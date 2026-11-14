import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, recordMovement, type Config, type Product } from "../lib/db";
import { storeStock } from "../lib/stores";
import { useApp, toast, beep } from "../lib/app";
import { can } from "../lib/roles";
import { Head, Modal, LocationSelect } from "../components/common";
import { ListenButton } from "../components/Listen";
import { spokenNumber } from "../lib/spoken";
import { connectScale, piecesFromWeight, pieceWeight, savePieceWeight, type Scale, type Reading } from "../lib/scale";

/* Blind stock count (owner's list R-142, R-143, R-185, R-186 … R-190, R-158, R-159):
   pick the rack, scan each design, give the pieces — typed, said ("pachas", "count 45") or weighed.
   The counter never sees how many the system expects. At the end the differences go to the owner
   as a report (item, rack, date, who counted), and the owner decides what to correct. */

type CountLine = { product_id: string; code: string; item: string; counted: number; how: "typed" | "voice" | "scale"; at: string };
type Diff = { product_id: string; code: string; item: string; expected: number; counted: number };
export type CountSheet = { id: string; loc_id: string; loc: string; by: string; started: string; finished?: string; lines: CountLine[]; diffs?: Diff[]; applied?: string; applied_by?: string };
const saveSheet = (c: CountSheet) => put("config", { id: "count:" + c.id, value: c, updated_at: now() } as Config);

export default function Count() {
  const { me } = useApp();
  const boss = can(me, "reports.view");
  const sheets = useLiveQuery(() => db.config.filter(c => c.id.startsWith("count:") && !c.deleted).toArray().then(r => r.map(x => x.value as CountSheet).sort((a, z) => z.started.localeCompare(a.started))), [], [] as CountSheet[]);
  const [loc, setLoc] = useState("");
  const [cur, setCur] = useState<CountSheet | null>(null);
  const [open, setOpen] = useState<CountSheet | null>(null);
  const start = async () => {
    const l = await db.locations.get(loc); if (!l) return toast("Pick the rack / box first (or scan its QR)", true);
    const c: CountSheet = { id: crypto.randomUUID(), loc_id: l.id, loc: l.code, by: me?.name || "", started: now(), lines: [] };
    await saveSheet(c); setCur(c);
  };
  if (cur) return <CountRun sheet={cur} onDone={() => setCur(null)} />;
  return <div>
    <Head eyebrow="Stock" title="Count (blind)" sub="Count a rack without seeing the system's number. Say it, type it, or weigh it. Differences go to the owner." />
    <div className="card pad stack" style={{ marginBottom: 12 }}>
      <LocationSelect value={loc} onChange={setLoc} label="Rack / box to count" buckets={false} />
      <button className="btn p" onClick={start}>Start counting</button>
    </div>
    <div className="card"><header><h3>Counts</h3></header><div className="pad stack" style={{ gap: 6 }}>
      {sheets.slice(0, 40).map(s => { const d = (s.diffs || []).filter(x => x.counted !== x.expected).length; return <div key={s.id} className="item">
        <span className="grow sm"><b>{s.loc}</b> · {s.by} · {new Date(s.started).toLocaleString("en-IN")}<div className="xs mut">{s.lines.length} designs counted{s.finished ? "" : " · not finished"}{boss && s.finished ? ` · ${d} difference${d === 1 ? "" : "s"}` : ""}{s.applied ? " · corrected" : ""}</div></span>
        {!s.finished && s.by === me?.name && <button className="btn sm" onClick={() => setCur(s)}>Continue</button>}
        {boss && s.finished && <button className="btn sm" onClick={() => setOpen(s)}>Report</button>}
      </div>; })}
      {!sheets.length && <div className="xs mut">No counts yet.</div>}
    </div></div>
    {open && <Report sheet={open} onClose={() => setOpen(null)} />}
  </div>;
}

