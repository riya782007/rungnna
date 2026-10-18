import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { DEFAULT_CFG, PRESETS, LabelView, type LabelCfg } from "../src/pages/Labels";
import { labelTSPL, labelLines, labelRate } from "../src/lib/label-tspl";
import { blankProduct } from "../src/lib/products";
import { productForLabel } from "../src/lib/purchase-labels";
import { ownPayload } from "../src/lib/parse";

const p = { ...blankProduct("o"), code: "RAB12XYZ", item: "F-RING", type: "PCS", style: "K5208/K-LT", color: "W/LP/B", rate: 2450, item_code: "202", pack: 12, ref: "183", tk: "" , cost_code: "OAX12PCS" };
const all = { ...DEFAULT_CFG.show, cost_code: true, code: true, tk: true };

describe("sticker text", () => {
  it("rates print as on the old stickers: whole rupees plain, paise with two places", () => {
    expect(labelRate(2400)).toBe("24"); expect(labelRate(2450)).toBe("24.50"); expect(labelRate(1999)).toBe("19.99");
  });
  for (const layout of ["shop", "stack"] as const) it(`direct print carries exactly the screen sticker's words (${layout})`, () => {
    const cfg: LabelCfg = { ...DEFAULT_CFG, layout, show: all };
    const html = renderToStaticMarkup(<LabelView cfg={cfg} p={p} qtyOnLabel={12} />).replace(/<[^>]+>/g, "\n");
    for (const l of labelLines(cfg, productForLabel(p, 12), 12)) expect(html).toContain(l.text);
  });
});

describe("TSPL for the TSC printer", () => {
  const job = (cfg: LabelCfg, copies = 3) => { const pp = productForLabel(p, 12); return labelTSPL(cfg, pp, 12, copies, ownPayload(pp, cfg.format || "shop")); };
  it("prints the requested copies of a correctly sized label", () => {
    const t = job({ ...DEFAULT_CFG, ...PRESETS.find(x => x.key === "rj")!.cfg } as LabelCfg);
    expect(t).toMatch(/^SIZE 50 mm, 20 mm\r\n/); expect(t).toContain("PRINT 1,3\r\n"); expect(t).toContain("QRCODE ");
    expect(t).toContain('"926X12PCS"');   // ₹24.50 prints as 26: label rates are even whole rupees   // the shop's own mark before the rate, as on its old stickers expect(t).toContain('"RUNGNNA"');
  });
  it("keeps every text line clear of the QR and inside the label on every roll preset", () => {
    for (const pre of PRESETS.filter(x => x.cfg.mode === "roll" && (x.cfg.cols || 1) === 1)) {
      const cfg = { ...DEFAULT_CFG, ...pre.cfg, show: all } as LabelCfg;
      let t: string;
      try { t = job(cfg); } catch (e: any) { expect(e.message).toMatch(/QR|room/); continue; }
      const qrX = Number(t.match(/QRCODE (\d+),/)![1]);
      for (const m of t.matchAll(/TEXT (\d+),(\d+),"(\d)",0,1,1,"([^"]*)"/g)) {
        const w = { "1": 8, "2": 12, "3": 16, "4": 24, "5": 32 }[m[3]]!, h = { "1": 12, "2": 20, "3": 24, "4": 32, "5": 48 }[m[3]]!;
        expect(Number(m[1]) + m[4].length * w, pre.key + " " + m[4]).toBeLessThanOrEqual(qrX + 2);
        expect(Number(m[2]) + h, pre.key).toBeLessThanOrEqual(cfg.h * 8);
      }
      const cell = Number(t.match(/QRCODE \d+,\d+,M,(\d+),/)![1]);
      expect(cell, pre.key).toBeGreaterThanOrEqual(2);
    }
  });
  it("nudges move the whole label the same way", () => {
    const a = job(DEFAULT_CFG), b = job({ ...DEFAULT_CFG, offX: DEFAULT_CFG.offX + 1, offY: DEFAULT_CFG.offY + 1 });
    const xy = (t: string) => [...t.matchAll(/(?:TEXT|QRCODE) (\d+),(\d+)/g)].map(m => [Number(m[1]), Number(m[2])]);
    xy(b).forEach(([x, y], i) => { expect(x - xy(a)[i][0]).toBe(8); expect(y - xy(a)[i][1]).toBe(8); });
  });
  it("refuses jobs it would print wrong", () => {
    expect(() => job({ ...DEFAULT_CFG, qr: 4 })).toThrow(/QR/);
    expect(() => job(DEFAULT_CFG, 0)).toThrow(/quantity/);
    expect(() => labelTSPL(DEFAULT_CFG, { ...p, item: "अंगूठी" }, 1, 1, "x")).toThrow(/Hindi/);
  });
});

describe("TSPL never prints a wrong price or quantity", () => {
  const big = { ...p, rate: 124550, pack: 144 };
  const words = (t: string) => [...t.matchAll(/TEXT \d+,\d+,"\d",0,1,1,"([^"]*)"/g)].map(m => m[1]);
  for (const key of ["40x30", "38x25", "rj", "50x25"]) it(`${key}: the full rate line is printed, or the job is refused`, () => {
    const cfg = { ...DEFAULT_CFG, ...PRESETS.find(x => x.key === key)!.cfg, show: all } as LabelCfg;
    const pp = productForLabel(big, 144);
    let t = "";
    try { t = labelTSPL(cfg, pp, 144, 1, ownPayload(pp)); } catch (e: any) { expect(e.message).toMatch(/fit|Too much|QR|room/); return; }
    const joined = [...new Set(words(t))].join("");
    expect(joined).toContain("91246X144PCS");
    expect(joined).toContain("OAX12PCS".replace("12", "144"));
  });
});

describe("the rate mark", () => {
  it("prints 9 before the rate, as the shop's old stickers do, and ₹ only when chosen", () => {
    const pp = productForLabel(p, 12);
    expect(renderToStaticMarkup(<LabelView cfg={DEFAULT_CFG} p={pp} qtyOnLabel={12} />)).toContain("926X12PCS");
    expect(renderToStaticMarkup(<LabelView cfg={{ ...DEFAULT_CFG, cur: "₹" }} p={pp} qtyOnLabel={12} />)).toContain("₹26X12PCS");
    // a printer with no ₹ in its fonts still gets a readable mark
    expect(labelTSPL({ ...DEFAULT_CFG, cols: 1, mode: "roll", w: 50, h: 20, qr: 15, cur: "₹" } as LabelCfg, pp, 12, 1, "x")).toContain("Rs.26");
  });
});
