import { db, put, type Product } from "./db";

/* UHF RFID readers in USB keyboard (HID) mode "type" the tag's EPC and press Enter (or Tab) — exactly
   like a barcode gun, so useScannerGun / the scan boxes already receive them. A tag is told apart from
   a printed label by its shape: hex, 64–256 bits (16–64 hex digits, whole 16-bit words) — EPC-96 is
   24 digits, EPC-128 / TID 32. Readers may add a label ("EPC:", "TID="), spaces, dashes, colons or a
   "0x"; those are dropped. All-digit strings shorter than 24 are left alone: those are EAN/ITF barcodes. */

export function normTag(raw: string): string {
  return String(raw ?? "").trim().toUpperCase()
    .replace(/^(EPC|TID|TAG|UII)\s*[:=#]?\s*/, "").replace(/^0X/, "").replace(/[\s:.-]/g, "");
}
export function isRfidTag(raw: string): boolean {
  const t = normTag(raw);
  if (!/^[0-9A-F]+$/.test(t) || t.length < 16 || t.length > 64 || t.length % 4 !== 0) return false;
  return t.length >= 24 || /[A-F]/.test(t);
}

/* Cloud sync sends every row of a batch with the same columns; rows saved before RFID existed lack
   these fields and would go up as null into NOT NULL columns. Fill them in before upload. */
export function rfidDefaults<R extends Record<string, any>>(table: string, row: R): R {
  if (table === "products" && !row.sold_tags) return { ...row, sold_tags: {} };
  if ((table === "bills" || table === "purchases") && !Array.isArray(row.rfid_tags)) return { ...row, rfid_tags: [] };
  return row;
}

/* One tag counts once per bill / stock-in. Keeps the order tags were first read. */
export class TagSet {
  private seen: Set<string>;
  constructor(tags: string[] = []) { this.seen = new Set(tags.map(normTag)); }
  /** true the first time a tag is seen, false for every repeat read */
  add(raw: string): boolean { const t = normTag(raw); if (!t || this.seen.has(t)) return false; this.seen.add(t); return true; }
  has(raw: string) { return this.seen.has(normTag(raw)); }
  delete(raw: string) { return this.seen.delete(normTag(raw)); }
  get size() { return this.seen.size; }
  list() { return [...this.seen]; }
}

/* A reader in continuous mode repeats the same tag many times a second. Warn about an unlinked tag
   once, then stay quiet about it for a while (but notice it again after it has been linked). */
export class Recent {
  private at = new Map<string, number>();
  constructor(private ms = 8000) {}
  first(key: string, now = Date.now()): boolean {
    const k = normTag(key), t = this.at.get(k);
    this.at.set(k, now);
    return t === undefined || now - t > this.ms;
  }
}

/* Link a tag to a product: it joins the product's barcodes (so findByScan finds it), leaves any
   other product it was on, and stops being "sold" (it's back on a piece in the shop). */
export async function linkTag(product: Product, raw: string): Promise<{ product: Product; movedFrom?: Product }> {
  const tag = normTag(raw);
  let movedFrom: Product | undefined;
  const others = await db.products.where("barcodes").equals(tag).filter(p => p.id !== product.id).toArray();
  for (const o of others) {
    const { [tag]: _, ...sold } = o.sold_tags || {};
    await put("products", { ...o, barcodes: o.barcodes.filter(b => b !== tag), sold_tags: sold });
    if (!o.deleted) movedFrom = o;
  }
  const cur = (await db.products.get(product.id)) || product;
  const { [tag]: _, ...sold } = cur.sold_tags || {};
  const next = await put("products", { ...cur, barcodes: cur.barcodes.includes(tag) ? cur.barcodes : [...cur.barcodes, tag], sold_tags: sold });
  return { product: next, movedFrom };
}

/* Tags a product carries, and the ones of those that already left on a bill */
export const tagsOf = (p: Pick<Product, "barcodes">) => p.barcodes.filter(isRfidTag);
export const soldBill = (p: Pick<Product, "sold_tags">, tag: string) => p.sold_tags?.[normTag(tag)];

/* Final bill: its tags are sold. Void / returned stock: they're back. Call inside a transaction that includes db.products. */
export async function setTagsSold(tags: string[] | undefined, billNo: string | null) {
  for (const raw of tags || []) {
    const tag = normTag(raw);
    const ps = await db.products.where("barcodes").equals(tag).toArray();
    for (const p of ps) {
      const cur = { ...(p.sold_tags || {}) };
      if (billNo) { if (cur[tag] === billNo) continue; cur[tag] = billNo; }
      else { if (!(tag in cur)) continue; delete cur[tag]; }
      await put("products", { ...p, sold_tags: cur });
    }
  }
}

/* ---------------- RFID count: expected (stock table) vs found (tags read) for one rack ---------------- */
export interface CountRow { product_id: string; expected: number; found: number; tagged: number; sold: { tag: string; bill: string }[] }
export interface CountReport { rows: CountRow[]; unknown: string[]; missing: number; foundTotal: number; expectedTotal: number; soldTotal: number }

/* Pure: expected pieces per product in the rack, the tags read, and every product (to resolve tags).
   A sold tag that turns up is listed under its product as sold — it is not counted as found stock. */
export function countReport(expected: Map<string, number>, reads: string[], products: Pick<Product, "id" | "barcodes" | "sold_tags" | "deleted">[]): CountReport {
  const byId = new Map(products.map(p => [p.id, p]));
  const byTag = new Map<string, Pick<Product, "id" | "barcodes" | "sold_tags" | "deleted">>();
  for (const p of products) if (!p.deleted) for (const b of p.barcodes) if (isRfidTag(b)) byTag.set(normTag(b), p);
  const rows = new Map<string, CountRow>();
  const row = (id: string) => {
    let r = rows.get(id);
    if (!r) {
      const p = byId.get(id);
      const tagged = p ? p.barcodes.filter(b => isRfidTag(b) && !p.sold_tags?.[normTag(b)]).length : 0;
      r = { product_id: id, expected: expected.get(id) || 0, found: 0, tagged, sold: [] };
      rows.set(id, r);
    }
    return r;
  };
  for (const [id, q] of expected) if (q > 0) row(id);
  const unknown: string[] = [];
  for (const tag of new TagSet(reads).list()) {
    const p = byTag.get(tag);
    if (!p) { unknown.push(tag); continue; }
    const bill = p.sold_tags?.[tag];
    if (bill) row(p.id).sold.push({ tag, bill });
    else row(p.id).found++;
  }
  const list = [...rows.values()].sort((a, z) => (z.expected - z.found) - (a.expected - a.found) || z.found - a.found);
  return {
    rows: list, unknown,
    missing: list.reduce((a, r) => a + Math.max(0, r.expected - r.found), 0),
    foundTotal: list.reduce((a, r) => a + r.found, 0),
    expectedTotal: list.reduce((a, r) => a + r.expected, 0),
    soldTotal: list.reduce((a, r) => a + r.sold.length, 0),
  };
}
