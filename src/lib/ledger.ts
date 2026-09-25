import { db, put, uid, now, deviceId, getSetting, setSetting, type Bill, type Party, type Payment, type Receipt } from "./db";
import { due, fy, counterCode, type Shop } from "./billing";
import { rupees } from "./format";
import { isOpen } from "./privacy";

/* A customer's account, the way a khata reads: what they bought (debit), what they paid (credit), balance. */
export type Entry = { at: string; kind: "opening" | "bill" | "paid" | "receipt"; ref: string; id?: string; debit: number; credit: number; balance: number; note?: string };

const counted = (b: Bill) => b.status === "final" && !b.deleted && (isOpen() || b.bill_type !== "estimate");
/* while estimates are locked, the part of a receipt that went to an estimate is left out too */
const visibleAmount = (r: Receipt) => (isOpen() ? r.amount : r.amount - r.allocations.filter(a => /^EST\//.test(a.bill_no)).reduce((x, a) => x + a.amount, 0));
const fromReceipt = (p: Payment) => (p.ref || "").startsWith("RCPT");

export async function ledger(party: Party): Promise<{ entries: Entry[]; balance: number; openingLeft: number }> {
  const [bills, rcpts] = await Promise.all([
    db.bills.where("party_id").equals(party.id).filter(counted).toArray(),
    db.receipts.where("party_id").equals(party.id).filter(r => !r.deleted).toArray(),
  ]);
  const raw: Omit<Entry, "balance">[] = [];
  if (party.opening_balance) raw.push({ at: "0000", kind: "opening", ref: "Opening balance", debit: Math.max(0, party.opening_balance), credit: Math.max(0, -party.opening_balance) });
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
      await put("bills", { ...b, payments: [...b.payments, { mode, amount: a, ref: "RCPT " + no }], paid: b.paid + a });
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
  bills.forEach(b => { if (!b.party_id) return; const paid = b.advance + b.payments.filter(p => p.mode !== "credit" && !fromReceipt(p)).reduce((a, p) => a + p.amount, 0); m.set(b.party_id, (m.get(b.party_id) || 0) + b.net - paid); });
  rcpts.forEach(r => m.set(r.party_id, (m.get(r.party_id) || 0) - visibleAmount(r)));
  return m;
}
