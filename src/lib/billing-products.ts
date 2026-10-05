import { db, type Bill, type Product } from "./db";
import { parseLabel } from "./parse";
import { VERIFIED_ITEM_CODES } from "./verified-labels";
import { findByScan, fromParsed, patterns, saveProduct, itemInfoFor, withItemInfo, readItemMap, type ItemMap } from "./products";

const realName = (name?: string) => !!name?.trim() && !/^ITEM\s+\d+$/i.test(name.trim());

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
  const parsed = parseLabel(raw, await patterns());
  return db.transaction("rw", [db.products, db.config, db.outbox], async () => {
    const found = await findByScan(raw, parsed);
    const recognized = !["code", "unknown"].includes(parsed.how);
    if (!found && (!recognized || !(parsed.style || parsed.item))) return undefined;
    const decoded = fromParsed(parsed, by);
    let p = found ? { ...found } : decoded;
    if (found && recognized) {
      if (!realName(p.item) && realName(decoded.item)) p.item = decoded.item;
      for (const key of ["style", "color", "item_code", "ref"] as const) if (!p[key] && decoded[key]) p[key] = decoded[key];
      if (parsed.type && (!p.type || p.type === "PCS")) p.type = decoded.type;
      if (!p.pack && decoded.pack) p.pack = decoded.pack;
      if (!p.rate && decoded.rate) p.rate = decoded.rate;
      if (!p.mrp && decoded.mrp) p.mrp = decoded.mrp;
      if (!p.barcodes.includes(parsed.raw)) p.barcodes = [...p.barcodes, parsed.raw];
    }
    p = withItemInfo(p, await itemInfoFor(p.item_code)) || p;
    return !found || JSON.stringify(p) !== JSON.stringify(found) ? saveProduct(p) : p;
  });
}
