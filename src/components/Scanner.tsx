import { Icon } from "./Icon";
import { useEffect, useRef, useState } from "react";
import { getSetting, setSetting } from "../lib/db";

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
  // phone photos are huge; 2000 px on the long side keeps detail and stays fast
  const k = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext("2d")!.drawImage(bmp, 0, 0, c.width, c.height);
  // 1) plain crops/enlargement (fast, handles most photos)
  const plain = await decodeImage(c, c.width, c.height);
  if (plain) return plain;
  // 2) contrast/threshold passes for faint or damaged stickers
  return decodeHardImage(c, c.width, c.height);
}

/* warm it up early so the first scan is instant */
export const warmScanner = () => { getDetector().catch(() => {}); };

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
  /* camera picker: laptops have a webcam, phones have front + rear. We remember
     the last camera on this device and let the user switch/flip. */
  const [cams, setCams] = useState<MediaDeviceInfo[]>([]);
  const [camId, setCamId] = useState<string>("");
  const camIdRef = useRef<string>(""); camIdRef.current = camId;
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

  const start = async (wantId?: string) => {
    setErr("");
    // Stop any running stream first (switching cameras).
    stream.current?.getTracks().forEach(t => t.stop());
    const id = wantId ?? camIdRef.current;
    // Prefer a chosen camera; otherwise the rear ("environment") camera on phones.
    const video1 = id
      ? { deviceId: { exact: id }, width: { ideal: 1920 }, height: { ideal: 1080 } }
      : { facingMode: { ideal: "environment" }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: video1 as MediaTrackConstraints, audio: false });
      stream.current = s;
      const tr: any = s.getVideoTracks()[0];
      const caps = tr?.getCapabilities?.() || {};
      try { if (caps.focusMode?.includes?.("continuous")) await tr.applyConstraints({ advanced: [{ focusMode: "continuous" }] }); } catch { /* ignore */ }
      setZoomCap(caps.zoom ? { min: caps.zoom.min || 1, max: Math.min(caps.zoom.max || 1, 4) } : null);
      if (video.current) { video.current.srcObject = s; await video.current.play(); }
      setOn(true);

      // Labels are only readable after permission is granted; enumerate now.
      try {
        const list = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
        setCams(list);
        // remember which camera we actually got
        const activeId = tr?.getSettings?.().deviceId || id || "";
        if (activeId) { setCamId(activeId); setSetting("scan_camera_id", activeId); }
      } catch { /* enumeration may be blocked; the flip control just won't show */ }
    } catch (e: any) {
      if (id && e?.name === "OverconstrainedError") { return start(""); } // chosen camera gone → default
      setErr(e?.name === "NotAllowedError"
        ? "Camera permission was refused. Allow it in the browser settings (tap the camera/lock icon in the address bar → Allow), or use the scanner gun box below."
        : "No camera available here — use the scanner gun box below or Photo scan.");
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
        {on ? <button className="btn sm" onClick={stop}>Stop camera</button> : <button className="btn sm p" onClick={() => start()}>Start camera</button>}
        {on && cams.length > 1 && <button className="btn sm" onClick={flip} title="Switch camera (rear / front / webcam)"><Icon n="camera" size={15} /> Switch</button>}
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
      <div className="xs mut">Tip: hold the sticker 10–15 cm away and tap the picture to focus. For very small stickers use Photo scan.{cams.length > 1 ? " Tap Switch to change cameras." : ""}</div>
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
