import type { Bill } from "./db";
import type { Shop } from "./billing";

/* Owner, 5 Nov (voice): "after the printout the customer asks how to pay" — and UPI comes in both ways: sometimes into
   the shop's own account, sometimes into the karigar's. Settings keeps the two UPI IDs; each bill prints the pay-QR of
   one of them (estimates default to the second account, every other bill to the shop's), and the counter can switch
   it with one tap. "-" on a bill = no QR on it. */
export type UpiAccount = { name: string; upi: string };
export const NO_QR = "-";

export function upiAccounts(shop: Pick<Shop, "upi" | "upi2" | "upi2_name">): UpiAccount[] {
  const out: UpiAccount[] = [];
  if (shop.upi?.trim()) out.push({ name: "Shop", upi: shop.upi.trim() });
  if (shop.upi2?.trim()) out.push({ name: shop.upi2_name?.trim() || "Karigar", upi: shop.upi2.trim() });
  return out;
}

/** Whose QR prints on this bill. Estimates print a QR only from the second account unless one is picked on the bill. */
export function qrAccount(b: Pick<Bill, "bill_type" | "pay_to">, shop: Pick<Shop, "upi" | "upi2" | "upi2_name">): UpiAccount | undefined {
  if (b.pay_to === NO_QR) return undefined;
  const acc = upiAccounts(shop);
  const picked = b.pay_to ? acc.find(a => a.name === b.pay_to) : undefined;
  if (picked) return picked;
  if (b.bill_type === "estimate") return acc.find(a => a.name !== "Shop");
  return acc.find(a => a.name === "Shop") || acc[0];
}

export function upiLink(a: UpiAccount, payee: string, paise: number, note?: string) {
  return `upi://pay?pa=${encodeURIComponent(a.upi)}&pn=${encodeURIComponent(a.name === "Shop" ? payee : a.name)}&am=${(paise / 100).toFixed(2)}&cu=INR${note ? `&tn=${encodeURIComponent(note)}` : ""}`;
}
