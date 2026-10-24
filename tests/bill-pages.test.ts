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
