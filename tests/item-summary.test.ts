import { describe, expect, it } from "vitest";
import { billItemsText, partyItems } from "../src/lib/itemSummary";

/* Owner, 24 Nov: how many bangles / chain lockets a party took, all bills and bill by bill. */
const l = (item: string, qty: number, amount: number) => ({ item, qty, amount } as any);
const b = (id: string, type: string, items: any[], at: string, extra: any = {}) => ({ id, bill_type: type, status: "final", items, at, gross: items.reduce((a: number, x: any) => a + x.amount, 0), net: items.reduce((a: number, x: any) => a + x.amount, 0) / 2, ...extra } as any);

describe("item-wise", () => {
  it("one bill, biggest first", () => {
    expect(billItemsText({ items: [l("chain lkt", 8, 0), l("BANGLE", 12, 0), l("Chain LKT", 2, 0)] })).toBe("BANGLE 12 · CHAIN LKT 10");
  });
  it("a party: pieces and value after the bill discount, returns taken off, bills counted once", () => {
    const rows = partyItems([b("1", "estimate", [l("BANGLE", 12, 1200), l("BANGLE", 6, 600)], "2026-11-01"), b("2", "gst", [l("CHAIN LKT", 4, 400)], "2026-11-10"), b("3", "return", [l("BANGLE", 2, 200)], "2026-11-12"), b("4", "estimate", [l("BANGLE", 50, 5000)], "2026-11-13", { deleted: 1 })]);
    expect(rows).toEqual([{ item: "BANGLE", qty: 16, value: 800, bills: 1, last: "2026-11-01" }, { item: "CHAIN LKT", qty: 4, value: 200, bills: 1, last: "2026-11-10" }]);
  });
});
