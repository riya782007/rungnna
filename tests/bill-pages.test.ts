import { describe, expect, it } from "vitest";
import { isSamePage, nextPageNo } from "../src/lib/purchase-photo";

/* Owner, 24 Oct: the second page of a bill carries the same bill no. and must print its own stickers. */
const l = (style: string, qty: number, cost = 50, color = "") => ({ style, color, qty, cost });
describe("pages of one supplier bill", () => {
  it("same lines again = same page (print again); new lines = next page", () => {
    const page1 = [l("K1", 12), l("K2", 6)];
    expect(isSamePage(page1, [l("K2", 6), l("K1", 12)])).toBe(true);
    expect(isSamePage(page1, [l("K3", 12)])).toBe(false);
    expect(isSamePage(page1, [l("K1", 12), l("K3", 4)])).toBe(false);
  });
  it("numbers the next page after the pages already saved", () => {
    expect(nextPageNo("1234", ["1234"])).toBe("1234 P2");
    expect(nextPageNo("1234", ["1234", "1234 P2"])).toBe("1234 P3");
  });
});

import { withBillDiscount, readDiscount } from "../src/lib/purchase-photo";
import { joinHalves } from "../src/lib/pdf-pages";
describe("bill discount and long pages", () => {
  it("takes the bill's discount off each line's cost", () => {
    expect(withBillDiscount([{ cost: "100" }, { cost: "72.50" }, { cost: "" }], 10)).toEqual([{ cost: "90.00" }, { cost: "65.25" }, { cost: "" }]);
    expect(readDiscount({ discount_pct: "10%" }, [])).toBe("10");
    expect(readDiscount({ discount_amount: "120" }, [{ qty: "12", cost: "100" }])).toBe("10");
    expect(readDiscount({}, [{ qty: "1", cost: "5" }])).toBe("");
  });
  it("joins the two halves of a page without the lines both halves saw", () => {
    const top = [{ sr: "1", style: "A" }, { sr: "2", style: "B" }, { sr: "3", style: "C" }];
    const bottom = [{ sr: "3", style: "C" }, { sr: "4", style: "D" }];
    expect(joinHalves([top, bottom]).map(r => r.sr)).toEqual(["1", "2", "3", "4"]);
  });
});

import { joinParts, srSpan } from "../src/lib/pdf-pages";
describe("a page read in parts (owner, 24 Oct: 25 lines, read 18)", () => {
  const line = (sr: number) => ({ sr: String(sr), style: "S" + sr, qty: "12", cost: "100" });
  it("puts every line together once, in the bill's order", () => {
    const full = Array.from({ length: 18 }, (_, i) => line(i + 1));
    const parts = [[1, 9], [8, 16], [15, 23], [22, 25]].map(([a, b]) => Array.from({ length: b - a + 1 }, (_, i) => line(a + i)));
    const out = joinParts([full, parts[2], parts[0], parts[3], parts[1]]);
    expect(out.map(r => r.sr)).toEqual(Array.from({ length: 25 }, (_, i) => String(i + 1)));
  });
  it("counts the lines from the bill's own Sr. numbers", () => {
    expect(srSpan([line(28), line(29), line(45)])).toBe(18);
    expect(srSpan([{ sr: "" }, { sr: "" }, { sr: "" }])).toBe(0);
  });
});

import { continueSr } from "../src/lib/purchase-photo";
describe("lines typed by hand carry on the bill's Sr. (owner, 25 Oct)", () => {
  it("numbers them after the highest one read", () => {
    expect(continueSr([{ sr: "" }, { sr: "17" }, { sr: "18" }, { sr: "" }]).map(r => r.sr)).toEqual(["19", "17", "18", "20"]);
    expect(continueSr([{ sr: "" }, { sr: "" }]).map(r => r.sr)).toEqual(["", ""]);
  });
});

