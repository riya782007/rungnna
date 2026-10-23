import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { labelArtworkGeometry } from "../src/lib/label-artwork";
import { DEFAULT_CFG } from "../src/pages/Labels";
import { blankProduct } from "../src/lib/products";

/* Owner, 24 Oct: "ALL must scan in one scan, without a single failure". Every sticker QR is drawn as the TSC prints
   it (203 dpi dots), the heat spreads every dot by a third of a square, and a real QR reader must still read it. */
const wasm = fs.readFileSync("node_modules/zxing-wasm/dist/reader/zxing_reader.wasm");
const reader = import("zxing-wasm/reader").then(async m => {
  await m.prepareZXingModule({ overrides: { wasmBinary: wasm.buffer.slice(wasm.byteOffset, wasm.byteOffset + wasm.byteLength) }, fireImmediately: true } as any);
  return m;
});
class ImageDataLike { constructor(public data: Uint8ClampedArray, public width: number, public height: number) {} }
(globalThis as any).ImageData ||= ImageDataLike;

function bitmap(path: string, size: number, bleed: number, scale = 3) {
  const W = (size + 16) * scale, off = 8 * scale, dark = new Uint8Array(W * W);
  for (const m of path.matchAll(/M(\d+) (\d+)h(\d+)v(\d+)h-\d+z/g)) {
    const [x, y, w, h] = m.slice(1).map(Number);
    for (let yy = y * scale - bleed; yy < (y + h) * scale + bleed; yy++) for (let xx = x * scale - bleed; xx < (x + w) * scale + bleed; xx++) dark[(yy + off) * W + xx + off] = 1;
  }
  const data = new Uint8ClampedArray(W * W * 4);
  for (let i = 0; i < W * W; i++) { const v = dark[i] ? 0 : 255; data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v; data[i * 4 + 3] = 255; }
  return new (globalThis as any).ImageData(data, W, W);
}

const CASES: [string, string, string, number][] = [
  ["SET", "K5210/2TXZ 1331", "EGHZ", 157600], ["HALF DULHAN SET", "K5210/2TXZ 6383", "UKHZ", 60000], ["BANGLES", "22315", "MIX", 9800],
  ["F-RING", "K5208/K-LT", "W/LP/B", 2400], ["EARRING", "K5210/11P K221026", "RANI PINK", 14600], ["SET", "SETS-1250-LONG/STYLE", "MULTICOLOUR", 125000],
];
describe("every sticker QR reads at the counter", () => {
  for (const [item, style, color, rate] of CASES) it(`${item} ${style}`, async () => {
    const m = await reader;
    const p = { ...blankProduct("o"), item, style, color, rate, pack: 1 } as any;
    const g = labelArtworkGeometry(DEFAULT_CFG, p, 1);
    expect(g.qr.moduleDots, "3-dot squares").toBe(3);
    for (const bleed of [0, 1, 2]) {   // a third and two thirds of a square of heat spread (in thirds of a dot)
      const res = await m.readBarcodes(bitmap(g.qr.path, g.qr.sizeDots, bleed), { formats: ["QRCode"], tryHarder: true });
      expect(res.find(r => r.isValid)?.text, `bleed ${bleed}`).toMatch(/^\d+~/);
    }
  });
});
