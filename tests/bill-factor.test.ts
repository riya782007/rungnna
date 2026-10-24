import { describe, expect, it } from "vitest";
import { checkBill, checkSummary } from "../src/lib/billCheck";

/* Owner's call, 24 Oct: the KALPESH copper-bangle bill (lines 28–58). QTY 24, 11, 12 … RATE 115, 102, 110 …
   AMOUNT 13800, 5610, 6600 … — every amount is 5 × qty × rate. The app showed 120, 55, 60. */
const PAGE: [string, string, string, string][] = [
  ["70640", "24", "115", "13800"], ["70150", "11", "102", "5610"], ["81173", "12", "110", "6600"], ["80488", "12", "117", "7020"],
  ["71111", "12", "126", "7560"], ["81201", "11", "107", "5885"], ["71122", "12", "99", "5940"], ["32903", "12", "57", "3420"],
  ["71098", "12", "74", "4440"], ["32955", "12", "62", "3720"], ["32598", "12", "75", "4500"], ["71029", "12", "50", "3000"],
  ["2133", "22", "104", "11440"], ["31588", "9", "147", "6615"], ["2345", "9", "107", "4815"],
];
const rows = PAGE.map(([style, qty, cost, amount]) => ({ item: "COPPER BAN", style, color: "", unit: "PCS", hsn: "", qty, cost, rate: "", amount, stickers: "" } as any));
describe("a bill whose every amount is 5 × qty × rate", () => {
  it("keeps the printed quantities and rates and reports the ×5 for the costing box", () => {
    const c = checkBill(rows);
    expect(c.factor).toBe(5);
    expect(c.rows.map(r => r.qty)).toEqual(PAGE.map(p => p[1]));
    expect(c.rows.map(r => r.cost)).toEqual(PAGE.map(p => p[2]));
    expect(c.sum * 5).toBe(PAGE.reduce((a, p) => a + Number(p[3]) * 100, 0));
    expect(c.fixes).toEqual([]);
    expect(checkSummary(c)).toMatch(/Multiply ×5/);
  });
  it("still fixes a real misread on an ordinary bill", () => {
    const c = checkBill([{ ...rows[0], qty: "2", amount: "2760" }, { ...rows[1], amount: "1122" }, { ...rows[2], amount: "1320" }]);
    expect(c.factor).toBeUndefined();
    expect(c.rows[0].qty).toBe("24");
  });
});

import { applyCosting, spreadExtra, readMultiplier, readExtra } from "../src/lib/purchase-photo";
describe("bill costing: multiply, less %, packing", () => {
  it("cost = printed rate × multiply − less %, always from the printed rate", () => {
    const once = applyCosting([{ cost: "115" }, { cost: "102" }], { mult: "5" });
    expect(once.map(r => r.cost)).toEqual(["575.00", "510.00"]);
    const again = applyCosting(once, { mult: "5", less: "10" });   // never multiplied twice
    expect(again.map(r => r.cost)).toEqual(["517.50", "459.00"]);
    expect(applyCosting(again, { mult: "1" }).map(r => r.cost)).toEqual(["115.00", "102.00"]);
  });
  it("spreads packing over the lines by value", () => {
    const rows = spreadExtra([{ qty: "10", cost: "100" }, { qty: "10", cost: "300" }], 400);
    expect(rows.map(r => r.cost)).toEqual(["110.00", "330.00"]);
  });
  it("reads the multiplier and packing printed under the total", () => {
    expect(readMultiplier({ bill_multiplier: "5" })).toBe("5");
    expect(readMultiplier({ bill_multiplier: "1" })).toBe("");
    expect(readExtra({ extra_charges: "Rs 1,200" })).toBe("1200");
  });
});
