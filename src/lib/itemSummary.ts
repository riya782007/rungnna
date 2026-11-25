import type { Bill } from "./db";

/* Owner, 24 Nov (voice): "for a particular party we have to see how many bangles, how many chain lockets they took —
   that segregation on the screen; and bill-wise too, how many bangles, how many chain lockets on that bill —
   item-wise, to read". */
const key = (item: string) => (item || "").trim().toUpperCase().replace(/\s+/g, " ") || "OTHER";

/** One bill: each item and its pieces, the biggest first ("BANGLE 12 · CHAIN LKT 8"). */
export function billItems(b: Pick<Bill, "items">): { item: string; qty: number }[] {
  const m = new Map<string, number>();
  for (const l of b.items) if (l.qty > 0) m.set(key(l.item), (m.get(key(l.item)) || 0) + l.qty);
  return [...m].map(([item, qty]) => ({ item, qty })).sort((a, z) => z.qty - a.qty || a.item.localeCompare(z.item));
}
export const billItemsText = (b: Pick<Bill, "items">, sep = " · ") => billItems(b).map(x => `${x.item} ${x.qty}`).join(sep);

export type PartyItem = { item: string; qty: number; value: number; bills: number; last: string };
/** A party's sales by item: pieces and value (returns taken off), on how many bills, last bought. */
export function partyItems(bills: Bill[]): PartyItem[] {
  const m = new Map<string, PartyItem & { seen: Set<string> }>();
  for (const b of bills) {
    if (b.deleted || b.status !== "final" || b.converted_to || b.merged_into) continue;
    const sign = b.bill_type === "return" ? -1 : b.bill_type === "gst" || b.bill_type === "estimate" ? 1 : 0;
    if (!sign) continue;
    const share = b.gross > 0 ? b.net / b.gross : 1;          // the bill's discount spread over its lines
    for (const l of b.items) {
      if (!(l.qty > 0)) continue;
      const k = key(l.item), x = m.get(k) || { item: k, qty: 0, value: 0, bills: 0, last: "", seen: new Set<string>() };
      x.qty += sign * l.qty; x.value += sign * Math.round(l.amount * share);
      if (sign > 0 && !x.seen.has(b.id)) { x.seen.add(b.id); x.bills++; if (b.at > x.last) x.last = b.at; }
      m.set(k, x);
    }
  }
  return [...m.values()].map(({ seen: _s, ...x }) => x).filter(x => x.qty !== 0 || x.value !== 0).sort((a, z) => z.qty - a.qty);
}
