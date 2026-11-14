import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, type Config } from "../lib/db";
import { rupees } from "../lib/format";
import { toast } from "../lib/app";
import { MoneyInput } from "./common";

/* Staff points, targets, mistakes and money given (owner's list R-31, R-45, R-47, R-58, R-86, R-203, R-207).
   Points: salesman 1 per ₹1,000 sold · helper ½ per ₹1,000 · packing 1 per bill · rechecking 1 per bill ·
   a cancelled bill made by that person −5 (billing mistake). */
export function StaffPoints({ from, to }: { from: string; to: string }) {
  const end = to + "T23:59:59";
  const bills = useLiveQuery(() => db.bills.filter(b => !b.deleted && b.at >= from && b.at <= end).toArray(), [from, to], []);
  const staff = useLiveQuery(() => db.staff.filter(s => !s.deleted && s.login !== "role").toArray(), [], []);
  const vouchers = useLiveQuery(() => db.vouchers.filter(v => !v.deleted && v.type === "expense" && v.at >= from && v.at <= end && (v.note || "").startsWith("Staff: ")).toArray(), [from, to], []);
  const targets = useLiveQuery(() => db.config.get("staff_targets").then(r => (r?.value || {}) as Record<string, number>), [], {} as Record<string, number>);
  const [edit, setEdit] = useState<Record<string, number> | null>(null);
  const rows = useMemo(() => {
    const idName = new Map(staff.map(s => [s.id, s.name]));
    const m = new Map<string, { sales: number; bills: number; helped: number; packed: number; checked: number; mistakes: number; money: number }>();
    const g = (n: string) => { const k = (n || "").trim(); if (!m.has(k)) m.set(k, { sales: 0, bills: 0, helped: 0, packed: 0, checked: 0, mistakes: 0, money: 0 }); return m.get(k)!; };
    for (const b of bills) {
      if (b.status === "void") { const who = idName.get(b.by_staff) || b.salesman; if (who) g(who).mistakes++; continue; }
      if (b.status !== "final" || b.bill_type === "return") continue;
      if (b.salesman) { g(b.salesman).sales += b.net; g(b.salesman).bills++; }
      if (b.helper) g(b.helper).helped += b.net;
      if (b.packed_by) g(b.packed_by).packed++;
      if (b.checked_by) g(b.checked_by).checked++;
    }
    for (const v of vouchers) { const n = v.note.slice(7).split(" — ")[0]; g(n).money += v.amount; }
    return [...m].filter(([k]) => k).map(([name, x]) => ({ name, ...x, points: Math.floor(x.sales / 100000) + Math.floor(x.helped / 200000) + x.packed + x.checked - 5 * x.mistakes, target: targets[name] || 0 }))
      .sort((a, z) => z.points - a.points);
  }, [bills, staff, vouchers, targets]);
  return <div className="card" style={{ marginTop: 12 }}>
    <header><h3>Staff points, targets &amp; mistakes</h3><button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setEdit({ ...targets })}>Set targets</button></header>
    <div className="pad stack" style={{ gap: 6 }}>
      <div className="xs mut">Points: 1 per ₹1,000 sold · ½ per ₹1,000 helped · 1 per bill packed · 1 per bill rechecked · −5 per cancelled bill (mistake). Money = salary, incentive, bonus, stationery given (Vouchers).</div>
      <table className="tbl sm"><thead><tr><th>Name</th><th>Points</th><th>Sales</th><th>Target</th><th>Bills</th><th>Packed</th><th>Rechecked</th><th>Mistakes</th><th>Money given</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.name}><td><b>{r.name}</b></td><td className="mono">{r.points}</td><td className="mono">{rupees(r.sales)}</td>
          <td className="mono">{r.target ? `${Math.round(r.sales * 100 / r.target)}% of ${rupees(r.target)}` : "—"}</td><td>{r.bills}</td><td>{r.packed}</td><td>{r.checked}</td><td style={{ color: r.mistakes ? "var(--bad)" : undefined }}>{r.mistakes}</td><td className="mono">{r.money ? rupees(r.money) : ""}</td></tr>)}</tbody></table>
      {!rows.length && <div className="xs mut">No bills with a salesman in these dates.</div>}
      {edit && <div className="stack">
        <b className="xs">Sales target for the dates shown (₹)</b>
        {staff.map(s => <label key={s.id} className="f">{s.name}<MoneyInput className="in mono" paise={edit[s.name] || 0} onPaise={v => setEdit({ ...edit, [s.name]: v })} /></label>)}
        <div className="row"><button className="btn p" onClick={async () => { await put("config", { id: "staff_targets", value: edit, updated_at: now() } as Config); setEdit(null); toast("Targets saved"); }}>Save targets</button><button className="btn" onClick={() => setEdit(null)}>Cancel</button></div>
      </div>}
    </div>
  </div>;
}
