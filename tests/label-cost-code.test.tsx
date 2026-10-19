import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { fakeLetterPool, printedCostCode } from "../src/lib/label-cost-code";
import { DEFAULT_CFG, PRESETS, PrintSheet, expandJobs, printerSig, tscCommands, upgradeLabelCfg } from "../src/pages/Labels";
import { renderLabelSvg } from "../src/lib/label-artwork";
import { labelLines } from "../src/lib/label-tspl";
import { blankProduct } from "../src/lib/products";
import { ownPayload } from "../src/lib/parse";
const product = { ...blankProduct("owner"), item: "NECKLACE", item_code: "203", style: "TEST", rate: 25000, pack: 1, type: "PCS", cost_code: "RPPX1PCS" };
const cfg = { ...DEFAULT_CFG, fakeLetters: "Z" };
describe("printed cost disguise", () => {
  it("prints Karan's example and preserves packing digits and unit", () => {
    expect(printedCostCode("RPPX1PCS", cfg)).toBe("RP-ZX1PCS");
    expect(printedCostCode("RRRPRX12PAIR", cfg)).toBe("R--P-ZX12PAIR");
    expect(printedCostCode("RPR", cfg)).toBe("RP-Z");
    expect(printedCostCode(undefined, cfg)).toBe("");
  });
  it("supports an unrestricted pool, normalizes letters, cycles every unique letter and stays stable", () => {
    const pool = "ZYXABCDEFGHIJKLMNOPQRSTUVW".repeat(100);
    expect(fakeLetterPool(pool)).toHaveLength(26);
    const look = { ...cfg, fakeLetters: "Z,Y,y x 123" };
    const values = Array.from({ length: 6 }, (_, i) => printedCostCode(product.cost_code, look, i));
    expect(new Set(values.slice(0, 3)).size).toBe(3);
    expect(values.slice(0, 3)).toEqual(values.slice(3));
    expect(values.every(v => /^RP-[ZYX]X1PCS$/.test(v))).toBe(true);
    expect(printedCostCode(product.cost_code, look, 4)).toBe(values[4]);
  });
  it("allows no fake letter or restoring original appearance and upgrades existing settings", () => {
    expect(printedCostCode("RPPX1PCS", { ...cfg, fakeLetters: "" })).toBe("RP-X1PCS");
    expect(printedCostCode("RPPX1PCS", { ...cfg, compactCostCode: false })).toBe("RPPX1PCS");
    expect(upgradeLabelCfg({}).compactCostCode).toBe(true);
    expect(printerSig(cfg)).not.toBe(printerSig({ ...cfg, fakeLetters: "AB" }));
  });
  it("shares the displayed code across SVG and TSC without changing product or QR bytes", () => {
    const before = JSON.stringify(product), qr = ownPayload(product, "shop");
    const look = { ...cfg, fakeLetters: "ZYX" };
    for (let i = 0; i < 5; i++) {
      const text = printedCostCode(product.cost_code, look, i);
      expect(renderLabelSvg(look, product, 1, 7, i)).toContain(text);
      expect(labelLines({ ...look, labelIndex: i }, product, 1).some(l => l.text === text)).toBe(true);
    }
    expect(JSON.stringify(product)).toBe(before);
    expect(ownPayload(product, "shop")).toBe(qr);
  });
  it("varies identical copies and retains their chosen letter after a batch boundary", () => {
    const look = { ...cfg, fakeLetters: "ZYX" };
    const queue = expandJobs([{ p: product, copies: 6, qtyOnLabel: 1 }]).map((job, labelIndex) => ({ ...job, labelIndex }));
    const full = renderToStaticMarkup(<PrintSheet cfg={look} jobs={queue} />);
    const batch = renderToStaticMarkup(<PrintSheet cfg={look} jobs={queue.slice(3)} />);
    expect(full.match(/RP-[ZYX]X1PCS/g)).toEqual(queue.map(j => printedCostCode(product.cost_code, look, j.labelIndex)));
    expect(batch.match(/RP-[ZYX]X1PCS/g)).toEqual(queue.slice(3).map(j => printedCostCode(product.cost_code, look, j.labelIndex)));
    for (const job of queue.slice(3)) {
      const text = printedCostCode(product.cost_code, look, job.labelIndex);
      expect(full).toContain(text); expect(batch).toContain(text);
    }
    const single = { ...look, ...PRESETS.find(p => p.key === "rj")!.cfg };
    const commands = tscCommands(single, queue);
    expect(commands.match(/PRINT 1,1/g)).toHaveLength(6);
    for (let i = 0; i < 3; i++) expect(commands).toContain(printedCostCode(product.cost_code, look, i));
  });
});
