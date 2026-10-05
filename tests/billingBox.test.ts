import "fake-indexeddb/auto";
import { describe, it, expect } from "vitest";
import { db, getSetting, setSetting, type BillLine } from "../src/lib/db";
import { newBill, DEFAULT_SHOP, fixLine } from "../src/lib/billing";
import { selectedBox, mergeBoxLine, type BillingDraft } from "../src/lib/billingBox";

const line = (patch: Partial<BillLine> = {}): BillLine => fixLine({ id: "a", product_id: "p", code: "P", item: "JHUMKA", type: "PCS", style: "S", color: "G", box_no: 8, pack: 12, pkts: 1, qty: 12, rate: 1000, disc: "", amount: 0, ...patch });

describe("billing box recovery and merging", () => {
  it("restores an empty selected box from the local draft snapshot", async () => {
    const draft = { ...newBill("", DEFAULT_SHOP, "gst"), items: [line({ box_no: 1 })], selected_box: 8 };
    await setSetting("draft_bill", draft);
    const restored = (await getSetting<BillingDraft | null>("draft_bill", null))!;
    expect(selectedBox(restored)).toBe(8);
    expect(restored.items[0].box_no).toBe(1);
    await db.settings.delete("draft_bill");
  });
  it("restores a selected earlier box instead of guessing the highest box", () => {
    expect(selectedBox({ ...newBill("", DEFAULT_SHOP), items: [line()], selected_box: 2 })).toBe(2);
  });
  it("recovers legacy drafts at their highest occupied box and rejects invalid metadata", () => {
    const b = { ...newBill("", DEFAULT_SHOP), items: [line()] };
    expect(selectedBox(b)).toBe(8);
    for (const selected_box of [0, -1, 1.5, NaN]) expect(selectedBox({ ...b, selected_box })).toBe(8);
    expect(selectedBox(newBill("", DEFAULT_SHOP))).toBe(1);
  });
  it("combines matching packets and keeps the target row identity and total", () => {
    const result = mergeBoxLine([line(), line({ id: "b", pkts: 2 })], "b");
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "a", box_no: 8, pkts: 3, qty: 36, amount: 36000 });
  });
  it("keeps loose pieces when combining them with packets", () => {
    expect(mergeBoxLine([line(), line({ id: "b", pkts: 0, qty: 5 })], "b")[0]).toMatchObject({ pkts: 0, qty: 17, amount: 17000 });
  });
  it("combines piece-based lines", () => {
    expect(mergeBoxLine([line({ pack: 1, pkts: 0, qty: 2 }), line({ id: "b", pack: 1, pkts: 0, qty: 3 })], "b")[0]).toMatchObject({ qty: 5, amount: 5000 });
  });
  it("keeps different boxes, products, rates, discounts and stock histories separate", () => {
    for (const patch of [{ box_no: 1 }, { product_id: "other" }, { rate: 2000 }, { disc: "10%" }, { stock_done: 1 as const }, { src_line: "original" }, { pack: 6 }]) {
      expect(mergeBoxLine([line(), line({ id: "b", ...patch })], "b")).toHaveLength(2);
    }
  });
  it("does not lose fixed line discounts or merge unidentified manual items", () => {
    expect(mergeBoxLine([line({ disc: "5" }), line({ id: "b", disc: "5" })], "b")).toHaveLength(2);
    expect(mergeBoxLine([line({ product_id: undefined }), line({ id: "b", product_id: undefined })], "b")).toHaveLength(2);
  });
});
