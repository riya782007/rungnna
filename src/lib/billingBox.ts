import type { Bill, BillLine } from "./db";
import { fixLine } from "./billing";

// Draft-only metadata lives in the same local snapshot as the unfinished bill.
export type BillingDraft = Bill & { selected_box?: number };
export function selectedBox(b: BillingDraft): number {
  return Number.isInteger(b.selected_box) && b.selected_box! > 0
    ? b.selected_box! : Math.max(1, ...b.items.map(l => l.box_no));
}

export function mergeBoxLine(items: BillLine[], id: string): BillLine[] {
  const source = items.find(l => l.id === id);
  if (!source?.product_id) return items;
  const target = items.find(l => l.id !== id && l.product_id === source.product_id && l.box_no === source.box_no
    && l.pack === source.pack && l.rate === source.rate && l.disc === source.disc
    && l.stock_done === source.stock_done && l.src_line === source.src_line);
  if (!target) return items;
  const qty = fixLine(target).qty + fixLine(source).qty;
  // Mixed loose pieces and packets must keep every piece.
  const pkts = target.pack > 1 && target.pkts > 0 && source.pkts > 0 ? target.pkts + source.pkts : 0;
  const merged = fixLine({ ...target, pkts, qty });
  // Fixed/rounded discounts can be non-additive: never change the total by merging.
  if (merged.amount !== fixLine(target).amount + fixLine(source).amount) return items;
  return items.filter(l => l.id !== id).map(l => l.id === target.id ? merged : l);
}
