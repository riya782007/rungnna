import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting, type Purchase } from "../lib/db";
import { saveProduct } from "../lib/products";
import { savePhoto } from "../lib/image";
import { Thumb } from "./common";
const CustomerCamera = lazy(() => import("./CustomerCamera"));
import type { Job } from "../pages/Labels";
import { parseSrList } from "../lib/quick-line";
import { toast } from "../lib/app";
import { UNITS } from "../lib/products";

/* Owner, 29 Oct (voice): "the goods come carton by carton — I need a place where I open one carton, take out its
   stickers, then the next". The purchase is saved once (stock in, one bill); the stickers then go out one carton at
   a time:
     • type the bill's Sr. numbers that are in the carton in front of him ("1-5, 8"), or scan / type a code
       printed on the goods — those lines are ticked;
     • Enter again (or the big button) prints only those stickers, and the lines are marked "Carton 1 ✓";
     • the next carton starts by itself; what is left is always counted on top.
   Progress is kept on this computer, so closing the screen half way loses nothing. */

type Progress = { done: Record<string, number> };
const keyOf = (id: string) => "carton_" + id;
const up = (v?: string) => (v || "").trim().toUpperCase();

/* Owner, 29 Oct (voice): "a print column, once — give it the print command, it comes out, then the next, the next".
   Every line also has its own Print button; after it prints, the cursor waits on the next line's button, so Enter,
   Enter, Enter goes down the bill one line at a time. autoSr: a line whose Print was pressed on the bill screen
   before the bill was saved — it prints as soon as the saved bill is here. */
/* Owner, 29 Oct (voice): "a mistake in the item or the rate — how do I correct it and print just that again?" Fix opens
   the line in place: item, code, rate, pieces per box and stickers. Save & print puts it right on the saved bill and
   on the product (stock and cost are not touched) and prints that line again. */
