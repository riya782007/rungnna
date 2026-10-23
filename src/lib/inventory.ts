import { db, type Product, type Purchase, type PurchaseLine } from "./db";
import { blankProduct, saveProduct } from "./products";
import { newPurchase, finalizePurchase } from "./stockin";
import { getRule, priceFromCost, retailFromRate } from "./pricing";
import { requirePerm } from "./scope";
import { assertLocation } from "./stores";
import { assertUnlocked } from "./finance";
import { uid, now } from "./db";

/* ===========================================================================
   Add inventory — one design, many variants, in one go (the reference console's
   "New product" builder, adapted to how this shop keys stock: style + colour
   (+ size) from a vendor). Saving creates or updates each variant's product,
   puts the pieces on the chosen rack with one stock-in, and hands the stock-in
   to Labels so the stickers print exactly as for a purchase.
=========================================================================== */

export type Variant = { color: string; size: string; qty: number; rate?: number };
export type DesignInput = {
  item: string; type: string; style: string; vendor_id?: string; vendor_name?: string;
  category?: string; collection?: string; material?: string; hsn?: string; gst_rate?: number | null;
  pack: number;            // pieces per packet (the X12PCS on the sticker); 1 = loose pieces
  cost: number;            // paise per piece, 0 = not known
  rate: number;            // paise per piece, 0 = work it out from cost with the shop's pricing rule
  retail_rate?: number; mrp?: number;
  rack: string;            // location the pieces go to (needed when any quantity > 0)
  photo_id?: string; by: string;
  variants: Variant[];
};

/** Every colour × size pair (sizes optional), in the order picked. */
export function variantGrid(colours: string[], sizes: string[], old: Variant[] = []): Variant[] {
  const cs = colours.length ? colours : [""], ss = sizes.length ? sizes : [""];
  return cs.flatMap(color => ss.map(size => old.find(v => v.color === color && v.size === size) || { color, size, qty: 0 }));
}

export function validateDesign(d: DesignInput): string | null {
  if (!d.item.trim()) return "Enter the item (e.g. NECKLACE SET)";
  if (!d.style.trim()) return "Enter the style / design number";
  if (!d.variants.length) return "Pick at least one colour";
  const keys = new Set<string>();
  for (const v of d.variants) {
    const k = v.color.trim().toUpperCase() + "|" + v.size.trim().toUpperCase();
    if (keys.has(k)) return `${v.color || "No colour"} ${v.size} is listed twice`;
    keys.add(k);
    if (!Number.isSafeInteger(v.qty) || v.qty < 0 || v.qty > 100000) return `Quantity for ${v.color || "this design"} must be a whole number`;
    if (v.rate != null && (!Number.isSafeInteger(v.rate) || v.rate < 0)) return "Check the variant rates";
  }
  if (!Number.isSafeInteger(d.pack) || d.pack < 1 || d.pack > 1000) return "Pieces per packet must be 1 or more";
  if (!Number.isSafeInteger(d.cost) || d.cost < 0 || !Number.isSafeInteger(d.rate) || d.rate < 0) return "Check cost and rate";
  if (!d.rate && !d.cost && d.variants.some(v => !v.rate)) return "Enter a selling rate (or the cost, to price it with your rule)";
  if (d.hsn && !/^\d{4,8}$/.test(d.hsn.trim())) return "HSN must be 4–8 digits";
  if (d.gst_rate != null && !(d.gst_rate >= 0 && d.gst_rate <= 28)) return "GST rate must be 0–28%";
  if (d.variants.some(v => v.qty > 0) && !d.rack) return "Choose the rack the pieces go to";
  if (d.variants.reduce((n, v) => n + v.qty, 0) > 5000) return "More than 5000 pieces: add them in smaller batches";
  return null;
}

/** Sizes are matched and stored through this one function, so "2.4 ", "2.4" and "Free Size"
    can't fork one design into three products on three intakes. */
export const normSize = (s = "") => s.trim().toUpperCase();

