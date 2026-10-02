import { db, type Bill, type BillLine, type Product, type Voucher } from "./db";
import { due, isReturn, isSale } from "./billing";
import { localDay } from "./ledger";
import { isEstimate, isOpen } from "./privacy";
import { currentStore, inStore } from "./scope";

export type Range = { from: string; to: string; store?: string };
export type ReportRow = Record<string, string | number>;

const inRange = (iso: string, r: Range) => {
  const d = localDay(iso);
  return d >= r.from && d <= r.to;
};
const counted = (b: Bill) => b.status === "final" && !b.deleted && (isOpen() || !isEstimate(b));
const sales = (b: Bill) => counted(b) && isSale(b);
const returns = (b: Bill) => counted(b) && isReturn(b);

export async function reportData(r: Range) {
  const store = r.store ?? currentStore();
  const scoped = (row: { store_id?: string | null }) => store === "all" || inStore(row, store);
  const rackIds = new Set((await db.locations.filter(scoped).toArray()).map(l => l.id));
  const [bills, parties, products, stock, moves, vouchers, returnsRows] = await Promise.all([
    db.bills.filter(b => scoped(b) && inRange(b.at, r)).toArray(),
    db.parties.toArray(),
    db.products.toArray(),
    db.stock.filter(c => rackIds.has(c.loc_id)).toArray(),
    db.movements.filter(scoped).toArray(),
    db.vouchers.filter(v => scoped(v) && inRange(v.at, r)).toArray(),
    db.purchase_returns.filter(x => scoped(x) && inRange(x.at, r)).toArray(),
  ]);
  const pmap = new Map(parties.map(p => [p.id, p]));
  const prod = new Map(products.map(p => [p.id, p]));
  const rowsFor = (bs: Bill[]) => bs.flatMap(b => b.items.map(l => ({ b, l, p: l.product_id ? prod.get(l.product_id) : undefined })));
  const saleBills = bills.filter(sales), returnBills = bills.filter(returns);
  const lines = rowsFor(saleBills), returnLines = rowsFor(returnBills);
  const by = (key: (b: Bill, l?: BillLine, p?: Product) => string, value: (b: Bill, l?: BillLine, p?: Product) => number) => {
    const m = new Map<string, ReportRow>();
    for (const { b, l, p } of lines) {
      const k = key(b, l, p) || "Unspecified";
      const row = m.get(k) || { name: k, qty: 0, sales: 0 };
      row.qty = Number(row.qty) + (l?.qty || 0); row.sales = Number(row.sales) + value(b, l, p); m.set(k, row);
    }
    return [...m.values()].sort((a, z) => Number(z.sales) - Number(a.sales));
  };
  const groupedBills = (key: (b: Bill) => string) => { const m = new Map<string, ReportRow>(); for (const b of saleBills) { const k = key(b) || "Unspecified", row = m.get(k) || { name: k, qty: 0, sales: 0 }; row.qty = Number(row.qty) + b.total_qty; row.sales = Number(row.sales) + b.net; m.set(k, row); } return [...m.values()]; };
  const byDay = groupedBills(b => localDay(b.at));
  const byMonth = groupedBills(b => localDay(b.at).slice(0, 7));
  const byItem = by((_b, l, p) => [l?.item || p?.item, l?.style || p?.style].filter(Boolean).join(" · "), (_b, l) => l?.amount || 0);
  const byParty = groupedBills(b => b.party_name || "Walk-in");
  const byArea = groupedBills(b => {
    const p = b.party_id ? pmap.get(b.party_id) : undefined;
    return [p?.city, p?.state || b.party_state].filter(Boolean).join(", ");
  });
  const bySalesman = groupedBills(b => b.salesman || "No salesman");
  const costByProduct = new Map(products.map(p => [p.id, p.cost || 0]));
  const cogs = lines.reduce((a, x) => a + (costByProduct.get(x.l.product_id || "") || 0) * x.l.qty, 0) -
    returnLines.reduce((a, x) => a + (costByProduct.get(x.l.product_id || "") || 0) * x.l.qty, 0);
  const expense = vouchers.filter((v: Voucher) => !v.deleted && v.type === "expense").reduce((a, v) => a + v.amount, 0);
  const saleTotal = saleBills.reduce((a, b) => a + b.net, 0);
  const returnTotal = returnBills.reduce((a, b) => a + b.net, 0);
  const pl = [{ name: "Sales", amount: saleTotal }, { name: "Returns", amount: -returnTotal }, { name: "COGS", amount: -cogs }, { name: "Expenses", amount: -expense }, { name: "Profit", amount: saleTotal - returnTotal - cogs - expense }];
  const valuation = stock.filter(c => c.qty).map(c => {
    const p = prod.get(c.product_id);
    return { rack: c.loc_id, code: p?.code || "", item: [p?.item, p?.style, p?.color].filter(Boolean).join(" · "), qty: c.qty, cost: p?.cost || 0, rate: p?.rate || 0, cost_value: c.qty * (p?.cost || 0), rate_value: c.qty * (p?.rate || 0) };
  });
  const soldAfter = new Map<string, string>();
  moves.filter(m => m.kind === "sale").forEach(m => soldAfter.set(m.product_id, m.at));
  const today = new Date(r.to + "T00:00").getTime();
  const dead = products.filter(p => !p.deleted && p.tk?.trim()).map(p => {
    const last = soldAfter.get(p.id);
    const days = last ? Math.floor((today - new Date(localDay(last) + "T00:00").getTime()) / 864e5) : 9999;
    const qty = stock.filter(c => c.product_id === p.id).reduce((a, c) => a + c.qty, 0);
    return { code: p.code, item: [p.item, p.style, p.color].filter(Boolean).join(" · "), qty, last_sale: last ? localDay(last) : "Never", days };
  }).filter(x => x.qty > 0 && x.days >= 90);
  const gstr = saleBills.filter(b => b.bill_type === "gst").reduce((m, b) => {
    const type = b.party_gstin ? "B2B" : "B2C";
    for (const l of b.items) {
      const p = l.product_id ? prod.get(l.product_id) : undefined;
      const hsn = p?.hsn || "7117";
      const k = type + "|" + hsn;
      const row = m.get(k) || { type, hsn, taxable: 0, gst: 0, invoices: 0 };
      row.taxable = Number(row.taxable) + l.amount;
      row.gst = Number(row.gst) + Math.round(l.amount * b.gst_rate / (b.gst_mode === "inclusive" ? 100 + b.gst_rate : 100));
      row.invoices = Number(row.invoices) + 1;
      m.set(k, row);
    }
    return m;
  }, new Map<string, ReportRow>());
  return { byDay, byMonth, byItem, byParty, byArea, bySalesman, valuation, dead, pl, gstr: [...gstr.values()], supplierReturns: returnsRows, dues: saleBills.reduce((a, b) => a + Math.max(0, due(b)), 0) };
}

export function csv(rows: ReportRow[]) {
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [cols.map(esc).join(","), ...rows.map(r => cols.map(c => esc(r[c])).join(","))].join("\n");
}

export function exportExcel(name: string, rows: ReportRow[]) {
  const blob = new Blob(["\ufeff" + csv(rows)], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = name.replace(/\.xlsx$/i, "") + ".xls"; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
