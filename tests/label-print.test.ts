import { expect, it } from "vitest";
import { DEFAULT_CFG, validateLabelPrint } from "../src/pages/Labels";
import { blankProduct } from "../src/lib/products";
const jobs = [{ p: { ...blankProduct("owner"), item: "BALI" }, qtyOnLabel: 1, copies: 4 }];
it("accepts the shop's default label format", () => { expect(() => validateLabelPrint(DEFAULT_CFG, jobs)).not.toThrow(); });
it("rejects broken roll dimensions rather than looping or spooling blank paper", () => {
  for (const change of [{ cols: 0 }, { cols: 1.5 }, { w: NaN }, { h: 0 }, { gapY: -1 }]) expect(() => validateLabelPrint({ ...DEFAULT_CFG, ...change }, jobs)).toThrow();
});
it("checks sheet fit, product names and the total batch before printing", () => {
  expect(() => validateLabelPrint({ ...DEFAULT_CFG, mode: "sheet", cols: 20, rows: 20 }, jobs)).toThrow("fit");
  expect(() => validateLabelPrint(DEFAULT_CFG, [{ ...jobs[0], copies: 5001 }])).toThrow("5000");
  expect(() => validateLabelPrint(DEFAULT_CFG, [{ ...jobs[0], p: { ...jobs[0].p, item: "" } }])).toThrow("names");
});
