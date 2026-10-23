import { db, put, uid, now, deviceId, getSetting, type Product } from "./db";
import { parseLabel, newCode, ownPayload, type Parsed, type Pattern } from "./parse";
import { productForLabel } from "./purchase-labels";
import { toPaise } from "./format";
import { isRfidTag, normTag } from "./rfid";
import { VERIFIED_ITEM_CODES } from "./verified-labels";
import { aliasFor } from "./old-codes";
import { requirePerm } from "./scope";

export async function patterns(): Promise<Pattern[]> { return getSetting<Pattern[]>("patterns", []); }

/* Find the product a scanned label belongs to. Exact raw match first, then our code,
   then the decoded style+colour (so a re-printed old label still finds the same product).

   Accuracy rule: a detailed label (old-software or Rungnna QR) says what the item IS.
   The shop's styles are NOT unique — "K5210/2T" is printed on earrings, balis and
   rings alike — so a product is only accepted when nothing on the label contradicts
   it (item code, item name, style, colour). A stored product that contradicts the
   label is never used, and a label string wrongly attached to it is detached, so the
   next scan can't repeat the mistake. */
const up = (v?: string) => (v || "").trim().toUpperCase();
const DETAILED = ["shop label", "rungnna"];
function contradicts(q: Product, x: Parsed, labelName: string): boolean {
  if (!DETAILED.includes(x.how)) return false;
  if (x.how === "rungnna" && x.code && q.code === x.code) return false;   // our own label: its product code is exact
  if (x.icode && q.item_code && q.item_code !== x.icode) return true;
  // the owner billed this name as that old item (HALF DULHAN SET → 320 BRIDAL SET): our own sticker for it
  const billedAs = !!x.icode && !q.item_code && aliasFor(q.item) === x.icode;
  // same item code: the owner's own name for it wins; no code on file: names must agree
  const name = up(x.item) || labelName;
  if (name && !billedAs && !(x.icode && q.item_code === x.icode) && hasProductName(q.item) && up(q.item) !== name) return true;
  if (up(x.style) && up(q.style) && up(q.style) !== up(x.style)) return true;
  if (up(x.color) && up(q.color) && up(q.color) !== up(x.color)) return true;
  return false;
}
/* Stickers a biller matched by hand after they failed to read (lib/scan-learn): the person's choice is final. */
export const TAUGHT = "scan_taught";
export async function taughtProduct(raw: string): Promise<Product | undefined> {
  const id = ((await db.config.get(TAUGHT))?.value as Record<string, string> | undefined)?.[raw.trim()];
  const p = id ? await db.products.get(id) : undefined;
  return p && !p.deleted ? p : undefined;
}
async function findStoredScan(raw: string, x: Parsed): Promise<Product | undefined> {
  const taught = await taughtProduct(raw);
  if (taught) return taught;
  const r = isRfidTag(raw) ? normTag(raw) : raw.trim();   // RFID tags are stored in one canonical form
  const labelName = x.icode ? up((await itemInfoFor(x.icode))?.name) : "";
  // the exact sticker, or the same old-format QR typed with "-" / "`" / lower case by the scanner
  const canon = canonicalQr(x);
  const byRaw = await db.products.where("barcodes").anyOf(canon && canon !== r ? [r, canon] : [r]).filter(q => !q.deleted).toArray();
  for (const q of byRaw) if (!contradicts(q, x, labelName)) return q;
  // repair: this exact label was linked to the wrong product by an earlier loose match
  for (const q of byRaw) await put("products", { ...q, barcodes: (q.barcodes || []).filter(b => b !== r) });
  let p = await db.products.where("code").equals(r).first();
  if (p && !p.deleted) return p;
  // a sticker whose product was deleted (21 Oct: the whole list was deleted at once, minutes after hundreds of
  // stickers were printed): the goods are in hand, so that product is brought back below if nothing live fits
  let gone: Product | undefined;
  if (x.code) {
    const same = await db.products.where("code").equals(x.code).toArray();
    const live = same.find(q => !q.deleted);
    if (live) return live;
    gone = same.find(q => q.deleted && !contradicts(q, x, labelName));
  }
  if (x.style) {
    const same = (await db.products.where("style").equals(up(x.style)).toArray())
      .filter(q => !q.deleted && (!x.color || up(q.color) === up(x.color)) && !contradicts(q, x, labelName));
    const fits = same.filter(q => {
      if (x.how !== "shop label") return !x.item || up(q.item) === up(x.item) || needsName(q) || !q.item?.trim();
      if (x.icode && q.item_code === x.icode) return true;
      if (q.item_code) return false;
      if (x.icode && aliasFor(q.item) === x.icode) return true;
      // no code on file: accept only when its name is the label's name, or it has no name yet
      return labelName ? up(q.item) === labelName || !hasProductName(q.item) : !hasProductName(q.item);
    });
    // same article at the printed rate first (one style is often sold at several rates)
    const rate = x.rate ? toPaise(x.rate) : 0;
    const hit = fits.find(q => rate && q.rate === rate) || fits[0];
    if (hit) return hit;
    // an old-format sticker of a product that was deleted after printing: bring that product back
    if (!gone && x.how === "shop label") gone = (await db.products.where("style").equals(up(x.style)).toArray())
      .find(q => q.deleted && (!x.color || up(q.color) === up(x.color)) && !contradicts(q, x, labelName) && (!x.icode || q.item_code === x.icode || aliasFor(q.item) === x.icode));
  }
  // an old sticker with no style (or whose style the scanner garbled): the same old item at the printed rate
  if (!x.style && x.how === "shop label" && x.icode && x.rate) {
    const rate = toPaise(x.rate);
    const same = (await db.products.filter(q => q.rate === rate && !q.deleted).toArray()).filter(q => !contradicts(q, x, labelName)
      && (q.item_code === x.icode || (!q.item_code && aliasFor(q.item) === x.icode) || (!q.item_code && !!labelName && up(q.item) === labelName))
      && (!x.color || !q.color || up(q.color) === up(x.color)));
    const hit = same.find(q => !q.style?.trim()) || (same.length === 1 ? same[0] : undefined);
    if (hit) return hit;
  }
  if (gone) {
    const back = { ...gone, deleted: 0 } as Product;
    await put("products", back);   // kept with its cost, supplier and history, not re-made from the sticker
    return back;
  }
  return undefined;
}

