import { expect, it } from "vitest";
import { purchaseLabelJobs, productForLabel } from "../src/lib/purchase-labels";
import { ownPayload, parseLabel } from "../src/lib/parse";
import { blankProduct } from "../src/lib/products";
import { newPurchase, lineOf } from "../src/lib/stockin";
import type { Purchase } from "../src/lib/db";

const p = { ...blankProduct("owner"), id: "p", item: "BALI", type: "PAIR", rate: 10000 };
const purchase = (): Purchase => ({ ...newPurchase("owner", "rack"), status: "final", items: [{ ...lineOf(p), qty: 6, pack: 2 }] });
it("prepares all named purchase products with packet-aware copy counts", () => {
  expect(purchaseLabelJobs(purchase(), [p])).toEqual([{ p, qtyOnLabel: 2, copies: 3, line: 1 }]);   // line: the bill line, printed on the sticker
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
  expect(purchaseLabelJobs(x, [p])).toEqual([{ p, qtyOnLabel: 2, copies: 2, line: 1 }, { p, qtyOnLabel: 1, copies: 1, line: 1 }]);
});
it("encodes exactly the printed quantity, even when the saved product has a different pack", () => {
  const original = { ...p, pack: 12, cost_code: "OAX12PAIR" };
  const printed = productForLabel(original, 1);
  expect(parseLabel(ownPayload(printed)).qty).toBe("1");
  expect(parseLabel(ownPayload({ ...printed, item_code: "5186" })).qty).toBe("1");
  expect(printed.cost_code).toBe("OAX1PAIR"); expect(original.pack).toBe(12);
});
it("uses the reviewed photo packet size while retaining a partial last packet", () => {
  const x = purchase(); x.items[0] = { ...x.items[0], qty: 13, pack: 1, label_pack: 6 };
  expect(purchaseLabelJobs(x, [p])).toEqual([{ p, qtyOnLabel: 6, copies: 2, line: 1 }, { p, qtyOnLabel: 1, copies: 1, line: 1 }]);
});
it("prints an exact sticker override independently of inventory quantity", () => {
  const x = purchase(); x.items[0] = { ...x.items[0], qty: 60, pack: 1, label_pack: 6, print_qty: 4 };
  const jobs = purchaseLabelJobs(x, [p]);
  expect(jobs).toEqual([{ p, qtyOnLabel: 6, copies: 4, line: 1 }]);
  expect(parseLabel(ownPayload(productForLabel(jobs[0].p, jobs[0].qtyOnLabel))).qty).toBe("6");
  expect(x.items[0].qty).toBe(60);
});
it("skips explicitly zero stickers and allows the entire purchase to skip printing", () => {
  const x = purchase(); x.items[0].print_qty = 0;
  expect(purchaseLabelJobs(x, [p])).toEqual([]);
  x.items.push({ ...x.items[0], id: "second", print_qty: 4 });
  expect(purchaseLabelJobs(x, [p])).toEqual([{ p, qtyOnLabel: 2, copies: 4, line: 2 }]);
});
it("rejects unsafe saved sticker overrides and invalid reviewed packet sizes", () => {
  for (const print_qty of [-1, 0.5, NaN, 5001]) {
    const x = purchase(); x.items[0].print_qty = print_qty;
    expect(() => purchaseLabelJobs(x, [p])).toThrow("sticker");
  }
  const x = purchase(); x.items[0].label_pack = 0;
  expect(() => purchaseLabelJobs(x, [p])).toThrow("quantities");
});
