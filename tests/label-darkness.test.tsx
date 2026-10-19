import { describe, expect, it } from "vitest";
import { DEFAULT_CFG, PRESETS, printerSig, type LabelCfg } from "../src/pages/Labels";
import { blankProduct } from "../src/lib/products";
import { ownPayload } from "../src/lib/parse";
import { labelHeat } from "../src/lib/label-darkness";
import { labelTSPL } from "../src/lib/label-tspl";
import { encodeLabelBitmapRow } from "../src/lib/label-bitmap";
import { renderLabelSvg } from "../src/lib/label-artwork";

const product = { ...blankProduct("owner"), code: "R1", item: "RING", item_code: "202", type: "PCS", style: "K5209/", color: "GOLD", rate: 10000, pack: 12, ref: "212" };
describe("label darkness without sticker changes", () => {
  it("sets heat and slower speed on both direct TSC and QZ bitmap output", () => {
    const cfg = { ...DEFAULT_CFG, ...PRESETS.find(p => p.key === "50x25")!.cfg, cols: 1 } as LabelCfg;
    const direct = labelTSPL(cfg, product, 12, 1, ownPayload(product));
    expect(direct).toContain("DENSITY 10\r\nSPEED 2");
    expect(labelTSPL({ ...cfg, density: 13, speed: 1 }, product, 12, 1, ownPayload(product))).toContain("DENSITY 13\r\nSPEED 1");
    const bitmap = new Uint8Array(104 * 120).fill(255);
    const text = new TextDecoder().decode(encodeLabelBitmapRow({ ...DEFAULT_CFG, density: 12, speed: 3 }, bitmap));
    expect(text).toContain("DENSITY 12\r\nSPEED 3\r\nCLS");
  });
  it("preserves QR, row and line artwork, stock dimensions and exact bitmap bytes when heat changes", () => {
    const cfg = { ...DEFAULT_CFG, ...PRESETS.find(p => p.key === "50x25")!.cfg, cols: 1 } as LabelCfg;
    const hot = { ...cfg, density: 14, speed: 1 };
    expect(renderLabelSvg(hot, product, 12, 7)).toBe(renderLabelSvg(cfg, product, 12, 7));
    const print = (look: LabelCfg) => labelTSPL(look, product, 12, 3, ownPayload(product)).replace(/DENSITY \d+\r\nSPEED \d+/, "");
    expect(print(hot)).toBe(print(cfg));
    const bitmap = new Uint8Array(104 * 120).fill(173);
    const raw = (density: number) => {
      const bytes = encodeLabelBitmapRow({ ...DEFAULT_CFG, density }, bitmap);
      const marker = new TextEncoder().encode("BITMAP 0,0,104,120,0,");
      const index = new TextDecoder("latin1").decode(bytes).indexOf("BITMAP 0,0,104,120,0,") + marker.length;
      return bytes.slice(index);
    };
    expect(raw(10)).toEqual(raw(14));
    expect(printerSig({ ...DEFAULT_CFG, density: 14 })).not.toBe(printerSig(DEFAULT_CFG));
  });
  it("refuses invalid heat values before sending a print job", () => {
    for (const density of [-1, 16, 2.5, NaN]) expect(() => labelHeat({ density })).toThrow("darkness");
    for (const speed of [0, 7, 1.5, Infinity]) expect(() => labelHeat({ speed })).toThrow("speed");
    expect(labelHeat({ density: 0, speed: 1 })).toEqual({ density: 0, speed: 1 });
  });
});
