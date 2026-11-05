import { db, type Bill, type BillLine, type Product } from "./db";
import { resolveProductScan, hasProductName, readItemMap, codeInfo, type ItemMap } from "./products";

const realName = hasProductName;

// Fill missing snapshots only; an existing invoice's name remains historical.
export function withBillNames(b: Bill, products: Product[], names: ItemMap): Bill {
  const byId = new Map(products.map(p => [p.id, p]));
  const byCode = new Map(products.map(p => [p.code, p]));
  return { ...b, items: b.items.map(l => {
    if (realName(l.item)) return l;
    const p = (l.product_id ? byId.get(l.product_id) : undefined) || byCode.get(l.code);
    const code = p?.item_code || /^ITEM\s+(\d+)$/i.exec(l.item?.trim() || "")?.[1];
    const name = realName(p?.item) ? p!.item.trim() : code ? codeInfo(code, names)?.name : "";
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

/* Owner, 5 Nov (photo): "Add the product name before saving: K5210/2T" stopped a 130-line bill, and the line was
   nowhere on screen. Saving now asks the name right there instead. The lines still without a name, grouped so one
   answer names them all (same item number, or same article), with a likely name from the same design family
   (K5210/2T → other K5210/… articles) already typed in. */
export type UnnamedGroup = { key: string; code?: string; style: string; lines: BillLine[]; guess: string };
const family = (style: string) => /^([A-Z]*\/?\d+)/.exec((style || "").toUpperCase().replace(/\s+/g, ""))?.[1].replace("/", "") || "";

export function unnamedGroups(items: BillLine[], products: Product[]): UnnamedGroup[] {
  const byId = new Map(products.map(p => [p.id, p])), byCode = new Map(products.map(p => [p.code, p]));
  const groups = new Map<string, UnnamedGroup>();
  for (const l of items) {
    if (realName(l.item) && !/^ITEM\s+\d+$/i.test(l.item.trim())) continue;
    const p = (l.product_id ? byId.get(l.product_id) : undefined) || byCode.get(l.code);
    const code = /^ITEM\s+(\d+)$/i.exec(l.item?.trim() || "")?.[1] || p?.item_code || undefined;
    const style = (l.style || p?.style || l.code || "").trim();
    const key = code ? "item:" + code : "style:" + (style.toUpperCase() || l.id);
    const g = groups.get(key) || { key, code, style, lines: [], guess: "" };
    g.lines.push(l); groups.set(key, g);
  }
  for (const g of groups.values()) {
    const fam = family(g.style);
    if (!fam) continue;
    const count = new Map<string, number>();
    const add = (name?: string, style?: string) => {
      if (!name || !realName(name) || /^ITEM\s+\d+$/i.test(name.trim()) || family(style || "") !== fam) return;
      const n = name.trim().toUpperCase(); count.set(n, (count.get(n) || 0) + 1);
    };
    for (const l of items) add(l.item, l.style);
    if (!count.size) for (const p of products) if (!p.deleted) add(p.item, p.style);
    g.guess = [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  }
  return [...groups.values()];
}
