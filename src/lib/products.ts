import { db, put, uid, now, deviceId, getSetting, type Product } from "./db";
import { parseLabel, newCode, type Parsed, type Pattern } from "./parse";
import { toPaise } from "./format";
import { isRfidTag, normTag } from "./rfid";
import { VERIFIED_ITEM_CODES } from "./verified-labels";

export async function patterns(): Promise<Pattern[]> { return getSetting<Pattern[]>("patterns", []); }

/* Find the product a scanned label belongs to. Exact raw match first, then our code,
   then the decoded style+colour (so a re-printed old label still finds the same product). */
async function findStoredScan(raw: string, x: Parsed): Promise<Product | undefined> {
  const r = isRfidTag(raw) ? normTag(raw) : raw.trim();   // RFID tags are stored in one canonical form
  let p = await db.products.where("barcodes").equals(r).filter(q => !q.deleted).first();
  if (p && !p.deleted) return p;
  p = await db.products.where("code").equals(r).first();
  if (p && !p.deleted) return p;
  if (x.code) {
    p = await db.products.where("code").equals(x.code).first();
    if (p && !p.deleted) return p;
  }
  if (x.style) {
    const same = await db.products.where("style").equals(x.style.trim().toUpperCase()).toArray();
    const hit = same.find(q => !q.deleted && (!x.color || q.color === x.color.trim().toUpperCase()) && (!x.item || q.item === x.item.trim().toUpperCase() || !q.item?.trim() || needsName(q)) && (!x.icode || !q.item_code || q.item_code === x.icode));
    if (hit) return hit;
  }
  return undefined;
}

export const hasProductName = (name?: string) => !!name?.trim() && !/^ITEM\s+\d+$/i.test(name.trim());

// An opaque barcode/RFID can still use the recognized label saved on its product.
async function scannedDetails(p: Product, parsed: Parsed, rules: Pattern[]): Promise<Product> {
  let next = { ...p };
  for (const raw of new Set([parsed.raw, p.raw_scan, ...p.barcodes])) {
    if (!raw || isRfidTag(raw)) continue;
    const x = raw === parsed.raw ? parsed : parseLabel(raw, rules);
    if (["code", "unknown"].includes(x.how) || (next.item_code && x.icode && next.item_code !== x.icode)) continue;
    const decoded = fromParsed(x, p.created_by);
    if (!hasProductName(next.item) && hasProductName(decoded.item)) next.item = decoded.item;
    for (const key of ["style", "color", "item_code", "ref"] as const) if (!next[key] && decoded[key]) next[key] = decoded[key];
    if (x.type && (!next.type || next.type === "PCS")) next.type = decoded.type;
    if (!next.pack && decoded.pack) next.pack = decoded.pack;
    if (!next.rate && decoded.rate) next.rate = decoded.rate;
    if (!next.mrp && decoded.mrp) next.mrp = decoded.mrp;
  }
  return withItemInfo(next, await itemInfoFor(next.item_code)) || next;
}

// All scan consumers get the same named product; lookup never creates inventory.
export async function findByScan(raw: string, parsed?: Parsed): Promise<Product | undefined> {
  if (!raw.trim()) return undefined;
  const rules = parsed ? [] : await patterns(), x = parsed || parseLabel(raw, rules);
  return db.transaction("rw", [db.products, db.config, db.outbox], async () => {
    const found = await findStoredScan(raw, x);
    if (!found) return undefined;
    const p = await scannedDetails(found, x, rules);
    if (!["code", "unknown"].includes(x.how) && x.raw && !p.barcodes.includes(x.raw)) p.barcodes = [...p.barcodes, x.raw];
    return JSON.stringify(p) !== JSON.stringify(found) ? saveProduct(p) : p;
  });
}

