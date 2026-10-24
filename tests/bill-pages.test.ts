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
