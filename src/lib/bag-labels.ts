import type { Bill } from "./db";
import type { LabelCfg } from "../pages/Labels";
import type { PurchaseLabelJob } from "./purchase-labels";
import { blankProduct } from "./products";
export type BagLabel = { billId: string; billNo: string; customer: string; number: number; total: number };
export const BAG_PREFIX = "RJ-BAG1|";
export function bagPayload(bag: Pick<BagLabel, "billId" | "number">) {
  if (!bag.billId || /[|\u0000-\u001f]/.test(bag.billId) || !Number.isSafeInteger(bag.number) || bag.number < 1 || bag.number > 5000) throw new Error("Invalid bag identity");
  return BAG_PREFIX + bag.billId + "|" + bag.number;
}
export function parseBagPayload(raw: string): { billId: string; number: number } | undefined {
  if (!raw.startsWith(BAG_PREFIX)) return undefined;
  const fields = raw.slice(BAG_PREFIX.length).split("|"), bag = { billId: fields[0], number: Number(fields[1]) };
  if (fields.length !== 2 || !/^\d+$/.test(fields[1])) throw new Error("Bag barcode is damaged");
  bagPayload(bag); return bag;
}
export function bagLabelCfg(cfg: LabelCfg): LabelCfg {
  return { ...cfg, layout: "stack", show: { ...cfg.show, item: true, style: true, color: true, rate: false, qty: false, tk: false, code: false, cost_code: false, line: false } };
}
/** Carry bags on the bill (owner, 26 Oct: bags are counted by hand, boxes are only how the lines were scanned). */
export const carryBags = (bill: Pick<Bill, "carry_bags">) => Math.min(99, Math.max(1, Math.floor(Number(bill.carry_bags) || 1)));
export function bagLabelJobs(bill: Bill, count = carryBags(bill)): PurchaseLabelJob[] {
  if (!bill.no || bill.status !== "final" || bill.deleted) throw new Error("Save the bill before printing customer bag labels");
  if (!bill.party_name.trim()) throw new Error("Enter the customer's name on the bill before printing bag labels");
  if (!Number.isSafeInteger(count) || count < 1 || count > 5000) throw new Error("Number of bags must be 1–5000");
  return Array.from({ length: count }, (_, index) => {
    const bag: BagLabel = { billId: bill.id, billNo: bill.no, customer: bill.party_name, number: index + 1, total: count };
    return { bag, p: { ...blankProduct(bill.by_staff), id: "bag:" + bill.id + ":" + bag.number, code: bagPayload(bag), item: bag.customer, style: bag.billNo, color: "BAG " + bag.number + " OF " + count, rate: 0, cost_code: "", type: "PCS", pack: 1 }, qtyOnLabel: 1, copies: 1, labelIndex: index };
  });
}
