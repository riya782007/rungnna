import type { Bill } from "./db";
import { billAmount } from "./format";

/** Presentation only: never use these figures for persistence, stock, accounts or payments. */
export function documentAmount(b: Pick<Bill, "bill_type">, paise: number): string {
  if (b.bill_type !== "estimate") return billAmount(paise);
  // A third decimal preserves exact tenths of a paisa instead of changing the arithmetic.
  return (Math.round(paise) / 1000).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 3 });
}
export function documentDiscount(b: Pick<Bill, "bill_type">, discount: string): string {
  if (b.bill_type !== "estimate" || !discount || discount.includes("%")) return discount;
  const value = Number(discount);
  return Number.isFinite(value) ? documentAmount(b, Math.round(value * 100)) : discount;
}
