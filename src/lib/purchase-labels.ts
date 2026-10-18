import type { Product, Purchase } from "./db";
import { evenRate } from "./pricing";

/* `line` = the line of the supplier's bill these labels are for, printed small on each sticker so whoever is
   labelling knows which goods (which line of the bill) a sticker goes on. */
export type PurchaseLabelJob = { p: Product; qtyOnLabel: number; copies: number; line?: number };
export function productForLabel(p: Product, qtyOnLabel: number): Product {
  // every printed label (screen, TSC and the QR inside) carries the even rate
  return { ...p, rate: evenRate(p.rate), pack: qtyOnLabel, cost_code: p.cost_code?.replace(/X\d+[A-Z]+$/i, `X${qtyOnLabel}${p.type || "PCS"}`) };
}
export function purchaseLabelJobs(purchase: Purchase, products: Product[]): PurchaseLabelJob[] {
  if (purchase.deleted || purchase.status !== "final") throw new Error("Save the purchase before printing labels");
  const map = new Map(products.map(p => [p.id, p]));
  const jobs = purchase.items.flatMap((line, i) => {
    const p = map.get(line.product_id), pack = line.label_pack ?? line.pack ?? 1;
    if (line.print_qty !== undefined && (!Number.isSafeInteger(line.print_qty) || line.print_qty < 0 || line.print_qty > 5000)) throw new Error("Check purchase sticker quantities");
    if (line.print_qty === 0) return [];
    if (!p || p.deleted || !p.item.trim()) throw new Error("A purchase item is missing its product/name. Review it before printing.");
    if (!Number.isSafeInteger(line.qty) || line.qty < 1 || !Number.isSafeInteger(pack) || pack < 1) throw new Error("Check purchase label quantities");
    if (line.print_qty !== undefined) return [{ p, qtyOnLabel: pack, copies: line.print_qty, line: i + 1 }];
    const full = Math.floor(line.qty / pack), remainder = line.qty % pack;
    return [
      ...(full ? [{ p, qtyOnLabel: pack, copies: full, line: i + 1 }] : []),
      ...(remainder ? [{ p, qtyOnLabel: remainder, copies: 1, line: i + 1 }] : []),
    ];
  });
  if (!jobs.length && !purchase.items.length) throw new Error("This purchase has no items to print");
  if (jobs.reduce((n, j) => n + j.copies, 0) > 5000) throw new Error("Purchase has over 5000 labels. Prepare smaller batches from the item form.");
  return jobs;
}
