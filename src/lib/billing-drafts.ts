import { db, deviceId, getSetting, setSetting, type Bill, type BillType } from "./db";
import { holdBill, totals, type Shop } from "./billing";
import { currentStore, inStore } from "./scope";
import { isOpen } from "./privacy";
import { selectedBox, type BillingDraft } from "./billingBox";

const key = (type: BillType, store = currentStore()) => `billing_draft:${store}:${type}`;
/** Keep each document type separately so a tax invoice cannot replace an estimate. */
export async function parkBillingDraft(bill: Bill, box: number, shop: Shop) {
  if (bill.no || bill.status !== "hold" || !bill.items.length) return;
  await holdBill(totals(bill, shop.state, shop.gstin));
  await setSetting(key(bill.bill_type, bill.store_id || currentStore()), { id: bill.id, box });
}
export async function resumeBillingDraft(type: BillType): Promise<BillingDraft | null> {
  if (type === "estimate" && !isOpen()) return null;
  const valid = (b: Bill | undefined): b is Bill => !!b && inStore(b) && !b.deleted && b.status === "hold" && !b.no && b.bill_type === type;
  const saved = await getSetting<{ id: string; box: number } | null>(key(type), null);
  const pointed = saved ? await db.bills.get(saved.id) : undefined;
  if (type === "estimate" && !isOpen()) return null;
  if (valid(pointed)) return { ...pointed, selected_box: saved!.box };
  // Recover bills parked before separate draft pointers were introduced, on this counter only.
  const held = await db.bills.where("status").equals("hold").filter(b => valid(b) && b.device === deviceId()).sortBy("updated_at");
  if (type === "estimate" && !isOpen()) return null;
  const latest = held[held.length - 1];
  return latest ? { ...latest, selected_box: selectedBox(latest) } : null;
}
