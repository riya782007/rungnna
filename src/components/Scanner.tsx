import { Icon } from "./Icon";
import { useEffect, useRef, useState } from "react";
import { getSetting, setSetting } from "../lib/db";

/* One scanner for everything: phone / tablet / laptop camera (QR + barcodes) and the USB/Bluetooth
   scanner gun, which simply "types" the code and presses Enter.

   Live camera reading, built for tiny shop stickers in poor light:
   - the sharpest stream the camera offers (up to 2560 px), continuous focus, and 2× zoom when the lens
     allows, so the phone can stay far enough away to focus while the sticker still fills enough pixels;
   - every frame is read by the phone's own detector when it has one (Android Chrome — very fast) AND by a
     WebAssembly reader in a background worker with the strongest settings (try-harder, rotated, inverted,
     contrast-stretched + sharpened when the first pass fails);
   - frames alternate between the whole aiming box and an enlarged middle, so small or far stickers read;
   - when several stickers are in view (a sheet), the one nearest the centre wins;
   - a sticker counts once while it stays in view. Everything runs on the device, offline. */

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
type Hit = { text: string; format: string; cx: number; cy: number };

/* ---------- background WebAssembly reader ---------- */
let worker: Worker | null = null, seq = 0;
const pending = new Map<number, (h: Hit[]) => void>();
function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("../lib/scanWorker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; out: Hit[] }>) => { pending.get(e.data.id)?.(e.data.out || []); pending.delete(e.data.id); };
    worker.onerror = () => { pending.forEach(f => f([])); pending.clear(); };
  }
  return worker;
}
function wasmRead(img: ImageData, strong = false): Promise<Hit[]> {
  return new Promise(res => {
    let w: Worker; try { w = getWorker(); } catch { res([]); return; }
    const id = ++seq; pending.set(id, res);
    w.postMessage({ id, img, strong }, [img.data.buffer]);
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); res([]); } }, 4000);
  });
}
/* the phone's built-in detector only (never the slow ponyfill on the main thread) */
let nativeP: Promise<any> | null = null;
function nativeDetector(): Promise<any> {
  if (!nativeP) nativeP = (async () => {
    const Native = (globalThis as any).BarcodeDetector;
    if (!Native) return null;
    try { const s: string[] = await Native.getSupportedFormats(); return s.includes("qr_code") ? new Native({ formats: FORMATS.filter(f => s.includes(f)) }) : null; } catch { return null; }
  })();
  return nativeP;
}
async function nativeRead(src: CanvasImageSource, w: number, h: number): Promise<Hit[]> {
  const d = await nativeDetector(); if (!d) return [];
  try {
    const f = await d.detect(src);
    return (f || []).filter((x: any) => x.rawValue).map((x: any) => {
      const b = x.boundingBox || { x: 0, y: 0, width: 0, height: 0 };
      return { text: String(x.rawValue), format: x.format, cx: (b.x + b.width / 2) / w, cy: (b.y + b.height / 2) / h };
    });
  } catch { return []; }
}
const nearest = (hits: Hit[]) => hits.sort((a, b) => Math.hypot(a.cx - 0.5, a.cy - 0.5) - Math.hypot(b.cx - 0.5, b.cy - 0.5))[0];
function grab(src: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, maxSide: number, up = 1): ImageData {
  const k = Math.min(up, maxSide / Math.max(sw, sh));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k));
  const g = c.getContext("2d", { willReadFrequently: true })!; g.imageSmoothingQuality = "high";
  g.drawImage(src, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return g.getImageData(0, 0, c.width, c.height);
}

/* Decode a still photo: phone's detector on the whole picture, then the strong reader on the whole picture,
   the middle and the four quarters enlarged. Small 15 mm stickers photographed from arm's length read this way. */
