import { db, put, now, type Bill, type BillType, type Dealer, type Party, type Product, type TradeOrder } from "./db";
import { newBill, newParty, lineFrom, fixLine, totals, holdBill, getShop, normPhone } from "./billing";
import { requirePerm } from "./scope";
import { getTradePortal, saveTradePortal, randomKey } from "./listing";

/* Dealer portal, shop side: approve retailers, turn their orders into bills, set the minimum order.
   Orders are priced by the server when placed; the bill made here starts from those exact rates. */

export const dealerUrl = () => `${location.origin}/dealer`;

/** The customer account for a dealer: the linked one, else one with the same mobile, else a new wholesale customer. */
export async function partyForDealer(d: Dealer): Promise<Party> {
  const fill = async (p: Party) => {
    // the state decides CGST+SGST vs IGST: if the account has none and the dealer gave one, use it
    if (!p.state && d.state) { const fixed = { ...p, state: d.state }; await put("parties", fixed); return fixed; }
    return p;
  };
  if (d.party_id) { const p = await db.parties.get(d.party_id); if (p && !p.deleted) return fill(p); }
  const phone = normPhone(d.phone);
  const same = await db.parties.filter(p => !p.deleted && p.kind !== "supplier" && normPhone(p.phone) === phone).first();
  if (same) return fill(same);
  const p: Party = { ...newParty(d.shop_name || d.name, d.phone), kind: "dealer", city: d.city, gstin: d.gstin, state: d.state || "", tier: "wholesale",
    notes: `Dealer portal${d.shop_name && d.name ? " · " + d.name : ""}` };
  await put("parties", p);
  return p;
}

export async function setDealerStatus(d: Dealer, status: Dealer["status"]) {
  requirePerm("dealers.manage", "approving dealers");
  const party = status === "approved" ? await partyForDealer(d) : null;
  await put("dealers", { ...d, status, party_id: party?.id ?? d.party_id ?? null });
}

/** A held bill (estimate or GST invoice) with the order's lines at the order's rates, ready to check, pack and save. */
export async function orderToBill(o: TradeOrder, type: BillType, by: string): Promise<Bill> {
  requirePerm("dealers.manage", "handling trade orders");
  const fresh = await db.trade_orders.get(o.id);
  if (!fresh || fresh.deleted || fresh.status === "cancelled") throw new Error("This order was cancelled");
  if (fresh.bill_id && (await db.bills.get(fresh.bill_id))?.status !== "void") throw new Error("A bill was already made for this order");
  const dealer = await db.dealers.get(o.dealer_id);
  const party = dealer ? await partyForDealer(dealer) : null;
  const shop = await getShop();
  const products = new Map((await db.products.bulkGet(o.items.map(l => l.product_id))).filter(Boolean).map(p => [p!.id, p as Product]));
  const missing = o.items.filter(l => !products.has(l.product_id));
  if (missing.length) throw new Error(`Not on this device yet: ${missing.map(m => m.code).join(", ")} — sync and try again`);
  const items = o.items.map(l => fixLine({ ...lineFrom(products.get(l.product_id)!, 1, 0, "wholesale"), pkts: 0, qty: l.qty, rate: l.rate }));
  const b0 = newBill(by, shop, type);
  const b = totals({ ...b0, items, party_id: party?.id, party_name: party?.name || o.dealer_shop || o.dealer_name, party_phone: o.dealer_phone,
    party_gstin: party?.gstin || dealer?.gstin || "", party_state: party?.state || dealer?.state || "", party_address: party ? [party.address, party.city, party.pin].filter(Boolean).join(", ") : "",
    price_level: "wholesale", remarks: [`Trade order ${o.no}`, o.note].filter(Boolean).join(" · ") }, shop.state, shop.gstin);
  await db.transaction("rw", [db.bills, db.trade_orders, db.outbox], async () => {
    await holdBill(b);
    await put("trade_orders", { ...fresh, status: "accepted", bill_id: b.id, bill_no: "" });
  });
  return b;
}

export async function cancelOrder(o: TradeOrder) {
  requirePerm("dealers.manage", "handling trade orders");
  await put("trade_orders", { ...o, status: "cancelled" });
}

/** When the bill made from an order is saved, the order shows its number (called from the orders screen). */
export async function refreshOrderStatus(o: TradeOrder) {
  if (!o.bill_id || o.status === "cancelled") return;
  const b = await db.bills.get(o.bill_id);
  if (b?.status === "final" && (o.status !== "billed" || o.bill_no !== b.no)) await put("trade_orders", { ...o, status: "billed", bill_no: b.no, updated_at: now() });
  if (b?.status === "void" && o.status !== "new") await put("trade_orders", { ...o, status: "new", bill_id: null, bill_no: "" });
}

export async function getMinOrder(): Promise<number> { return Number((await getTradePortal() as any)?.min_order) || 0; }
export async function setMinOrder(paise: number) {
  requirePerm("dealers.manage", "changing the minimum order");
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("Check the minimum order");
  const cur = await getTradePortal();
  await saveTradePortal({ token: cur?.token || randomKey(), enabled: cur?.enabled ?? false, created_at: cur?.created_at || new Date().toISOString(), ...(cur || {}), min_order: paise } as any);
}