// Billing and stock-in may create a product from a recognized detailed label.
export async function resolveProductScan(raw: string, by: string): Promise<{ product?: Product; created?: boolean }> {
  if (!raw.trim()) return {};
  const rules = await patterns(), parsed = parseLabel(raw, rules);
  return db.transaction("rw", [db.products, db.config, db.outbox], async () => {
    const found = await findStoredScan(raw, parsed);
    if (!found && (["code", "unknown"].includes(parsed.how) || !(parsed.style || parsed.item))) return {};
    const source = found || fromParsed(parsed, by);
    const p = await scannedDetails(source, parsed, rules);
    if (parsed.raw && !p.barcodes.includes(parsed.raw)) p.barcodes = [...p.barcodes, parsed.raw];
    return { product: !found || JSON.stringify(p) !== JSON.stringify(found) ? await saveProduct(p) : p, created: !found };
  });
}

/* The product master is keyed on [Model/Article + Vendor] (with style/colour as the
   tie-breaker). This is the guardrail from the spec: two vendors can sell an
   identical-looking piece and they must stay distinct products. Returns an exact
   match only — used before creating a product from a photo, so visual similarity
   alone can never merge two different articles. */
export function productKey(p: Pick<Product, "model" | "style" | "color" | "vendor_id">): string {
  return [
    (p.model || p.style || "").trim().toUpperCase(),
    (p.color || "").trim().toUpperCase(),
    (p.vendor_id || "").trim(),
  ].join("|");
}

export async function findByKey(key: Pick<Product, "model" | "style" | "color" | "vendor_id">): Promise<Product | undefined> {
  const model = (key.model || key.style || "").trim().toUpperCase();
  if (!model) return undefined;
  // narrow by an indexed field first, then match the full key in memory
  const field = key.model ? "model" : "style";
  const rows = await db.products.where(field).equals(model).toArray();
  const want = productKey(key);
  return rows.find(q => !q.deleted && productKey(q) === want);
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
  const pk = parseInt(x.qty || ""); if (["shop label", "rungnna"].includes(x.how) && pk > 0) p.pack = pk;
  return p;
}

/* The old labels carry only a number for the item (202). The owner names it once (F-RING, PAIR) and
   every later scan of that number — billing, stock in, scan, import — fills the name and unit by itself.
   The list lives in config "item_codes" (synced): { "202": { name: "F-RING", unit: "PAIR" } }.
   Older copies stored just the name ("202": "F-RING"); those still read fine. */
export const UNITS = ["PCS", "PAIR", "SET"] as const;
export type ItemInfo = { name: string; unit: string };
export type ItemMap = Record<string, ItemInfo>;

export function normUnit(v: unknown): string {
  const s = String(v ?? "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!s) return "";
  if (/^(PCS?|PIECES?|NOS?|NUMBERS?|PCE)$/.test(s)) return "PCS";
  if (/^(PAIRS?|PRS?)$/.test(s)) return "PAIR";
  if (/^SETS?$/.test(s)) return "SET";
  return s;
}
export function readItemMap(value: unknown): ItemMap {
  const out: ItemMap = {};
  if (!value || typeof value !== "object") return out;
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "string") { if (v.trim()) out[k] = { name: v.trim().toUpperCase(), unit: "" }; }
    else if (v && typeof v === "object") {
      const o = v as Partial<ItemInfo>;
      const name = String(o.name || "").trim().toUpperCase(), unit = normUnit(o.unit);
      if (name || unit) out[k] = { name, unit };
    }
  }
  return out;
}
export async function itemMap(): Promise<ItemMap> { return readItemMap((await db.config.get("item_codes"))?.value); }

/* Merge names/units into the list. keep=true only fills numbers that aren't named yet. */
export async function learnItems(entries: Record<string, Partial<ItemInfo>>, keep = false) {
  const cur = await itemMap(); let changed = false;
  for (const [code, e] of Object.entries(entries)) {
    if (!code) continue;
    const old = cur[code], name = (e.name || "").trim().toUpperCase(), unit = normUnit(e.unit);
    if (keep && old?.name) { if (!old.unit && unit) { cur[code] = { ...old, unit }; changed = true; } continue; }
    const next = { name: name || old?.name || "", unit: unit || old?.unit || "" };
    if (!next.name && !next.unit) continue;
    if (old?.name !== next.name || old?.unit !== next.unit) { cur[code] = next; changed = true; }
  }
  if (changed) await put("config", { id: "item_codes", value: cur, updated_at: now() } as any);
  return cur;
}

