import { checkedEntryReference } from "./entry-reference";
import { db, uid, setSetting, type Product, type Purchase, type Party } from "./db";
import { blankProduct, findByKey, saveProduct, itemMap, normUnit, productKey, resolvedItemMap, UNIT_RE } from "./products";
import { newPurchase, lineOf, finalizePurchase } from "./stockin";
import { readCount, readPacketSize } from "./purchase-quantities";
import { moneyInput } from "./pos";
import { requirePerm } from "./scope";
import { vendorCost } from "./vendors";
import { getRule, priceFromCost, evenRate, retailFromRate, type PricingRule } from "./pricing";

export type PhotoRow = { item: string; style: string; color: string; unit: string; hsn: string; qty: string; cost: string; rate: string;
  /** set when autoArticle() invented the article because the bill printed none */
  autoStyle?: boolean;
  /** the line's own serial on the supplier's bill ("1-10", "7"), printed in the sticker's box (owner, 21 Oct) */
  sr?: string;
  entry_code?: string; // editable maker initial + date for this purchase line
  review_id?: string;
  /** Old application identity; supplied by its master or a matching saved article. */
  item_code?: string; ref?: string;
  packSource?: "bill" | "saved" | "default" | "manual";
  /** the supplier's terms (÷ rate divisor, less %) are already in this line's cost: never applied twice */
  termsDone?: boolean;
  /** pieces in one packet: the "X3" printed after the rate on the sticker (old software's QTY). Blank = 1. */
  pack?: string;
  /** old software's PRINT QTY: blank is one per packet; 0 skips; a number prints that many stickers. */
  stickers?: string;
  /** the cost exactly as the bill was read, so vendor terms can be undone and a cost divided too often is caught */
  billCost?: string;
  /** owner, 22 Oct: collection/style, material and a photo set on the same screen as the stickers */
  collection?: string; material?: string; photo_id?: string };

/** Lines whose cost is under a tenth of their selling rate: almost always a cost divided (or misread) too often.
    1-based line numbers. */
export function suspiciousCosts(rows: PhotoRow[]): number[] {
  const out: number[] = [];
  rows.forEach((r, i) => {
    const c = Number(r.cost), s = Number(r.rate);
    if (c > 0 && s > 0 && s / c > 10) out.push(i + 1);
  });
  return out;
}
/** Put every line's cost back to what the bill said (undoes vendor terms; lines typed by hand keep theirs). */
export function restoreBillCosts(rows: PhotoRow[]): PhotoRow[] {
  return rows.map(r => (r.billCost ? { ...r, cost: r.billCost, termsDone: false } : r));
}

/** Pieces per packet for a review line: a whole number 1–10000, blank meaning 1. */
export function packOf(r: Pick<PhotoRow, "pack">): number {
  const t = (r.pack ?? "").trim();
  if (!t) return 1;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 1 || n > 10000) throw new Error(`Pieces per packet must be a whole number (got "${t}")`);
  return n;
}
const packOrOne = (r: Pick<PhotoRow, "pack">) => { try { return packOf(r); } catch { return 1; } };
export function pricePhotoRows(rows: PhotoRow[], rule: PricingRule): PhotoRow[] {
  return rows.map(r => {
    if (r.rate.trim() || !r.cost.trim() || !/^(PCS|PAIR|SET)$/i.test(r.unit.trim())) return r;
    try {
      const cost = moneyInput(r.cost);
      if (cost <= 0) return r;
      return { ...r, rate: (priceFromCost(cost, rule, 1, r.unit).rate / 100).toFixed(2) };
    } catch { return r; }
  });
}
/* Apply the supplier's terms (rate ÷ divisor, then less %) to every printed cost. Shown to the owner to review; call once. */
export function applyVendorTerms(rows: PhotoRow[], v?: Pick<Party, "less_pct" | "rate_divisor">): PhotoRow[] {
  return rows.map(r => (r.termsDone ? r : { ...r, cost: vendorCost(r.cost, v), termsDone: true }));
}
/** "Apply shop pricing", pressed on purpose: every line with a cost gets its selling rate from the shop's rule again
    (after vendor terms changed the costs, the old rates were worked out from the wrong cost). */
