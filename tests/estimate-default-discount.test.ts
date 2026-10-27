import { describe, expect, it } from "vitest";
import { DEFAULT_SHOP, newBill, totals, withEstimateDiscount } from "../src/lib/billing";
import { slipFeed } from "../src/lib/printing";

/* Owner, 27 Oct: "the discount didn't come by itself like we were used to, so the boy didn't give it". */
describe("a new estimate starts with the shop's usual discount", () => {
  const shop = { ...DEFAULT_SHOP, est_disc_pct: 50, est_less_pct: 3 };
  it("puts 50% + 3% less on a new estimate, worked out as 51.5% off", () => {
    const b = withEstimateDiscount(newBill("t", shop, "estimate"), shop);
    expect(b.discount_pct).toBe(50);
    expect(b.less_pct).toBe(3);
    const line = { id: "l", item: "BANGLE", style: "", color: "", type: "PCS", box_no: 1, pack: 1, pkts: 0, qty: 10, rate: 10000, disc: "", amount: 0 };
    expect(totals({ ...b, items: [line] } as any).discount).toBe(51500);
  });
  it("leaves tax invoices and challans alone, and a shop with no usual discount", () => {
    expect(withEstimateDiscount({ ...newBill("t", shop, "estimate"), bill_type: "gst" } as any, shop).discount_pct).toBe(0);
    const plain = withEstimateDiscount(newBill("t", DEFAULT_SHOP, "estimate"), DEFAULT_SHOP);
    expect(plain.discount_pct).toBe(0);
    expect(plain.less_pct).toBeFalsy();
  });
  it("ignores a nonsense setting", () => {
    expect(withEstimateDiscount(newBill("t", shop, "estimate"), { est_disc_pct: 250 }).discount_pct).toBe(0);
  });
});

describe("slips on the roll: no long blank gap with an automatic cutter", () => {
  it("adds blank paper only for a manual tear-off", () => {
    expect(slipFeed(15, "partial")).toBe(0);
    expect(slipFeed(15, "full")).toBe(0);
    expect(slipFeed(15, "manual")).toBe(15);
  });
});
