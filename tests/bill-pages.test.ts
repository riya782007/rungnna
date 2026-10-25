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
