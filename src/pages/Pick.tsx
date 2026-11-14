import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { useApp, toast, beep } from "../lib/app";
import { Head, Modal } from "../components/common";
import { ListenButton } from "../components/Listen";
import { usePrintJob } from "../lib/printing";
import { listPicks, savePick, sendToFloors, ticketLeft, floorName, myFloor, setMyFloor, NO_FLOOR, type PickTicket } from "../lib/picking";
import { spokenRequest } from "../lib/spoken";

/* Picking screen for each floor's tablet (KOT / kitchen-screen style). */
const FLOORS = ["G", "1", "2", "3", "4", NO_FLOOR];
const mins = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000));

export default function Pick() {
  const { me } = useApp();
  const [floor, setFloor] = useState(myFloor() || "all");
  const [view, setView] = useState<"open" | "token" | "done">("open");
  const [scan, setScan] = useState("");
  const [ask, setAsk] = useState(false);
  const [printing, setPrinting] = useState<PickTicket | null>(null);
  usePrintJob(!!printing, () => setPrinting(null));
  const stamp = useLiveQuery(() => db.config.filter(c => c.id.startsWith("pick:")).toArray().then(r => r.map(x => x.updated_at).join()), [], "");
  const all = useLiveQuery(() => listPicks(), [stamp], [] as PickTicket[]);
  const today = new Date().toISOString().slice(0, 10);
  const mine = all.filter(t => t.status !== "cancelled" && (floor === "all" || t.floor === floor));
  const open = mine.filter(t => t.status === "new" || t.status === "picking");
  const done = mine.filter(t => t.status === "done" && (t.done_at || "").slice(0, 10) === today).reverse();
  const tokens = useMemo(() => {
    const m = new Map<string, PickTicket[]>();
    for (const t of all) if (t.status !== "cancelled" && (t.status !== "done" || (t.done_at || "").slice(0, 10) === today)) (m.get(t.source_id) || m.set(t.source_id, []).get(t.source_id)!).push(t);
    return [...m.values()].reverse();
  }, [all]);

  const mark = async (t: PickTicket, i: number, picked: number) => {
    const items = t.items.map((x, k) => k === i ? { ...x, picked: Math.max(0, Math.min(x.qty, picked)) } : x);
    await savePick({ ...t, items, status: "picking" });
  };
  const finish = async (t: PickTicket) => {
    const left = ticketLeft(t);
    if (left && !confirm(`${left} pieces not ticked. Send to ${t.to} anyway?`)) return;
    await savePick({ ...t, status: "done", done_at: new Date().toISOString(), done_by: me?.name || "" });
    beep("saved"); toast(`Token ${t.token} · ${floorName(t.floor)} done → ${t.to}`);
  };
  const onScan = async (code: string) => {
    const c = code.trim().toUpperCase(); if (!c) return;
    const prod = await db.products.filter(p => !p.deleted && (p.code.toUpperCase() === c || (p.barcodes || []).some(b => b.toUpperCase() === c))).first();
    for (const t of open) {
      const i = t.items.findIndex(x => x.picked < x.qty && (x.code.toUpperCase() === c || (prod && x.product_id === prod.id)));
      if (i >= 0) { await mark(t, i, t.items[i].picked + Math.max(1, prod?.pack || 1)); beep(true); return; }
    }
    beep(false); toast("This piece is not on an open ticket for this floor", true);
  };

  return <div>
    <Head eyebrow="Stock" title="Picking (KOT)" sub="Each floor sees only its own tickets: rack, box, pieces. Tick or scan what you picked, then Done — the counter sees it turn green.">
      <button className="btn" onClick={() => setAsk(true)}>🎙 Ask another floor</button>
    </Head>
    <div className="card pad stack" style={{ marginBottom: 12 }}>
      <div className="row">
        <span className="xs mut">This tablet is on</span>
        {["all", ...FLOORS].map(f => <button key={f} className="chip" aria-pressed={floor === f} onClick={() => { setFloor(f); setMyFloor(f === "all" ? "" : f); }}>{f === "all" ? "All floors" : floorName(f)}</button>)}
      </div>
      <div className="row">
        <div className="seg" role="group"><button aria-pressed={view === "open"} onClick={() => setView("open")}>To pick {open.length || ""}</button><button aria-pressed={view === "token"} onClick={() => setView("token")}>By token (counter)</button><button aria-pressed={view === "done"} onClick={() => setView("done")}>Done today {done.length || ""}</button></div>
        <input className="in grow mono" placeholder="Scan sticker to tick it" value={scan} onChange={e => setScan(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { void onScan(scan); setScan(""); } }} />
      </div>
    </div>

    {view === "open" && <div className="grid g2">
      {open.map(t => <div key={t.id} className="card" style={{ borderLeft: `6px solid ${mins(t.created_at) > 15 ? "var(--bad)" : mins(t.created_at) > 7 ? "#c99a2e" : "var(--ok, #1f8a4c)"}` }}>
        <header><h3>Token {t.token}</h3><span className="pill">{floorName(t.floor)}</span><span className="grow" /><span className="xs mut">{mins(t.created_at)} min · {t.party_name || t.note}</span></header>
        <div className="pad stack" style={{ gap: 4 }}>
          {t.items.map((x, i) => <div key={i} className="item" style={{ opacity: x.picked >= x.qty ? .5 : 1 }}>
            <button className="chip" aria-pressed={x.picked >= x.qty} onClick={() => mark(t, i, x.picked >= x.qty ? 0 : x.qty)} style={{ minWidth: 44 }}>{x.picked >= x.qty ? "✓" : " "}</button>
            <span className="grow"><b className="mono">{x.rack ? `Rack ${x.rack}${x.box ? " · Box " + x.box : ""}` : x.loc || "Find it"}</b><div className="sm">{x.item} <span className="mono xs">{x.code}</span> {x.style} {x.color}</div></span>
            <b className="mono" style={{ fontSize: 22 }}>{x.picked && x.picked < x.qty ? `${x.picked}/` : ""}{x.qty}</b>
          </div>)}
          <div className="row"><span className="xs mut grow">→ {t.to}{t.note ? " · " + t.note : ""}</span>
            <button className="btn sm" onClick={() => setPrinting(t)}>Print slip</button>
            <button className="btn sm p" onClick={() => finish(t)}>Done → {t.to.split(" ")[0]}</button></div>
        </div>
      </div>)}
      {!open.length && <div className="card empty"><b>Nothing to pick</b>New tickets appear here by themselves.</div>}
    </div>}

    {view === "token" && <div className="list">
      {tokens.map(ts => { const allDone = ts.every(t => t.status === "done"); return <div key={ts[0].source_id} className="item" style={{ flexWrap: "wrap" }}>
        <span className="grow"><b>Token {ts[0].token}</b> <span className="xs mut">{ts[0].party_name} · {mins(ts[0].created_at)} min</span></span>
        {ts.map(t => <span key={t.id} className={"pill " + (t.status === "done" ? "ok" : "warn")}>{floorName(t.floor)} {t.status === "done" ? "✓" : `${ticketLeft(t)} left`}</span>)}
        {allDone && <span className="pill ok">ALL READY</span>}
      </div>; })}
      {!tokens.length && <div className="empty"><b>No tokens today</b></div>}
    </div>}

    {view === "done" && <div className="list">{done.map(t => <div key={t.id} className="item"><span className="grow sm"><b>Token {t.token}</b> · {floorName(t.floor)} · {t.items.length} lines<div className="xs mut">by {t.done_by} · {new Date(t.done_at!).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div></span></div>)}</div>}

    {ask && <AskFloor onClose={() => setAsk(false)} me={me?.name || ""} myFloorNow={floor} />}
    {printing && createPortal(<div style={{ page: "rj-receipt" } as any} className="inv thermal slip">
      <style data-thermal-width="80">{"@page rj-receipt{size:auto;margin:2mm}"}</style>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: 16 }}>PICK · {floorName(printing.floor).toUpperCase()}</div>
      <div style={{ textAlign: "center", fontSize: 22, fontWeight: 800 }}>TOKEN {printing.token}</div>
      <div>{printing.party_name} → {printing.to}</div>
      <table className="inv-t"><tbody>{printing.items.map((x, i) => <tr key={i}><td><b>{x.rack ? `R${x.rack}${x.box ? "/B" + x.box : ""}` : x.loc || "?"}</b></td><td>{x.item} {x.code}</td><td style={{ textAlign: "right" }}><b>{x.qty}</b></td><td>[ ]</td></tr>)}</tbody></table>
      <div>{new Date(printing.created_at).toLocaleString("en-IN")} · {printing.note}</div>
      <div style={{ height: "25mm" }} />
    </div>, document.getElementById("printroot")!)}
  </div>;
}

