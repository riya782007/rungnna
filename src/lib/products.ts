import { db, put, uid, now, deviceId, getSetting, type Product } from "./db";
import { parseLabel, newCode, type Parsed, type Pattern } from "./parse";
import { toPaise } from "./format";

export async function patterns(): Promise<Pattern[]> { return getSetting<Pattern[]>("patterns", []); }

/* Find the product a scanned label belongs to. Exact raw match first, then our code,
   then the decoded style+colour (so a re-printed old label still finds the same product). */
export async function findByScan(raw: string, parsed?: Parsed): Promise<Product | undefined> {
  const r = raw.trim();
  let p = await db.products.where("barcodes").equals(r).first();
  if (p && !p.deleted) return p;
  p = await db.products.where("code").equals(r).first();
  if (p && !p.deleted) return p;
  const x = parsed || parseLabel(r, await patterns());
  if (x.code) {
    p = await db.products.where("code").equals(x.code).first();
    if (p && !p.deleted) return p;
  }
  if (x.style) {
    const same = await db.products.where("style").equals(x.style).toArray();
    const hit = same.find(q => !q.deleted && (!x.color || q.color === x.color) && (!x.item || q.item === x.item));
    if (hit) return hit;
  }
  return undefined;
}

export function blankProduct(by: string): Product {
  return {
    id: uid(), code: newCode(deviceId()), barcodes: [], item: "", type: "PCS", style: "", color: "", tk: "",
    rate: 0, mrp: 0, category: "", notes: "", created_by: by, created_at: now(), updated_at: now(),
  };
}

export function fromParsed(x: Parsed, by: string): Product {
  const p = blankProduct(by);
  p.item = (x.item || "").toUpperCase();
  p.type = (x.type || "PCS").toUpperCase();
  p.style = (x.style || (x.how === "code" ? "" : "")).toUpperCase();
  p.color = (x.color || "").toUpperCase();
  p.tk = x.tk || "";
  p.rate = x.rate ? toPaise(x.rate) : 0;
  p.mrp = x.mrp ? toPaise(x.mrp) : 0;
  p.raw_scan = x.raw;
  if (x.raw) p.barcodes = [x.raw];
  if (x.how === "rungnna" && x.code) p.code = x.code;
  if (x.icode) p.item_code = x.icode;
  if (x.ref) p.ref = x.ref;
  const pk = parseInt(x.qty || ""); if (x.how === "shop label" && pk > 0) p.pack = pk;
  return p;
}

/* The old labels carry only a number for the item (202). Once any product with that number
   has a name (F-RING), every later scan of that number fills the name in by itself. */
export async function itemNameFor(icode?: string) {
  if (!icode) return "";
  const hit = await db.products.where("item_code").equals(icode).filter(p => !!p.item && !p.deleted).first();
  if (hit?.item) return hit.item;
  const map = (await db.config.get("item_codes"))?.value as Record<string, string> | undefined; // imported item list
  return map?.[icode] || "";
}
export async function itemCodeFor(item: string) {
  if (!item) return "";
  const hit = await db.products.where("item").equals(item).filter(p => !!p.item_code && !p.deleted).first();
  return hit?.item_code || "";
}

export async function saveProduct(p: Product) {
  p.item = p.item.trim().toUpperCase(); p.style = p.style.trim().toUpperCase(); p.color = p.color.trim().toUpperCase();
  p.type = (p.type || "PCS").trim().toUpperCase();
  if (!p.barcodes.includes(p.code)) p.barcodes = [...p.barcodes, p.code];
  return put("products", p);
}

/* TK on the old labels = dead stock. Any value in that slot marks the piece as dead. */
export const isDead = (p: Pick<Product, "tk">) => !!(p.tk && p.tk.trim());
export const DEAD_MARK = "TK";

export const label = (p: Pick<Product, "item" | "style" | "color">) =>
  [p.item, p.style, p.color].filter(Boolean).join(" · ") || "Unnamed product";

/* distinct values for the ITEM / TYPE drop-downs, learned from what the shop already has */
export async function distinct(field: "item" | "type" | "color" | "category") {
  const s = new Set<string>();
  await db.products.each(p => { const v = (p as any)[field]; if (v && !p.deleted) s.add(v); });
  return [...s].sort();
}
export const DEFAULT_ITEMS = ["CHAIN", "NECKLACE SET", "CHOKER", "EARRING", "JHUMKI", "BALI", "TOPS", "MAANG TIKKA", "BANGLE", "KADA", "BRACELET", "RING", "PAYAL", "ANKLET", "PENDANT SET", "MANGALSUTRA", "NATH", "HAIR ACCESSORY", "BINDI", "BROOCH", "KAMARBANDH", "HATHPHOOL"];
export const DEFAULT_TYPES = ["PCS", "PAIR", "SET", "DOZEN", "BOX", "CARD", "PACKET"];
