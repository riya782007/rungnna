import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, type Config, type Party } from "../lib/db";
import { useApp, toast } from "../lib/app";
import { Head, Modal, PhotoButton, Thumb } from "../components/common";
import { SpeakText } from "../components/Voice";
import { waLink } from "../lib/billing";
import { when } from "../lib/format";

/* Customer desk (owner's list R-07, R-56, R-57, R-72, R-77, R-78, R-79):
   repairs, complaints, queries, feedback about how a customer was treated, and Diwali gifts —
   one place, each with a date-wise story of what was done. Saved like everything else
   (works offline, syncs to every computer). */

export type DeskKind = "repair" | "complaint" | "query" | "feedback" | "gift";
export type DeskStatus = "open" | "progress" | "ready" | "closed";
export type DeskLog = { at: string; by: string; text: string; photo_id?: string };
export type DeskRow = {
  id: string; kind: DeskKind; status: DeskStatus; party_id?: string; party_name: string; phone: string;
  title: string; items: string; bill_no: string; staff: string; promised: string; created_at: string; log: DeskLog[];
};

export const KINDS: [DeskKind, string, string][] = [
  ["repair", "Repairs", "Goods received for repair: what, when, what was done, when returned"],
  ["complaint", "Complaints", "Customer complaint box"],
  ["query", "Queries", "Customer query / enquiry box"],
  ["feedback", "Remarks", "How the customer was treated, service given, remarks about staff or customer"],
  ["gift", "Gifts", "Diwali / occasion gift given or not"],
];
const STATUS: Record<DeskStatus, string> = { open: "Received", progress: "In progress", ready: "Ready", closed: "Closed / returned" };

export async function saveDesk(r: DeskRow) { await put("config", { id: "desk:" + r.id, value: r, updated_at: now() } as Config); }

export default function Desk() {
  const { me } = useApp();
  const [kind, setKind] = useState<DeskKind>("repair");
  const [showClosed, setShowClosed] = useState(false);
  const [edit, setEdit] = useState<DeskRow | null>(null);
  const [q, setQ] = useState("");
  const rows = useLiveQuery(() => db.config.filter(c => c.id.startsWith("desk:") && !c.deleted).toArray().then(r => r.map(x => ({ ...(x.value as DeskRow), id: x.id.slice(5) }))), [], [] as DeskRow[]);
  const list = useMemo(() => rows.filter(r => r.kind === kind && (showClosed || r.status !== "closed") && (!q || `${r.party_name} ${r.phone} ${r.title} ${r.items} ${r.bill_no}`.toLowerCase().includes(q.toLowerCase())))
    .sort((a, z) => z.created_at.localeCompare(a.created_at)), [rows, kind, showClosed, q]);
  const fresh = (): DeskRow => ({ id: crypto.randomUUID(), kind, status: "open", party_name: "", phone: "", title: "", items: "", bill_no: "", staff: me?.name || "", promised: "", created_at: now(), log: [] });
  return <div>
    <Head eyebrow="Customers" title="Repairs, complaints & remarks" sub="Every repair, complaint, query and remark with dates and what was done.">
      <button className="btn p" onClick={() => setEdit(fresh())}>+ New</button>
    </Head>
    <div className="card pad stack" style={{ marginBottom: 12 }}>
      <div className="tabs">{KINDS.map(([k, l]) => <a key={k} href="#/desk" className={kind === k ? "on" : ""} onClick={e => { e.preventDefault(); setKind(k); }}>{l} {rows.filter(r => r.kind === k && r.status !== "closed").length || ""}</a>)}</div>
      <div className="xs mut">{KINDS.find(k => k[0] === kind)![2]}</div>
      <div className="row"><input className="in grow" placeholder="Search name, mobile, item, bill no." value={q} onChange={e => setQ(e.target.value)} />
        <button className="chip" aria-pressed={showClosed} onClick={() => setShowClosed(!showClosed)}>Show closed</button></div>
    </div>
    <div className="list">
      {list.map(r => <a key={r.id} href="#/desk" onClick={e => { e.preventDefault(); setEdit(r); }}>
        <span className="grow"><b className="sm">{r.party_name || "—"}</b> <span className={"pill " + (r.status === "ready" ? "ok" : r.status === "closed" ? "" : "warn")}>{STATUS[r.status]}</span>
          <div className="xs mut">{r.title}{r.items ? " · " + r.items : ""}{r.bill_no ? " · bill " + r.bill_no : ""} · {when(r.created_at)}{r.promised ? " · promised " + r.promised : ""}</div></span>
      </a>)}
      {!list.length && <div className="empty"><b>Nothing here</b>Tap + New to write one down.</div>}
    </div>
    {edit && <DeskEditor value={edit} onClose={() => setEdit(null)} />}
  </div>;
}

