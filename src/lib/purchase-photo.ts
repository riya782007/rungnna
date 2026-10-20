import { checkedEntryReference } from "./entry-reference";
import { db, uid, setSetting, type Product, type Purchase, type Party } from "./db";
import { blankProduct, findByKey, saveProduct, itemMap, normUnit, productKey, resolvedItemMap } from "./products";
import { newPurchase, lineOf, finalizePurchase } from "./stockin";
import { readCount, readPacketSize } from "./purchase-quantities";
import { moneyInput } from "./pos";
import { requirePerm } from "./scope";
import { vendorCost } from "./vendors";
import { getRule, priceFromCost, evenRate, type PricingRule } from "./pricing";

export type PhotoRow = { item: string; style: string; color: string; unit: string; hsn: string; qty: string; cost: string; rate: string;
  /** set when autoArticle() invented the article because the bill printed none */
  autoStyle?: boolean;
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
  billCost?: string };

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
    if (!/^(PCS|PAIR|SET)$/i.test(r.unit)) throw new Error(`Line ${i + 1}: convert dozen/box/packet to PCS, PAIR or SET before saving`);
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
    const unit = /^(PCS|PAIR|SET)$/i.test(r.unit.trim()) ? r.unit.trim().toUpperCase() : "PCS";
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
      if (seen.has(key)) throw new Error("Repeated article/colour: combine its quantities before saving");
      seen.add(key);
      const old = await findByKey({ model: row.style, style: row.style, color: row.color, vendor_id: supplier.id });
      if (old && old.type !== row.unit.toUpperCase()) throw new Error("Unit differs from the existing article. Review before saving.");
      const code = priceFromCost(row.cost, rule, row.pack, row.unit).cost_code;
      const p: Product = old ? { ...old, item: row.item, hsn: row.hsn || old.hsn, cost: row.cost, rate: row.rate, price_locked: 1, cost_code: code, pack: row.pack, item_code: row.item_code || old.item_code, ref: row.ref ?? old.ref } : { ...blankProduct(input.by), item: row.item, style: row.style, model: row.style, color: row.color, item_code: row.item_code, ref: row.ref, type: row.unit, hsn: row.hsn, rate: row.rate, cost: row.cost, cost_code: code, price_locked: 1, vendor_id: supplier.id, vendor_name: supplier.name, pack: row.pack };
      const saved = await saveProduct(p);
      // Packet-entry totals are recomputed as pkts × pack by stock-in. A partial
      // packet keeps the supplier's exact unit total; label_pack retains its sticker size.
      const partial = row.qty % row.pack !== 0;
      purchase.items.push({ ...lineOf(saved, !old), id: uid(), qty: row.qty, pkts: partial ? 0 : Math.floor(row.qty / row.pack), pack: partial ? 1 : row.pack,
        entry_code: row.entry_code, label_pack: row.pack, ...(row.print_qty !== undefined ? { print_qty: row.print_qty } : {}), cost: row.cost });
    }
    const saved = await finalizePurchase(purchase);
    await setSetting("purchase_photo_draft", null);
    return saved;
  });
}
