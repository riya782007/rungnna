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
  it("keeps the printed quantities and rates", () => {
    const c = checkBill(rows);
    expect(c.factor).toBe(5);
    expect(c.rows.map(r => r.qty)).toEqual(PAGE.map(p => p[1]));
    expect(c.rows.map(r => r.cost)).toEqual(PAGE.map(p => p[2]));
    expect(c.fixes).toEqual([]);
    expect(checkSummary(c)).toMatch(/5 × Qty × Rate/);
  });
  it("still fixes a real misread on an ordinary bill", () => {
    const c = checkBill([{ ...rows[0], qty: "2", amount: "2760" }, { ...rows[1], amount: "1122" }, { ...rows[2], amount: "1320" }]);
    expect(c.factor).toBeUndefined();
    expect(c.rows[0].qty).toBe("24");
  });
});