export function repricePhotoRows(rows: PhotoRow[], rule: PricingRule): { rows: PhotoRow[]; priced: number } {
  let priced = 0;
  const out = rows.map(r => {
    if (!r.cost.trim() || !/^(PCS|PAIR|SET)$/i.test(r.unit.trim())) return r;
    try {
      const cost = moneyInput(r.cost); if (cost <= 0) return r;
      priced++;
      return { ...r, rate: (priceFromCost(cost, rule, 1, r.unit).rate / 100).toFixed(2) };
    } catch { return r; }
  });
  return { rows: out, priced };
}
/* Many of this shop's bills print no article number at all. The RLJ challan, for instance, lists
   "CHOTI" seven times and "SETS" thirteen times, and the only thing telling those articles apart is
   the rate. Without an article every line fails validation, and merging them by name would put seven
   differently-priced articles onto one product.

   So the article is built from the item and its cost — CHOTI-273, SETS-86 — which has the useful
   property that re-buying the same thing at the same rate next month matches the SAME product
   instead of making a new one. Two lines that collide (the same item at the same rate really is one
   article) get a -2, -3 suffix rather than being silently combined, so the owner decides.

   Only blank articles are filled; anything the bill actually printed is left exactly as read. */
export function autoArticle(rows: PhotoRow[]): PhotoRow[] {
  const used = new Set(rows.map(r => r.style.trim().toUpperCase()).filter(Boolean));
  return rows.map(r => {
    if (r.style.trim()) return r;
    const name = r.item.trim().toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 12) || "ITEM";
    const rupees = (() => { try { const c = moneyInput(r.cost); return c > 0 ? String(Math.round(c / 100)) : ""; } catch { return ""; } })();
    const stem = rupees ? `${name}-${rupees}` : name;
    let style = stem;
    for (let n = 2; used.has(style); n++) style = `${stem}-${n}`;
    used.add(style);
    return { ...r, style, autoStyle: true };
  });
}
/** Articles this app invented because the bill printed none — shown to the owner before saving. */
export const autoArticleCount = (rows: PhotoRow[]) => rows.filter(r => r.autoStyle).length;

/* The same article + colour on two lines (a bill that lists it twice) is one product: identical
   lines (same item, unit, rate, cost, packet) are added together instead of stopping the save.
   Lines that differ in price or unit stay apart, with a message naming them. */
export function combineRepeatedRows(rows: PhotoRow[]): { rows: PhotoRow[]; combined: number; conflict?: string } {
  const up = (v?: string) => (v || "").trim().toUpperCase();
  const out: (PhotoRow & { src: number[] })[] = [], at = new Map<string, number>();
  let combined = 0, conflict: string | undefined;
  const stick = (x: PhotoRow) => (x.stickers?.trim() ? Number(x.stickers) : Math.ceil((Number(x.qty) || 0) / (Number(x.pack) || 1)));
  rows.forEach((r, i) => {
    const key = up(r.style) + "|" + up(r.color);
    const j = up(r.style) ? at.get(key) : undefined;
    if (j === undefined) { at.set(key, out.length); out.push({ ...r, src: [i + 1] }); return; }
    const t = out[j];
    const same = up(t.item) === up(r.item) && up(t.unit) === up(r.unit) && t.rate.trim() === r.rate.trim() && t.cost.trim() === r.cost.trim() && String(t.pack || "1").trim() === String(r.pack || "1").trim();
    // named by the Sr. shown in the first column (owner, 29 Oct: "it says lines 8 and 10, the screen shows 9 and 11")
    const no = (k: number) => rows[k - 1]?.sr?.trim() || String(k);
    if (!same) { conflict ||= `Sr. ${t.src.map(no).join(", ")} and Sr. ${no(i + 1)} both have the code ${r.style.trim()}${r.color ? " · " + r.color : ""} but different ${t.rate.trim() !== r.rate.trim() || t.cost.trim() !== r.cost.trim() ? "rates" : "units or packets"}. One code is probably misread: correct it from the bill (both lines are marked red).`; out.push({ ...r, src: [i + 1] }); return; }
    const anySet = !!(t.stickers?.trim() || r.stickers?.trim());
    // a sticker of a combined line names both bill lines, e.g. "1-4+1-13", so either packet can be matched to the bill
    const sr = [t.sr, r.sr].map(x => (x || "").trim()).filter(Boolean).join("+");
    out[j] = { ...t, qty: String((Number(t.qty) || 0) + (Number(r.qty) || 0)), stickers: anySet ? String(stick(t) + stick(r)) : "", ...(sr ? { sr } : {}), src: [...t.src, i + 1] };
    combined++;
  });
  return { rows: out.map(({ src, ...r }) => r as PhotoRow), combined, conflict };
}

