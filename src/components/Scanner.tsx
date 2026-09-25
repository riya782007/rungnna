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
/* Decode a still photo (or a video frame): whole image first, then the middle and quarters enlarged.
   Small 15 mm stickers photographed from arm's length still read this way. */
export async function decodeImage(src: CanvasImageSource & { width?: number; height?: number }, W?: number, H?: number): Promise<{ rawValue: string; format: string } | null> {
  const det = await getDetector();
  const w = W || (src as any).videoWidth || (src as any).width, h = H || (src as any).videoHeight || (src as any).height;
  const tryOn = async (img: any) => { try { const f = await det.detect(img); return f && f.length ? f[0] : null; } catch { return null; } };
  const full = await tryOn(src); if (full) return full;
  const c = document.createElement("canvas"); const g = c.getContext("2d", { willReadFrequently: true })!;
  const crops: [number, number, number, number, number][] = [
    [0.25, 0.25, 0.5, 0.5, 2], [0, 0, 0.6, 0.6, 2], [0.4, 0, 0.6, 0.6, 2], [0, 0.4, 0.6, 0.6, 2], [0.4, 0.4, 0.6, 0.6, 2], [0.3, 0.3, 0.4, 0.4, 3],
  ];
  for (const [x, y, cw, ch, k] of crops) {
    const sw = w * cw, sh = h * ch;
    c.width = Math.min(2400, Math.round(sw * k)); c.height = Math.round(c.width * sh / sw);
    g.imageSmoothingQuality = "high";
    g.drawImage(src, w * x, h * y, sw, sh, 0, 0, c.width, c.height);
    const hit = await tryOn(c); if (hit) return hit;
  }
  return null;
}
export async function decodeFile(file: Blob) {
  const bmp = await createImageBitmap(file);
  // phone photos are huge; 2000 px on the long side keeps detail and stays fast
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  return decodeImage(c, c.width, c.height);
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
  const [zoomCap, setZoomCap] = useState<{ min: number; max: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [photoBusy, setPhotoBusy] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  const frame = useRef(0);
  const setZ = async (z: number) => { const tr: any = stream.current?.getVideoTracks()[0]; try { await tr?.applyConstraints({ advanced: [{ zoom: z }] }); setZoom(z); } catch { /* not supported */ } };
  const refocus = async () => { const tr: any = stream.current?.getVideoTracks()[0]; try { await tr?.applyConstraints({ advanced: [{ focusMode: "single-shot" }] }); await tr?.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* ignore */ } };
  /* A sticker counts once while it stays in view. It counts again only after it has left the picture
     (next packet, same label) — so resting the phone on one packet can never inflate the count. */
  const seen = useRef({ t: "", at: 0 });
  const emit = (rawValue: string, format: string, live = false) => {
    const t = Date.now();
    if (live) {
      const still = rawValue === seen.current.t && t - seen.current.at < 900;
      seen.current = { t: rawValue, at: t };
      if (still) return;
    }
    if (rawValue && !(rawValue === last.current.t && t - last.current.at < gap)) {
      last.current = { t: rawValue, at: t };
      flash.current?.classList.remove("go"); void flash.current?.offsetWidth; flash.current?.classList.add("go");
      cb.current(rawValue, format);
    }
  };
  const last = useRef({ t: "", at: 0 });
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const cb = useRef(onCode); cb.current = onCode;

  const stop = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setOn(false); };

  const start = async () => {
    setErr("");
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false,
      });
      stream.current = s;
      const tr: any = s.getVideoTracks()[0];
      const caps = tr?.getCapabilities?.() || {};
      try { if (caps.focusMode?.includes?.("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* ignore */ }
      setZoomCap(caps.zoom ? { min: caps.zoom.min || 1, max: Math.min(caps.zoom.max || 1, 4) } : null);
      if (video.current) { video.current.srcObject = s; await video.current.play(); }
      setOn(true);
    } catch (e: any) {
      setErr(e?.name === "NotAllowedError" ? "Camera permission was refused. Allow it in the browser settings, or use the scanner gun box below." : "No camera available here — use the scanner gun box below.");
    }
  };

  useEffect(() => { start(); return stop; }, []);

  useEffect(() => {
    if (!on) return;
    let alive = true, busy = false; let zoomCanvas: HTMLCanvasElement | null = null;
    const loop = async () => {
      if (!alive) return;
      const v = video.current;
      if (!busy && !pausedRef.current && v && v.readyState >= 2) {
        busy = true;
        try {
          const det = await getDetector();
          frame.current++;
          let found = await det.detect(v);
          if ((!found || !found.length) && frame.current % 2 === 0) {
            // every other frame: look again at the middle of the picture, enlarged — small stickers from further away
            const c = zoomCanvas || (zoomCanvas = document.createElement("canvas"));
            const w = v.videoWidth, h = v.videoHeight, sw = w * 0.5, sh = h * 0.5;
            c.width = Math.round(sw * 2); c.height = Math.round(sh * 2);
            c.getContext("2d")!.drawImage(v, (w - sw) / 2, (h - sh) / 2, sw, sh, 0, 0, c.width, c.height);
            found = await det.detect(c);
          }
          if (found && found.length) emit(found[0].rawValue, found[0].format, true);
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
        <video ref={video} playsInline muted onClick={refocus} />
        <div className="guide" />
        <div className="flash" ref={flash} />
        <span className="tag">{on ? (paused ? "Paused" : "Point at the label") : "Camera off"}</span>
      </div>
      {err && <div className="note warn">{err}</div>}
      <div className="row">
        {on ? <button className="btn sm" onClick={stop}>Stop camera</button> : <button className="btn sm p" onClick={start}>Start camera</button>}
        {on && <button className="btn sm" onClick={toggleTorch}>{torch ? "Torch off" : "Torch"}</button>}
        {on && zoomCap && zoomCap.max > 1 && <button className="btn sm" onClick={() => setZ(zoom >= Math.min(3, zoomCap.max) ? zoomCap.min : Math.min(zoom + 1, zoomCap.max))}>Zoom {zoom}×</button>}
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
          setPhotoBusy(true);
          try { const r = await decodeFile(f); if (r) emit(r.rawValue + "", r.format); else setErr("Couldn't read a code in that photo — hold the phone a little closer, keep the sticker flat and try again."); }
          finally { setPhotoBusy(false); }
        }} />
        <button className="btn sm" onClick={() => { setErr(""); last.current = { t: "", at: 0 }; photo.current?.click(); }} disabled={photoBusy}>{photoBusy ? "Reading…" : "Photo scan"}</button>
      </div>
      <div className="xs mut">Tip: hold the sticker 10–15 cm away and tap the picture to focus. For very small stickers use Photo scan.</div>
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
