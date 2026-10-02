import { db, put, uid, now, deviceId, type Movement, type Party, type Purchase, type PurchaseReturn, type PurchaseReturnLine, type Voucher } from "./db";
import { getShop, type Shop } from "./billing";
import { rupees } from "./format";
import { localDay } from "./ledger";
import { Pdf, fit } from "./pdf";
import { nextSeries } from "./vouchers";
import { waLink } from "./billing";
import { assertUnlocked } from "./finance";

export type SupplierEntry = { at: string; kind: "opening" | "bill" | "payment" | "debit_note" | "journal"; ref: string; id?: string; debit: number; credit: number; balance: number; note?: string };

const payablePurchase = (p: Purchase) => p.status === "final" && !p.deleted && !!(p.supplier_id || p.supplier_name) && p.total_cost > 0;
const supplierPayment = (v: Voucher, id: string) => !v.deleted && v.type === "payment" && v.party_kind === "supplier" && v.party_id === id;

export async function supplierLedger(party: Party): Promise<{ entries: SupplierEntry[]; balance: number }> {
  const [purchases, returns, vouchers] = await Promise.all([
    db.purchases.filter(p => payablePurchase(p) && (p.supplier_id === party.id || (!p.supplier_id && p.supplier_name === party.name))).toArray(),
    db.purchase_returns.filter(r => !r.deleted && (r.supplier_id === party.id || (!r.supplier_id && r.supplier_name === party.name))).toArray(),
    db.vouchers.filter(v => supplierPayment(v, party.id) || (!v.deleted && v.type === "journal" && v.party_id === party.id)).toArray(),
  ]);
  const raw: Omit<SupplierEntry, "balance">[] = [];
  if (party.opening_balance) raw.push({ at: "0000", kind: "opening", ref: "Opening balance", debit: Math.max(0, party.opening_balance), credit: Math.max(0, -party.opening_balance) });
  purchases.forEach(p => raw.push({ at: p.at, kind: "bill", ref: p.no + (p.supplier_bill ? " · " + p.supplier_bill : ""), id: p.id, debit: p.total_cost, credit: 0, note: `${p.total_qty} pcs` }));
  returns.forEach(r => raw.push({ at: r.at, kind: "debit_note", ref: r.no, id: r.id, debit: 0, credit: r.total_cost, note: `${r.total_qty} pcs returned` }));
  vouchers.forEach(v => raw.push({ at: v.at, kind: v.type === "journal" ? "journal" : "payment", ref: v.no + " · " + v.mode.toUpperCase(), id: v.id, debit: 0, credit: v.amount, note: v.note }));
  raw.sort((a, z) => (a.at < z.at ? -1 : a.at > z.at ? 1 : a.kind === "bill" ? -1 : 1));
  let bal = 0;
  return { entries: raw.map(e => ({ ...e, balance: (bal += e.debit - e.credit) })), balance: bal };
}

export async function supplierBalances() {
  const suppliers = await db.parties.filter(p => !p.deleted && p.kind === "supplier").toArray();
  const rows = await Promise.all(suppliers.map(async p => [p.id, (await supplierLedger(p)).balance] as const));
  return new Map(rows);
}

export async function supplierAging(today = localDay(new Date().toISOString())) {
  const suppliers = await db.parties.filter(p => !p.deleted && p.kind === "supplier").toArray();
  const out = new Map<string, { d0_30: number; d31_60: number; d60: number; total: number }>();
  for (const p of suppliers) {
    const led = await supplierLedger(p);
    let payments = led.entries.filter(e => e.credit > 0).reduce((a, e) => a + e.credit, 0);
    const buckets = { d0_30: 0, d31_60: 0, d60: 0, total: Math.max(0, led.balance) };
    for (const e of led.entries.filter(e => e.debit > 0).sort((a, z) => a.at.localeCompare(z.at))) {
      const left = Math.max(0, e.debit - payments);
      payments = Math.max(0, payments - e.debit);
      if (!left) continue;
      const age = Math.floor((new Date(today + "T00:00").getTime() - new Date(localDay(e.at) + "T00:00").getTime()) / 864e5);
      if (age <= 30) buckets.d0_30 += left;
      else if (age <= 60) buckets.d31_60 += left;
      else buckets.d60 += left;
    }
    out.set(p.id, buckets);
  }
  return out;
}

