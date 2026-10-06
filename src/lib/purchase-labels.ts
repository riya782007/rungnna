import type { Product, Purchase } from "./db";

export type PurchaseLabelJob = { p: Product; qtyOnLabel: number; copies: number };
export function purchaseLabelJobs(purchase: Purchase, products: Product[]): PurchaseLabelJob[] {
  if (purchase.deleted || purchase.status !== "final") throw new Error("Save the purchase before printing labels");
  const map = new Map(products.map(p => [p.id, p]));
  const jobs = purchase.items.map(line => {
    const p = map.get(line.product_id), pack = line.pack || 1;
    if (!p || p.deleted || !p.item.trim()) throw new Error("A purchase item is missing its product/name. Review it before printing.");
    if (!Number.isSafeInteger(line.qty) || line.qty < 1 || !Number.isSafeInteger(pack) || pack < 1) throw new Error("Check purchase label quantities");
    return { p, qtyOnLabel: pack, copies: Math.ceil(line.qty / pack) };
  });
  if (!jobs.length) throw new Error("This purchase has no items to print");
  if (jobs.reduce((n, j) => n + j.copies, 0) > 5000) throw new Error("Purchase has over 5000 labels. Prepare smaller batches from the item form.");
  return jobs;
}
