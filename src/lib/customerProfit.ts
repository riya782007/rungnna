import { db, type Bill } from "./db";
import { inStore } from "./scope";
import { isSale, isReturn } from "./billing";
import { isEstimate, isOpen } from "./privacy";

/* Owner, 22 Oct: "when a customer is made he should have his own profit and loss, cost to sale and profit,
   sale pattern and AI, journal, debit and credit, narration". Worked out on this computer from the bills of the
   company that is open (estimate company → estimates, tax-invoice company → invoices), so it works offline and
   needs nothing typed. The "AI" lines are plain-word advice from his own numbers. */
export type CustomerProfit = {
  bills: number; sales: number; returns: number; cost: number; profit: number; margin: number; costKnown: number;
  months: { label: string; amount: number }[]; items: { name: string; qty: number; amount: number }[];
  everyDays: number; lastDays: number; firstAt: string; advice: string[];
};
const day = 86400000;
const revenue = (b: Bill) => Math.max(0, b.net - (b.gst || 0));   // what he earns before tax

export async function customerProfit(partyId: string, balance = 0, now = Date.now()): Promise<CustomerProfit> {
  const all = (await db.bills.where("party_id").equals(partyId).toArray())
    .filter(b => inStore(b) && b.status === "final" && !b.deleted && (isOpen() || !isEstimate(b)));
  const sales = all.filter(isSale).sort((a, z) => (a.at < z.at ? -1 : 1)), back = all.filter(isReturn);
  const ids = [...new Set([...sales, ...back].flatMap(b => b.items.map(l => l.product_id).filter(Boolean) as string[]))];
  const products = new Map((await db.products.bulkGet(ids)).filter(Boolean).map(p => [p!.id, p!]));
  let cost = 0, valued = 0, lines = 0;
  const items = new Map<string, { qty: number; amount: number }>();
  for (const b of sales) for (const l of b.items) {
    lines++;
    const c = l.product_id ? products.get(l.product_id)?.cost || 0 : 0;
    if (c > 0) { cost += c * l.qty; valued++; }
    const name = (l.item || "ITEM").trim().toUpperCase(), it = items.get(name) || { qty: 0, amount: 0 };
    items.set(name, { qty: it.qty + l.qty, amount: it.amount + l.amount });
  }
  for (const b of back) for (const l of b.items) { const c = l.product_id ? products.get(l.product_id)?.cost || 0 : 0; cost -= c * l.qty; }
  const sold = sales.reduce((a, b) => a + revenue(b), 0), returned = back.reduce((a, b) => a + revenue(b), 0);
  const profit = sold - returned - cost;
  // the last six months, oldest first
  const months: { label: string; amount: number }[] = [];
  const ref = new Date(now);
  for (let i = 5; i >= 0; i--) {
    const d = new Date(ref.getFullYear(), ref.getMonth() - i, 1), key = `${d.getFullYear()}-${d.getMonth()}`;
    months.push({ label: d.toLocaleDateString("en-IN", { month: "short" }), amount: sales.filter(b => { const x = new Date(b.at); return `${x.getFullYear()}-${x.getMonth()}` === key; }).reduce((a, b) => a + revenue(b), 0) });
  }
  const gaps = sales.slice(1).map((b, i) => (Date.parse(b.at) - Date.parse(sales[i].at)) / day).filter(g => g >= 0.5);
  const everyDays = gaps.length ? Math.round(gaps.reduce((a, g) => a + g, 0) / gaps.length) : 0;
  const lastDays = sales.length ? Math.floor((now - Date.parse(sales[sales.length - 1].at)) / day) : 0;
  const top = [...items].map(([name, v]) => ({ name, ...v })).sort((a, z) => z.amount - a.amount);
  const net = sold - returned, margin = net > 0 && valued ? Math.round(profit / net * 100) : 0;

  const advice: string[] = [];
  const r = (p: number) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
  if (!sales.length) advice.push("No bills yet in this company.");
  else {
    if (everyDays) advice.push(lastDays > everyDays * 1.5
      ? `Usually buys every ${everyDays} days, but the last bill was ${lastDays} days ago — call him today.`
      : `Buys about every ${everyDays} days; last bill ${lastDays} day${lastDays === 1 ? "" : "s"} ago.`);
    if (top.length) advice.push(`Mostly buys ${top.slice(0, 3).map(t => `${t.name} (${net ? Math.round(t.amount / Math.max(1, sold) * 100) : 0}%)`).join(", ")} — show him new ${top[0].name} first.`);
    if (valued) advice.push(margin < 15 ? `Profit on him is only ${margin}%. Check the discounts before the next bill.` : `Profit on him is ${margin}% (${r(profit)} so far).`);
    if (valued < lines) advice.push(`${lines - valued} of ${lines} lines have no cost on the product, so the profit leaves them out.`);
    if (returned > net * 0.1 && returned > 0) advice.push(`Returns are high (${r(returned)}). Ask him why before sending the same goods.`);
    if (balance > 0) advice.push(`He owes ${r(balance)}. Ask for it with the next bill.`);
  }
  return { bills: sales.length, sales: sold, returns: returned, cost, profit, margin, costKnown: valued, months, items: top.slice(0, 8), everyDays, lastDays, firstAt: sales[0]?.at || "", advice };
}