/** The same variant already in the catalogue: style + colour + size + vendor. */
async function existing(d: DesignInput, v: Variant): Promise<Product | undefined> {
  const style = d.style.trim().toUpperCase(), color = v.color.trim().toUpperCase(), size = normSize(v.size);
  const rows = await db.products.where("style").equals(style).toArray();
  return rows.find(p => !p.deleted && (p.color || "").toUpperCase() === color && normSize(p.size || "") === size && (p.vendor_id || "") === (d.vendor_id || ""));
}

export async function createDesign(d: DesignInput): Promise<{ products: Product[]; purchase?: Purchase }> {
  requirePerm("products.edit", "adding products");
  const why = validateDesign(d); if (why) throw new Error(why);
  if (d.variants.some(v => v.qty > 0)) requirePerm("stock.in", "stock in");
  const rule = await getRule();
  /* Pre-flight the checks finalizePurchase would make LAST. It runs outside the product
     transaction, so a locked period or a bad rack used to leave every variant created with
     zero stock and no stock-in to match — a mess to unpick by hand. Fail before writing. */
  if (d.variants.some(v => v.qty > 0)) { await assertLocation(d.rack); await assertUnlocked(now()); }
  const products: Product[] = [], lines: PurchaseLine[] = [];
  const minted = new Set<string>();
  await db.transaction("rw", [db.products, db.outbox, db.config, db.settings], async () => {
    for (const v of d.variants) {
      const typed = v.rate || d.rate;
      const priced = d.cost ? priceFromCost(d.cost, rule, d.pack, d.type) : null;
      const old = await existing(d, v);
      // a hand-set rate stays hand-set: re-stocking must never quietly re-price it from the rule
      const rate = typed || (old?.price_locked ? old.rate : priced?.rate) || 0;
      if (!rate) throw new Error(`Enter a rate for ${v.color || d.style}`);
      const base: Product = old || { ...blankProduct(d.by), photo_id: d.photo_id };
      // belt and braces on top of the counter in newCode: never hand out a code this device already uses
      if (!old) {
        for (let i = 0; minted.has(base.code) || await db.products.where("code").equals(base.code).count(); i++) {
          if (i > 50) throw new Error("Could not make a unique product code — try again");
          base.code = blankProduct(d.by).code;
        }
        minted.add(base.code);
      }
      const p: Product = {
        ...base, item: d.item, type: d.type || "PCS", style: d.style, model: d.style, color: v.color, size: normSize(v.size) || undefined,
        vendor_id: d.vendor_id || undefined, vendor_name: d.vendor_name || undefined,
        category: d.category ?? base.category, collection: d.collection || base.collection, material: d.material || base.material,
        hsn: d.hsn?.trim() || base.hsn, ...(d.gst_rate != null ? { gst_rate: d.gst_rate } : {}),
        pack: d.pack, rate, wholesale_rate: rate, retail_rate: d.retail_rate || base.retail_rate || retailFromRate(rate, rule) || undefined, mrp: d.mrp || base.mrp || 0,
        cost: d.cost || base.cost, cost_code: d.cost ? priceFromCost(d.cost, rule, d.pack, d.type).cost_code : base.cost_code,
        price_locked: typed ? 1 : base.price_locked,
        photo_id: base.photo_id || d.photo_id,
      };
      const saved = (await saveProduct(p)) as Product;
      products.push(saved);
      // whole packets get one sticker each; leftover loose pieces get their own line
      const full = d.pack > 1 ? Math.floor(v.qty / d.pack) : 0, loose = d.pack > 1 ? v.qty % d.pack : v.qty;
      const line = (pack: number, pkts: number, qty: number): PurchaseLine => ({ id: uid(), product_id: saved.id, code: saved.code, item: saved.item, style: saved.style, color: saved.color, pack, pkts, qty, cost: d.cost, rate, isNew: !old });
      if (full) lines.push(line(d.pack, full, full * d.pack));
      if (loose) lines.push(line(1, 0, loose));
    }
  });
  if (!lines.length) return { products };
  // not a supplier bill: the vendor stays on the products, so nothing is added to what we owe them
  const purchase = await finalizePurchase({ ...newPurchase(d.by, d.rack), items: lines,
    note: `Add inventory: ${d.item} ${d.style}${d.vendor_name ? " · vendor " + d.vendor_name : ""}` });
  return { products, purchase };
}