function CountRun({ sheet, onDone }: { sheet: CountSheet; onDone: () => void }) {
  const { me } = useApp();
  const [s, setS] = useState(sheet);
  const [code, setCode] = useState("");
  const [prod, setProd] = useState<Product | null>(null);
  const [qty, setQty] = useState("");
  const [confirmN, setConfirmN] = useState<{ n: number; how: CountLine["how"]; heard?: string } | null>(null);
  const scanRef = useRef<HTMLInputElement>(null);
  const find = async (c: string) => {
    const x = c.trim().toUpperCase(); if (!x) return;
    const p = await db.products.filter(p => !p.deleted && (p.code.toUpperCase() === x || (p.barcodes || []).some(b => b.toUpperCase() === x))).first();
    if (!p) { beep(false); return toast("No product with this code", true); }
    beep(true); setProd(p); setQty(""); setCode("");
  };
  const save = async (n: number, how: CountLine["how"]) => {
    if (!prod) return;
    const line: CountLine = { product_id: prod.id, code: prod.code, item: prod.item, counted: n, how, at: now() };
    const v = { ...s, lines: [...s.lines.filter(l => l.product_id !== prod.id), line] };
    await saveSheet(v); setS(v); setProd(null); setQty(""); setConfirmN(null); beep("saved");
    setTimeout(() => scanRef.current?.focus(), 50);
  };
  const finish = async () => {
    if (!confirm(`Finish counting ${s.loc}? ${s.lines.length} designs counted. Anything on this rack you did not scan counts as 0.`)) return;
    const cells = (await storeStock()).filter(c => c.loc_id === s.loc_id && c.qty !== 0);
    const prods = new Map((await db.products.toArray()).map(p => [p.id, p]));
    const ids = new Set([...cells.map(c => c.product_id), ...s.lines.map(l => l.product_id)]);
    const diffs: Diff[] = [...ids].map(id => ({ product_id: id, code: prods.get(id)?.code || "", item: prods.get(id)?.item || "", expected: cells.filter(c => c.product_id === id).reduce((a, c) => a + c.qty, 0), counted: s.lines.find(l => l.product_id === id)?.counted ?? 0 }));
    await saveSheet({ ...s, finished: now(), diffs });
    toast("Count saved and sent to the owner"); onDone();
  };
  return <div>
    <Head eyebrow="Count" title={`Counting ${s.loc}`} sub={`${s.lines.length} designs counted · by ${s.by}`}>
      <button className="btn p" onClick={finish}>Finish</button>
      <button className="btn" onClick={onDone}>Pause</button>
    </Head>
    <div className="card pad stack" style={{ marginBottom: 12 }}>
      <input ref={scanRef} className="in mono" autoFocus placeholder="Scan the sticker (or type its code) and press Enter" value={code} onChange={e => setCode(e.target.value)} onKeyDown={e => { if (e.key === "Enter") void find(code); }} />
      {prod && <div className="stack">
        <div className="sm"><b>{prod.item}</b> <span className="mono">{prod.code}</span> {prod.style} {prod.color}</div>
        <label className="f">Pieces you counted<input className="in mono" style={{ fontSize: 28 }} inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/[^\d]/g, ""))} onKeyDown={e => { if (e.key === "Enter" && qty) setConfirmN({ n: Number(qty), how: "typed" }); }} placeholder="?" /></label>
        <div className="row">
          <ListenButton label="🎙 Say the count" onText={t => { const n = spokenNumber(t); n === null ? toast(`Heard "${t}" — no number in it. Say e.g. "pachas" or "count 45"`, true) : setConfirmN({ n: Math.round(n), how: "voice", heard: t }); }} />
          <button className="btn p" disabled={!qty} onClick={() => setConfirmN({ n: Number(qty), how: "typed" })}>Save</button>
        </div>
        <Weigh product={prod} onPieces={n => setConfirmN({ n, how: "scale" })} />
      </div>}
    </div>
    <div className="list">{[...s.lines].reverse().map(l => <div key={l.product_id} className="item"><span className="grow sm">{l.item} <span className="mono xs">{l.code}</span><div className="xs mut">{l.how} · {new Date(l.at).toLocaleTimeString("en-IN")}</div></span><b className="mono">{l.counted}</b></div>)}</div>
    {confirmN && <Modal title="Confirm" onClose={() => setConfirmN(null)}>
      <div className="stack" style={{ textAlign: "center" }}>
        {confirmN.heard && <div className="xs mut">Heard: "{confirmN.heard}"</div>}
        <div style={{ fontSize: 22 }}>{prod?.item} {prod?.code}</div>
        <div style={{ fontSize: 56, fontWeight: 800 }}>{confirmN.n}</div>
        <div className="row" style={{ justifyContent: "center" }}>
          <button className="btn p" style={{ fontSize: 26, padding: "16px 40px", background: "#1f8a4c" }} onClick={() => save(confirmN.n, confirmN.how)}>✓ Confirm quantity</button>
          <button className="btn" onClick={() => setConfirmN(null)}>No</button>
        </div>
      </div>
    </Modal>}
  </div>;
}