/* "Send 10 boxes of RU1023 to floor 1" — said or typed; a big confirm box before anything is saved (R-189). */
function AskFloor({ onClose, me, myFloorNow }: { onClose: () => void; me: string; myFloorNow: string }) {
  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], []);
  const [said, setSaid] = useState(""); const [code, setCode] = useState(""); const [qty, setQty] = useState(""); const [to, setTo] = useState(myFloorNow === "all" ? "G" : myFloorNow);
  const read = (text: string) => { setSaid(text); const r = spokenRequest(text, products.map(p => p.code)); if (r.code) setCode(r.code); if (r.qty) setQty(String(r.qty)); if (r.floor) setTo(r.floor); };
  const prod = products.find(p => p.code.toUpperCase() === code.toUpperCase());
  const send = async () => {
    if (!prod) return toast("Which product? Say or type its code", true);
    const n = Number(qty); if (!(n > 0)) return toast("How many?", true);
    const ts = await sendToFloors({ source: "request", id: crypto.randomUUID(), no: "REQ-" + new Date().toTimeString().slice(0, 5).replace(":", ""), party: "", to: floorName(to), note: said || `${me} asked`, by: me }, [{ product_id: prod.id, code: prod.code, item: prod.item, style: prod.style, color: prod.color, qty: n }]);
    toast(`Sent to ${ts.map(t => floorName(t.floor)).join(", ")} → ${floorName(to)}`); onClose();
  };
  return <Modal title="Ask another floor to send goods" onClose={onClose}>
    <div className="stack">
      <div className="row"><ListenButton onText={read} />
        <span className="xs mut">e.g. "RU1023 das piece floor ek bhejo" / "send 10 of RU1023 to floor 1"</span></div>
      {said && <div className="note sm">Heard: {said}</div>}
      <div className="grid g3">
        <label className="f">Product code<input className="in mono" value={code} onChange={e => setCode(e.target.value.toUpperCase())} /></label>
        <label className="f">Pieces<input className="in mono" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/[^\d]/g, ""))} /></label>
        <label className="f">Send to<select className="in" value={to} onChange={e => setTo(e.target.value)}>{["G", "1", "2", "3", "4"].map(f => <option key={f} value={f}>{floorName(f)}</option>)}</select></label>
      </div>
      {prod && <div className="sm">{prod.item} {prod.style} {prod.color}</div>}
      <button className="btn p" style={{ fontSize: 20, padding: 16 }} onClick={send}>✓ Confirm: send {qty || "?"} × {code || "?"} to {floorName(to)}</button>
    </div>
  </Modal>;
}
