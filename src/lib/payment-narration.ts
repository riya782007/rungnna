import type { Bill, Payment } from "./db";
import { billAmount } from "./format";

/** Derived from the payment rows: editing/removing a payment cannot leave stale remarks. */
export function paymentNarration(payments: Payment[], amount = billAmount): string {
  return payments.filter(p => p.mode === "upi" && p.amount > 0 && p.recipient?.trim())
    .map(p => `UPI ${amount(p.amount)} received by ${p.recipient!.trim()}`).join("; ");
}

export function billNarration(bill: Pick<Bill, "remarks" | "payments">, amount = billAmount): string {
  return [bill.remarks?.trim(), paymentNarration(bill.payments, amount)].filter(Boolean).join("\n");
}
