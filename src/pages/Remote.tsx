import { useEffect, useRef, useState } from "react";
import { joinRemote } from "../lib/remote";
import { useApp, beep } from "../lib/app";
import { CameraScanner } from "../components/Scanner";
import { Icon } from "../components/Icon";

/* This phone is a scanner for the counter. Point, beep, the item is on the counter's bill. */
export default function Remote({ id }: { id: string }) {
  const { me } = useApp();
  const [state, setState] = useState("connecting");
  const [log, setLog] = useState<{ n: number; text: string; label?: string }[]>([]);
  const link = useRef<{ send: (t: string, n: number) => boolean; close: () => void } | null>(null);
  const n = useRef(0);
  useEffect(() => {
    let closed = false;
    joinRemote(id, me?.name || "phone", (k, label) => { setLog(l => l.map(x => (x.n === k ? { ...x, label } : x))); beep(!/not found/i.test(label)); }, setState)
      .then(l => { if (closed) l.close(); else link.current = l; });
    return () => { closed = true; link.current?.close(); };
  }, [id]);
  return (
    <div className="remote">
      <div className="row between" style={{ marginBottom: 10 }}>
        <div><b style={{ fontSize: 18 }}>Scanner for the counter</b>
          <div className="xs mut"><i className={"dot " + (state === "connected" ? "" : state === "error" || state === "offline" ? "bad" : "warn")} /> {state === "connected" ? "Connected — scan stickers, they go straight onto the bill" : state === "offline" ? "Needs internet on this phone" : state === "error" ? "Can't reach the counter — check internet" : "Connecting…"}</div></div>
        <a className="btn sm" href="#/home"><Icon n="x" size={16} />Done</a>
      </div>
      <CameraScanner tall gap={1500} onCode={t => { const k = ++n.current; link.current?.send(t, k); setLog(l => [{ n: k, text: t }, ...l].slice(0, 30)); }} />
      <div className="list" style={{ marginTop: 10 }}>
        {log.map(x => <div key={x.n} className="li"><span className="grow sm">{x.label || "Sending…"}</span><span className="xs mut mono" style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{x.text}</span></div>)}
        {!log.length && <div className="empty">Scanned items appear here and on the counter screen.</div>}
      </div>
    </div>
  );
}
