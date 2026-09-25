import { Icon } from "./Icon";
import { useEffect, useRef, useState } from "react";

/* One scanner for everything: phone/tablet camera (QR + 1D barcodes) and the
   USB/Bluetooth scanner gun, which simply "types" the code and presses Enter.
   Decoding runs on the device with a self-hosted WebAssembly reader, so it works offline. */

const FORMATS = ["qr_code", "code_128", "code_39", "code_93", "ean_13", "ean_8", "upc_a", "upc_e", "itf", "codabar", "data_matrix"];

let detectorP: Promise<any> | null = null;
async function getDetector(): Promise<any> {
  if (!detectorP) detectorP = (async () => {
    const Native = (globalThis as any).BarcodeDetector;
    if (Native) {
      try {
        const supported: string[] = await Native.getSupportedFormats();
        if (supported.includes("qr_code")) return new Native({ formats: FORMATS.filter(f => supported.includes(f)) });
      } catch { /* fall through */ }
    }
    const mod = await import("barcode-detector/ponyfill");
    mod.setZXingModuleOverrides({ locateFile: (p: string) => (p.endsWith(".wasm") ? "/zxing_reader.wasm" : p) });
    return new mod.BarcodeDetector({ formats: FORMATS as any });
  })();
  return detectorP;
}
/* warm it up early so the first scan is instant */
export const warmScanner = () => { getDetector().catch(() => {}); };

export function CameraScanner({ onCode, paused = false, gap = 2500 }: { onCode: (text: string, format: string) => void; paused?: boolean; gap?: number }) {
  const video = useRef<HTMLVideoElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  const [on, setOn] = useState(false);
  const [torch, setTorch] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const last = useRef({ t: "", at: 0 });
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const cb = useRef(onCode); cb.current = onCode;

  const stop = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setOn(false); };

  const start = async () => {
    setErr("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false,
      });
      stream.current = s;
      if (video.current) { video.current.srcObject = s; await video.current.play(); }
      setOn(true);
    } catch (e: any) {
      setErr(e?.name === "NotAllowedError" ? "Camera permission was refused. Allow it in the browser settings, or use the scanner gun box below." : "No camera available here — use the scanner gun box below.");
    }
  };

  useEffect(() => { start(); return stop; }, []);

  useEffect(() => {
    if (!on) return;
    let alive = true, busy = false;
    const loop = async () => {
      if (!alive) return;
      const v = video.current;
      if (!busy && !pausedRef.current && v && v.readyState >= 2) {
        busy = true;
        try {
          const det = await getDetector();
          const found = await det.detect(v);
          if (found && found.length) {
            const { rawValue, format } = found[0];
            const t = Date.now();
            if (rawValue && !(rawValue === last.current.t && t - last.current.at < gap)) {
              last.current = { t: rawValue, at: t };
              flash.current?.classList.remove("go"); void flash.current?.offsetWidth; flash.current?.classList.add("go");
              cb.current(rawValue, format);
            }
          }
        } catch { /* frame not ready */ }
        busy = false;
      }
      setTimeout(() => requestAnimationFrame(loop), 110);
    };
    loop();
    return () => { alive = false; };
  }, [on]);

  const toggleTorch = async () => {
    const tr: any = stream.current?.getVideoTracks()[0];
    try { await tr?.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { /* not supported */ }
  };

  return (
    <div className="stack">
      <div className="vf">
        <video ref={video} playsInline muted />
        <div className="guide" />
        <div className="flash" ref={flash} />
        <span className="tag">{on ? (paused ? "Paused" : "Point at the label") : "Camera off"}</span>
      </div>
      {err && <div className="note warn">{err}</div>}
      <div className="row">
        {on ? <button className="btn sm" onClick={stop}>Stop camera</button> : <button className="btn sm p" onClick={start}>Start camera</button>}
        {on && <button className="btn sm" onClick={toggleTorch}>{torch ? "Torch off" : "Torch"}</button>}
      </div>
    </div>
  );
}

/* Scanner-gun box: keeps focus, submits on Enter, also accepts typed or pasted codes. */
export function WedgeInput({ onCode, placeholder, autoFocus = true }: { onCode: (t: string) => void; placeholder?: string; autoFocus?: boolean }) {
  const [v, setV] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!autoFocus) return;
    const f = (e: KeyboardEvent) => { if (e.key === "F7") { e.preventDefault(); ref.current?.focus(); } };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  }, [autoFocus]);
  return (
    <div className="wedge">
      <Icon n="scan" size={20} />
      <input ref={ref} value={v} autoFocus={autoFocus} placeholder={placeholder || "Scan with the gun, or type a code and press Enter (F7)"}
        onChange={e => setV(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && v.trim()) { onCode(v.trim()); setV(""); } }}
        autoComplete="off" autoCapitalize="characters" spellCheck={false} />
      <kbd className="xs mut">Enter</kbd>
    </div>
  );
}
