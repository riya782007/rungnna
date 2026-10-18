import { describe, expect, it } from "vitest";
import { labelBatches, runsOf } from "../src/lib/labelBatches";

describe("printing stickers in batches that can be stopped", () => {
  it("prints a short run in one go, with nothing to stop between", () => {
    expect(labelBatches(30, 3)).toEqual([{ from: 0, to: 30 }]);
    expect(labelBatches(60, 3)).toEqual([{ from: 0, to: 60 }]);
  });

  it("starts a long run with one test row, then batches of whole rows", () => {
    const b = labelBatches(344, 3);                       // Karan's bill, one per piece
    expect(b[0]).toEqual({ from: 0, to: 3 });
    expect(b[1]).toEqual({ from: 3, to: 63 });
    expect(b[b.length - 1].to).toBe(344);
    expect(b.slice(1, -1).every(x => (x.to - x.from) % 3 === 0)).toBe(true);
    // every sticker exactly once, in order
    expect(b.every((x, i) => i === 0 || x.from === b[i - 1].to)).toBe(true);
  });

  it("caps what a 1000-for-100 mistake can waste at the test row", () => {
    const b = labelBatches(1000, 3);
    expect(b[0].to - b[0].from).toBe(3);
    expect(b.length).toBe(1 + Math.ceil(997 / 60));
  });

  it("never ends a batch mid-row, and 0 means all at once", () => {
    expect(labelBatches(100, 3, 50, false)[0]).toEqual({ from: 0, to: 51 });
    expect(labelBatches(500, 3, 0)).toEqual([{ from: 0, to: 500 }]);
    expect(labelBatches(0, 3)).toEqual([]);
  });

  it("groups identical stickers so the TSC gets one print command per product", () => {
    const a = { id: "a" }, b = { id: "b" };
    expect(runsOf([a, a, a, b, b, a])).toEqual([{ item: a, n: 3 }, { item: b, n: 2 }, { item: a, n: 1 }]);
  });
});

