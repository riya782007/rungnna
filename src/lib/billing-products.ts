import { db, type Bill, type Product } from "./db";
import { VERIFIED_ITEM_CODES } from "./verified-labels";
import { resolveProductScan, hasProductName, readItemMap, type ItemMap } from "./products";

const realName = hasProductName;

// Fill missing snapshots only; an existing invoice's name remains historical.
export function withBillNames(b: Bill, products: Product[], names: ItemMap): Bill {
  const byId = new Map(products.map(p => [p.id, p]));
  const byCode = new Map(products.map(p => [p.code, p]));
  return { ...b, items: b.items.map(l => {
    if (realName(l.item)) return l;
    const p = (l.product_id ? byId.get(l.product_id) : undefined) || byCode.get(l.code);
    const code = p?.item_code || /^ITEM\s+(\d+)$/i.exec(l.item?.trim() || "")?.[1];
    const name = realName(p?.item) ? p!.item.trim() : code ? (names[code]?.name || VERIFIED_ITEM_CODES[code as keyof typeof VERIFIED_ITEM_CODES]?.name) : "";
    return realName(name) ? { ...l, item: name! } : l;
  }) };
}

export async function fillBillNames(b: Bill): Promise<Bill> {
  const [products, config] = await Promise.all([db.products.toArray(), db.config.get("item_codes")]);
  return withBillNames(b, products, readItemMap(config?.value));
}

export async function resolveBillingScan(raw: string, by: string): Promise<Product | undefined> {
  return (await resolveProductScan(raw, by)).product;
}