/* Count by weight: set one piece's weight once (put 10 pieces on the scale), then weigh the packet. */
export function Weigh({ product, onPieces }: { product: Product; onPieces: (n: number) => void }) {
  const { me } = useApp();
  const [scale, setScale] = useState<Scale | null>(null);
  const [live, setLive] = useState<Reading | null>(null);
  const [per, setPer] = useState(0);
  const [sample, setSample] = useState("10");
  const [w, setW] = useState("");
  const [tare, setTare] = useState(0);
  useEffect(() => { pieceWeight(product.id).then(setPer); }, [product.id]);
  useEffect(() => () => scale?.stop(), [scale]);
  useEffect(() => { if (live) setW(String(live.grams)); }, [live?.grams]);
  const grams = Number(w) || 0;
  const r = useMemo(() => piecesFromWeight(grams, per, tare), [grams, per, tare]);
  return <div className="card pad stack" style={{ background: "var(--bg2, #faf6ee)" }}>
    <div className="row"><b className="sm grow">⚖ Count by weight</b>
      {scale ? <span className={"pill " + (live?.stable ? "ok" : "warn")}>{live ? `${live.grams} g${live.stable ? "" : " · settling"}` : "waiting for scale"}</span>
        : <button className="btn sm" onClick={async () => { try { setScale(await connectScale(setLive)); } catch (e: any) { if (e?.name !== "NotFoundError") toast(e.message, true); } }}>Connect scale</button>}</div>
    <div className="grid g3">
      <label className="f">Weight now (g)<input className="in mono" inputMode="decimal" value={w} onChange={e => setW(e.target.value)} /></label>
      <label className="f">Pieces on scale for one-piece weight<input className="in mono" inputMode="numeric" value={sample} onChange={e => setSample(e.target.value.replace(/\D/g, ""))} /></label>
      <label className="f">Box / tray weight (g)<input className="in mono" inputMode="decimal" value={tare || ""} onChange={e => setTare(Number(e.target.value) || 0)} /></label>
    </div>
    <div className="row">
      <button className="btn sm" disabled={!grams || !Number(sample)} onClick={async () => { const g = Math.round((grams - tare) / Number(sample) * 1000) / 1000; await savePieceWeight(product.id, g, me?.name || ""); setPer(g); toast(`One piece = ${g} g — saved for ${product.code}`); }}>Set one-piece weight from {sample || "?"} pcs</button>
      <span className="xs mut grow">{per ? `One piece: ${per} g` : "Put a few pieces on the scale first and set the one-piece weight"}</span>
    </div>
    {per > 0 && grams > 0 && <div className="row"><b style={{ fontSize: 22 }}>{r.pieces} pcs</b>{!r.sure && <span className="pill warn">not a whole number of pieces — recheck</span>}
      <button className="btn p" disabled={!r.pieces} onClick={() => onPieces(r.pieces)}>Use {r.pieces}</button></div>}
  </div>;
}

function Report({ sheet, onClose }: { sheet: CountSheet; onClose: () => void }) {
  const { me } = useApp();
  const diffs = (sheet.diffs || []).filter(d => d.counted !== d.expected);
  const apply = async () => {
    if (!can(me, "stock.move")) return toast("Needs the stock-move permission", true);
    if (!confirm(`Correct ${diffs.length} designs on ${sheet.loc} to the counted pieces? Each change is written in Activity.`)) return;
    const cells = (await storeStock()).filter(c => c.loc_id === sheet.loc_id);
    for (const d of diffs) {
      const nowQty = cells.filter(c => c.product_id === d.product_id).reduce((a, c) => a + c.qty, 0);
      const delta = d.counted - nowQty; if (!delta) continue;
      await recordMovement({ product_id: d.product_id, kind: "adjust", qty: Math.abs(delta), from_loc: delta < 0 ? sheet.loc_id : null, to_loc: delta > 0 ? sheet.loc_id : null, person_type: "employee", person_name: sheet.by, by_staff: me?.id || "", note: `Blind count ${sheet.loc} by ${sheet.by}: expected ${d.expected}, counted ${d.counted}` });
    }
    await saveSheet({ ...sheet, applied: now(), applied_by: me?.name || "" }); toast("Stock corrected"); onClose();
  };
  return <Modal title={`Count report · ${sheet.loc}`} onClose={onClose}>
    <div className="stack">
      <div className="xs mut">Counted by {sheet.by} · {new Date(sheet.started).toLocaleString("en-IN")} → {sheet.finished && new Date(sheet.finished).toLocaleTimeString("en-IN")} · {sheet.lines.length} designs</div>
      <table><thead><tr><th>Design</th><th>Expected</th><th>Counted</th><th>Difference</th></tr></thead><tbody>
        {diffs.map(d => <tr key={d.product_id}><td>{d.item} <span className="mono xs">{d.code}</span></td><td className="mono">{d.expected}</td><td className="mono">{d.counted}</td><td className="mono" style={{ color: d.counted < d.expected ? "var(--bad)" : undefined }}>{d.counted - d.expected > 0 ? "+" : ""}{d.counted - d.expected}</td></tr>)}
      </tbody></table>
      {!diffs.length && <div className="note">Everything matches.</div>}
      {diffs.length > 0 && !sheet.applied && <button className="btn p" onClick={apply}>Correct stock to the count</button>}
      {sheet.applied && <div className="xs mut">Corrected by {sheet.applied_by} · {new Date(sheet.applied).toLocaleString("en-IN")}</div>}
    </div>
  </Modal>;
}
