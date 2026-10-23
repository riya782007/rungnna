import { locCode } from "../lib/stock-adjustment";
import { inStore, storeStock, currentStore, MAIN_STORE } from "../lib/stores";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { Head, Thumb, useLocations } from "../components/common";
import { label } from "../lib/products";
import { when } from "../lib/format";
import { usePrivate, maskNote, isEstimate } from "../lib/privacy";

/* Full movement register — filter by day, kind, person. Exportable to Excel (CSV). */
export default function Activity() {
  const locs = useLocations();
  const priv = usePrivate();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState("");
  /* Owner, 22 Oct: sales and intake on their own pages under Activity; sale yellow, intake green,
     anything from an estimate red and called "estimate". */
  const [tab, setTab] = useState<"" | "sale" | "intake" | "estimate" | "other">("");
  const [who, setWho] = useState("");
  const rows = useLiveQuery(async () => {
    const a = new Date(day + "T00:00:00"), b = new Date(a.getTime() + 86400000);
    return db.movements.where("at").between(a.toISOString(), b.toISOString()).filter(inStore).reverse().sortBy("at");
  }, [day], []);
  const prods = useLiveQuery(() => db.products.toArray(), [], []);
  const staff = useLiveQuery(() => db.staff.filter(inStore).toArray(), [], []);
  const P = useMemo(() => new Map(prods.map(p => [p.id, p])), [prods]);
  const estBills = useLiveQuery(async () => {
    const ids = [...new Set(rows.map(m => m.ref_bill).filter(Boolean) as string[])];
    const bills = await db.bills.bulkGet(ids);
    return new Set(bills.filter(b => b && isEstimate(b)).map(b => b!.id));
  }, [rows], new Set<string>());
  const isEst = (m: { ref_bill?: string; note?: string }) => (!!m.ref_bill && estBills.has(m.ref_bill)) || /^(EST|ECN)\//.test(m.note || "");
  const group = (m: { kind: string; ref_bill?: string; note?: string }) => isEst(m) ? "estimate" : m.kind === "sale" ? "sale" : m.kind === "intake" ? "intake" : "other";
  const kindName = (m: { kind: string; ref_bill?: string; note?: string }) => isEst(m) ? (m.kind === "sale" ? "estimate" : "estimate " + m.kind) : m.kind;
  const code = (id: string | null) => (id ? locCode(locs.find(l => l.id === id)) || "?" : "");
  const shown = rows.filter(m => priv || !isEst(m));
  const count = (t: string) => shown.filter(m => group(m) === t).length;
  const list = shown.filter(m => (!tab || group(m) === tab) && (!kind || m.kind === kind) && (!who || (m.person_name + " " + (staff.find(s => s.id === m.by_staff)?.name || "")).toLowerCase().includes(who.toLowerCase())));

  const csv = () => {
    const head = ["time", "kind", "qty", "code", "item", "style", "color", "from", "to", "person_type", "person", "recorded_by", "note", "photo"];
    const lines = list.map(m => { const p = P.get(m.product_id); return [m.at, m.kind, m.qty, p?.code, p?.item, p?.style, p?.color, code(m.from_loc), code(m.to_loc), m.person_type, m.person_name, staff.find(s => s.id === m.by_staff)?.name, maskNote(m.note, priv), m.photo_url || ""]; });
    const text = [head, ...lines].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = `rungnna-movements-${day}.csv`; a.click();
  };

  return (
    <div>
      <Head eyebrow="Register" title="Activity log" sub="Every intake, transfer, damage and correction — with who, when and where.">
        <button className="btn" onClick={csv} disabled={!list.length}>Download for Excel</button>
      </Head>
      <nav className="tabs act-tabs" style={{ marginBottom: 10 }}>
        {([["", "All"], ["sale", "Sales"], ["intake", "Intake"], ...(priv ? [["estimate", "Estimates"]] : []), ["other", "Moves & corrections"]] as [typeof tab, string][]).map(([k, l]) =>
          <a key={k || "all"} href="#/activity" className={tab === k ? "on" : ""} onClick={e => { e.preventDefault(); setTab(k); }}>{l}{k ? ` (${count(k)})` : ""}</a>)}
      </nav>
      <div className="card pad row" style={{ marginBottom: 12 }}>
        <input className="in" type="date" style={{ width: 170 }} value={day} onChange={e => setDay(e.target.value)} />
        <select className="in" style={{ width: 170 }} value={kind} onChange={e => setKind(e.target.value)}>
          <option value="">All kinds</option>{["intake", "transfer", "sale", "return", "adjust", "damage", "missing", "found"].map(k => <option key={k}>{k}</option>)}</select>
        <input className="in grow" placeholder="Person…" value={who} onChange={e => setWho(e.target.value)} />
        <span className="pill">{list.reduce((a, m) => a + m.qty, 0)} pcs · {list.length} lines</span>
      </div>
      <div className="card tw"><table>
        <thead><tr><th>Time</th><th>Kind</th><th>Product</th><th style={{ textAlign: "right" }}>Qty</th><th>From → To</th><th>Person</th><th>By</th><th>Note</th><th></th></tr></thead>
        <tbody>{list.map(m => { const p = P.get(m.product_id); return (
          <tr key={m.id} className={"act-" + group(m)}>
            <td className="xs mut" style={{ whiteSpace: "nowrap" }}>{when(m.at)}</td><td><span className={"pill act-pill-" + group(m)}>{kindName(m)}</span></td>
            <td><a href={"#/product/" + m.product_id}>{p ? label(p) : "…"}</a></td><td className="mono b" style={{ textAlign: "right" }}>{m.qty}</td>
            <td className="mono xs">{code(m.from_loc)} → {code(m.to_loc)}</td><td className="sm">{m.person_type} {m.person_name}</td>
            <td className="sm">{staff.find(s => s.id === m.by_staff)?.name}</td><td className="xs">{maskNote(m.note, priv)}</td>
            <td>{(m.photo_id || m.photo_url) && <Thumb photo_id={m.photo_id} url={m.photo_url} size={32} />}</td>
          </tr>); })}</tbody></table>
        {!list.length && <div className="pad mut">No movements on this day.</div>}
      </div>
    </div>
  );
}