/** Owner, 29 Oct: "remove this error — if something is wrong I'll correct it by hand". When he approves two lines
    with one code at different prices anyway, the later one becomes its own article: the code + its cost in rupees
    (3902 at ₹495 → 3902-495), the same way articles are built for bills that print none. */
export function keepRepeatsApart(rows: PhotoRow[]): { rows: PhotoRow[]; renamed: { sr: string; from: string; to: string }[] } {
  const up = (v?: string) => (v || "").trim().toUpperCase();
  const first = new Map<string, PhotoRow>(), used = new Set(rows.map(r => up(r.style))), renamed: { sr: string; from: string; to: string }[] = [];
  const out = rows.map((r, i) => {
    if (!up(r.style)) return r;
    const k = up(r.style) + "|" + up(r.color), t = first.get(k);
    if (!t) { first.set(k, r); return r; }
    const same = up(t.item) === up(r.item) && up(t.unit) === up(r.unit) && t.rate.trim() === r.rate.trim() && t.cost.trim() === r.cost.trim() && String(t.pack || "1").trim() === String(r.pack || "1").trim();
    if (same) return r;
    const rupees = (() => { try { const c = moneyInput(r.cost); return c > 0 ? String(Math.round(c / 100)) : ""; } catch { return ""; } })();
    const stem = `${r.style.trim()}-${rupees || "2"}`;
    let style = stem;
    for (let n = 2; used.has(up(style)); n++) style = `${stem}-${n}`;
    used.add(up(style));
    renamed.push({ sr: r.sr?.trim() || String(i + 1), from: r.style.trim(), to: style });
    return { ...r, style };
  });
  return { rows: out, renamed };
}

/* Owner, 29 Oct (voice, with the TIKA/NATH bill): "the bill clearly says how many boxes and pieces, and still the
   stickers came out wrong". A bill that prints Box | Pcs | Qty (4 · 12 · 48PC) says it all: 4 packets of 12, so
   4 stickers each marked X12 — whatever the packet default or a saved article says. */
export function byBoxes(box: unknown, qty: unknown, pack: unknown): { stickers: string; pack?: string; packSource?: "bill" } {
  const b = Number(String(box ?? "").trim()), q = Number(String(qty ?? "").trim()), p = Number(String(pack ?? "").trim());
  if (!Number.isInteger(b) || b <= 0 || !Number.isFinite(q) || q <= 0 || b > q) return { stickers: "" };
  if (p > 0 && p * b === q) return { stickers: String(b), pack: String(p), packSource: "bill" };
  if (q % b === 0) return { stickers: String(b), pack: String(q / b), packSource: "bill" };
  return { stickers: "" };
}