import { repeatedCodes } from "../src/lib/pdf-pages";
describe("owner, 29 Oct: the whole-page read slipped a line, so 3902 showed on Sr. 9 and 11", () => {
  const L = (sr: number, style: string, qty = "10") => ({ sr: String(sr), style, qty, cost: "100" });
  it("the close-up strips win over a slipped whole-page reading", () => {
    const whole = [L(8, "SET-360"), L(9, "3902", "12"), L(10, "6548"), L(11, "3902"), L(17, "14001", "13"), L(18, "14001", "14")];
    const top = [L(7, "6580"), L(8, "3902", "12"), L(9, "6548"), L(10, "19020"), L(11, "19026")];
    const bottom = [L(16, "14001"), L(17, "8500-1 TO 8500-12", "156"), L(18, "7200-1 TO 7200-9", "108")];
    const out = joinParts([whole, top, bottom]);
    expect(out.map(r => `${r.sr}:${r.style}`)).toEqual(["7:6580", "8:3902", "9:6548", "10:19020", "11:19026", "16:14001", "17:8500-1 TO 8500-12", "18:7200-1 TO 7200-9"]);
    expect(repeatedCodes(out)).toEqual([]);
  });
  it("names the bill's Sr. numbers of a code read twice", () => {
    expect(repeatedCodes([L(9, "3902"), L(10, "6548"), L(11, "3902 ")])).toEqual([{ style: "3902", lines: ["9", "11"] }]);
  });
});

import { keepRepeatsApart, combineRepeatedRows } from "../src/lib/purchase-photo";
describe("owner, 29 Oct: one code at two prices can still be approved", () => {
  const R = (sr: string, style: string, cost: string) => ({ review_id: sr, sr, item: "SET", style, color: "", unit: "PCS", hsn: "", qty: "10", pack: "1", stickers: "", cost, rate: "" }) as any;
  it("names the later line after its cost, and the merge then has no conflict", () => {
    const rows = [R("8", "3902", "410"), R("9", "6548", "510"), R("10", "3902", "495")];
    expect(combineRepeatedRows(rows).conflict).toMatch(/^Sr\. 8 and Sr\. 10 both have the code 3902/);
    const apart = keepRepeatsApart(rows);
    expect(apart.renamed).toEqual([{ sr: "10", from: "3902", to: "3902-495" }]);
    expect(combineRepeatedRows(apart.rows).conflict).toBeUndefined();
  });
});

import { byBoxes } from "../src/lib/purchase-photo";
describe("owner, 29 Oct: Box | Pcs | Qty on the bill decides the stickers", () => {
  it("one sticker per box, each with the pieces in that box", () => {
    expect(byBoxes("4", "48", "12")).toEqual({ stickers: "4", pack: "12", packSource: "bill" });
    expect(byBoxes("1", "12", "")).toEqual({ stickers: "1", pack: "12", packSource: "bill" });
    expect(byBoxes("2", "25", "")).toEqual({ stickers: "" });      // uneven boxes: left to the usual rules
    expect(byBoxes("", "12", "12")).toEqual({ stickers: "" });
  });
});

import { checkBill } from "../src/lib/billCheck";
describe("owner, 29 Oct: TIKA/NATH bill came out 12 × 12", () => {
  it("a box count read as the quantity is put right from the amount, not taken as a ×12 supplier rate", () => {
    const L = (box: string, cost: string, amount: string) => ({ item: "TIKA", style: "", color: "", unit: "PCS", hsn: "", qty: box, box, pack: "12", stickers: "", cost, rate: "", amount }) as any;
    const r = checkBill([L("4", "53", "2544"), L("2", "65", "1560"), L("1", "51", "612"), L("1", "67", "804")], "18336");
    expect(r.factor).toBeUndefined();
    expect(r.rows.map(x => x.qty)).toEqual(["48", "24", "12", "12"]);
    expect(r.rows.map(x => byBoxes(x.box, x.qty, x.pack).stickers)).toEqual(["4", "2", "1", "1"]);
  });
});
