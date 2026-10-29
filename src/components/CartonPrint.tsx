import { useEffect, useMemo, useRef, useState } from "react";
import { getSetting, setSetting, type Purchase } from "../lib/db";
import type { Job } from "../pages/Labels";
import { parseSrList } from "../lib/quick-line";
import { toast } from "../lib/app";

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

export function CartonPrint({ purchase, jobs, print, busy }: { purchase: Purchase; jobs: Job[]; print: (queue: Job[]) => Promise<unknown>; busy?: boolean }) {
  const [prog, setProg] = useState<Progress>({ done: {} });
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [text, setText] = useState("");
  const [working, setWorking] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => { void getSetting<Progress>(keyOf(purchase.id), { done: {} }).then(p => setProg(p && p.done ? p : { done: {} })); setTicked(new Set()); }, [purchase.id]);
  useEffect(() => { setTimeout(() => box.current?.focus(), 50); }, [purchase.id]);

  // one row per bill line, with the stickers that line prints
  const lines = useMemo(() => purchase.items.map((l, i) => {
    const sr = String(l.bill_sr?.trim() || i + 1);
    const stickers = jobs.filter(j => String(j.line ?? "") === sr).reduce((n, j) => n + j.copies, 0);
    return { sr, item: l.item, style: l.style, color: l.color, qty: l.qty, stickers };
  }), [purchase, jobs]);
  const carton = Math.max(0, ...Object.values(prog.done)) + 1;
  const left = lines.filter(l => !prog.done[l.sr] && l.stickers > 0);
  const sel = lines.filter(l => ticked.has(l.sr));
  const selStickers = sel.reduce((n, l) => n + l.stickers, 0);

  const save = (p: Progress) => { setProg(p); void setSetting(keyOf(purchase.id), p); };
  const tick = (srs: string[], on = true) => setTicked(old => { const n = new Set(old); for (const s of srs) on ? n.add(s) : n.delete(s); return n; });

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
      toast(`${label}: ${queue.reduce((n, j) => n + j.copies, 0)} stickers sent · ${rest ? `${rest} line${rest === 1 ? "" : "s"} left` : "all lines done ✓"}`);
    } catch (e: any) { toast(e?.message || "Printing did not start", true); }
    finally { setWorking(false); setTimeout(() => box.current?.focus(), 50); }
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
      <button type="button" className="btn p" disabled={busy || working || !sel.length} onClick={() => void run(sel, `Carton ${carton}`)}>
        {working ? "Printing…" : sel.length ? `Print carton ${carton} · ${selStickers} sticker${selStickers === 1 ? "" : "s"}` : `Tick the lines of carton ${carton}`}</button>
      {!!left.length && <button type="button" className="btn" disabled={busy || working} onClick={() => void run(left, "All left")}>Print all left ({left.reduce((n, l) => n + l.stickers, 0)})</button>}
    </div>
    <div className="tw"><table className="pos-t carton-t"><thead><tr><th></th><th>Sr.</th><th>Item</th><th>Code</th><th className="r">Qty</th><th className="r">Stickers</th><th>Carton</th></tr></thead><tbody>
      {lines.map(l => <tr key={l.sr} className={(ticked.has(l.sr) ? "on " : "") + (prog.done[l.sr] ? "done" : "")} onClick={() => tick([l.sr], !ticked.has(l.sr))}>
        <td><input type="checkbox" aria-label={"Sr. " + l.sr + " in this carton"} checked={ticked.has(l.sr)} onChange={() => { /* the row's click does it */ }} /></td>
        <td className="mono b">{l.sr}</td><td>{l.item}</td><td className="mono">{l.style}{l.color ? " · " + l.color : ""}</td>
        <td className="r">{l.qty}</td><td className="r">{l.stickers}</td>
        <td>{prog.done[l.sr] ? <span className="ok-text">✓ {prog.done[l.sr]}</span> : ""}</td>
      </tr>)}
    </tbody></table></div>
  </div>;
}