export function validatePhotoRows(rows: PhotoRow[]) {
  if (!rows.length || rows.length > 300) throw new Error("Review 1–300 purchase lines");
  return rows.map((r, i) => {
    const qty = Number(r.qty);
    const print_qty = r.stickers?.trim() ? Number(r.stickers) : undefined;
    if (!r.item.trim() || !r.style.trim()) throw new Error(`Line ${i + 1}: enter product name and article/style`);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000000) throw new Error(`Line ${i + 1}: quantity must be a positive whole number`);
    if (print_qty !== undefined && (!Number.isSafeInteger(print_qty) || print_qty < 0 || print_qty > 5000)) throw new Error(`Line ${i + 1}: stickers must be 0–5000, or leave blank for one per packet`);
    if (!r.cost.trim() || !r.rate.trim()) throw new Error(`Line ${i + 1}: review cost and selling rate`);
    const cost = moneyInput(r.cost), rate = moneyInput(r.rate);
    if (cost <= 0 || rate <= 0) throw new Error(`Line ${i + 1}: enter positive cost and selling rate`);
    if (!Number.isSafeInteger(qty * cost)) throw new Error("Purchase amount is too large");
    if (!UNIT_RE.test(r.unit)) throw new Error(`Line ${i + 1}: choose the unit (PCS, PAIR, SET, DOZEN, BOX, CARD or PACKET)`);
    if (r.item_code && !/^\d+$/.test(r.item_code.trim())) throw new Error(`Line ${i + 1}: old-software item code must be numeric`);
    if (/[~\u0000-\u001f\u007f]/.test(r.ref || "")) throw new Error(`Line ${i + 1}: old-software reference cannot contain ~ or control characters`);
    if (r.hsn && !/^\d{4,8}$/.test(r.hsn)) throw new Error(`Line ${i + 1}: check HSN`);
    let pack: number;
    try { pack = packOf(r); } catch (e: any) { throw new Error(`Line ${i + 1}: ${e.message}`); }
    const entry_code = checkedEntryReference(r.entry_code);
    return { ...r, entry_code, qty, cost, rate: evenRate(rate), pack, print_qty };   // the product keeps the same even rate its label shows
  });
}

/* Draft products for the on-screen sticker preview, so the owner sees the real label before
   approving. The labels actually PRINTED are built from the saved purchase by
   purchaseLabelJobs(), so the preview can never be the thing that goes to the printer. */
export function draftLabelProducts(rows: PhotoRow[], by: string, rule: PricingRule, limit = 6): Product[] {
  return rows.slice(0, limit).map(r => {
    let cost = 0, rate = 0;
    try { cost = moneyInput(r.cost); } catch { /* blank while typing */ }
    try { rate = moneyInput(r.rate); } catch { /* blank while typing */ }
    const unit = UNIT_RE.test(r.unit.trim()) ? r.unit.trim().toUpperCase() : "PCS";
    return {
      ...blankProduct(by),
      item: r.item.trim().toUpperCase(), style: r.style.trim().toUpperCase(), model: r.style.trim().toUpperCase(),
      color: r.color.trim().toUpperCase(), type: unit, item_code: r.item_code, ref: r.ref, pack: packOrOne(r), rate, cost,
      entry_code: r.entry_code,
      cost_code: cost > 0 ? priceFromCost(cost, rule, packOrOne(r), unit).cost_code : "",
    };
  });
}

