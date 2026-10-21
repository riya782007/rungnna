import { describe, expect, it } from "vitest";
import { lineSignature } from "../src/lib/purchase-photo";

/* Cloud log, 21 Oct: the same bill saved twice (bill no. "EST 13/10/2022" then "EST 13/10/2022/", and
   bill 1750 under SOLANKI then SF) to print its stickers again, adding the stock a second time. */
describe("same bill entered again", () => {
  const a = [{ style: "K5210/11P", color: "W/XZ/13", qty: 12, cost: 5800 }, { style: "104208", color: "", qty: 3, cost: 9200 }];
  it("matches whatever the bill no., supplier, line order or letter case", () => {
    expect(lineSignature([...a].reverse().map(l => ({ ...l, style: l.style.toLowerCase() })))).toBe(lineSignature(a));
  });
  it("a different quantity or cost is a different bill", () => {
    expect(lineSignature([{ ...a[0], qty: 13 }, a[1]])).not.toBe(lineSignature(a));
    expect(lineSignature([a[0], { ...a[1], cost: 9300 }])).not.toBe(lineSignature(a));
  });
});
