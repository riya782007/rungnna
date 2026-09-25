import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { Head, Thumb, useLocations } from "../components/common";
import { label } from "../lib/products";
import { when } from "../lib/format";

/* Full movement register — filter by day, kind, person. Exportable to Excel (CSV). */
export default function Activity() {
  const locs = useLocations();
  const [day, setDay] = useState(new Date().toISOString().slice(0, 10));
  const [kind, setKind] = useState("");
  const [who, setWho] = useState("");
  const rows = useLiveQuery(async () => {
    const a = new Date(day + "T00:00:00"), b = new Date(a.getTime() + 86400000);
    return db.movements.where("at").between(a.toISOString(), b.toISOString()).reverse().sortBy("at");
  }, [day], []);
  const prods = useLiveQuery(() => db.products.toArray(), [], []);
  const staff = useLiveQuery(() => db.staff.toArray(), [], []);
  const P = useMemo(() => new Map(prods.map(p => [p.id, p])), [prods]);
  const code = (id: string | null) => (id ? locs.find(l => l.id === id)?.code || "?" : "");
  const list = rows.filter(m => (!kind || m.kind === kind) && (!who || (m.person_name + " " + (staff.find(s => s.id === m.by_staff)?.name || "")).toLowerCase().includes(who.toLowerCase())));

  const csv = () => {
    const head = ["time", "kind", "qty", "code", "item", "style", "color", "from", "to", "person_type", "person", "recorded_by", "note", "photo"];
    const lines = list.map(m => { const p = P.get(m.product_id); return [m.at, m.kind, m.qty, p?.code, p?.item, p?.style, p?.color, code(m.from_loc), code(m.to_loc), m.person_type, m.person_name, staff.find(s => s.id === m.by_staff)?.name, m.note, m.photo_url || ""]; });
    const text = [head, ...lines].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" })); a.download = `rungnna-movements-${day}.csv`; a.click();
  };

  return (
    <div>
      <Head eyebrow="Register" title="Activity log" sub="Every intake, transfer, damage and correction — with who, when and where.">
        <button className="btn" onClick={csv} disabled={!list.length}>Download for Excel</button>
      </Head>
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
          <tr key={m.id}>
            <td className="xs mut" style={{ whiteSpace: "nowrap" }}>{when(m.at)}</td><td><span className="pill">{m.kind}</span></td>
            <td><a href={"#/product/" + m.product_id}>{p ? label(p) : "…"}</a></td><td className="mono b" style={{ textAlign: "right" }}>{m.qty}</td>
            <td className="mono xs">{code(m.from_loc)} → {code(m.to_loc)}</td><td className="sm">{m.person_type} {m.person_name}</td>
            <td className="sm">{staff.find(s => s.id === m.by_staff)?.name}</td><td className="xs">{m.note}</td>
            <td>{(m.photo_id || m.photo_url) && <Thumb photo_id={m.photo_id} url={m.photo_url} size={32} />}</td>
          </tr>); })}</tbody></table>
        {!list.length && <div className="pad mut">No movements on this day.</div>}
      </div>
    </div>
  );
}
