import { inStore, storeStock, currentStore, MAIN_STORE } from "../lib/stores";
import { useEffect, useMemo, useRef, useState } from "react";
import { db, getSetting, type Bill, type BillLine, type Product } from "../lib/db";
import { findByScan, label } from "../lib/products";
import { fillBillNames } from "../lib/billing-products";
import { totals, getShop, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { detectAll, type Detected } from "../components/Scanner";
import { Head } from "../components/common";
import { Icon } from "../components/Icon";
import { beep, toast } from "../lib/app";
import { rupees } from "../lib/format";

/* ---------------------------------------------------------------------------
   Overhead Recheck — the 5-second double-check before the box is sealed.

   Lay the whole packed box/tray under the overhead camera, tags facing up.
   The camera runs a continuous MULTI-scan: it reads every QR / DataMatrix tag
   in the picture at once and draws a glowing box over each one, live — a
   visual RFID audit. Green = on this bill. Yellow = a real product, but not on
   this bill (extra). Red = not recognised.

   Press F5 (or Audit) to match the tags on the tray against the bill:
     • all match  → the screen flashes GREEN and shows "safe to seal"
     • mismatch   → flashes RED and lists exactly which line is MISSING from
                    the tray, or EXTRA on the tray.

   It reuses the same offline scanner engine as the rest of the app
   (native BarcodeDetector, ZXing WASM fallback) via detectAll().
--------------------------------------------------------------------------- */

type Tag = { code: string; corners: { x: number; y: number }[]; product?: Product; lastSeen: number };
type Verdict = null | { ok: boolean; matched: Line[]; missing: Line[]; extra: Tag[] };
type Line = BillLine & { _seen?: boolean };

const TAG_TTL_MS = 400; // drop a box this long after a tag last left the picture

export default function Recheck({ args }: { args: string[] }) {
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [bill, setBill] = useState<Bill | null>(null);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [liveCount, setLiveCount] = useState(0);
  const [verdict, setVerdict] = useState<Verdict>(null);

  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const tags = useRef<Map<string, Tag>>(new Map());
  const alive = useRef(false);
  const billRef = useRef<Bill | null>(null);
  billRef.current = bill;

  /* load the bill to check: #/recheck/<id>, else the counter's unsaved draft */
  useEffect(() => {
    (async () => {
      setShop(await getShop());
      if (args[0]) { const b = await db.bills.get(args[0]); if (b && inStore(b)) return setBill(await fillBillNames(b)); }
      const draft = await getSetting<Bill | null>("draft_bill", null);
      if (draft && draft.items.length) return setBill(await fillBillNames(draft));
      // fall back to the most recent bill so the screen is never empty
      const last = await db.bills.orderBy("at").reverse().filter(b => inStore(b) && !b.deleted && b.items.length > 0).first();
      setBill(last ? await fillBillNames(last) : null);
    })();
  }, [args[0]]);

  /* the set of product ids this bill expects, with counts (a line can be many pieces,
     but each physical tag is one product; we match by product presence) */
  const expected = useMemo(() => {
    const m = new Map<string, Line>();
    (bill?.items || []).forEach(l => { if (l.product_id) m.set(l.product_id, l); });
    return m;
  }, [bill]);

  // ---- camera lifecycle --------------------------------------------------
  const start = async () => {
    setErr("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      stream.current = s;
      const tr: any = s.getVideoTracks()[0];
      try { if (tr?.getCapabilities?.().focusMode?.includes?.("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* ignore */ }
      if (video.current) { video.current.srcObject = s; await video.current.play(); }
      setRunning(true); alive.current = true; loop();
    } catch (e: any) {
      setErr(e?.name === "NotAllowedError"
        ? "Camera permission was refused. Allow it in the browser settings and try again."
        : "No camera available here. The overhead recheck needs a camera pointed down at the tray.");
    }
  };
  const stop = () => {
    alive.current = false; setRunning(false);
    stream.current?.getTracks().forEach(t => t.stop()); stream.current = null;
    tags.current.clear(); setLiveCount(0);
    const c = canvas.current, g = c?.getContext("2d");
    if (c && g) g.clearRect(0, 0, c.width, c.height);
  };
  useEffect(() => () => stop(), []);

  // ---- continuous multi-scan loop ---------------------------------------
  const loop = async () => {
    if (!alive.current) return;
    const v = video.current;
    if (v && v.readyState >= 2) {
      const found = await detectAll(v);
      const now = performance.now();
      for (const f of found) await ingest(f, now);
      for (const [code, t] of tags.current) if (now - t.lastSeen > TAG_TTL_MS) tags.current.delete(code);
      setLiveCount(tags.current.size);
      draw();
    }
    setTimeout(() => requestAnimationFrame(loop), 90);
  };

  async function ingest(f: Detected, now: number) {
    const code = f.rawValue.trim();
    const prev = tags.current.get(code);
    if (prev) { prev.corners = f.corners; prev.lastSeen = now; return; }
    // first time we see this tag in the current view — resolve the product once
    const product = await findByScan(code);
    tags.current.set(code, { code, corners: f.corners, product, lastSeen: now });
  }

  // ---- AR overlay --------------------------------------------------------
  function draw() {
    const v = video.current, c = canvas.current;
    if (!v || !c) return;
    const w = v.videoWidth, h = v.videoHeight;
    if (!w || !h) return;
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const g = c.getContext("2d")!;
    g.clearRect(0, 0, w, h);

    for (const t of tags.current.values()) {
      const onBill = !!(t.product && expected.has(t.product.id));
      const known = !!t.product;
      const color = onBill ? "#12c46a" : known ? "#f5b301" : "#ff4d4f";

      const pts = t.corners;
      g.save();
      g.lineWidth = Math.max(3, w / 300);
      g.strokeStyle = color;
      g.shadowColor = color;
      g.shadowBlur = 24;
      if (pts.length >= 3) {
        g.beginPath();
        g.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i].x, pts[i].y);
        g.closePath();
        g.stroke();
        g.globalAlpha = 0.15; g.fillStyle = color; g.fill(); g.globalAlpha = 1;
      }
      // label chip
      const lx = pts[0]?.x ?? 8, ly = Math.max(20, (pts[0]?.y ?? 20) - 10);
      const text = t.product ? label(t.product) : t.code.slice(0, 18);
      g.shadowBlur = 0;
      g.font = `600 ${Math.max(14, Math.round(w / 55))}px system-ui, sans-serif`;
      const tw = g.measureText(text).width;
      g.fillStyle = "rgba(0,0,0,.6)"; g.fillRect(lx - 4, ly - Math.round(w / 45), tw + 8, Math.round(w / 34));
      g.fillStyle = color; g.fillText(text, lx, ly);
      g.restore();
    }
  }

  // ---- the audit (F5) ----------------------------------------------------
  function runAudit() {
    const b = billRef.current;
    if (!b || !b.items.length) { toast("No bill to check — open a bill first", true); return; }

    const seen = new Set<string>();      // product ids currently on the tray
    const extra: Tag[] = [];
    for (const t of tags.current.values()) {
      if (t.product && expected.has(t.product.id)) seen.add(t.product.id);
      else extra.push(t);
    }
    const matched: Line[] = [];
    const missing: Line[] = [];
    for (const [pid, line] of expected) (seen.has(pid) ? matched : missing).push(line);

    const ok = missing.length === 0 && extra.length === 0 && matched.length > 0;
    setVerdict({ ok, matched, missing, extra });
    beep(ok);
    if (ok) toast(`✓ Match — ${matched.length} item${matched.length === 1 ? "" : "s"} verified, safe to seal`);
    else toast(`✗ Mismatch — ${missing.length} missing, ${extra.length} extra`, true);
  }

  // F5 anywhere on this page (and stop the browser reloading)
  useEffect(() => {
    const f = (e: KeyboardEvent) => { if (e.key === "F5") { e.preventDefault(); runAudit(); } };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  });

  const t = bill ? totals(bill, shop.state) : null;
  const distinctItems = expected.size;

  return (
    <div>
      <Head eyebrow="Packing check" title="Overhead recheck"
        sub="Lay the packed box under the overhead camera, tags facing up. Every tag lights up as it is read. Press F5 to match the tray against the bill before you seal it." />

      <div className="split">
        <div className="stack">
          <div className={"card recheck-stage" + (verdict ? (verdict.ok ? " pass" : " fail") : "")}>
            <div className="vf recheck-vf">
              <video ref={video} playsInline muted />
              <canvas ref={canvas} className="recheck-overlay" />
              {verdict && <div className={"recheck-banner " + (verdict.ok ? "pass" : "fail")}>{verdict.ok ? "✓ MATCH — SAFE TO SEAL" : "✗ MISMATCH"}</div>}
              <span className="tag">{running ? `Reading — ${liveCount} tag${liveCount === 1 ? "" : "s"} in view` : "Camera off"}</span>
            </div>
            {err && <div className="note warn">{err}</div>}
            <div className="row">
              {running
                ? <button className="btn sm" onClick={stop}>Stop camera</button>
                : <button className="btn sm p" onClick={start}><Icon n="camera" size={16} /> Start camera</button>}
              <button className="btn sm dk" onClick={runAudit} disabled={!bill}>Audit · F5</button>
              {verdict && <button className="btn sm" onClick={() => setVerdict(null)}>Clear result</button>}
            </div>
            <div className="xs mut">Green = on this bill · Yellow = a product not on this bill (extra) · Red = tag not recognised.</div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <header>
              <h3>{bill ? (bill.no || "Unsaved bill") : "No bill"}</h3>
              {bill && <span className="pill">{distinctItems} item{distinctItems === 1 ? "" : "s"}{t ? ` · ${t.total_qty} pcs` : ""}</span>}
            </header>
            <div className="pad stack" style={{ gap: 6 }}>
              {!bill && <div className="mut sm">Open a bill from the counter (Save leaves a draft), or visit <code className="mono">#/recheck/&lt;bill id&gt;</code>. The most recent bill loads automatically.</div>}
              {t && <>
                <div className="row between sm"><span className="mut">Customer</span><b>{bill!.party_name || "Walk-in"}</b></div>
                <div className="row between sm"><span className="mut">Net</span><b className="mono">{rupees(t.net)}</b></div>
              </>}
            </div>
          </div>

          {verdict && (
            <div className={"card recheck-result " + (verdict.ok ? "ok" : "bad")}>
              <header><h3>{verdict.ok ? "Everything matches" : "Needs attention"}</h3>
                <span className={"pill " + (verdict.ok ? "ok" : "bad")}>{verdict.matched.length}/{distinctItems} matched</span></header>
              <div className="pad stack" style={{ gap: 6 }}>
                {verdict.missing.map(l => <div key={"m" + l.id} className="row between sm recheck-miss">
                  <span className="grow">{l.item} {l.style} {l.color}</span><span className="pill bad">MISSING from tray</span></div>)}
                {verdict.extra.map(x => <div key={"x" + x.code} className="row between sm recheck-extra">
                  <span className="grow">{x.product ? label(x.product) : x.code}</span><span className="pill warn">EXTRA / not billed</span></div>)}
                {verdict.matched.map(l => <div key={"g" + l.id} className="row between sm">
                  <span className="grow mut">{l.item} {l.style} {l.color}</span><span className="pill ok">on tray</span></div>)}
                {verdict.ok && <div className="note ok sm">All items on the bill are present and nothing extra is in the box. Print the receipt and seal it.</div>}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