/** Fill printed packet sizes, known article sizes and learned legacy codes before review. */
export async function preparePhotoRows(rows: PhotoRow[], supplierId: string, fallbackPack = "1"): Promise<PhotoRow[]> {
  const [products, learned] = await Promise.all([db.products.filter(p => !p.deleted).toArray(), itemMap()]);
  const known = resolvedItemMap(learned);
  return rows.map(row => {
    const item = row.item.trim().toUpperCase(), unit = normUnit(row.unit);
    const old = products.find(p => productKey(p) === productKey({ model: row.style, style: row.style, color: row.color, vendor_id: supplierId }));
    const codes = new Set<string>();
    for (const p of products) if (p.item.trim().toUpperCase() === item && normUnit(p.type) === unit && /^\d+$/.test(p.item_code || "")) codes.add(p.item_code!);
    for (const [code, info] of Object.entries(known)) if (info.name.trim().toUpperCase() === item && (!info.unit || normUnit(info.unit) === unit) && /^\d+$/.test(code)) codes.add(code);
    const item_code = row.item_code?.trim() || old?.item_code || (codes.size === 1 ? [...codes][0] : undefined);
    const explicitPack = !!row.pack?.trim() && row.packSource !== "default" && row.packSource !== "saved";
    return { ...row, review_id: row.review_id || uid(), unit: unit || row.unit, qty: readCount(row.qty), pack: explicitPack ? readPacketSize(row.pack) : String(old?.pack || fallbackPack || "1"), packSource: explicitPack ? row.packSource || "bill" : old?.pack ? "saved" : "default", ...(item_code ? { item_code } : {}), ...(row.ref ? {} : old?.ref ? { ref: old.ref } : {}) };
  });
}

/** Same copy count as the saved purchase: explicit PRINT QTY, otherwise one per packet. */
export const labelCountFor = (rows: { qty: number; pack?: number; print_qty?: number }[]) => rows.reduce((n, r) => n + (r.print_qty ?? Math.ceil(r.qty / (r.pack || 1))), 0);

export async function savePhotoPurchase(rows: PhotoRow[], input: { by: string; rack: string; supplierId: string; billNo: string; photoId?: string; note: string; invoiceTotal?: string }): Promise<Purchase> {
  requirePerm("purchases.photo", "saving purchase bill photos");
  const checked = validatePhotoRows(rows);
  if (labelCountFor(checked) > 5000) throw new Error("Purchase exceeds the 5000-label batch limit. Reduce stickers or split it before saving.");
  const invoice_total = input.invoiceTotal?.trim() ? moneyInput(input.invoiceTotal) : undefined;
  if (invoice_total !== undefined && invoice_total <= 0) throw new Error("Check supplier invoice total");
  return db.transaction("rw", [db.products, db.purchases, db.parties, db.movements, db.stock, db.outbox, db.settings, db.config, db.locations, db.stores], async () => {
    const supplier = await db.parties.get(input.supplierId);
    if (!supplier || supplier.deleted || supplier.kind !== "supplier") throw new Error("Choose a supplier account");
    if (!input.billNo.trim()) throw new Error("Enter supplier bill number");
    if (await db.purchases.filter(p => !p.deleted && p.status === "final" && p.supplier_id === supplier.id && p.supplier_bill.trim().toUpperCase() === input.billNo.trim().toUpperCase()).count()) throw new Error("This supplier bill is already saved");
    const purchase = { ...newPurchase(input.by, input.rack), supplier_id: supplier.id, supplier_name: supplier.name, supplier_bill: input.billNo.trim(), photo_id: input.photoId, note: input.note, ...(invoice_total !== undefined ? { invoice_total } : {}) };
    const rule = await getRule();
    const seen = new Set<string>();
    for (const row of checked) {
      const key = [row.style.trim().toUpperCase(), row.color.trim().toUpperCase()].join("|");
      if (seen.has(key)) throw new Error(`Article ${row.style}${row.color ? " · " + row.color : ""} is on two lines that differ in rate, cost, unit or packet. Make them match (they are then added together), or change one line's style/colour.`);
      seen.add(key);
      const old = await findByKey({ model: row.style, style: row.style, color: row.color, vendor_id: supplier.id });
      if (old && old.type !== row.unit.toUpperCase()) throw new Error("Unit differs from the existing article. Review before saving.");
      const code = priceFromCost(row.cost, rule, row.pack, row.unit).cost_code;
      const p: Product = old ? { ...old, item: row.item, hsn: row.hsn || old.hsn, cost: row.cost, rate: row.rate, retail_rate: old.retail_rate || retailFromRate(row.rate, rule) || undefined, price_locked: 1, cost_code: code, pack: row.pack, item_code: row.item_code || old.item_code, ref: row.ref ?? old.ref, collection: row.collection?.trim() || old.collection, material: row.material?.trim() || old.material, photo_id: row.photo_id || old.photo_id } : { ...blankProduct(input.by), item: row.item, style: row.style, model: row.style, color: row.color, item_code: row.item_code, ref: row.ref, type: row.unit, hsn: row.hsn, rate: row.rate, retail_rate: retailFromRate(row.rate, rule) || undefined, cost: row.cost, cost_code: code, price_locked: 1, vendor_id: supplier.id, vendor_name: supplier.name, pack: row.pack, collection: row.collection?.trim() || undefined, material: row.material?.trim() || undefined, photo_id: row.photo_id };
      const saved = await saveProduct(p);
      // Packet-entry totals are recomputed as pkts × pack by stock-in. A partial
      // packet keeps the supplier's exact unit total; label_pack retains its sticker size.
      const partial = row.qty % row.pack !== 0;
      purchase.items.push({ ...lineOf(saved, !old), id: uid(), qty: row.qty, pkts: partial ? 0 : Math.floor(row.qty / row.pack), pack: partial ? 1 : row.pack,
        entry_code: row.entry_code, label_pack: row.pack, ...(row.sr?.trim() ? { bill_sr: row.sr.trim() } : {}), ...(row.print_qty !== undefined ? { print_qty: row.print_qty } : {}), cost: row.cost });
    }
    const saved = await finalizePurchase(purchase);
    await setSetting("purchase_photo_draft", null);
    return saved;
  });
}

