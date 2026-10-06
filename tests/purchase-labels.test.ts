import { expect, it } from "vitest";
import { purchaseLabelJobs, productForLabel } from "../src/lib/purchase-labels";
import { ownPayload, parseLabel } from "../src/lib/parse";
import { blankProduct } from "../src/lib/products";
import { newPurchase, lineOf } from "../src/lib/stockin";

const p = { ...blankProduct("owner"), id: "p", item: "BALI", type: "PAIR", rate: 10000 };
const purchase = () => ({ ...newPurchase("owner", "rack"), status: "final" as const, items: [{ ...lineOf(p), qty: 6, pack: 2 }] });
it("prepares all named purchase products with packet-aware copy counts", () => {
  expect(purchaseLabelJobs(purchase(), [p])).toEqual([{ p, qtyOnLabel: 2, copies: 3 }]);
});
it("does not silently print an incomplete purchase", () => {
  expect(() => purchaseLabelJobs(purchase(), [])).toThrow("missing");
  expect(() => purchaseLabelJobs(purchase(), [{ ...p, item: "" }])).toThrow("name");
});
it("rejects unsaved purchases and unsafe quantities", () => {
  expect(() => purchaseLabelJobs({ ...purchase(), status: "hold" }, [p])).toThrow("Save");
  const x = purchase(); x.items[0].qty = 10002;
  expect(() => purchaseLabelJobs(x, [p])).toThrow("5000");
  x.items[0].qty = 0; expect(() => purchaseLabelJobs(x, [p])).toThrow("quantities");
});
it("prints the actual quantity on a partly filled final packet", () => {
  const x = purchase(); x.items[0].qty = 5;
  expect(purchaseLabelJobs(x, [p])).toEqual([{ p, qtyOnLabel: 2, copies: 2 }, { p, qtyOnLabel: 1, copies: 1 }]);
});
it("encodes exactly the printed quantity, even when the saved product has a different pack", () => {
  const original = { ...p, pack: 12, cost_code: "OAX12PAIR" };
  const printed = productForLabel(original, 1);
  expect(parseLabel(ownPayload(printed)).qty).toBe("1");
  expect(parseLabel(ownPayload({ ...printed, item_code: "5186" })).qty).toBe("1");
  expect(printed.cost_code).toBe("OAX1PAIR"); expect(original.pack).toBe(12);
});
