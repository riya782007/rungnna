import { describe, it, expect } from "vitest";
import { labelOrder, orderedLines, DEFAULT_ORDER } from "../src/lib/label-order";
import { labelLines } from "../src/lib/label-tspl";
import { renderLabelSvg } from "../src/lib/label-artwork";
import { DEFAULT_CFG } from "../src/pages/Labels";
import { blankProduct } from "../src/lib/products";

/* Owner, 22 Oct: "set where each thing goes on the sticker, so nobody is confused reading it". */
const p = { ...blankProduct("s"), id: "p", item: "SET", style: "K5210", color: "WHITE", entry_code: "K221026", cost_code: "PRO", rate: 42600, pack: 1 } as any;
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);

describe("sticker order", () => {
  it("fills in a saved order and ignores rubbish", () => {
    expect(labelOrder(undefined)).toEqual(DEFAULT_ORDER);
    expect(labelOrder(["style", "x", "style", "item"]).slice(0, 2)).toEqual(["style", "item"]);
    expect(labelOrder(["style"])).toHaveLength(DEFAULT_ORDER.length);
  });
  it("keeps Reference and Style on one line, in the chosen order", () => {
    expect(orderedLines(["style", "ref"], { style: "K5210", ref: "K221026" }, false)[0].text).toBe("K5210 K221026");
    expect(orderedLines(undefined, { style: "K5210", ref: "K221026" }, false)[0].text).toBe("K221026 K5210");
  });
  it("the usual order prints as before", () => {
    const look = { shop: "S", show: { item: true, style: true, color: true, rate: true, qty: true, cost_code: true } as any, cur: "9" };
    expect(labelLines(look, p, 1).map(l => l.text)).toEqual(["SET", "K221026 K5210", "WHITE", "9426X1PCS", "PRO"]);
  });
  it("puts the cost code first and style before reference when he asks", () => {
    const look = { shop: "S", show: { item: true, style: true, color: true, rate: true, qty: true, cost_code: true } as any, cur: "9", order: ["cost", "style", "ref", "item"] };
    expect(labelLines(look, p, 1).map(l => l.text)).toEqual(["9426X1PCS", "PRO", "K5210 K221026", "SET", "WHITE"]);
    const svg = renderLabelSvg({ ...DEFAULT_CFG, cur: "9", order: ["cost", "style", "ref", "item"], show: { ...DEFAULT_CFG.show, item: true, style: true, color: true, rate: true, qty: true, cost_code: true } }, p, 1);
    const t = texts(svg);
    expect(t.indexOf("K5210 K221026 WHITE")).toBeLessThan(t.indexOf("SET"));
    expect(t[t.length - 1]).toBe("9426X1PCS");
  });
  it("can hide the reference but keep the style", () => {
    const look = { shop: "S", show: { style: true, ref: false } as any };
    expect(labelLines(look, p, 1).map(l => l.text)).toEqual(["K5210"]);
  });
});
