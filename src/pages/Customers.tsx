import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type Party } from "../lib/db";
import { due, newParty, waLink, normPhone } from "../lib/billing";
import { go, toast } from "../lib/app";
import { rupees, when } from "../lib/format";
import { Head, PhotoButton, Thumb } from "../components/common";
import { VoiceNotes } from "../components/Voice";

/* Customers & dealers: who buys, how much, what they owe — one tap to call or WhatsApp. */
export default function Customers({ args }: { args: string[] }) {
  return args[0] ? <PartyView id={args[0]} /> : <PartyList />;
}

function PartyList() {
  const [q, setQ] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted).toArray(), [], []);
  const bills = useLiveQuery(() => db.bills.where("status").equals("final").filter(b => !b.deleted).toArray(), [], []);
  const stats = useMemo(() => {
    const m = new Map<string, { sales: number; due: number; last: string; n: number }>();
    bills.forEach(b => { if (!b.party_id) return; const s = m.get(b.party_id) || { sales: 0, due: 0, last: "", n: 0 };
      s.sales += b.net; s.due += Math.max(0, due(b)); s.n++; if (b.at > s.last) s.last = b.at; m.set(b.party_id, s); });
    return m;
  }, [bills]);
  const list = parties.filter(p => (!q || (p.name + " " + p.phone + " " + p.city).toLowerCase().includes(q.toLowerCase())) && (!onlyDue || (stats.get(p.id)?.due || 0) > 0))
    .sort((a, z) => (stats.get(z.id)?.sales || 0) - (stats.get(a.id)?.sales || 0));
  const totalDue = [...stats.values()].reduce((a, s) => a + s.due, 0);
  return (
    <div>
      <Head eyebrow="Customers & dealers" title="Customers" sub={`${parties.length} customers · ${rupees(totalDue)} to collect`}>
        <button className="btn p" onClick={async () => { const n = prompt("Customer / shop name"); if (!n) return; const ph = prompt("Mobile number") || ""; const p = newParty(n.toUpperCase(), ph.replace(/\D/g, "")); await put("parties", p); go("customers/" + p.id); }}>+ Add customer</button>
      </Head>
      <div className="card pad row" style={{ marginBottom: 12 }}>
        <input className="in grow" placeholder="Search name, mobile, city" value={q} onChange={e => setQ(e.target.value)} />
        <button className="chip" aria-pressed={onlyDue} onClick={() => setOnlyDue(!onlyDue)}>Only with dues</button>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {list.map(p => { const s = stats.get(p.id); return (
          <a key={p.id} className="item" href={"#/customers/" + p.id}>
            <Thumb photo_id={p.photo_id} url={p.photo_url} text={p.name} />
            <div className="grow"><b className="sm">{p.name}</b><div className="xs mut">{p.phone} {p.city && "· " + p.city} {s?.last && "· last " + when(s.last)}</div></div>
            <div style={{ textAlign: "right" }}><div className="mono b">{rupees(s?.sales || 0)}</div>{s?.due ? <div className="xs" style={{ color: "var(--rose)" }}>Due {rupees(s.due)}</div> : <div className="xs mut">{s?.n || 0} bills</div>}</div>
          </a>); })}
        {!list.length && <div className="card pad mut">No customers yet — they are added from the billing screen (F3).</div>}
      </div>
    </div>
  );
}