function DeskEditor({ value, onClose }: { value: DeskRow; onClose: () => void }) {
  const { me } = useApp();
  const [r, setR] = useState<DeskRow>(value);
  const [note, setNote] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted && p.kind !== "supplier").toArray(), [], [] as Party[]);
  const isNew = !value.log.length && !value.party_name;
  const pick = (name: string) => { const p = parties.find(x => x.name === name); setR({ ...r, party_name: name, party_id: p?.id, phone: p?.phone || r.phone }); };
  const save = async (status?: DeskStatus) => {
    if (!r.party_name.trim() && !r.phone.trim()) return toast("Write the customer's name or mobile", true);
    const log = note.trim() || photo || status ? [...r.log, { at: now(), by: me?.name || "", text: (status ? `[${STATUS[status]}] ` : "") + note.trim(), photo_id: photo }] : r.log;
    const v = { ...r, status: status || r.status, log };
    await saveDesk(v); toast("Saved"); onClose();
  };
  const msg = r.kind === "repair" ? `Namaste ${r.party_name}, aapka repair (${r.title || r.items}) ${r.status === "ready" ? "ready hai — kripya le jaayein" : "par kaam chal raha hai"}. — Rungnna Jewellery & Co` : `Namaste ${r.party_name}, — Rungnna Jewellery & Co`;
  return <Modal title={isNew ? "New entry" : r.party_name} onClose={onClose}>
    <div className="stack">
      <div className="grid g2">
        <label className="f">Customer<input className="in" list="desk-parties" value={r.party_name} onChange={e => pick(e.target.value.toUpperCase())} /></label>
        <datalist id="desk-parties">{parties.slice(0, 500).map(p => <option key={p.id} value={p.name}>{p.phone}</option>)}</datalist>
        <label className="f">Mobile<input className="in mono" inputMode="numeric" value={r.phone} onChange={e => setR({ ...r, phone: e.target.value.replace(/\D/g, "").slice(0, 10) })} /></label>
      </div>
      <label className="f">{r.kind === "repair" ? "What is the problem" : r.kind === "gift" ? "Gift (what, which occasion)" : "Subject"}<input className="in" value={r.title} onChange={e => setR({ ...r, title: e.target.value })} /></label>
      {r.kind === "repair" && <div className="grid g3">
        <label className="f">Items / pieces<input className="in" value={r.items} placeholder="2 sets, 1 kada" onChange={e => setR({ ...r, items: e.target.value })} /></label>
        <label className="f">Bill no. (if any)<input className="in mono" value={r.bill_no} onChange={e => setR({ ...r, bill_no: e.target.value })} /></label>
        <label className="f">Promised date<input className="in" type="date" value={r.promised} onChange={e => setR({ ...r, promised: e.target.value })} /></label>
      </div>}
      {r.kind === "feedback" && <label className="f">About staff member (optional)<input className="in" value={r.staff} onChange={e => setR({ ...r, staff: e.target.value })} /></label>}
      <label className="f">Note / what was done<textarea className="in" rows={2} value={note} onChange={e => setNote(e.target.value)} /></label>
      <div className="row"><SpeakText onText={t => setNote(n => (n ? n + " " : "") + t)} /><PhotoButton value={photo} onChange={setPhoto} label="Photo" /></div>
      {r.log.length > 0 && <div className="stack" style={{ gap: 4 }}>
        <b className="xs">History</b>
        {r.log.map((l, i) => <div key={i} className="item xs">{l.photo_id && <Thumb photo_id={l.photo_id} size={36} />}<span className="grow">{l.text || "photo"}<div className="mut">{when(l.at)} · {l.by}</div></span></div>)}
      </div>}
      <div className="row">
        <button className="btn p" onClick={() => save()}>Save</button>
        {r.kind === "repair" && r.status === "open" && <button className="btn" onClick={() => save("progress")}>Sent for repair</button>}
        {r.kind === "repair" && r.status !== "ready" && r.status !== "closed" && <button className="btn g" onClick={() => save("ready")}>Ready</button>}
        {r.status !== "closed" && <button className="btn" onClick={() => save("closed")}>{r.kind === "repair" ? "Returned to customer" : "Close"}</button>}
        {r.phone && <a className="btn g" href={waLink(r.phone, msg)} target="_blank" rel="noopener">WhatsApp</a>}
      </div>
    </div>
  </Modal>;
}