export async function decodeImage(src: CanvasImageSource & { width?: number; height?: number }, W?: number, H?: number): Promise<{ rawValue: string; format: string } | null> {
  const w = W || (src as any).videoWidth || (src as any).width, h = H || (src as any).videoHeight || (src as any).height;
  const n = await nativeRead(src, w, h); if (n.length) { const b = nearest(n); return { rawValue: b.text, format: b.format }; }
  const tiles: [number, number, number, number, number][] = [[0, 0, 1, 1, 1], [0.2, 0.2, 0.6, 0.6, 2], [0, 0, 0.55, 0.55, 2], [0.45, 0, 0.55, 0.55, 2], [0, 0.45, 0.55, 0.55, 2], [0.45, 0.45, 0.55, 0.55, 2]];
  for (const [x, y, cw, ch, up] of tiles) {
    const r = await wasmRead(grab(src, w * x, h * y, w * cw, h * ch, 2400, up), true);
    if (r.length) { const b = nearest(r); return { rawValue: b.text, format: b.format }; }
  }
  return null;
}
/* Contrast / threshold pass for faint, glary or damaged thermal stickers that the
   plain crops miss. Grayscale → Otsu binarisation (auto black/white split) at a
   couple of upscales. Fully on-device and bounded (a handful of passes). */
async function decodeHardImage(src: CanvasImageSource, w: number, h: number): Promise<{ rawValue: string; format: string } | null> {
  const det = await getDetector();
  const tryOn = async (img: any) => { try { const f = await det.detect(img); return f && f.length ? f[0] : null; } catch { return null; } };

  // regions to attack: whole frame, then the centre (where a held-up sticker sits)
  const regions: [number, number, number, number][] = [[0, 0, 1, 1], [0.2, 0.2, 0.6, 0.6], [0.32, 0.32, 0.36, 0.36]];
  const scales = [1.5, 2.5];
  const c = document.createElement("canvas"); const g = c.getContext("2d", { willReadFrequently: true })!;

  for (const [rx, ry, rw, rh] of regions) {
    const sw = w * rw, sh = h * rh;
    for (const k of scales) {
      c.width = Math.min(1800, Math.round(sw * k)); c.height = Math.round(c.width * sh / sw);
      g.imageSmoothingQuality = "high";
      g.drawImage(src, w * rx, h * ry, sw, sh, 0, 0, c.width, c.height);
      binarizeOtsu(g, c.width, c.height);
      const hit = await tryOn(c); if (hit) return hit;
    }
  }
  return null;
}

/* In-place grayscale + Otsu threshold: finds the brightness that best separates
   ink from paper, then hard black/white. Rescues low-contrast QR from thermal fade. */
function binarizeOtsu(g: CanvasRenderingContext2D, w: number, h: number) {
  const img = g.getImageData(0, 0, w, h); const d = img.data;
  const hist = new Array(256).fill(0);
  const lum = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const y = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    lum[p] = y; hist[y]++;
  }
  const total = w * h;
  let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
  let sumB = 0, wB = 0, maxVar = -1, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) * (mB - mF);
    if (between > maxVar) { maxVar = between; thr = t; }
  }
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    const v = lum[p] > thr ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  g.putImageData(img, 0, 0);
}

export async function decodeFile(file: Blob) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, 2400 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  // 1) phone detector + strong reader over tiles (handles almost every photo)
  const plain = await decodeImage(c, c.width, c.height);
  if (plain) return plain;
  // 2) hard black/white threshold passes for faint or damaged thermal stickers
  return decodeHardImage(c, c.width, c.height);
}

/* warm both engines up so the first scan is instant */
export const warmScanner = () => { getDetector().catch(() => {}); nativeDetector().catch(() => {}); try { getWorker(); } catch { /* no workers */ } };

/* A detected code with the four corner points of its outline, in the source's
   own pixel space. Used by the overhead recheck to draw the AR boxes. */
export type Detected = { rawValue: string; format: string; corners: { x: number; y: number }[] };

/* Read EVERY code visible in one frame at once (not just the first). This is what
   the tray recheck needs: a whole box of stickers read in a single look. */
