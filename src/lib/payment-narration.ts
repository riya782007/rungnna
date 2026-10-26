import type { Bill, Payment } from "./db";
import { billAmount } from "./format";

/** Derived from the payment rows: editing/removing a payment cannot leave stale remarks. */
export function paymentNarration(payments: Payment[]): string {
  return payments.filter(p => p.mode === "upi" && p.amount > 0 && p.recipient?.trim())
    .map(p => `UPI ${billAmount(p.amount)} received by ${p.recipient!.trim()}`).join("; ");
}

export function billNarration(bill: Pick<Bill, "remarks" | "payments">): string {
  return [bill.remarks?.trim(), paymentNarration(bill.payments)].filter(Boolean).join("\n");
}
