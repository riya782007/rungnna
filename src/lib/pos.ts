import { uid, type BillLine } from "./db";
import { fixLine } from "./billing";

export function moneyInput(value: string): number {
  const clean = value.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) throw new Error("Enter a non-negative amount with up to two decimals");
  const n = Math.round(Number(clean) * 100);
  if (!Number.isSafeInteger(n) || n > 1e12) throw new Error("Amount is too large");
  return n;
}
export function manualLine(input: { item: string; style: string; color: string; unit: string; hsn: string; qty: string; rate: string; box: number }): BillLine {
  if (!input.item.trim()) throw new Error("Product name is required");
  const qty = Number(input.qty);
  if (!Number.isSafeInteger(qty) || qty <= 0 || qty > 1000000) throw new Error("Quantity must be a positive whole number");
  if (input.hsn && !/^\d{4,8}$/.test(input.hsn.trim())) throw new Error("HSN must contain 4–8 digits");
  return fixLine({ id: uid(), code: "", item: input.item.trim(), style: input.style.trim().toUpperCase(), color: input.color.trim().toUpperCase(), type: input.unit, hsn: input.hsn.trim(), box_no: input.box, pack: 1, pkts: 0, qty, rate: moneyInput(input.rate), disc: "", amount: 0 });
}
export function validatePosLines(lines: BillLine[]) {
  for (const l of lines) {
    if (!Number.isSafeInteger(l.qty) || l.qty <= 0) throw new Error("Enter a positive whole quantity for " + l.item);
    if (!Number.isSafeInteger(l.rate) || l.rate < 0 || !Number.isSafeInteger(l.amount) || l.amount < 0) throw new Error("Invalid amount for " + l.item);
  }
}