export async function detectAll(src: CanvasImageSource): Promise<Detected[]> {
  const det = await getDetector();
  try {
    const found = await det.detect(src);
    return (found || [])
      .filter((f: any) => f.rawValue)
      .map((f: any) => ({
        rawValue: String(f.rawValue),
        format: f.format,
        // Native gives cornerPoints; the ZXing ponyfill gives the same shape.
        corners: (f.cornerPoints || []).map((p: any) => ({ x: p.x, y: p.y })),
      }));
  } catch {
    return [];
  }
}

export function CameraScanner({ onCode, paused = false, gap = 2500, tall = false }: { onCode: (text: string, format: string) => void; paused?: boolean; gap?: number; tall?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const [err, setErr] = useState("");
  const [on, setOn] = useState(false);
  const [torch, setTorch] = useState(false);
  const stream = useRef<MediaStream | null>(null);
  const [zoomCap, setZoomCap] = useState<{ min: number; max: number } | null>(null);
  const [zoom, setZoom] = useState(1);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [lastText, setLastText] = useState("");
  const photo = useRef<HTMLInputElement>(null);
  /* camera picker: laptops have a webcam, phones have front + rear. We remember
     the last camera on this device and let the user switch/flip. */
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState<string>("");
  const camIdRef = useRef<string>(""); camIdRef.current = camId;
  const track = () => stream.current?.getVideoTracks()[0] as any;
  const setZ = async (z: number) => { try { await track()?.applyConstraints({ advanced: [{ zoom: z }] }); setZoom(z); } catch { /* not supported */ } };
  const refocus = async () => { try { await track()?.applyConstraints({ advanced: [{ focusMode: "single-shot" }] }); await track()?.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* ignore */ } };
  const last = useRef({ t: "", at: 0 });
  const seen = useRef({ t: "", at: 0 });
  const pausedRef = useRef(paused); pausedRef.current = paused;
  const cb = useRef(onCode); cb.current = onCode;

  /* A sticker counts once while it stays in view. It counts again only after it has left the picture
     (next packet, same label) — so resting the phone on one packet can never inflate the count. */
  const emit = (text: string, format: string, live = false) => {
    const t = Date.now();
    if (live) { const still = text === seen.current.t && t - seen.current.at < 900; seen.current = { t: text, at: t }; if (still) return; }
    if (!text || (text === last.current.t && t - last.current.at < gap)) return;
    last.current = { t: text, at: t };
    setLastText(text);
    flash.current?.classList.remove("go"); void flash.current?.offsetWidth; flash.current?.classList.add("go");
    cb.current(text, format);
  };

  const stop = () => { stream.current?.getTracks().forEach(t => t.stop()); stream.current = null; setOn(false); };

  const start = async (wantId?: string) => {
    setErr("");
    stream.current?.getTracks().forEach(t => t.stop());
    if (!navigator.mediaDevices?.getUserMedia) { setErr("This browser can't open the camera. Use Chrome, Photo scan, or a phone as scanner."); return; }
    const id = wantId ?? camIdRef.current;
    const hi = { width: { ideal: 2560 }, height: { ideal: 1440 }, frameRate: { ideal: 30 } };
    const want = id ? { deviceId: { exact: id }, ...hi } : { facingMode: { ideal: "environment" }, ...hi };
    try {
      let s: MediaStream;
      try { s = await navigator.mediaDevices.getUserMedia({ video: want as MediaTrackConstraints, audio: false }); }
      catch (e: any) {
        if (id && e?.name === "OverconstrainedError") return start("");            // chosen camera gone → default
        if (e?.name === "NotAllowedError") throw e;
        s = await navigator.mediaDevices.getUserMedia({ video: id ? { deviceId: { exact: id } } : { facingMode: { ideal: "environment" } }, audio: false });
      }
      stream.current = s;
      const tr: any = s.getVideoTracks()[0];
      const caps = tr?.getCapabilities?.() || {};
      try { if (caps.focusMode?.includes?.("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* ignore */ }
      if (caps.zoom && caps.zoom.max > 1) {
        const zc = { min: caps.zoom.min || 1, max: Math.min(caps.zoom.max, 5) };
        setZoomCap(zc);
        // 2× lets the phone stay ~15 cm away (where it can focus) while the sticker still fills the frame
        const z = Math.min(2, zc.max); try { await tr.applyConstraints({ advanced: [{ zoom: z }] }); setZoom(z); } catch { /* ignore */ }
      } else setZoomCap(null);
      if (video.current) { video.current.srcObject = s; await video.current.play().catch(() => {}); }
      setOn(true);
      try {
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        setCams(list);
        const activeId = tr?.getSettings?.().deviceId || id || "";
        if (activeId) { setCamId(activeId); setSetting("scan_camera_id", activeId); }
      } catch { /* enumeration may be blocked; the flip control just won't show */ }
    } catch (e: any) {
      setErr(e?.name === "NotAllowedError"
        ? "Camera permission was refused. Tap the lock/camera icon in the address bar → Allow camera, then Start camera."
        : e?.name === "NotReadableError" ? "The camera is busy in another app or tab. Close it and tap Start camera."
        : "No camera available here — use Photo scan, a scanner gun, or a phone as scanner.");
    }
  };

  /* Switch to the next available camera (rear → front → webcam → …). */
  const flip = async () => {
    if (cams.length < 2) return;
    const idx = Math.max(0, cams.findIndex(c => c.deviceId === camIdRef.current));
    const next = cams[(idx + 1) % cams.length];
    setCamId(next.deviceId); setSetting("scan_camera_id", next.deviceId);
    await start(next.deviceId);
  };

  useEffect(() => { getSetting<string>("scan_camera_id", "").then(id => { setCamId(id); start(id); }); return stop; }, []);

  useEffect(() => {
    if (!on) return;
    let alive = true, frame = 0, fails = 0;
    (async () => {
      while (alive) {
        const v = video.current;
        if (pausedRef.current || !v || v.readyState < 2 || !v.videoWidth) { await new Promise(r => setTimeout(r, 120)); continue; }
        frame++;
        const W = v.videoWidth, H = v.videoHeight;
        // aiming box = middle 80% × 70%; every other frame, the middle 45% enlarged 2×
        const wide = frame % 2 === 1;
        const [fx, fy] = wide ? [0.8, 0.7] : [0.45, 0.4];
        const sw = W * fx, sh = H * fy, sx = (W - sw) / 2, sy = (H - sh) / 2;
        let hits: Hit[] = [];
        try {
          const img = grab(v, sx, sy, sw, sh, 1600, wide ? 1 : 2);
          const [n, z] = await Promise.all([wide ? nativeRead(v, W, H) : Promise.resolve([] as Hit[]), wasmRead(img, fails > 6)]);
          hits = [...n, ...z.map(h => ({ ...h, cx: (sx + h.cx * sw) / W, cy: (sy + h.cy * sh) / H }))];
        } catch { /* frame not ready */ }
        if (!alive) break;
        if (hits.length) { fails = 0; const b = nearest(hits); emit(b.text, b.format, true); setStatus(""); }
        else { fails++; if (fails === 40) setStatus("Hold the sticker flat, 10–20 cm away. Tap the picture to focus, use the torch, or Photo scan."); }
        await new Promise(r => requestAnimationFrame(() => r(null)));
      }
    })();
    return () => { alive = false; };
  }, [on]);

  const toggleTorch = async () => { try { await track()?.applyConstraints({ advanced: [{ torch: !torch }] }); setTorch(!torch); } catch { setErr("This camera has no torch."); } };

  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className={"vf" + (tall ? " tall" : "")}>
        <video ref={video} playsInline muted autoPlay onClick={refocus} />
        <div className="guide" />
        <div className="flash" ref={flash} />
        <span className="tag">{on ? (paused ? "Paused" : "Point at the sticker") : "Camera off"}</span>
        {lastText && <span className="lastread">✓ {lastText.length > 34 ? lastText.slice(0, 34) + "…" : lastText}</span>}
      </div>
      {status && <div className="xs mut">{status}</div>}
      {err && <div className="note warn sm">{err}</div>}
      <div className="row" style={{ gap: 6 }}>
        {on ? <button className="btn sm" onClick={stop}>Stop</button> : <button className="btn sm p" onClick={() => start()}>Start camera</button>}
        {on && cams.length > 1 && <button className="btn sm" onClick={flip} title="Switch camera (rear / front / webcam)"><Icon n="camera" size={15} /> Switch</button>}
        {on && <button className="btn sm" onClick={toggleTorch}>{torch ? "Torch off" : "Torch"}</button>}
        {on && zoomCap && <button className="btn sm" onClick={() => setZ(zoom >= Math.min(3, zoomCap.max) ? zoomCap.min : Math.min(zoom + 1, zoomCap.max))}>Zoom {zoom}×</button>}
        <input ref={photo} type="file" accept="image/*" capture="environment" hidden onChange={async e => {
          const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
          setPhotoBusy(true); setErr("");
          try { const r = await decodeFile(f); if (r) { last.current = { t: "", at: 0 }; emit(String(r.rawValue), r.format); } else setErr("Couldn't find a code in that photo. Keep the sticker flat and fill more of the picture."); }
          finally { setPhotoBusy(false); }
        }} />
        <button className="btn sm" onClick={() => photo.current?.click()} disabled={photoBusy}><Icon n="camera" size={15} />{photoBusy ? "Reading…" : "Photo scan"}</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------------
   Global scanner-gun listener.

   A USB/Bluetooth gun "types" the code and presses Enter — but only if some
   input happens to be focused does the app see it. This hook listens on the
   whole document so a gun works the instant a code is scanned, with no click
   into a box first. It tells a gun apart from a person by SPEED: guns fire
   keys a few milliseconds apart and finish with Enter/Tab; people are slower.

   It deliberately does NOT fire when the user is typing in a real field (input,
   textarea, contenteditable, select) — including the WedgeInput — so it never
   fights normal typing or double-reads a code the WedgeInput already handled.
--------------------------------------------------------------------------- */
export function useScannerGun(
  onCode: (code: string) => void,
  opts: { enabled?: boolean; minLength?: number; maxGapMs?: number } = {},
) {
  const cb = useRef(onCode); cb.current = onCode;
  const enabled = opts.enabled !== false;
  const minLength = opts.minLength ?? 3;
  const maxGapMs = opts.maxGapMs ?? 35;   // guns are typically 1–15 ms/char; people >100 ms

  useEffect(() => {
    if (!enabled) return;
    let buf = "";
    let lastAt = 0;
    let timer: any = 0;

    const editable = (el: EventTarget | null) => {
      const n = el as HTMLElement | null;
      if (!n || !n.tagName) return false;
      const tag = n.tagName.toLowerCase();
      return tag === "input" || tag === "textarea" || tag === "select" || n.isContentEditable;
    };

    const reset = () => { buf = ""; };

    const onKey = (e: KeyboardEvent) => {
      // Never interfere with real typing (incl. the WedgeInput box).
      if (editable(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const now = performance.now();
      const gap = now - lastAt;
      lastAt = now;

      if (e.key === "Enter" || e.key === "Tab") {
        if (buf.length >= minLength) { const code = buf; reset(); cb.current(code); }
        else reset();
        // don't preventDefault Tab focus moves unless we actually consumed a scan
        if (buf.length === 0 && (e.key === "Enter")) { /* let real Enter pass */ }
        return;
      }

      // Only single printable characters are part of a scan.
      if (e.key.length !== 1) return;

      // A slow keystroke means a human started typing → begin a fresh buffer.
      if (gap > maxGapMs) buf = "";
      buf += e.key;

      // Guns that send no terminator: flush shortly after the burst stops.
      clearTimeout(timer);
      timer = setTimeout(() => { if (buf.length >= minLength) { const code = buf; reset(); cb.current(code); } else reset(); }, 60);
    };

    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("keydown", onKey, true); clearTimeout(timer); };
  }, [enabled, minLength, maxGapMs]);
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
