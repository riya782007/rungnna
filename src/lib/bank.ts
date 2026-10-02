import { db, put, now, uid, type BankLine, type Party } from "./db";
import { num, txt } from "./importer";
import { inStore, currentStore, ownerOnly } from "./scope";
import { saveVoucher } from "./vouchers";
import { receive } from "./ledger";
import { assertUnlocked } from "./finance";

export type BankMap = Partial<Record<"date" | "narration" | "debit" | "credit" | "ref" | "amount" | "direction", number>>;
const aliases = {
  date: ["date", "txndate", "transactiondate", "valuedate", "postingdate"],
  narration: ["narration", "description", "particulars", "transactiondetails", "remarks"],
  debit: ["debit", "debitamount", "withdrawal", "withdrawals", "withdrawalamt", "withdrawalamount", "dramount"],
  credit: ["credit", "creditamount", "deposit", "deposits", "depositamt", "depositamount", "cramount"],
  ref: ["ref", "referenceno", "reference", "chequeno", "chqrefno", "chequereferenceno", "utr", "transactionid"],
  amount: ["amount", "transactionamount"], direction: ["drcr", "type", "transactiontype", "debitcredit"],
};
export function bankMap(headers: unknown[]): BankMap {
  const h = headers.map(x => txt(x).toLowerCase().replace(/[^a-z]/g, "")), out: BankMap = {};
  for (const [key, values] of Object.entries(aliases)) { const i = h.findIndex(s => values.includes(s) || values.some(v => s === v + "inr" || s === v + "rs")); if (i >= 0) out[key as keyof BankMap] = i; }
  return out;
}
export function bankDate(v: unknown): string {
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 100000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10);
  const s = txt(v), m = s.match(/^(\d{1,2})[./-](\d{1,2}|[A-Za-z]{3})[./-](\d{2}|\d{4})$/);
  let y: number, mo: number, day: number;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) [y, mo, day] = s.split("-").map(Number);
  else if (m) { day = Number(m[1]); mo = /^\d+$/.test(m[2]) ? Number(m[2]) : "jan feb mar apr may jun jul aug sep oct nov dec".split(" ").indexOf(m[2].toLowerCase()) + 1; y = Number(m[3]); if (y < 100) y += y < 70 ? 2000 : 1900; }
  else throw new Error("Unrecognised bank date: " + s);
  const d = new Date(Date.UTC(y, mo - 1, day));
  if (d.getUTCFullYear() !== y || d.getUTCMonth() !== mo - 1 || d.getUTCDate() !== day) throw new Error("Invalid bank date: " + s);
  return d.toISOString().slice(0, 10);
}
export function parseBankRows(rows: unknown[][], mapping: BankMap, account: string): Omit<BankLine, "id" | "updated_at" | "batch">[] {
  if (mapping.date === undefined || mapping.narration === undefined || (mapping.debit === undefined && mapping.credit === undefined && mapping.amount === undefined)) throw new Error("Map date, narration and amount columns");
  const occurrences = new Map<string, number>();
  return rows.filter(r => r.some(v => txt(v))).map((r, i) => {
    const val = (k: keyof BankMap) => mapping[k] === undefined ? "" : r[mapping[k]!];
    const date = bankDate(val("date")), narration = txt(val("narration")), ref = txt(val("ref"));
    let debit = Math.round(Math.abs(num(val("debit"))) * 100), credit = Math.round(Math.abs(num(val("credit"))) * 100);
    if (!debit && !credit && mapping.amount !== undefined) { const amount = Math.round(num(val("amount")) * 100), dr = /dr|debit|withdraw/i.test(txt(val("direction"))) || amount < 0; if (dr) debit = Math.abs(amount); else credit = Math.abs(amount); }
    if ((!debit && !credit) || (debit && credit)) throw new Error(`Row ${i + 1}: choose either debit or credit`);
    const identity = JSON.stringify([currentStore(), account.trim().toUpperCase(), date, narration, ref, debit, credit]);
    const occurrence = (occurrences.get(identity) || 0) + 1; occurrences.set(identity, occurrence);
    return { account, date, narration, ref, debit, credit, store_id: currentStore(), fingerprint: identity + ":" + occurrence };
  });
}
export async function importBank(lines: ReturnType<typeof parseBankRows>) {
  ownerOnly();
  return db.transaction("rw", [db.bank_lines, db.outbox], async () => {
    let count = 0; const batch = uid();
    for (const l of lines) { if (await db.bank_lines.where("fingerprint").equals(l.fingerprint).count()) continue; await put("bank_lines", { ...l, id: uid(), batch, updated_at: now() }); count++; }
    return count;
  });
}
export type BankCandidate = { key: string; table: "receipts" | "vouchers" | "bills"; id: string; at: string; amount: number; credit: boolean; name: string; ref: string; no: string };
export async function bankCandidates(): Promise<BankCandidate[]> {
  const [receipts, vouchers, bills] = await Promise.all([db.receipts.filter(r => !r.deleted && inStore(r) && !["cash", "credit"].includes(r.mode)).toArray(), db.vouchers.filter(v => !v.deleted && inStore(v) && ["payment", "expense", "receipt"].includes(v.type) && !["cash", "credit"].includes(v.mode)).toArray(), db.bills.filter(b => !b.deleted && inStore(b) && b.status === "final" && b.bill_type === "gst").toArray()]);
  return [
    ...receipts.map(r => ({ key: "receipts:" + r.id, table: "receipts" as const, id: r.id, at: r.at, amount: r.amount, credit: true, name: r.party_name, ref: r.note, no: r.no })),
    ...vouchers.map(v => ({ key: "vouchers:" + v.id, table: "vouchers" as const, id: v.id, at: v.at, amount: v.amount, credit: v.type === "receipt", name: v.party_name || v.category || "", ref: v.ref || v.note, no: v.no })),
    ...bills.flatMap(b => b.payments.flatMap((p, i) => ["cash", "credit"].includes(p.mode) || p.ref?.startsWith("RCPT") ? [] : [{ key: `bills:${b.id}:${i}`, table: "bills" as const, id: b.id, at: p.at || b.at, amount: p.amount, credit: true, name: b.party_name, ref: p.ref || "", no: b.no }])),
  ];
}
export function matchScore(line: BankLine, c: BankCandidate): number {
  if (c.amount !== (line.debit || line.credit) || c.credit !== !!line.credit) return 0;
  const days = Math.abs(Date.parse(line.date) - Date.parse(c.at.slice(0, 10))) / 864e5; if (days > 3 || !Number.isFinite(days)) return 0;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const narration = norm(line.narration + line.ref), ref = norm(c.ref), name = norm(c.name);
  return 10 + (3 - days) + (ref.length >= 6 && narration.includes(ref) ? 100 : 0) + (name.length >= 3 && narration.includes(name) ? 30 : 0);
}
export async function acceptMatch(id: string, key: string, manual = false) {
  ownerOnly();
  return db.transaction("rw", [db.bank_lines, db.receipts, db.vouchers, db.bills, db.config, db.outbox], async () => {
    const l = await db.bank_lines.get(id); if (!l || !inStore(l) || l.match_key) throw new Error("Statement line already matched or unavailable");
    await assertUnlocked(l.date);
    const c = (await bankCandidates()).find(c => c.key === key);
    if (!c || c.amount !== (l.debit || l.credit) || c.credit !== !!l.credit || (!manual && !matchScore(l, c))) throw new Error("Amount, direction or date do not match");
    if (await db.bank_lines.filter(x => !x.deleted && inStore(x) && x.match_key === key).count()) throw new Error("This voucher is already reconciled");
    await put("bank_lines", { ...l, match_key: key, matched_at: now() });
  });
}
export async function voucherFromBank(id: string, type: "receipt" | "payment" | "expense", by: string, party?: Party, category = "other") {
  ownerOnly();
  return db.transaction("rw", [db.bank_lines, db.vouchers, db.receipts, db.bills, db.config, db.settings, db.stores, db.outbox], async () => {
    const l = await db.bank_lines.get(id); if (!l || !inStore(l) || l.match_key) throw new Error("Statement line unavailable or reconciled");
    await assertUnlocked(l.date);
    if (!!l.credit !== (type === "receipt")) throw new Error("Debit lines need a payment or expense; credit lines need a receipt");
    if (type === "payment" && party?.kind !== "supplier") throw new Error("Choose a supplier");
    if (type === "receipt" && (!party || party.kind === "supplier")) throw new Error("Choose a customer");
    const amount = l.debit || l.credit, note = [l.narration, l.ref].filter(Boolean).join(" · ");
    const v = type === "receipt" ? await receive(party!, amount, "bank", note, by, l.date + "T12:00:00.000Z") : await saveVoucher({ type, amount, mode: "bank", by, party, category: category as any, note, ref: l.ref, at: l.date + "T12:00:00.000Z" });
    await put("bank_lines", { ...l, match_key: (type === "receipt" ? "receipts:" : "vouchers:") + v.id, matched_at: now() }); return v;
  });
}
