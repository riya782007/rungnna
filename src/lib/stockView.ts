import { db, type Movement, type StockCell, type Bill } from "./db";
import { storeStock, currentStore } from "./stores";
import { isEstimate } from "./privacy";

/* Owner, 19 Nov (video): "when the estimate is closed, everything linked to it should close with it".
   Stock is the last place an estimate still showed: pieces sold on an estimate left the racks, so with
   estimates closed the stock numbers quietly told anyone how much went out on estimates. While closed, the
   stock screens show each rack as if the estimate bills had not happened; open them and the real count is back.
   Billing, counting and picking always use the real count. */

/** an estimate (or a goods return on one) that is still private: not turned into a GST bill */
export const privateBill = (b: Pick<Bill, "bill_type" | "src_type" | "status" | "converted_to">) =>
  isEstimate(b) && b.status !== "converted" && !b.converted_to;

/** What the private bills did to each rack cell: key "product|loc" → pieces added (+) or taken (−). */
export function estimateEffect(moves: Pick<Movement, "product_id" | "qty" | "from_loc" | "to_loc" | "deleted">[]) {
  const fx = new Map<string, number>();
  const add = (k: string, d: number) => fx.set(k, (fx.get(k) || 0) + d);
  for (const m of moves) {
    if (m.deleted || !(m.qty > 0)) continue;
    if (m.from_loc) add(m.product_id + "|" + m.from_loc, -m.qty);
    if (m.to_loc) add(m.product_id + "|" + m.to_loc, m.qty);
  }
  return fx;
}

/** Stock cells with the private bills taken back out. */
export function withoutEstimates(cells: StockCell[], fx: Map<string, number>): StockCell[] {
  if (!fx.size) return cells;
  return cells.map(c => { const d = fx.get(c.key); return d ? { ...c, qty: c.qty - d } : c; });
}

/** The stock the screens show: the real count while estimates are open, without them while closed. */
export async function shownStock(open: boolean, store = currentStore()): Promise<StockCell[]> {
  const cells = await storeStock(store);
  if (open) return cells;
  const ids = (await db.bills.filter(b => !b.deleted && privateBill(b)).primaryKeys()) as string[];
  if (!ids.length) return cells;
  return withoutEstimates(cells, estimateEffect(await db.movements.where("ref_bill").anyOf(ids).toArray()));
}

/** A count below zero means more was sold than was ever entered: shown as 0 with the shortfall beside it. */
export const onHand = (qty: number) => Math.max(0, qty);
export const shortBy = (qty: number) => Math.max(0, -qty);
