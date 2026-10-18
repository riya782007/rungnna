import { expect, it } from "vitest";
import { DEFAULT_CFG, validateLabelPrint, afterCheckRow, labelSetupKey, PrintSheet } from "../src/pages/Labels";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blankProduct } from "../src/lib/products";
const jobs = [{ p: { ...blankProduct("owner"), item: "BALI" }, qtyOnLabel: 1, copies: 4 }];
it("accepts the shop's default label format", () => { expect(() => validateLabelPrint(DEFAULT_CFG, jobs)).not.toThrow(); });
it("rejects broken roll dimensions rather than looping or spooling blank paper", () => {
  for (const change of [{ cols: 0 }, { cols: 1.5 }, { w: NaN }, { h: 0 }, { gapY: -1 }]) expect(() => validateLabelPrint({ ...DEFAULT_CFG, ...change }, jobs)).toThrow();
});
it("counts an accepted check row once even when it spans different products", () => {
  const second = { ...jobs[0], p: { ...jobs[0].p, item: "F-RING" }, copies: 4 };
  expect(afterCheckRow([{ ...jobs[0], copies: 2 }, second], 3)).toEqual([{ ...second, copies: 3 }]);
  expect(afterCheckRow(jobs, 4)).toEqual([]);
});
it("requires another check after changing printer or alignment", () => {
  const key = labelSetupKey(DEFAULT_CFG);
  expect(labelSetupKey({ ...DEFAULT_CFG, checked: key })).toBe(key);
  expect(labelSetupKey({ ...DEFAULT_CFG, offX: 0.5 })).not.toBe(key);
  expect(labelSetupKey({ ...DEFAULT_CFG, output: "qz", qzPrinter: "TSC" })).not.toBe(key);
});
it("prints 3-across browser pages with the gap managed by the driver", () => {
  const html = renderToStaticMarkup(createElement(PrintSheet, { cfg: DEFAULT_CFG, jobs: Array.from({ length: 4 }, () => jobs[0]) }));
  expect(html).toContain("@page{size:104mm 15mm;margin:0}");
  expect(html.match(/class="lbl"/g)).toHaveLength(4);
  expect(html.match(/page-break-after:always/g)).toHaveLength(1);
});
it("rejects an oversized QR before it can print an error message on a sticker", () => {
  expect(() => validateLabelPrint({ ...DEFAULT_CFG, h: 5 }, jobs)).toThrow("QR");
});
it("checks sheet fit, product names and the total batch before printing", () => {
  expect(() => validateLabelPrint({ ...DEFAULT_CFG, mode: "sheet", cols: 20, rows: 20 }, jobs)).toThrow("fit");
  expect(() => validateLabelPrint(DEFAULT_CFG, [{ ...jobs[0], copies: 5001 }])).toThrow("5000");
  expect(() => validateLabelPrint(DEFAULT_CFG, [{ ...jobs[0], p: { ...jobs[0].p, item: "" } }])).toThrow("names");
});