export type LineFix = { item: string; style: string; rate: string; pack: string; stickers: string };
/** One change for many ticked lines (owner, 13 Nov): blank fields are left as they are. */
export type BulkLineFix = { item?: string; type?: string; pack?: string };
export function CartonPrint({ purchase, jobs, print, busy, autoSr, onAutoDone, onFix, onFixMany, times = 1 }: { purchase: Purchase; jobs: Job[]; print: (queue: Job[]) => Promise<unknown>; busy?: boolean; autoSr?: string; onAutoDone?: () => void; onFix?: (index: number, fix: LineFix) => Promise<Job[]>; onFixMany?: (indexes: number[], fix: BulkLineFix) => Promise<Job[]>; times?: number }) {
  const [many, setMany] = useState<BulkLineFix>({});
  const [editing, setEditing] = useState<{ i: number; f: LineFix } | null>(null);
  const [prog, setProg] = useState<Progress>({ done: {} });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  /* Owner, 6 Nov (photo of this screen + voice): a photo of each line's goods as the carton is opened — taken with the
     camera (a plugged-in USB camera is used by itself; the choice is remembered) or uploaded (a file on the computer;
     on a phone, its camera or gallery). The camera stays open and moves down the lines, so it opens once a carton. */
  const [shoot, setShoot] = useState<number | null>(null);   // index in `lines` the open camera is taking
  const file = useRef<HTMLInputElement>(null), fileFor = useRef<number>(-1);
  const pids = useMemo(() => purchase.items.map(l => l.product_id).filter(Boolean), [purchase]);
  const pics = useLiveQuery(async () => new Map((await db.products.bulkGet(pids)).filter(Boolean).map(p => [p!.id, p!])), [pids.join()], new Map());
  const [loaded, setLoaded] = useState("");
  useEffect(() => { void getSetting<Progress>(keyOf(purchase.id), { done: {} }).then(p => { setProg(p && p.done ? p : { done: {} }); setLoaded(purchase.id); }); setTicked(new Set()); }, [purchase.id]);
  useEffect(() => { if (!autoSr) setTimeout(() => box.current?.focus(), 50); }, [purchase.id]);

  // one row per bill line, with the stickers that line prints
  const lines = useMemo(() => purchase.items.map((l, i) => {
    const sr = String(l.bill_sr?.trim() || i + 1);
    const stickers = jobs.filter(j => String(j.line ?? "") === sr).reduce((n, j) => n + j.copies, 0) * times;
    return { i, sr, item: l.item, style: l.style, color: l.color, qty: l.qty, rate: l.rate, pack: l.label_pack ?? l.pack ?? 1, print_qty: l.print_qty, stickers, product_id: l.product_id };
  }), [purchase, jobs, times]);
  const carton = Math.max(0, ...Object.values(prog.done)) + 1;
  const left = lines.filter(l => !prog.done[l.sr] && l.stickers > 0);
  const sel = lines.filter(l => ticked.has(l.sr));
  const selStickers = sel.reduce((n, l) => n + l.stickers, 0);

  const save = (p: Progress) => { setProg(p); void setSetting(keyOf(purchase.id), p); };
  const tick = (srs: string[], on = true) => setTicked(old => { const n = new Set(old); for (const s of srs) on ? n.add(s) : n.delete(s); return n; });

  const putPhoto = async (k: number, photo_id: string) => {
    const l = lines[k], p = l?.product_id ? await db.products.get(l.product_id) : undefined;
    if (!p) { toast(`Sr. ${l?.sr}: this line has no product to put the photo on`, true); return; }
    await saveProduct({ ...p, photo_id, photo_url: undefined }, true);
    toast(`Photo saved · Sr. ${l.sr} ${l.item}`);
  };
  const nextShot = (k: number) => { const n = k + 1 < lines.length ? k + 1 : null; setShoot(n); if (n === null) toast("Photos done for every line ✓"); };
  const upload = async (files: FileList | null) => {
    const k = fileFor.current; if (!files?.length || k < 0) return;
    try { for (const [j, f] of [...files].entries()) { if (k + j >= lines.length) break; await putPhoto(k + j, await savePhoto(f)); } }
    catch (e: any) { toast(e.message || "Could not save the photo", true); }
    if (file.current) file.current.value = "";
  };

  const run = async (which: typeof lines, label: string) => {
    if (!which.length || working) return;
    const want = new Set(which.map(l => l.sr));
    const queue = jobs.filter(j => want.has(String(j.line ?? "")));
    if (!queue.length) return toast("These lines have no stickers to print", true);
    setWorking(true);
    try {
      await print(queue);
      const done = { ...prog.done }; for (const l of which) done[l.sr] = carton;
      save({ done }); setTicked(new Set()); setText("");
      const rest = lines.filter(l => !done[l.sr] && l.stickers > 0).length;
      toast(`${label}: ${queue.reduce((n, j) => n + j.copies, 0) * times} stickers sent · ${rest ? `${rest} line${rest === 1 ? "" : "s"} left` : "all lines done ✓"}`);
    } catch (e: any) { toast(e?.message || "Printing did not start", true); }
    finally { setWorking(false); setTimeout(() => box.current?.focus(), 50); }
  };

  const focusNext = (after: string, done: Record<string, number>) => {
    const i = lines.findIndex(l => l.sr === after);
    const next = lines.slice(i + 1).find(l => !done[l.sr] && l.stickers > 0) || lines.find(l => !done[l.sr] && l.stickers > 0);
    setTimeout(() => (document.querySelector(`.carton-t button[data-sr="${next?.sr}"]`) as HTMLButtonElement | null)?.focus(), 80);
  };
  const printLine = async (l: (typeof lines)[number]) => {
    await run([l], `Sr. ${l.sr}`);
    const done = { ...prog.done, [l.sr]: carton };
    focusNext(l.sr, done);
  };
  const autoRan = useRef("");
  useEffect(() => {
    if (!autoSr || loaded !== purchase.id || autoRan.current === purchase.id + autoSr || !jobs.length) return;
    autoRan.current = purchase.id + autoSr;
    const l = lines.find(x => x.sr === autoSr) || lines.find(x => x.sr.split("+").includes(autoSr));
    onAutoDone?.();
    if (l) void printLine(l);
  }, [autoSr, loaded, purchase.id, jobs.length]);

  const saveFix = async () => {
    if (!editing || !onFix || working) return;
    const l = lines[editing.i];
    setWorking(true);
    try {
      const fresh = await onFix(editing.i, editing.f);
      setEditing(null);
      const queue = fresh.filter(j => String(j.line ?? "") === l.sr);
      if (queue.length) { await print(queue); const done = { ...prog.done, [l.sr]: carton }; save({ done }); toast(`Sr. ${l.sr} corrected · ${queue.reduce((n, j) => n + j.copies, 0) * times} stickers sent`); }
      else toast(`Sr. ${l.sr} corrected`);
    } catch (e: any) { toast(e?.message || "Could not save the correction", true); }
    finally { setWorking(false); }
  };

  const saveMany = async (andPrint: boolean) => {
    if (!onFixMany || working || !sel.length) return;
    setWorking(true);
    try {
      const srs = new Set(sel.map(l => l.sr));
      const fresh = await onFixMany(sel.map(l => l.i), many);
      setMany({});
      if (andPrint) {
        const queue = fresh.filter(j => srs.has(String(j.line ?? "")));
        if (queue.length) {
          await print(queue);
          const done = { ...prog.done }; for (const s of srs) done[s] = carton;
          save({ done });
        }
      }
      setTicked(new Set());
      toast(`${srs.size} line${srs.size === 1 ? "" : "s"} corrected${andPrint ? " and printed" : ""}`);
    } catch (e: any) { toast(e?.message || "Could not save the correction", true); }
    finally { setWorking(false); }
  };

  const enter = () => {
    const t = text.trim();
    if (!t) { if (sel.length) void run(sel, `Carton ${carton}`); return; }
    const nums = parseSrList(t);
    // numbers are the bill's Sr.; a number that is no Sr. on this bill but is a line's code ("470") is that code
    const codeHit = (v: string) => lines.filter(l => up(l.style) && (up(l.style) === up(v) || up(v).includes(up(l.style)) || up(l.style).includes(up(v))));
    if (nums.length && /^[\d\s,;+-]+$/.test(t) && !(nums.every(n => !lines.some(l => l.sr === String(n))) && codeHit(t).length)) {
      const have = nums.map(String).filter(s => lines.some(l => l.sr === s));
      const missing = nums.length - have.length;
      tick(have); setText("");
      if (missing) toast(`${missing} of those Sr. numbers ${missing === 1 ? "is" : "are"} not on this bill`, true);
      return;
    }
    // a code from the goods or its old sticker: the line(s) with that article
    const hit = codeHit(t);
    if (!hit.length) return toast(`No line with code ${t} on this bill`, true);
    tick(hit.map(l => l.sr)); setText("");
  };

  return <div className="note stack carton-print" style={{ gap: 8 }}>
    <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
      <b className="grow carton-head">Carton {carton}{left.length ? ` · ${lines.length - left.length} of ${lines.length} lines done` : " · all lines done ✓"}</b>
      {!!Object.keys(prog.done).length && <button type="button" className="linkbtn" onClick={() => { save({ done: {} }); setTicked(new Set()); }}>Start the cartons again</button>}
    </div>
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <input ref={box} className="in carton-in grow" value={text} onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); enter(); } }}
        placeholder="Bill Sr. in this carton, e.g. 1-5, 8 — or a code — then Enter" aria-label="Lines in this carton" />
      <button type="button" className="btn p" disabled={working || !sel.length} onClick={() => void run(sel, `Carton ${carton}`)}>
        {working ? "Printing…" : sel.length ? `Print carton ${carton} · ${selStickers} sticker${selStickers === 1 ? "" : "s"}` : `Tick the lines of carton ${carton}`}</button>
      {!!left.length && <button type="button" className="btn" disabled={working} onClick={() => void run(left, "All left")}>Print all left ({left.reduce((n, l) => n + l.stickers, 0)})</button>}
    </div>
    {onFixMany && <div className="row carton-many" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
      <span className="sm"><b>{sel.length ? `Change the ${sel.length} ticked line${sel.length === 1 ? "" : "s"}` : "Change many lines at once"}</b>
        <span className="xs mut">{sel.length ? " — blank boxes stay as they are" : " — tick the lines first (or "}</span>
        {!sel.length && <><button type="button" className="linkbtn xs" onClick={() => tick(lines.map(l => l.sr))}>tick all</button><span className="xs mut">)</span></>}</span>
      {!!sel.length && <>
        <label className="f">Item name<input className="in" aria-label="Item name for ticked lines" placeholder="e.g. POUCH" value={many.item || ""} onChange={e => setMany({ ...many, item: e.target.value.toUpperCase() })} /></label>
        <label className="f">Unit<select className="in" aria-label="Unit for ticked lines" value={many.type || ""} onChange={e => setMany({ ...many, type: e.target.value })}>
          <option value="">— as it is —</option>{UNITS.map(u => <option key={u} value={u}>{u}</option>)}</select></label>
        <label className="f">Pieces per box<input className="in r" inputMode="numeric" aria-label="Pieces per box for ticked lines" placeholder="as it is" style={{ maxWidth: 90 }} value={many.pack || ""} onChange={e => setMany({ ...many, pack: e.target.value.replace(/\D/g, "") })} /></label>
        <button type="button" className="btn p" disabled={working} onClick={() => void saveMany(true)}>Save &amp; print</button>
        <button type="button" className="btn" disabled={working} onClick={() => void saveMany(false)}>Save only</button>
        <button type="button" className="linkbtn" onClick={() => setTicked(new Set())}>Untick all</button>
      </>}
    </div>}
    <div className="tw"><table className="pos-t carton-t"><thead><tr><th></th><th>Sr.</th><th>Item</th><th>Code</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">X</th><th className="r">Stickers</th><th>Carton</th><th>Photo</th><th></th></tr></thead><tbody>
      {lines.map(l => editing?.i === l.i ? <tr key={l.sr} className="fixing" onClick={e => e.stopPropagation()}>
        <td></td><td className="mono b">{l.sr}</td>
        <td><input className="in" aria-label="Fix item" value={editing.f.item} onChange={e => setEditing({ ...editing, f: { ...editing.f, item: e.target.value } })} /></td>
        <td><input className="in mono" aria-label="Fix code" value={editing.f.style} onChange={e => setEditing({ ...editing, f: { ...editing.f, style: e.target.value } })} /></td>
        <td className="r">{l.qty}</td>
        <td><input className="in r" inputMode="decimal" aria-label="Fix rate" value={editing.f.rate} onChange={e => setEditing({ ...editing, f: { ...editing.f, rate: e.target.value } })} /></td>
        <td><input className="in r" inputMode="numeric" aria-label="Fix pieces per box" value={editing.f.pack} onChange={e => setEditing({ ...editing, f: { ...editing.f, pack: e.target.value, stickers: "" } })} /></td>
        <td><input className="in r" inputMode="numeric" aria-label="Fix stickers" placeholder={l.qty % (Number(editing.f.pack) || 1) && l.qty > (Number(editing.f.pack) || 1) ? `${Math.floor(l.qty / (Number(editing.f.pack) || 1))}+1` : String(Math.ceil(l.qty / (Number(editing.f.pack) || 1)))} value={editing.f.stickers} onChange={e => setEditing({ ...editing, f: { ...editing.f, stickers: e.target.value } })} onKeyDown={e => { if (e.key === "Enter") void saveFix(); }} /></td>
        <td colSpan={2}><div className="row" style={{ gap: 6 }}><button type="button" className="btn sm p" disabled={working} onClick={() => void saveFix()}>Save &amp; print</button><button type="button" className="linkbtn" onClick={() => setEditing(null)}>Cancel</button></div></td>
      </tr> : <tr key={l.sr} className={(ticked.has(l.sr) ? "on " : "") + (prog.done[l.sr] ? "done" : "")} onClick={() => tick([l.sr], !ticked.has(l.sr))}>
        <td><input type="checkbox" aria-label={"Sr. " + l.sr + " in this carton"} checked={ticked.has(l.sr)} onChange={() => { /* the row's click does it */ }} /></td>
        <td className="mono b">{l.sr}</td><td>{l.item}</td><td className="mono">{l.style}{l.color ? " · " + l.color : ""}</td>
        <td className="r">{l.qty}</td><td className="r">{l.rate ? (l.rate / 100).toFixed(2) : "—"}</td><td className="r">{l.pack}</td><td className="r">{l.stickers}</td>
        <td>{prog.done[l.sr] ? <span className="ok-text b">✓ {prog.done[l.sr]}</span> : ""}</td>
        <td onClick={e => e.stopPropagation()}><div className="row carton-photo" style={{ gap: 4, flexWrap: "nowrap" }}>
          {(() => { const p = l.product_id ? pics.get(l.product_id) : undefined; return p?.photo_id || p?.photo_url ? <Thumb photo_id={p.photo_id} url={p.photo_url} size={34} /> : null; })()}
          <button type="button" className="btn sm" disabled={!l.product_id} title="Camera — a plugged-in USB camera is used; it stays open for the next lines" aria-label={`Camera photo for Sr. ${l.sr}`} onClick={() => setShoot(lines.indexOf(l))}>📷</button>
          <button type="button" className="btn sm" disabled={!l.product_id} title="Upload a photo (several at once go on this line and the ones below)" aria-label={`Upload photo for Sr. ${l.sr}`} onClick={() => { fileFor.current = lines.indexOf(l); file.current?.click(); }}>📁</button>
        </div></td>
        <td><div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          {/* never greyed out while another print runs: a press always answers, if only to say "wait a moment" */}
          <button type="button" data-sr={l.sr} className={"btn sm" + (prog.done[l.sr] ? "" : " p")} disabled={working || !l.stickers}
            onClick={e => { e.stopPropagation(); void printLine(l); }}>{prog.done[l.sr] ? "Print again" : "Print"} {l.stickers}</button>
          {onFix && <button type="button" className="btn sm" disabled={working} title="Correct the item, code, rate or packet of this line and print it again"
            onClick={e => { e.stopPropagation(); setEditing({ i: l.i, f: { item: l.item, style: l.style, rate: l.rate ? (l.rate / 100).toFixed(2) : "", pack: String(l.pack), stickers: l.print_qty !== undefined ? String(l.print_qty) : "" } }); }}>Fix</button>}
        </div></td>
      </tr>)}
    </tbody></table></div>
    <input ref={file} type="file" accept="image/*" multiple hidden onChange={e => void upload(e.target.files)} />
    {shoot !== null && lines[shoot] && <Suspense fallback={<div role="status">Opening camera…</div>}>
      <CustomerCamera title="Photos of this carton" facing="environment" settingKey="photo_camera" preferExternal stay
        caption={<><b className="mono">Sr. {lines[shoot].sr}</b> · {lines[shoot].item} <span className="mono">{lines[shoot].style}</span>{lines[shoot].color ? " · " + lines[shoot].color : ""}
          {(() => { const p = lines[shoot].product_id ? pics.get(lines[shoot].product_id!) : undefined; return p?.photo_id || p?.photo_url ? <span className="xs mut"> · has a photo — a new one replaces it</span> : null; })()}</>}
        onPhoto={async id => { const k = shoot; await putPhoto(k, id); nextShot(k); }}
        onSkip={() => nextShot(shoot)} onClose={() => setShoot(null)} />
    </Suspense>}
  </div>;
}