/** What a bill's lines add up to, whatever its bill no. or supplier: article + colour + pieces + cost.
    Two purchases with the same signature are the same bill entered twice (owner's log, 21 Oct: one bill saved
    again with a "/" added to its number, another under a second supplier, to print the stickers again). */
/* Owner, 24 Oct: "when the second page of a bill comes, it doesn't print because it reads the same bill number;
   to move ahead I have to change the bill number". Same bill no. + lines that are not on the saved page = the
   next page of that bill: it is saved as "<bill no> P2" (P3…) and only its own stickers print. Lines that are all
   on a saved page = the same page again: its stickers are printed again and nothing is added twice. */
export const lineKey = (l: { style: string; color?: string; qty: number; cost: number }) => [l.style.trim().toUpperCase(), (l.color || "").trim().toUpperCase(), l.qty, Math.round(l.cost)].join("|");
export function isSamePage(saved: { style: string; color?: string; qty: number; cost: number }[], now: { style: string; color?: string; qty: number; cost: number }[]) {
  const have = new Set(saved.map(lineKey));
  return now.length > 0 && now.every(l => have.has(lineKey(l)));
}
export function nextPageNo(billNo: string, taken: string[]): string {
  const base = billNo.trim(), used = new Set(taken.map(t => t.trim().toUpperCase()));
  for (let n = 2; n < 100; n++) { const no = `${base} P${n}`; if (!used.has(no.toUpperCase())) return no; }
  return `${base} P${Date.now() % 1000}`;
}
/* Owner, 24 Oct (call): "every supplier has his own system — this one multiplies by 5, that one writes net rates,
   another takes off a less %; then packing ₹1200, then my weighing/freight… I end up working out factors like 1.24
   by hand". One box per bill: Multiply ×, Less %, Packing/freight ₹. Each line's cost = the bill's printed rate ×
   multiply − less %, shown live so the selling rates are worked out from the real cost; packing/freight is spread
   over the lines by value when the purchase is saved. */
