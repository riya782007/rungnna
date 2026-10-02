import { db, put, uid, now, deviceId, getSetting, setSetting, type Bill, type Party, type Payment, type Receipt } from "./db";
import { due, fy, counterCode, isSale, isReturn, type Shop } from "./billing";
import { rupees } from "./format";
import { isOpen, isEstimate } from "./privacy";
import { Pdf, fit } from "./pdf";

/* A customer's account, the way a khata reads: what they bought (debit), what they paid (credit), balance. */
export type Entry = { at: string; kind: "opening" | "bill" | "paid" | "receipt" | "return" | "refund"; ref: string; id?: string; debit: number; credit: number; balance: number; note?: string };

/* sales that make the customer owe money (not challans, not bills merged into another invoice) */
const counted = (b: Bill) => b.status === "final" && !b.deleted && isSale(b) && (isOpen() || !isEstimate(b));
/* credit notes reduce what they owe; a refund paid out on one puts it back */
const creditNote = (b: Bill) => b.status === "final" && !b.deleted && isReturn(b) && (isOpen() || !isEstimate(b));
/* while estimates are locked, the part of a receipt that went to an estimate is left out too */
const visibleAmount = (r: Receipt) => (isOpen() ? r.amount : r.amount - r.allocations.filter(a => /^EST\//.test(a.bill_no)).reduce((x, a) => x + a.amount, 0));
const fromReceipt = (p: Payment) => (p.ref || "").startsWith("RCPT");

export async function ledger(party: Party): Promise<{ entries: Entry[]; balance: number; openingLeft: number }> {
  const [all, rcpts] = await Promise.all([
    db.bills.where("party_id").equals(party.id).toArray(),
    db.receipts.where("party_id").equals(party.id).filter(r => !r.deleted).toArray(),
  ]);
  const raw: Omit<Entry, "balance">[] = [];
  if (party.opening_balance) raw.push({ at: "0000", kind: "opening", ref: "Opening balance", debit: Math.max(0, party.opening_balance), credit: Math.max(0, -party.opening_balance) });
  const bills = all.filter(counted);
  for (const c of all.filter(creditNote)) {
    raw.push({ at: c.at, kind: "return", ref: c.no + (c.return_of_no ? " · return of " + c.return_of_no : ""), id: c.id, debit: 0, credit: c.net, note: `${c.total_qty} pcs back` });
    if (c.paid) raw.push({ at: c.at, kind: "refund", ref: "Refund on " + c.no, id: c.id, debit: c.paid, credit: 0 });
  }
  for (const b of bills) {
    raw.push({ at: b.at, kind: "bill", ref: b.no, id: b.id, debit: b.net, credit: 0, note: `${b.total_qty} pcs` });
    const paid = b.advance + b.payments.filter(p => p.mode !== "credit" && !fromReceipt(p)).reduce((a, p) => a + p.amount, 0);
    if (paid) raw.push({ at: b.at, kind: "paid", ref: "Paid on " + b.no, id: b.id, debit: 0, credit: paid });
  }
  for (const r of rcpts) { const amt = visibleAmount(r); if (amt) raw.push({ at: r.at, kind: "receipt", ref: r.no + " · " + r.mode.toUpperCase(), id: r.id, debit: 0, credit: amt, note: r.note }); }
  raw.sort((a, z) => (a.at < z.at ? -1 : a.at > z.at ? 1 : a.kind === "bill" ? -1 : 1));
  let bal = 0;
  const entries = raw.map(e => ({ ...e, balance: (bal += e.debit - e.credit) }));
  const openingLeft = Math.max(0, (party.opening_balance || 0) - rcpts.reduce((a, r) => a + r.opening_part, 0));
  return { entries, balance: bal, openingLeft };
}

/* Receive money: clears the opening balance first, then the oldest unpaid bills. Anything extra stays as advance. */
export async function receive(party: Party, amount: number, mode: Payment["mode"], note: string, by: string): Promise<Receipt> {
  const cc = await counterCode(); const key = `seq_RC_${fy()}_${cc}`;
  const n = (await getSetting<number>(key, 0)) + 1; await setSetting(key, n);
  const no = `RC/${fy()}/${cc}-${String(n).padStart(4, "0")}`;
  const { openingLeft } = await ledger(party);
  let left = amount;
  const opening_part = Math.min(left, openingLeft); left -= opening_part;
  const bills = (await db.bills.where("party_id").equals(party.id).filter(counted).toArray()).sort((a, z) => a.at.localeCompare(z.at));
  const allocations: Receipt["allocations"] = [];
  let rec!: Receipt;
  await db.transaction("rw", [db.bills, db.receipts, db.outbox], async () => {
    for (const b of bills) {
      if (left <= 0) break;
      const d = due(b); if (d <= 0) continue;
      const a = Math.min(d, left); left -= a;
      allocations.push({ bill_id: b.id, bill_no: b.no, amount: a });
      await put("bills", { ...b, payments: [...b.payments, { mode, amount: a, ref: "RCPT " + no, at: now() }], paid: b.paid + a });
    }
    const r: Receipt = { id: uid(), no, party_id: party.id, party_name: party.name, amount, mode, note, allocations, opening_part, unallocated: left,
      device: deviceId(), by_staff: by, at: now(), updated_at: now() };
    rec = await put("receipts", r);
  });
  return rec;
}

export function statementText(party: Party, entries: Entry[], balance: number, shop: Shop) {
  const last = entries.slice(-15);
  const L = [`*${shop.name}*`, `Account statement — ${party.name}`, new Date().toLocaleDateString("en-IN"), ""];
  if (entries.length > last.length) L.push(`(last ${last.length} entries)`);
  for (const e of last) L.push(`${e.kind === "opening" ? "Opening" : new Date(e.at).toLocaleDateString("en-IN")}  ${e.ref}  ${e.debit ? "+" + rupees(e.debit) : "−" + rupees(e.credit)}`);
  L.push("", balance > 0 ? `*Balance due: ${rupees(balance)}*` : balance < 0 ? `*Advance with us: ${rupees(-balance)}*` : "*All clear — nothing due* ✅");
  if (balance > 0 && shop.upi) L.push(`Pay by UPI: upi://pay?pa=${encodeURIComponent(shop.upi)}&pn=${encodeURIComponent(shop.name)}&am=${(balance / 100).toFixed(2)}&cu=INR`);
  L.push("", "Thank you 🙏");
  return L.join("\n");
}

/* Balances for every customer at once (list screens). */
export async function balances(): Promise<Map<string, number>> {
  const [parties, bills, rcpts] = await Promise.all([db.parties.toArray(), db.bills.filter(counted).toArray(), db.receipts.filter(r => !r.deleted).toArray()]);
  const m = new Map<string, number>();
  parties.forEach(p => m.set(p.id, p.opening_balance || 0));
  const cns = await db.bills.filter(creditNote).toArray();
  cns.forEach(c => { if (c.party_id) m.set(c.party_id, (m.get(c.party_id) || 0) - c.net + c.paid); });
  bills.forEach(b => { if (!b.party_id) return; const paid = b.advance + b.payments.filter(p => p.mode !== "credit" && !fromReceipt(p)).reduce((a, p) => a + p.amount, 0); m.set(b.party_id, (m.get(b.party_id) || 0) + b.net - paid); });
  rcpts.forEach(r => m.set(r.party_id, (m.get(r.party_id) || 0) - visibleAmount(r)));
  return m;
}

/* A statement for a date range: everything before `from` folds into one opening line. Dates are YYYY-MM-DD (local). */
export function statementRange(entries: Entry[], from: string, to: string): { opening: number; rows: Entry[]; closing: number; debit: number; credit: number } {
  const day = (e: Entry) => (e.kind === "opening" ? "0000" : localDay(e.at));
  const before = entries.filter(e => day(e) < from);
  const rows = entries.filter(e => day(e) >= from && day(e) <= to);
  const opening = before.length ? before[before.length - 1].balance : 0;
  let bal = opening;
  const out = rows.map(e => ({ ...e, balance: (bal += e.debit - e.credit) }));
  return { opening, rows: out, closing: bal, debit: rows.reduce((a, e) => a + e.debit, 0), credit: rows.reduce((a, e) => a + e.credit, 0) };
}
export const localDay = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export function rangeText(party: Party, st: ReturnType<typeof statementRange>, from: string, to: string, shop: Shop) {
  const f = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-IN");
  const L = [`*${shop.name}*`, `Statement — ${party.name}`, `${f(from)} to ${f(to)}`, "", `Opening: ${rupees(st.opening)}`];
  const rows = st.rows.slice(-25);
  if (st.rows.length > rows.length) L.push(`(last ${rows.length} of ${st.rows.length} entries — full list in the PDF)`);
  for (const e of rows) L.push(`${new Date(e.at).toLocaleDateString("en-IN")}  ${e.ref}  ${e.debit ? "+" + rupees(e.debit) : "−" + rupees(e.credit)}`);
  L.push("", `Billed ${rupees(st.debit)} · Paid/credited ${rupees(st.credit)}`);
  L.push(st.closing > 0 ? `*Balance due: ${rupees(st.closing)}*` : st.closing < 0 ? `*Advance with us: ${rupees(-st.closing)}*` : "*All clear — nothing due* ✅");
  if (st.closing > 0 && shop.upi) L.push(`Pay by UPI: upi://pay?pa=${encodeURIComponent(shop.upi)}&pn=${encodeURIComponent(shop.name)}&am=${(st.closing / 100).toFixed(2)}&cu=INR`);
  L.push("", "Thank you 🙏");
  return L.join("\n");
}

/* The statement as a PDF: header, opening line, one row per entry, running balance, totals; new page when full. */
export function statementPdf(party: Party, st: ReturnType<typeof statementRange>, from: string, to: string, shop: Shop): Uint8Array {
  const doc = new Pdf();
  const M = 40, R = doc.width - M;
  const col = { date: M, ref: M + 62, debit: R - 150, credit: R - 75, bal: R };
  const amt = (n: number) => (n / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const f = (d: string) => new Date(d + "T00:00").toLocaleDateString("en-IN");
  let y = 0;
  const head = (first: boolean) => {
    y = 50;
    if (first) {
      doc.text(M, y, shop.name, { size: 16, font: "F2" });
      doc.text(R, y, "ACCOUNT STATEMENT", { size: 11, font: "F2", align: "right" });
      y += 16; doc.text(M, y, [shop.address, shop.phone].filter(Boolean).join("  ·  "), { size: 8.5, gray: 0.35 });
      if (shop.gstin) { y += 12; doc.text(M, y, "GSTIN " + shop.gstin, { size: 8.5, gray: 0.35 }); }
      y += 22; doc.text(M, y, party.name, { size: 12, font: "F2" });
      doc.text(R, y, `${f(from)} to ${f(to)}`, { size: 10, align: "right" });
      y += 14; doc.text(M, y, [party.phone, party.city, party.gstin ? "GSTIN " + party.gstin : ""].filter(Boolean).join("  ·  "), { size: 9, gray: 0.35 });
      y += 18;
    } else { doc.text(M, y, `${party.name} — statement ${f(from)} to ${f(to)} (continued)`, { size: 9, gray: 0.35 }); y += 14; }
    doc.rect(M - 4, y - 11, R - M + 8, 16);
    doc.text(col.date, y, "Date", { size: 9, font: "F2" }); doc.text(col.ref, y, "Particulars", { size: 9, font: "F2" });
    doc.text(col.debit, y, "Debit", { size: 9, font: "F2", align: "right" }); doc.text(col.credit, y, "Credit", { size: 9, font: "F2", align: "right" });
    doc.text(col.bal, y, "Balance", { size: 9, font: "F2", align: "right" });
    y += 18;
  };
  const row = (date: string, ref: string, debit: number, credit: number, bal: number, bold = false) => {
    if (y > doc.height - 70) { doc.addPage(); head(false); }
    doc.text(col.date, y, date, { size: 9 });
    doc.text(col.ref, y, fit(ref, col.debit - 70 - col.ref, 9, bold ? "F2" : "F1"), { size: 9, font: bold ? "F2" : "F1" });
    if (debit) doc.text(col.debit, y, amt(debit), { size: 9, font: "F3", align: "right" });
    if (credit) doc.text(col.credit, y, amt(credit), { size: 9, font: "F3", align: "right" });
    doc.text(col.bal, y, amt(Math.abs(bal)) + (bal < 0 ? " Cr" : bal > 0 ? " Dr" : ""), { size: 9, font: "F3", align: "right" });
    doc.line(M, y + 5, R, y + 5, 0.3, 0.88);
    y += 16;
  };
  head(true);
  row(f(from), "Opening balance", 0, 0, st.opening, true);
  for (const e of st.rows) row(new Date(e.at).toLocaleDateString("en-IN"), e.ref + (e.note ? "  (" + e.note + ")" : ""), e.debit, e.credit, e.balance);
  if (y > doc.height - 110) { doc.addPage(); head(false); }
  y += 6; doc.line(M, y - 10, R, y - 10, 0.8, 0.4);
  doc.text(col.ref, y, "Totals for the period", { size: 9.5, font: "F2" });
  doc.text(col.debit, y, amt(st.debit), { size: 9.5, font: "F3", align: "right" }); doc.text(col.credit, y, amt(st.credit), { size: 9.5, font: "F3", align: "right" });
  y += 22;
  doc.text(M, y, st.closing > 0 ? "Balance due" : st.closing < 0 ? "Advance with us" : "All clear", { size: 12, font: "F2" });
  doc.text(R, y, "Rs. " + amt(Math.abs(st.closing)), { size: 12, font: "F2", align: "right" });
  if (st.closing > 0 && shop.upi) { y += 16; doc.text(M, y, "Pay by UPI: " + shop.upi, { size: 9, gray: 0.35 }); }
  y += 26; doc.text(M, y, `Printed ${new Date().toLocaleString("en-IN")}  ·  Dr = you owe us, Cr = advance with us`, { size: 8, gray: 0.5 });
  return doc.bytes();
}
