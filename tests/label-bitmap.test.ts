import { describe, expect, it, vi } from "vitest";
import type { LabelCfg } from "../src/pages/Labels";
import type { Product } from "../src/lib/db";
import { labelArtworkGeometry, labelQr, renderLabelSvg } from "../src/lib/label-artwork";
import { buildLabelBitmapJob, encodeLabelBitmapRow, labelBitmapRows, labelRowWidth, rgbaToTsplBitmap, validateLabelBitmapJob } from "../src/lib/label-bitmap";

const cfg: LabelCfg = {
  preset: "three", mode: "roll", w: 33, h: 15, cols: 3, gapX: 2.5, gapY: 2.6, sheetW: 210, sheetH: 297, top: 0, left: 0, rows: 1,
  qr: 9, font: 5.5, pad: 0.6, offX: 0, offY: 0, shop: "RUNGNNA", format: "shop", layout: "shop",
  show: { shop: true, item: true, style: true, color: true, rate: true, tk: false, code: false, qty: true, cost_code: false },
};
const p: Product = { id: "1", updated_at: "", code: "R1", barcodes: [], item: "F-RING", type: "PCS", style: "K521011/P", color: "WXZ713", tk: "", rate: 914600, mrp: 0, category: "", notes: "", item_code: "202", pack: 1, cost_code: "WXZX1PCS" };
const job = { p, qtyOnLabel: 6, copies: 4 };

describe("label artwork", () => {
  it("shares the old label arrangement and exact packet quantity, with no currency glyph", () => {
    const svg = renderLabelSvg(cfg, p, 6);
    expect(svg).toContain('width="33mm" height="15mm"');
    expect(svg).toContain("F-RING"); expect(svg).toContain("K521011/P"); expect(svg).toContain("WXZ713");
    expect(svg).toContain(">9146X6PCS</text>"); expect(svg).not.toContain("₹"); expect(svg).toContain("rotate(90)");
  });
  it("keeps packet quantity visible with hidden rate, honors toggles and recalculates cost code", () => {
    const svg = renderLabelSvg({ ...cfg, show: { ...cfg.show, rate: false, item: false, cost_code: true } }, p, 4);
    expect(svg).toContain(">4PCS</text>"); expect(svg).toContain(">WXZX4PCS</text>");
    expect(svg).not.toContain(">F-RING</text>"); expect(svg).not.toContain(">9146");
    expect(renderLabelSvg({ ...cfg, layout: "stack" }, p, 1)).not.toContain("rotate(90)");
  });
  it("escapes product and shop text so imported invoice fields cannot create HTML", () => {
    const svg = renderLabelSvg({ ...cfg, shop: "<script>&" }, { ...p, item: '<img src="x" onerror="alert(1)">' }, 1);
    expect(svg).not.toContain("<img"); expect(svg).not.toContain("<script>"); expect(svg).toContain("&lt;img"); expect(svg).toContain("&lt;script&gt;&amp;");
  });
  it("uses integer QR dots and a four-module quiet border even when 9mm needs expanding", () => {
    const qr = labelQr("202~9146~6~~~K521011/P~WXZ713", 9);
    expect(qr.moduleDots).toBeGreaterThanOrEqual(2);
    expect(Number.isSafeInteger(qr.moduleDots)).toBe(true);
    expect(qr.sizeDots).toBe((qr.modules + 8) * qr.moduleDots);
    expect(qr.path).toMatch(/^M8 8/);
    expect(qr.path).not.toMatch(/\d\.\d/);
    expect(() => labelArtworkGeometry({ ...cfg, h: 5 }, p, 1)).toThrow("QR details");
  });
  it("keeps the bottom price and quantity beside an expanded QR instead of underneath it", () => {
    const c = { ...cfg, format: "rungnna" as const }, product = { ...p, code: "R".repeat(40) };
    const g = labelArtworkGeometry(c, product, 1000000);
    expect(g.qr.sizeDots).toBeGreaterThan(85);
    const textWidth = g.width - g.pad - g.brand - g.qr.sizeDots - g.pad * 2;
    expect(renderLabelSvg(c, product, 1000000)).toContain(`textLength="${textWidth}" lengthAdjust="spacingAndGlyphs">9146X1000000PCS</text>`);
  });
});

