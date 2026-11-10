import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { newBill, DEFAULT_SHOP, billText, billSummary, totals } from "../src/lib/billing";

/* Owner, 10 Nov (photo + voice): the WhatsApp bill had 32 long lines nobody understands, and "Thank you! �". */
describe("WhatsApp bill message", () => {
  const b = totals({ ...newBill("k", DEFAULT_SHOP, "estimate"), no: "EST/26CU0124",
    items: Array.from({ length: 32 }, (_, i) => ({ id: "l" + i, product_id: "", code: "", item: "EARING", style: "K5210/11P", color: "", type: "", unit: "PCS",
      qty: 2, rate: 1000, disc: 0, amount: 2000, box_no: 1, pkts: 0, pack: 0, gst_rate: 0 }) as any) }, "Delhi");
  it("sends a short message when the bill goes as a picture", () => {
    const s = billSummary(b, DEFAULT_SHOP);
    expect(s.split("\n").length).toBeLessThan(10);
    expect(s).toContain("32 items · 64 pcs");
    expect(s).not.toContain("EARING");
  });
  it("has no emoji that a computer cannot show", () => {
    for (const s of [billText(b, DEFAULT_SHOP), billSummary(b, DEFAULT_SHOP)]) expect(s).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });
});