/* A scanner set to the wrong keyboard layout can type an old QR as raw text
   ("255-224-1-183--K5208/2T-KXZ"); that is the label, not a name. */
export const looksLikeRawLabel = (name?: string) => /^\d+[~\-`^]\d+(\.\d+)?[~\-`^]\d+[~\-`^]/.test((name || "").trim());
export const hasProductName = (name?: string) => !!name?.trim() && !/^ITEM\s+\d+$/i.test(name.trim()) && !looksLikeRawLabel(name);

// An opaque barcode/RFID can still use the recognized label saved on its product.
async function scannedDetails(p: Product, parsed: Parsed, rules: Pattern[]): Promise<Product> {
  let next = { ...p };
  for (const raw of new Set([parsed.raw, p.raw_scan, ...(p.barcodes || [])])) {
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

// Packet quantity belongs to this sticker; do not rewrite the master pack size.
function scannedPacket(p: Product, parsed: Parsed): Product {
  const pack = Number(parsed.qty);
  return ["shop label", "rungnna"].includes(parsed.how) && Number.isSafeInteger(pack) && pack > 0 && pack <= 1000000 ? { ...p, pack } : p;
}

// All scan consumers get the same named product; lookup never creates inventory.
export async function findByScan(raw: string, parsed?: Parsed): Promise<Product | undefined> {
  if (!raw.trim()) return undefined;
  const rules = parsed ? [] : await patterns(), x = parsed || parseLabel(raw, rules);
  return db.transaction("rw", [db.products, db.config, db.outbox], async () => {
    const found = await findStoredScan(raw, x);
    if (!found) return undefined;
    const p = await scannedDetails(found, x, rules);
    if (!["code", "unknown"].includes(x.how) && x.raw && !(p.barcodes || []).includes(x.raw)) p.barcodes = [...(p.barcodes || []), x.raw];
    const saved = JSON.stringify(p) !== JSON.stringify(found) ? await saveProduct(p, true) : p;
    return scannedPacket(saved, x);
  });
}

// Billing and stock-in may create a product from a recognized detailed label.
export async function resolveProductScan(raw: string, by: string): Promise<{ product?: Product; created?: boolean }> {
  if (!raw.trim()) return {};
  const rules = await patterns(), parsed = parseLabel(raw, rules);
  return db.transaction("rw", [db.products, db.config, db.outbox], async () => {
    const found = await findStoredScan(raw, parsed);
    if (!found && (["code", "unknown"].includes(parsed.how) || !(parsed.style || parsed.item || (parsed.how === "shop label" && parsed.icode && parsed.rate)))) return {};
    const source = found || fromParsed(parsed, by);
    const p = await scannedDetails(source, parsed, rules);
    if (parsed.raw && !(p.barcodes || []).includes(parsed.raw)) p.barcodes = [...(p.barcodes || []), parsed.raw];
    const saved = !found || JSON.stringify(p) !== JSON.stringify(found) ? await saveProduct(p, true) : p;
    return { product: scannedPacket(saved, parsed), created: !found };
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
export type ItemInfo = { name: string; unit: string; owner?: boolean };   // owner: named on purpose by the shop
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
    // a whole scanned QR saved as a name (22 Oct: "252~20~3~183~~K5210/11P~LKQR") is not a name
    if (typeof v === "string") { if (v.trim() && !v.includes("~")) out[k] = { name: v.trim().toUpperCase(), unit: "" }; }
    else if (v && typeof v === "object") {
      const o = v as Partial<ItemInfo>;
      const name0 = String(o.name || "").trim().toUpperCase(), name = name0.includes("~") ? "" : name0, unit = normUnit(o.unit);
      if (name || unit) out[k] = o.owner ? { name, unit, owner: true } : { name, unit };
    }
  }
  return out;
}
export async function itemMap(): Promise<ItemMap> { return (learnedCache = readItemMap((await db.config.get("item_codes"))?.value)); }

/* Which name an item code really means.
   The old software's own item list (VERIFIED_ITEM_CODES) is the authority for its codes:
   a name the app picked up as a side effect of saving some product can't override it —
   that is how "203" came to mean BALI instead of EARING. Only a name the owner set on
   purpose (owner: true) overrides the list. Codes not on the list use what was learned. */
let learnedCache: ItemMap = {};
export function codeInfo(code?: string, learned: ItemMap = learnedCache): ItemInfo | undefined {
  if (!code) return undefined;
  const m = learned[code], v = VERIFIED_ITEM_CODES[code];
  if (v && !(m?.owner && m.name)) return { name: v.name, unit: v.unit || (m?.name === v.name ? m.unit : "") };
  return m && (m.name || m.unit) ? m : undefined;
}
/* A label must say what its QR means. An old-software QR carries only the item CODE, so
   the name printed beside it has to be that code's name — otherwise the sticker reads
   EARING while every scanner (ours and the old software) reads BALI. */
export function labelCodeProblem(item: string, code?: string): string {
  const name = (item || "").trim().toUpperCase(), means = codeInfo(code)?.name;
  if (!name || !code || !means || means === name || aliasFor(name) === code) return "";   // the owner chose: this name is billed as that item
  const right = Object.entries(resolvedItemMap(learnedCache)).filter(([, v]) => v.name === name).map(([c]) => c);
  return `This label would say ${name}, but its QR carries item code ${code}, which is ${means}. ` +
    (right.length === 1 ? `${name} is code ${right[0]} — fix the ITEM CODE before printing.` : `Fix the ITEM CODE (or the item name) before printing.`);
}
/** Every code the app can name, with that priority applied. */
export function resolvedItemMap(learned: ItemMap): ItemMap {
  const out: ItemMap = {};
  for (const code of new Set([...Object.keys(VERIFIED_ITEM_CODES), ...Object.keys(learned)])) { const i = codeInfo(code, learned); if (i) out[code] = i; }
  return out;
}

/* Merge names/units into the list. keep=true only fills numbers that aren't named yet. */
export async function learnItems(entries: Record<string, Partial<ItemInfo>>, keep = false) {
  const cur = await itemMap(); let changed = false;
  for (const [code, e] of Object.entries(entries)) {
    if (!code) continue;
    const old = cur[code], name = (e.name || "").trim().toUpperCase(), unit = normUnit(e.unit);
    if (keep && old?.name) { if (!old.unit && unit) { cur[code] = { ...old, unit }; changed = true; } continue; }
    const owner = !!(e.owner || (old?.owner && !name));
    const next: ItemInfo = { name: name || old?.name || "", unit: unit || old?.unit || "", ...(owner ? { owner: true } : {}) };
    if (!next.name && !next.unit) continue;
    if (old?.name !== next.name || old?.unit !== next.unit || !!old?.owner !== owner) { cur[code] = next; changed = true; }
  }
  if (changed) await put("config", { id: "item_codes", value: cur, updated_at: now() } as any);
  learnedCache = cur;
  return cur;
}

/* "ITEM 202" is what an unnamed old label shows — treat it as no name at all */
export const placeholderItem = (icode?: string) => (icode ? "ITEM " + icode : "");
export const needsName = (p: Pick<Product, "item" | "item_code">) =>
  !!p.item_code && (!p.item?.trim() || p.item.trim().toUpperCase() === placeholderItem(p.item_code) || looksLikeRawLabel(p.item));

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
  const known = codeInfo(icode, await itemMap());
  if (known?.name) return known;
  // a code nobody has named: borrow the name of a product already carrying it
  const hit = await db.products.where("item_code").equals(icode).filter(p => !p.deleted && !needsName(p)).first();
  if (hit) return { name: hit.item, unit: known?.unit || (hit.type && hit.type !== "PCS" ? hit.type : "") };
  return known;
}
export async function itemNameFor(icode?: string) { return (await itemInfoFor(icode))?.name || ""; }

/* On every scan: a product still called "ITEM 202" picks up the learned name and unit (and is saved). */
export async function fillFromItemCode(p: Product): Promise<Product> {
  if (!p.item_code) return p;
  const x = withItemInfo(p, await itemInfoFor(p.item_code));
  return x ? put("products", x) : p;
}

/* Startup: products already saved as "ITEM 202" / blank pick up their name from the
   shop's learned list or the old software's item list, without waiting for a re-scan. */
export async function nameKnownItemCodes(): Promise<number> {
  const learned = await itemMap();
  const unnamed = await db.products.filter(p => !p.deleted && needsName(p)).toArray();
  let n = 0;
  for (const p of unnamed) {
    const code = p.item_code!, info = codeInfo(code, learned);
    const x = withItemInfo(p, info);
    if (x) { await put("products", x); n++; }
  }
  return n;
}

/* Item-code checkup: the data problems that make a scan report the wrong item.
   - wrongCode: a product whose name disagrees with what its item code means. Every
     label printed for it carries the other item's code (EARING sticker → BALI scan).
   - ignoredNames: names the app learned for an old-software code that disagree with
     the old software's own list (now ignored; shown so the owner knows).
   - sharedLabels: one sticker text attached to more than one product. */
export type CodeAudit = {
  wrongCode: { p: Product; means: string; fixCode: string }[];
  ignoredNames: { code: string; learned: string; means: string }[];
  sharedLabels: { raw: string; products: Product[] }[];
};
export async function auditItemCodes(): Promise<CodeAudit> {
  const learned = await itemMap(), resolved = resolvedItemMap(learned);
  const products = await db.products.filter(p => !p.deleted).toArray();
  const byName = new Map<string, string[]>();
  for (const [code, v] of Object.entries(resolved)) if (v.name) byName.set(v.name, [...(byName.get(v.name) || []), code]);
  const wrongCode = products.flatMap(p => {
    const means = codeInfo(p.item_code, learned)?.name, name = up(p.item);
    if (!p.item_code || !means || !hasProductName(p.item) || means === name) return [];
    const codes = byName.get(name) || [];
    return [{ p, means, fixCode: codes.length === 1 ? codes[0] : "" }];
  });
  const ignoredNames = Object.entries(learned).flatMap(([code, m]) => {
    const v = VERIFIED_ITEM_CODES[code];
    return v && m.name && !m.owner && m.name !== v.name ? [{ code, learned: m.name, means: v.name }] : [];
  });
  const owners = new Map<string, Product[]>();
  for (const p of products) for (const raw of p.barcodes || []) if (DETAILED.includes(parseLabel(raw).how)) owners.set(raw, [...(owners.get(raw) || []), p]);
  const sharedLabels = [...owners].filter(([, ps]) => ps.length > 1).map(([raw, ps]) => ({ raw, products: ps }));
  return { wrongCode, ignoredNames, sharedLabels };
}
/** Fix: give the product the code that really means its name (or clear the wrong one). */
export async function fixProductCode(p: Product, code: string) {
  return saveProduct({ ...p, item_code: code || undefined });
}
/** Fix: a shared sticker stays only on the product whose details it actually carries. */
export async function unshareLabel(raw: string) {
  const x = parseLabel(raw), labelName = x.icode ? up(codeInfo(x.icode)?.name) : "";
  const ps = await db.products.where("barcodes").equals(raw).filter(q => !q.deleted).toArray();
  const keep = ps.filter(q => !contradicts(q, x, labelName));
  const keepId = keep.length === 1 ? keep[0].id : undefined;
  for (const q of ps) if (q.id !== keepId) await saveProduct({ ...q, barcodes: (q.barcodes || []).filter(b => b !== raw) });
  return keepId;
}

/* The owner names a number: remember it, and fix every product that still carries no name. */
export async function nameItemCode(code: string, name: string, unit: string) {
  const info = { name: name.trim().toUpperCase(), unit: normUnit(unit) || "PCS" };
  if (!code || !info.name) return info;
  await learnItems({ [code]: { ...info, owner: true } });
  const ps = await db.products.where("item_code").equals(code).filter(p => !p.deleted).toArray();
  for (const p of ps) { const x = withItemInfo(p, info); if (x) await put("products", x); }
  return info;
}
export async function itemCodeFor(item: string) {
  if (!item) return "";
  // the code that authoritatively means this name comes first; a product's stored
  // code may be the very mistake we must not copy onto new labels
  const want = item.trim().toUpperCase();
  const named = Object.entries(resolvedItemMap(await itemMap())).filter(([, v]) => v.name === want).map(([code]) => code);
  if (named.length === 1) return named[0];
  if (named.length > 1) return "";
  const hit = await db.products.where("item").equals(item).filter(p => !!p.item_code && !p.deleted && !codeInfo(p.item_code)?.name).first();
  return hit?.item_code || "";
}

export async function hideProducts(ids: string[]) {
  requirePerm("products.edit", "hiding products");
  return db.transaction("rw", [db.products, db.outbox], async () => {
    for (const id of new Set(ids)) { const current = await db.products.get(id); if (current && !current.deleted) await put("products", { ...current, deleted: 1 }); }
  });
}

/** Owner, 23 Oct: "Hide" on the Products page took 137 products and their 1,408 pieces out of view and nothing
    could bring them back. Their stock and history were never removed; this shows them again. */
export async function showProducts(ids: string[]) {
  requirePerm("products.edit", "showing hidden products again");
  return db.transaction("rw", [db.products, db.outbox], async () => {
    for (const id of new Set(ids)) { const current = await db.products.get(id); if (current && current.deleted) await put("products", { ...current, deleted: 0 }); }
  });
}

/** fromScan: the app remembering a sticker it just read at the counter (its QR, or the product a printed old
    sticker stands for). That is part of billing, not editing products, so it needs no products permission. */
export async function saveProduct(p: Product, fromScan = false) {
  if (!fromScan) requirePerm("products.edit", "adding or editing products");
  p.item = p.item.trim().toUpperCase(); p.style = p.style.trim().toUpperCase(); p.color = p.color.trim().toUpperCase();
  p.type = (p.type || "PCS").trim().toUpperCase();
  if (p.size != null) p.size = p.size.trim().toUpperCase() || undefined;   // same key as lib/inventory normSize, incl. legacy rows
  if (!(p.barcodes || []).includes(p.code)) p.barcodes = [...(p.barcodes || []), p.code];
  const saved = await put("products", p);
  // the first time a number gets a real name (e.g. typed on Scan & record), every later label learns it
  // (codes on the old software's own list are already named — never relearn them from a product)
  if (p.item_code && !needsName(p) && !VERIFIED_ITEM_CODES[p.item_code]) await learnItems({ [p.item_code]: { name: p.item, unit: p.type !== "PCS" ? p.type : "" } }, true);
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

/* Owner, 24 Oct: "every sticker must scan in one scan, without a single failure". The old software's QR carries
   no product code, only the item number, rate, packing, style and colour, so two products could look alike.
   Every old-format QR this app prints is therefore written onto its product: scanning that exact sticker
   then finds exactly that product, first time. A scanner that types "~" as "-" or "`" gives the same QR back
   in the shop's own form (canonicalQr). */
export const canonicalQr = (x: Parsed) => x.how === "shop label" ? x.raw.trim().toUpperCase().replace(/[~\-`^\\|#¬°'"]/g, "~") : "";
export async function rememberPrintedQrs(jobs: { p: Product; qtyOnLabel: number; bag?: unknown; sourceQr?: string }[], format: "shop" | "rungnna" = "shop") {
  const add = new Map<string, Set<string>>();
  for (const j of jobs) {
    if (j.bag || !j.p?.id) continue;
    let raw = "";
    try { raw = j.sourceQr ?? ownPayload(productForLabel(j.p, j.qtyOnLabel), format); } catch { continue; }
    const key = canonicalQr(parseLabel(raw));
    if (!key) continue;
    (add.get(j.p.id) || add.set(j.p.id, new Set()).get(j.p.id)!).add(key);
  }
  for (const [id, keys] of add) {
    const p = await db.products.get(id);
    if (!p || p.deleted) continue;
    const have = new Set(p.barcodes || []), fresh = [...keys].filter(k => !have.has(k));
    if (fresh.length) await put("products", { ...p, barcodes: [...(p.barcodes || []), ...fresh] });
  }
}
