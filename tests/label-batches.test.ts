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

import { DEFAULT_CFG, upgradeLabelCfg } from "../src/pages/Labels";
describe("the shop's sticker roll", () => {
  it("defaults to the roll Karan actually uses: 3 across, 33 × 15 mm", () => {
    expect(DEFAULT_CFG).toMatchObject({ mode: "roll", w: 33, h: 15, cols: 3 });
  });
  it("moves a device still on the old 50 × 20 guess to the real roll, keeping its other choices", () => {
    const c = upgradeLabelCfg({ ...DEFAULT_CFG, preset: "rj", w: 50, h: 20, cols: 1, shop: "RJ", offX: 1 });
    expect(c).toMatchObject({ preset: "rj3", w: 33, h: 15, cols: 3, shop: "RJ", offX: 1 });
  });
  it("leaves a size someone set by hand alone", () => {
    expect(upgradeLabelCfg({ ...DEFAULT_CFG, preset: "custom", w: 40, h: 25, cols: 2 })).toMatchObject({ w: 40, h: 25, cols: 2 });
    expect(upgradeLabelCfg(null)).toMatchObject({ w: 33, cols: 3 });
  });
});