export type Costing = { mult?: string; less?: string; extra?: string };
const num0 = (v?: string) => { const n = Number(String(v ?? "").replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };
export const costingOf = (c: Costing) => ({ mult: num0(c.mult) > 0 ? Math.min(1000, num0(c.mult)) : 1, less: Math.min(90, num0(c.less)), extra: num0(c.extra) });
/** Each line's cost from its printed rate (billCost) × multiply − less %. The printed rate is kept in billCost. */
export function applyCosting<T extends { cost: string; billCost?: string; termsDone?: boolean }>(rows: T[], c: Costing): T[] {
  const { mult, less } = costingOf(c);
  return rows.map(r => {
    const base = Number(r.billCost ?? r.cost);
    if (!(base > 0)) return r;
    return { ...r, billCost: String(base), cost: (Math.round(base * mult * (100 - less)) / 100).toFixed(2) };
  });
}
/** Packing / freight spread over the lines by value (each line's cost goes up by the same %). */
export function spreadExtra<T extends { cost: string; qty: string }>(rows: T[], extra: number): T[] {
  const goods = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.cost) || 0), 0);
  if (!(extra > 0) || !(goods > 0)) return rows;
  const up = 1 + extra / goods;
  return rows.map(r => { const c = Number(r.cost); return c > 0 ? { ...r, cost: (Math.round(c * up * 100) / 100).toFixed(2) } : r; });
}
/** A multiplier the bill prints under its total (e.g. "Total 98446 · 5 · Rs 492230"). */
export function readMultiplier(out: { bill_multiplier?: unknown }): string {
  const m = Number(String(out?.bill_multiplier ?? "").replace(/[^0-9.]/g, ""));
  return m > 1 && m <= 100 ? String(m) : "";
}
/** Packing / freight / other charges the bill adds below its total. */
export function readExtra(out: { extra_charges?: unknown }): string {
  const e = Number(String(out?.extra_charges ?? "").replace(/[^0-9.]/g, ""));
  return e > 0 ? String(Math.round(e * 100) / 100) : "";
}
/** The bill's discount % taken off each line's cost (rounded to paise). Selling rates are left as they are. */
export function withBillDiscount<T extends { cost: string }>(rows: T[], pct: number): T[] {
  if (!(pct > 0)) return rows;
  return rows.map(r => { const c = Number(r.cost); return c > 0 ? { ...r, cost: (Math.round(c * (100 - pct)) / 100).toFixed(2) } : r; });
}
/** The discount % the bill reader found: as a %, or worked out from a rupee discount and the goods' total. */
export function readDiscount(out: { discount_pct?: unknown; discount_amount?: unknown }, rows: { qty: string; cost: string }[]): string {
  const pct = Number(String(out?.discount_pct ?? "").replace(/[^0-9.]/g, ""));
  if (pct > 0 && pct < 90) return String(Math.round(pct * 100) / 100);
  const amt = Number(String(out?.discount_amount ?? "").replace(/[^0-9.]/g, ""));
  const goods = rows.reduce((a, r) => a + (Number(r.qty) || 0) * (Number(r.cost) || 0), 0);
  return amt > 0 && goods > amt ? String(Math.round(amt / goods * 10000) / 100) : "";
}
/** Lines added by hand have no bill Sr.: they take the numbers after the bill's highest one (18 read → 19, 20 …). */
export function continueSr<T extends { sr?: string }>(rows: T[]): T[] {
  const nums = rows.map(r => /^\d{1,4}$/.test((r.sr || "").trim()) ? Number(r.sr) : NaN).filter(Number.isFinite);
  if (!nums.length) return rows;
  let next = Math.max(...nums);
  return rows.map(r => ((r.sr || "").trim() ? r : { ...r, sr: String(++next) }));
}
export function lineSignature(lines: { style: string; color: string; qty: number; cost: number }[]): string {
  return lines.map(l => [l.style.trim().toUpperCase(), (l.color || "").trim().toUpperCase(), l.qty, Math.round(l.cost)].join("|")).sort().join(";");
}