/* "ITEM 202" is what an unnamed old label shows — treat it as no name at all */
export const placeholderItem = (icode?: string) => (icode ? "ITEM " + icode : "");
export const needsName = (p: Pick<Product, "item" | "item_code">) =>
  !!p.item_code && (!p.item?.trim() || p.item.trim().toUpperCase() === placeholderItem(p.item_code));

/* Pure: the product with the learned name/unit filled in, or null when nothing changes. */
export function withItemInfo(p: Product, info?: ItemInfo): Product | null {
  if (!info || !p.item_code) return null;
  const unnamed = needsName(p), x = { ...p };
  if (unnamed && info.name) x.item = info.name;
  if (info.unit && x.type !== info.unit && (unnamed || !x.type || x.type === "PCS")) x.type = info.unit;
  return x.item !== p.item || x.type !== p.type ? x : null;
}

export async function itemInfoFor(icode?: string): Promise<ItemInfo | undefined> {
  if (!icode) return undefined;
  const m = (await itemMap())[icode];
  if (m?.name) return m;
  const hit = await db.products.where("item_code").equals(icode).filter(p => !p.deleted && !needsName(p)).first();
  if (hit) return { name: hit.item, unit: m?.unit || (hit.type && hit.type !== "PCS" ? hit.type : "") };
  return m?.name ? m : { ...VERIFIED_ITEM_CODES[icode as keyof typeof VERIFIED_ITEM_CODES], ...m };
}
export async function itemNameFor(icode?: string) { return (await itemInfoFor(icode))?.name || ""; }

/* On every scan: a product still called "ITEM 202" picks up the learned name and unit (and is saved). */
export async function fillFromItemCode(p: Product): Promise<Product> {
  if (!p.item_code) return p;
  const x = withItemInfo(p, await itemInfoFor(p.item_code));
  return x ? put("products", x) : p;
}

/* The owner names a number: remember it, and fix every product that still carries no name. */
export async function nameItemCode(code: string, name: string, unit: string) {
  const info = { name: name.trim().toUpperCase(), unit: normUnit(unit) || "PCS" };
  if (!code || !info.name) return info;
  await learnItems({ [code]: info });
  const ps = await db.products.where("item_code").equals(code).filter(p => !p.deleted).toArray();
  for (const p of ps) { const x = withItemInfo(p, info); if (x) await put("products", x); }
  return info;
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
  const saved = await put("products", p);
  // the first time a number gets a real name (e.g. typed on Scan & record), every later label learns it
  if (p.item_code && !needsName(p)) await learnItems({ [p.item_code]: { name: p.item, unit: p.type !== "PCS" ? p.type : "" } }, true);
  return saved;
}

/* TK on the old labels = dead stock. Any value in that slot marks the piece as dead. */
export const isDead = (p: Pick<Product, "tk">) => !!(p.tk && p.tk.trim());
export const DEAD_MARK = "TK";

export const label = (p: Pick<Product, "item" | "style" | "color">) =>
  [hasProductName(p.item) ? p.item : "Name needed" + (/^ITEM\s+\d+$/i.test(p.item?.trim() || "") ? " (" + p.item.trim() + ")" : ""), p.style, p.color].filter(Boolean).join(" · ");

/* distinct values for the ITEM / TYPE drop-downs, learned from what the shop already has */
export async function distinct(field: "item" | "type" | "color" | "category") {
  const s = new Set<string>();
  await db.products.each(p => { const v = (p as any)[field]; if (v && !p.deleted) s.add(v); });
  return [...s].sort();
}
export const DEFAULT_ITEMS = ["CHAIN", "NECKLACE SET", "CHOKER", "EARRING", "JHUMKI", "BALI", "TOPS", "MAANG TIKKA", "BANGLE", "KADA", "BRACELET", "RING", "PAYAL", "ANKLET", "PENDANT SET", "MANGALSUTRA", "NATH", "HAIR ACCESSORY", "BINDI", "BROOCH", "KAMARBANDH", "HATHPHOOL"];
export const DEFAULT_TYPES = ["PCS", "PAIR", "SET", "DOZEN", "BOX", "CARD", "PACKET"];
