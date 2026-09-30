/// <reference lib="webworker" />
import { readBarcodes, prepareZXingModule } from "zxing-wasm/reader";

/* Decoding off the main thread: the screen stays smooth while every frame is read with the
   strongest settings (try harder, rotated, inverted, down-scaled, several binarizers). */
prepareZXingModule({ overrides: { locateFile: (p: string) => (p.endsWith(".wasm") ? "/zxing_reader.wasm" : p) }, fireImmediately: true } as any);

/* Dim, washed-out or soft frames: stretch the contrast (1st–99th percentile) and sharpen edges, in grey. */
function enhance(img: ImageData): ImageData {
  const { width: w, height: h, data: d } = img, n = w * h;
  const g = new Float32Array(n), hist = new Uint32Array(256);
  for (let i = 0, j = 0; i < n; i++, j += 4) { const v = (d[j] * 77 + d[j + 1] * 150 + d[j + 2] * 29) >> 8; g[i] = v; hist[v]++; }
  let lo = 0, hi = 255, acc = 0;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > n * 0.01) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > n * 0.01) { hi = v; break; } }
  const k = 255 / Math.max(8, hi - lo);
  const out = new ImageData(w, h), o = out.data;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let b = g[i];
    if (x > 0 && y > 0 && x < w - 1 && y < h - 1) b = (g[i - 1] + g[i + 1] + g[i - w] + g[i + w] + g[i] * 4) / 8;
    let v = ((g[i] + 1.2 * (g[i] - b)) - lo) * k;
    v = v < 0 ? 0 : v > 255 ? 255 : v;
    const j = i * 4; o[j] = o[j + 1] = o[j + 2] = v; o[j + 3] = 255;
  }
  return out;
}

type Job = { id: number; img: ImageData; strong: boolean };
const BASE = { formats: ["QRCode", "DataMatrix", "Code128", "Code39", "EAN13", "EAN8", "UPCA", "ITF"] as any, tryRotate: true, tryInvert: true, maxNumberOfSymbols: 12 };

self.onmessage = async (e: MessageEvent<Job>) => {
  const { id, img, strong } = e.data;
  try {
    let r = await readBarcodes(img, { ...BASE, tryHarder: true, tryDownscale: true, binarizer: "LocalAverage" } as any);
    let src = img;
    if (!r.some(x => x.isValid)) { src = enhance(img); r = await readBarcodes(src, { ...BASE, tryHarder: true, tryDownscale: true, binarizer: "LocalAverage" } as any); }
    if (!r.some(x => x.isValid) && strong) r = await readBarcodes(src, { ...BASE, tryHarder: true, tryDownscale: true, binarizer: "GlobalHistogram" } as any);
    const out = r.filter(x => x.isValid && x.text).map(x => {
      const p = x.position; const cx = (p.topLeft.x + p.topRight.x + p.bottomLeft.x + p.bottomRight.x) / 4, cy = (p.topLeft.y + p.topRight.y + p.bottomLeft.y + p.bottomRight.y) / 4;
      return { text: x.text, format: x.format, cx: cx / img.width, cy: cy / img.height };
    });
    (self as any).postMessage({ id, out });
  } catch (err: any) { (self as any).postMessage({ id, out: [], error: String(err?.message || err) }); }
};