import { DEFAULT_CFG, upgradeLabelCfg, validateLabelPrint, PrintSheet } from "../src/pages/Labels";
import { renderToStaticMarkup } from "react-dom/server";
describe("the shop's stickers, printed as the old software prints them", () => {
  const PAGE = { preset: "rjpage", mode: "sheet", sheetW: 101.6, sheetH: 152.4, w: 33, h: 15, cols: 3, rows: 9, gapX: 1.3, gapY: 1.93, left: 3.5, edgeR: 100, qr: 8, font: 5, offX: 0, offY: 0 } as const;
  it("defaults to one row of 3 stickers per print, on the printer's own row-sized stock", () => {
    expect(DEFAULT_CFG).toMatchObject({ preset: "rjrow", mode: "roll", driverPaper: true, w: 33, h: 15, cols: 3, edgeR: 104 });
    expect(() => validateLabelPrint(DEFAULT_CFG, [{ p: { item: "KADA" } as any, qtyOnLabel: 1, copies: 1 }])).not.toThrow();
  });
  it("a row never wastes stickers: batches are whole rows and the test is one row", () => {
    const b = labelBatches(344, DEFAULT_CFG.cols);
    expect(b[0]).toEqual({ from: 0, to: 3 });
    expect(b.every(x => x.from % 3 === 0)).toBe(true);
  });
  it("sends no page size, so Chrome can't turn the short, wide row sideways", () => {
    const html = renderToStaticMarkup(<PrintSheet cfg={DEFAULT_CFG} jobs={[{ p: { item: "EARING", style: "K5210/11P", rate: 32000, type: "PCS" } as any, qtyOnLabel: 1, copies: 1 }]} />);
    expect(html).toContain("@page{margin:0}");
    expect(html).not.toMatch(/@page\{size/);
    expect(html).toContain("9320X1PCS");
  });
  it("keeps the third sticker inside the printer's 104 mm", () => {
    const c = DEFAULT_CFG, x3 = c.offX + 2 * (c.w + c.gapX);
    expect(Math.min(c.w, c.edgeR! - x3)).toBeGreaterThan(c.qr + 2 * c.pad + 8);
  });
  it("moves a device on any earlier default (50 × 20, 103 × 15 rows, the 4 × 6 page) to it", () => {
    for (const old of [{ preset: "rj", mode: "roll", w: 50, h: 20, cols: 1 }, { preset: "rj3", mode: "roll", w: 33, h: 15, cols: 3, gapX: 2 }, PAGE, { ...PAGE, left: 0, edgeR: undefined, qr: 11 }] as const)
      expect(upgradeLabelCfg({ ...DEFAULT_CFG, ...old, shop: "RJ" } as any)).toMatchObject({ preset: "rjrow", mode: "roll", driverPaper: true, shop: "RJ" });
  });
  it("leaves anything set by hand alone", () => {
    expect(upgradeLabelCfg({ ...DEFAULT_CFG, ...PAGE, offX: 1 } as any)).toMatchObject({ preset: "rjpage", offX: 1 });
    expect(upgradeLabelCfg({ ...DEFAULT_CFG, preset: "custom", mode: "roll", w: 40, h: 25, cols: 2 })).toMatchObject({ w: 40, h: 25, cols: 2 });
    expect(upgradeLabelCfg(null)).toMatchObject({ preset: "rjrow" });
  });
});

import { runBatches, printerSig } from "../src/pages/Labels";
describe("a computer can never waste more than one row before someone checks it", () => {
  it("unchecked: one row first, even for a short run, then the rest in normal batches", () => {
    expect(runBatches(9, 3, 60, true, false)).toEqual([{ from: 0, to: 3 }, { from: 3, to: 9 }]);
    const b = runBatches(344, 3, 60, true, false);
    expect(b[0]).toEqual({ from: 0, to: 3 });
    expect(b[b.length - 1].to).toBe(344);
    expect(b.every((x, i) => i === 0 || x.from === b[i - 1].to)).toBe(true);
    expect(runBatches(2, 3, 60, true, false)).toEqual([{ from: 0, to: 2 }]);
  });
  it("checked: prints as before", () => {
    expect(runBatches(9, 3, 60, true, true)).toEqual([{ from: 0, to: 9 }]);
  });
  it("any change to where the ink lands needs a new check; the shop name does not", () => {
    expect(printerSig({ ...DEFAULT_CFG, offX: 3 })).not.toBe(printerSig(DEFAULT_CFG));
    expect(printerSig({ ...DEFAULT_CFG, shop: "RJ" })).toBe(printerSig(DEFAULT_CFG));
  });
});

import { purchaseLabelJobs } from "../src/lib/purchase-labels";
describe("each sticker says which line of the bill its goods are on", () => {
  it("purchase labels carry the bill line, printed small on the third line beside the cost code", () => {
    const mk = (id: string, item: string) => ({ id, code: id, item, style: "S", color: "", type: "PCS", pack: 1, rate: 32000, cost_code: "KX", barcodes: [] } as any);
    const purchase = { status: "final", items: [{ product_id: "a", qty: 2, pack: 1 }, { product_id: "b", qty: 3, pack: 1 }] } as any;
    const jobs = purchaseLabelJobs(purchase, [mk("a", "EARING"), mk("b", "KADA")]);
    expect(jobs.map(j => j.line)).toEqual([1, 2]);
    const html = renderToStaticMarkup(<PrintSheet cfg={DEFAULT_CFG} jobs={[jobs[1]]} />);
    expect(html).toMatch(/<div>KADA<\/div>/);                       // the item line stays whole
    expect(html).toMatch(/KX<span class="lno lno-end"[^>]*>2<\/span>/); // the line number sits after the cost code, on the third line
    expect(renderToStaticMarkup(<PrintSheet cfg={{ ...DEFAULT_CFG, show: { ...DEFAULT_CFG.show, line: false } }} jobs={[jobs[1]]} />)).not.toContain('class="lno"');
  });
});

import { evenRate, sellFromCost, DEFAULT_RULE } from "../src/lib/pricing";
describe("label rates are always even, so half of them (the wholesale rate) is a whole rupee", () => {
  it("75 → 76, 76 stays, paise go up to the next even rupee", () => {
    expect(evenRate(7500)).toBe(7600); expect(evenRate(7600)).toBe(7600);
    expect(evenRate(2450)).toBe(2600); expect(evenRate(2400)).toBe(2400); expect(evenRate(0)).toBe(0);
  });
  it("prices worked out from cost come out even too", () => {
    for (const cost of [100, 2300, 4100, 9999]) expect((sellFromCost(cost * 100, DEFAULT_RULE) / 100) % 2).toBe(0);
  });
  it("the printed rate and the QR inside agree on the even rate", () => {
    const p = { id: "x", code: "RJ1", item: "KAMAR BELT", style: "KB-12", color: "", type: "PCS", pack: 1, rate: 7500, cost_code: "KXBS", item_code: "205", barcodes: [] } as any;
    const html = renderToStaticMarkup(<PrintSheet cfg={DEFAULT_CFG} jobs={[{ p, qtyOnLabel: 1, copies: 1 }]} />);
    expect(html).toContain("976X1PCS"); expect(html).not.toContain("975X1PCS");
  });
});