function PartyView({ id }: { id: string }) {
  const p0 = useLiveQuery(() => db.parties.get(id), [id]);
  const bills = useLiveQuery(() => db.bills.where("party_id").equals(id).filter(b => !b.deleted).reverse().sortBy("at"), [id], []);
  const [p, setP] = useState<Party | null>(null);
  useEffect(() => { if (p0) setP({ ...p0 }); }, [p0?.updated_at]);
  if (!p) return <div className="card pad">Loading…</div>;
  const set = (k: keyof Party, v: any) => setP({ ...p, [k]: v });
  const fin = bills.filter(b => b.status === "final");
  const owed = fin.reduce((a, b) => a + Math.max(0, due(b)), 0);
  return (
    <div>
      <Head eyebrow={p.kind} title={p.name} sub={`${fin.length} bills · ${rupees(fin.reduce((a, b) => a + b.net, 0))} bought · ${rupees(owed)} due`}>
        {p.phone && <a className="btn" href={"tel:" + p.phone}>📞 Call</a>}
        {p.phone && <a className="btn g" target="_blank" rel="noreferrer" href={waLink(p.phone, `Namaste ${p.name} ji,`)}>💬 WhatsApp</a>}
        <button className="btn p" onClick={() => go("bill")}>New bill</button>
      </Head>
      <div className="split">
        <div className="card pad stack">
          <div className="row"><Thumb photo_id={p.photo_id} url={p.photo_url} text={p.name} size={80} /><PhotoButton value={p.photo_id} onChange={v => set("photo_id", v)} label="Photo" /></div>
          <div className="grid g2">
            <label className="f">Name<input className="in" value={p.name} onChange={e => set("name", e.target.value.toUpperCase())} /></label>
            <label className="f">Mobile / WhatsApp<input className="in mono" inputMode="tel" value={p.phone} onChange={e => set("phone", e.target.value.replace(/[^\d+]/g, ""))} /></label>
            <label className="f">Type<select className="in" value={p.kind} onChange={e => set("kind", e.target.value)}><option value="customer">Customer</option><option value="dealer">Dealer</option><option value="supplier">Supplier</option></select></label>
            <label className="f">Price tier<select className="in" value={p.tier} onChange={e => set("tier", e.target.value)}><option value="retail">Retail</option><option value="wholesale">Wholesale</option><option value="dealer">Dealer</option></select></label>
            <label className="f">GSTIN<input className="in mono" value={p.gstin} onChange={e => set("gstin", e.target.value.toUpperCase())} /></label>
            <label className="f">State<input className="in" value={p.state} onChange={e => set("state", e.target.value)} placeholder="e.g. Delhi" /></label>
            <label className="f">City<input className="in" value={p.city} onChange={e => set("city", e.target.value)} /></label>
            <label className="f">Credit limit ₹<input className="in mono" value={p.credit_limit ? p.credit_limit / 100 : ""} onChange={e => set("credit_limit", Math.round(Number(e.target.value.replace(/[^\d.]/g, "")) * 100) || 0)} /></label>
          </div>
          <label className="f">Address<textarea className="in" rows={2} value={p.address} onChange={e => set("address", e.target.value)} /></label>
          <label className="f">Notes<textarea className="in" rows={2} value={p.notes} onChange={e => set("notes", e.target.value)} placeholder="Likes kundan sets, pays every Saturday…" /></label>
          <div className="row"><button className="btn p" onClick={async () => { await put("parties", { ...p, phone: normPhone(p.phone).replace(/^91(?=\d{10}$)/, "") }); toast("Saved"); }}>Save</button></div>
          <VoiceNotes entity="party" entityId={p.id} />
        </div>
        <div className="card"><header><h3>Bills</h3><span className="pill">{bills.length}</span></header>
          <div className="pad stack" style={{ gap: 6 }}>
            {bills.map(b => <a key={b.id} className="item" href={"#/bills/" + b.id}><span className="grow"><b className="mono sm">{b.no || "on hold"}</b><div className="xs mut">{when(b.at)} · {b.total_qty} pcs · {b.status}</div></span>
              <span style={{ textAlign: "right" }}><b className="mono">{rupees(b.net)}</b>{b.status === "final" && due(b) > 0 && <div className="xs" style={{ color: "var(--rose)" }}>due {rupees(due(b))}</div>}</span></a>)}
            {!bills.length && <div className="mut sm">No bills yet.</div>}
          </div></div>
      </div>
    </div>
  );
}
