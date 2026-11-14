import { db, type Bill, type Party } from "./db";
import { balances } from "./ledger";

/* Customer ranking, purchase cycle and "not coming back" alerts (owner's list R-14, R-65, R-80, R-81).
   Worked out on this computer from the bills already here — no AI call, works offline. */

export type Grade = "A" | "B" | "C" | "New";
export type CustomerStat = {
  party_id: string; name: string; phone: string; city: string;
  total: number; bills: number; first: string; last: string;
  gapDays: number;        // usual days between two visits (0 = only one visit)
  daysSince: number;      // days since the last bill
  grade: Grade; rank: number;
  points: number;         // 1 point per ₹1,000 bought in the last 12 months
  top: string[];          // what they buy most (by pieces): their "group"
  notReturning: boolean;
  why: string[];          // likely reasons, for customers who stopped coming
  returns: number; due: number;
};

const DAY = 86400000;
// only final bills: a converted estimate / merged challan lives on inside the invoice it became
const counted = (b: Bill) => !b.deleted && b.status === "final" && b.bill_type !== "return";

export function rankCustomers(bills: Bill[], parties: Party[], due: Map<string, number>, openIssues: Map<string, number> = new Map(), at = Date.now()): CustomerStat[] {
  const since = at - 365 * DAY;
  const by = new Map<string, Bill[]>();
  const rets = new Map<string, number>();
  for (const b of bills) {
    if (!b.party_id || b.deleted) continue;
    if (b.bill_type === "return") { rets.set(b.party_id, (rets.get(b.party_id) || 0) + 1); continue; }
    if (!counted(b)) continue;
    if (Date.parse(b.at) < since) continue;
    (by.get(b.party_id) || by.set(b.party_id, []).get(b.party_id)!).push(b);
  }
  const ps = new Map(parties.map(p => [p.id, p]));
  const out: CustomerStat[] = [];
  for (const [id, list] of by) {
    const p = ps.get(id); if (!p || p.deleted || p.kind === "supplier") continue;
    list.sort((a, z) => a.at.localeCompare(z.at));
    const days = [...new Set(list.map(b => b.at.slice(0, 10)))];
    const first = list[0].at, last = list[list.length - 1].at;
    const gapDays = days.length > 1 ? Math.round((Date.parse(days[days.length - 1]) - Date.parse(days[0])) / DAY / (days.length - 1)) : 0;
    const daysSince = Math.floor((at - Date.parse(last)) / DAY);
    const total = list.reduce((a, b) => a + (b.net || 0), 0);
    const items = new Map<string, number>();
    for (const b of list) for (const l of b.items || []) { const k = (l.item || "").trim().toUpperCase(); if (k) items.set(k, (items.get(k) || 0) + (l.qty || 0)); }
    const top = [...items].sort((a, z) => z[1] - a[1]).slice(0, 3).map(x => x[0]);
    const notReturning = days.length >= 2 ? daysSince > Math.max(30, gapDays * 2) : daysSince > 90;
    const d = due.get(id) || 0, r = rets.get(id) || 0;
    const why: string[] = [];
    if (notReturning) {
      if (d > 0) why.push(`₹${Math.round(d / 100).toLocaleString("en-IN")} still due — may be avoiding the shop`);
      if (r) why.push(`${r} return${r > 1 ? "s" : ""} (credit note) — check the goods / quality`);
      if (openIssues.get(id)) why.push(`${openIssues.get(id)} repair / complaint still open`);
      const lastDisc = list[list.length - 1].discount_pct || 0, avgDisc = list.reduce((a, b) => a + (b.discount_pct || 0), 0) / list.length;
      if (list.length > 1 && lastDisc + 2 < avgDisc) why.push(`Last bill had less discount (${lastDisc}% vs usual ${Math.round(avgDisc)}%)`);
      if (!why.length) why.push("No complaint or dues on record — call and ask; may be buying elsewhere");
    }
    out.push({ party_id: id, name: p.name, phone: p.phone, city: p.city, total, bills: list.length, first, last, gapDays, daysSince, grade: "C", rank: 0, points: Math.floor(total / 100000), top, notReturning, why, returns: r, due: d });
  }
  out.sort((a, z) => z.total - a.total);
  const n = out.length;
  out.forEach((c, i) => {
    c.rank = i + 1;
    c.grade = c.bills === 1 && c.daysSince < 60 ? "New" : i < Math.ceil(n * 0.2) ? "A" : i < Math.ceil(n * 0.5) ? "B" : "C";
  });
  return out;
}

/** Open repairs / complaints per customer (from the Customer desk). */
export async function openIssueCounts(): Promise<Map<string, number>> {
  const rows = await db.config.filter(c => c.id.startsWith("desk:") && !c.deleted).toArray();
  const m = new Map<string, number>();
  for (const r of rows) { const v = r.value || {}; if (v.party_id && v.status !== "closed" && (v.kind === "repair" || v.kind === "complaint")) m.set(v.party_id, (m.get(v.party_id) || 0) + 1); }
  return m;
}

export async function customerStats(): Promise<CustomerStat[]> {
  const [bills, parties, due, issues] = await Promise.all([db.bills.toArray(), db.parties.toArray(), balances(), openIssueCounts()]);
  return rankCustomers(bills, parties, due, issues);
}
