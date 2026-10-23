import { useEffect, useRef, useState } from "react";

/* window.prompt() does not exist in the Windows app ("prompt() is not supported" — owner's Rename, 22 Oct),
   so every question for a word or a number is asked in the app's own small box. */
type Ask = { message: string; value: string; secret?: boolean; numeric?: boolean; done: (v: string | null) => void };
let open: ((a: Ask) => void) | null = null;
export function askText(message: string, value = "", o: { secret?: boolean; numeric?: boolean } = {}): Promise<string | null> {
  return new Promise(done => { if (open) open({ message, value, ...o, done }); else done(null); });
}

export function AskHost() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [v, setV] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { open = a => { setAsk(a); setV(a.value); }; return () => { open = null; }; }, []);
  useEffect(() => { if (ask) setTimeout(() => { input.current?.focus(); input.current?.select(); }, 30); }, [ask]);
  if (!ask) return null;
  const close = (r: string | null) => { ask.done(r); setAsk(null); };
  return <div className="ask-back" role="dialog" aria-modal="true" aria-label={ask.message} onKeyDown={e => { if (e.key === "Escape") close(null); }}>
    <form className="card pad stack ask-box" onSubmit={e => { e.preventDefault(); close(v); }}>
      <label className="f"><b className="sm">{ask.message}</b>
        <input ref={input} className={"in" + (ask.numeric ? " mono" : "")} type={ask.secret ? "password" : "text"} inputMode={ask.numeric ? "numeric" : undefined}
          autoComplete="off" value={v} onChange={e => setV(e.target.value)} /></label>
      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={() => close(null)}>Cancel</button>
        <button className="btn p">OK</button>
      </div>
    </form>
  </div>;
}