describe("TSPL row bitmap", () => {
  it("packs MSB first, uses zero for black, and leaves byte padding white", () => {
    const pixels = new Uint8ClampedArray(9 * 2 * 4).fill(255);
    for (const index of [0, 7, 8, 9 + 1]) pixels.fill(0, index * 4, index * 4 + 3);
    expect([...rgbaToTsplBitmap(pixels, 9, 2)]).toEqual([0x7e, 0x7f, 0xbf, 0xff]);
    expect([...rgbaToTsplBitmap(new Uint8Array([0, 0, 0, 0]), 1, 1)]).toEqual([255]);
  });
  it("reproduces the black arrow diagram and byte table from TSC's manual page 68", () => {
    // Official v3 manual, printed p68 / PDF page86: shaded cells are 0, white are1.
    // Encode the diagram's shaded spans; expected bytes come from its separate table.
    const spans = [
      [[0, 16]], [[0, 16]], [[0, 16]], [[0, 5]], [[0, 6]],
      [[0, 3], [4, 7]], [[0, 3], [5, 8]], [[0, 3], [6, 9]],
      [[0, 3], [7, 10]], [[0, 3], [8, 11]], [[0, 3], [9, 12]],
      [[0, 3], [10, 13]], [[0, 3], [11, 14]], [[0, 3], [12, 13]],
      [[0, 3]], [[0, 3]],
    ];
    const rgba = new Uint8ClampedArray(16 * 16 * 4).fill(255);
    spans.forEach((row, y) => row.forEach(([left, right]) => {
      for (let x = left; x < right; x++) rgba.fill(0, (y * 16 + x) * 4, (y * 16 + x) * 4 + 3);
    }));
    expect([...rgbaToTsplBitmap(rgba, 16, 16)]).toEqual([
      0, 0, 0, 0, 0, 0, 0x07, 0xff, 0x03, 0xff, 0x11, 0xff, 0x18, 0xff,
      0x1c, 0x7f, 0x1e, 0x3f, 0x1f, 0x1f, 0x1f, 0x8f, 0x1f, 0xc7,
      0x1f, 0xe3, 0x1f, 0xf7, 0x1f, 0xff, 0x1f, 0xff,
    ]);
  });
  it("declares 104x15mm plus a separate gap, binary dimensions and exactly one page per row", () => {
    expect(labelRowWidth(cfg)).toBe(104);
    const bitmap = new Uint8Array(104 * 120).fill(255); bitmap[0] = 0;
    const bytes = encodeLabelBitmapRow(cfg, bitmap), text = new TextDecoder("latin1").decode(bytes);
    expect(text).toContain("SIZE 104 mm,15 mm\r\nGAP 2.6 mm,0 mm\r\n");
    expect(text).toContain("REFERENCE 0,0\r\nSHIFT 0\r\nOFFSET 0 mm\r\nDIRECTION 1\r\nCLS\r\nBITMAP 0,0,104,120,0,");
    expect(text.endsWith("\r\nPRINT 1,1\r\n")).toBe(true);
    const binaryStart = text.indexOf("BITMAP 0,0,104,120,0,") + "BITMAP 0,0,104,120,0,".length;
    expect(bytes[binaryStart]).toBe(0); expect(bytes[binaryStart + bitmap.length - 1]).toBe(255);
    expect(() => encodeLabelBitmapRow(cfg, new Uint8Array(1))).toThrow("does not match");
  });
  it("keeps job order across rows and leaves the final row unfilled", () => {
    const b = { ...job, p: { ...p, id: "2", item: "CHAIN" }, copies: 2, qtyOnLabel: 1 };
    const rows = labelBitmapRows(cfg, [job, b, { ...job, copies: 1 }]);
    expect(rows.map(row => row.map(j => j.p.id))).toEqual([["1", "1", "1"], ["1", "2", "2"], ["1"]]);
    expect(rows.flat().map(j => j.qtyOnLabel)).toEqual([6, 6, 6, 6, 1, 1, 6]);
  });
  it("rejects sheets, wide rolls and broken quantities before touching a printer or canvas", () => {
    expect(() => validateLabelBitmapJob(cfg, [job])).not.toThrow();
    for (const patch of [{ mode: "sheet" as const }, { w: 40 }, { gapY: -1 }, { offY: 15 }, { cols: 0 }]) expect(() => validateLabelBitmapJob({ ...cfg, ...patch }, [job])).toThrow();
    expect(() => validateLabelBitmapJob(cfg, [{ ...job, copies: 5001 }])).toThrow("5000");
    expect(() => labelBitmapRows(cfg, [{ ...job, qtyOnLabel: 0 }])).toThrow("quantities");
  });
  it("rasterizes the same SVG, prints two rows for four labels, and clears spare cells", async () => {
    const draws: unknown[][] = [], clips: unknown[][] = [], fills: unknown[][] = [];
    const context = { fillStyle: "", imageSmoothingEnabled: true, fillRect: (...a: unknown[]) => fills.push(a), save: vi.fn(), beginPath: vi.fn(), rect: (...a: unknown[]) => clips.push(a), clip: vi.fn(), restore: vi.fn(), drawImage: (...a: unknown[]) => draws.push(a), getImageData: () => ({ data: new Uint8ClampedArray(832 * 120 * 4).fill(255) }) };
    const original = { document: globalThis.document, Image: globalThis.Image, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    const svgs: Blob[] = [];
    class FakeImage { onload: (() => void) | null = null; onerror: (() => void) | null = null; set src(_: string) { this.onload?.(); } }
    vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }), fonts: { ready: Promise.resolve() } });
    vi.stubGlobal("Image", FakeImage);
    URL.createObjectURL = blob => { svgs.push(blob as Blob); return "blob:test"; }; URL.revokeObjectURL = vi.fn();
    try {
      const bytes = await buildLabelBitmapJob(cfg, [job]);
      const text = new TextDecoder("latin1").decode(bytes);
      expect(text.match(/PRINT 1,1/g)).toHaveLength(2);
      expect(draws.map(a => a.slice(1))).toEqual([[0, 0, 264, 120], [284, 0, 264, 120], [568, 0, 264, 120], [0, 0, 264, 120]]);
      expect(fills).toEqual([[0, 0, 832, 120], [0, 0, 832, 120]]);
      expect(clips).toHaveLength(4);
      expect(await svgs[0].text()).toBe(renderLabelSvg(cfg, p, 6));
    } finally { vi.unstubAllGlobals(); URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke; }
  });
});