export async function savePurchaseReturn(input: {
  supplier: Party;
  purchase?: Purchase;
  items: PurchaseReturnLine[];
  note?: string;
  by: string;
}): Promise<PurchaseReturn> {
  await assertUnlocked(now());
  const num = await nextSeries("DN");
  const total_qty = input.items.reduce((a, l) => a + l.qty, 0);
  const total_cost = input.items.reduce((a, l) => a + l.qty * l.cost, 0);
  const row: PurchaseReturn = {
    id: uid(), ...num, supplier_id: input.supplier.id, supplier_name: input.supplier.name, purchase_id: input.purchase?.id, purchase_no: input.purchase?.no,
    items: input.items, total_qty, total_cost, note: input.note || "", device: deviceId(), by_staff: input.by, at: now(), updated_at: now(),
  };
  await db.transaction("rw", [db.purchase_returns, db.movements, db.outbox, db.stock], async () => {
    await put("purchase_returns", row);
    for (const l of row.items) {
      if (!l.qty || !l.loc_id) continue;
      const m: Movement = { id: uid(), product_id: l.product_id, kind: "adjust", qty: l.qty, from_loc: l.loc_id, to_loc: null,
        person_type: "supplier", person_name: row.supplier_name, by_staff: row.by_staff, note: row.no, device: deviceId(), ref_bill: row.id, at: row.at, updated_at: now() };
      await put("movements", m);
      const key = l.product_id + "|" + l.loc_id;
      const c = await db.stock.get(key);
      await db.stock.put({ key, product_id: l.product_id, loc_id: l.loc_id, qty: (c?.qty || 0) - l.qty });
    }
  });
  return row;
}

export function supplierStatementText(p: Party, entries: SupplierEntry[], balance: number, shop: Shop) {
  const L = [`*${shop.name}*`, `Supplier statement — ${p.name}`, new Date().toLocaleDateString("en-IN"), ""];
  entries.slice(-20).forEach(e => L.push(`${e.kind === "opening" ? "Opening" : new Date(e.at).toLocaleDateString("en-IN")}  ${e.ref}  ${e.debit ? "+" + rupees(e.debit) : "-" + rupees(e.credit)}`));
  L.push("", balance > 0 ? `*Payable: ${rupees(balance)}*` : balance < 0 ? `*Debit balance: ${rupees(-balance)}*` : "*All clear*");
  return L.join("\n");
}

export function supplierStatementPdf(p: Party, entries: SupplierEntry[], shop: Shop): Uint8Array {
  const doc = new Pdf();
  const M = 40, R = doc.width - M;
  let y = 50;
  const amt = (n: number) => (n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  doc.text(M, y, shop.name, { size: 16, font: "F2" });
  doc.text(R, y, "SUPPLIER STATEMENT", { size: 11, font: "F2", align: "right" });
  y += 24; doc.text(M, y, p.name, { size: 12, font: "F2" }); y += 22;
  doc.rect(M - 4, y - 12, R - M + 8, 17);
  doc.text(M, y, "Date", { size: 9, font: "F2" }); doc.text(M + 70, y, "Particulars", { size: 9, font: "F2" }); doc.text(R - 120, y, "Debit", { size: 9, font: "F2", align: "right" }); doc.text(R - 55, y, "Credit", { size: 9, font: "F2", align: "right" }); doc.text(R, y, "Balance", { size: 9, font: "F2", align: "right" });
  y += 18;
  for (const e of entries) {
    if (y > doc.height - 70) { doc.addPage(); y = 50; }
    doc.text(M, y, e.kind === "opening" ? "-" : new Date(e.at).toLocaleDateString("en-IN"), { size: 9 });
    doc.text(M + 70, y, fit(e.ref + (e.note ? " (" + e.note + ")" : ""), 250, 9), { size: 9 });
    if (e.debit) doc.text(R - 120, y, amt(e.debit), { size: 9, font: "F3", align: "right" });
    if (e.credit) doc.text(R - 55, y, amt(e.credit), { size: 9, font: "F3", align: "right" });
    doc.text(R, y, amt(Math.abs(e.balance)) + (e.balance < 0 ? " Dr" : e.balance > 0 ? " Cr" : ""), { size: 9, font: "F3", align: "right" });
    y += 16;
  }
  return doc.bytes();
}

export async function shareSupplierStatement(p: Party) {
  const shop = await getShop();
  const led = await supplierLedger(p);
  return { text: supplierStatementText(p, led.entries, led.balance, shop), pdf: supplierStatementPdf(p, led.entries, shop), wa: waLink(p.phone, supplierStatementText(p, led.entries, led.balance, shop)) };
}
