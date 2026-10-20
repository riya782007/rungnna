import { allocate } from "./allocate";
import { trackCustomLines, unassignedRack } from "./stock-adjustment";
import { db, put, uid, now, deviceId, getSetting, setSetting, type Bill, type BillLine, type BillType, type Movement, type Party, type Product, type Config } from "./db";
import { rupees, billAmount } from "./format";
import { isOpen, isEstimate } from "./privacy";
import { setTagsSold } from "./rfid";
import { assertUnlocked } from "./finance";
import { currentStore, inStore, assertStoreRow, storeLocations } from "./stores";
import { fillBillNames } from "./billing-products";
import { validatePosLines } from "./pos";
import { isInterState } from "./states";
import { requirePerm } from "./scope";
import { purgeEstimates } from "./estimatePurge";

/* ---------------- shop profile (synced to every device) ---------------- */
export interface Shop {
  name: string; tagline: string; address: string; phone: string; whatsapp: string; gstin: string;
  state: string; upi: string; bank: string; terms: string; hsn: string; gst_rate: number; gst_mode: "exclusive" | "inclusive"; max_disc: number;
}
export const DEFAULT_SHOP: Shop = {
  name: "RUNGNNA JEWELLERY & CO", tagline: "Fashion & Imitation Jewellery", address: "", phone: "", whatsapp: "", gstin: "",
  state: "Delhi", upi: "", bank: "", terms: "Goods once sold will not be taken back. Subject to local jurisdiction.",
  hsn: "7117", gst_rate: 3, gst_mode: "exclusive", max_disc: 10,
};
export async function getShop(): Promise<Shop> {
  const c = await db.config.get("shop");
  /* The shop is in Sadar Bazar, Delhi. A blank state (as saved on 16 Oct) made every out-of-state tax invoice charge
     CGST + SGST while printing "Place of supply: Rajasthan": the state decides IGST, so it is never left blank. */
  const v = { ...DEFAULT_SHOP, ...(c?.value || {}) };
  return { ...v, state: v.state || DEFAULT_SHOP.state };
}
export async function saveShop(v: Shop) {
  requirePerm("settings.manage", "changing shop settings");
  await put("config", { id: "shop", value: v, updated_at: now() } as Config);
}

/* ---------------- numbering: each counter owns its own series, so offline numbers never clash ---------------- */
export function fy(d = new Date()) {
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y).slice(2)}-${String(y + 1).slice(2)}`;
}
export async function counterCode(): Promise<string> {
  let c = await getSetting<string>("counter_code", "");
  // 3 random chars: ~47k codes, so two counters rarely get the same one
  if (!c) { c = "C" + deviceId().slice(-3); await setSetting("counter_code", c); }
  const store = await db.stores.get(currentStore());
  return store && store.code !== "MAIN" ? store.code + c : c;
}
/* RJ = tax invoice, EST = estimate, CH = delivery challan, CN = credit note (ECN when it returns an estimate, so it stays private) */
export const seriesOf = (t: BillType, src?: BillType) =>
  t === "gst" ? "RJ" : t === "challan" ? "CH" : t === "return" ? (src === "estimate" ? "ECN" : "CN") : "EST";
export const isSale = (b: Pick<Bill, "bill_type">) => b.bill_type === "gst" || b.bill_type === "estimate";
export const isChallan = (b: Pick<Bill, "bill_type">) => b.bill_type === "challan";
export const isReturn = (b: Pick<Bill, "bill_type">) => b.bill_type === "return";
/* the sales that count as money owed / sold: saved invoices and estimates (not challans, not merged-away sources) */
export const isSaleFinal = (b: Bill) => isSale(b) && b.status === "final" && !b.deleted;
export const docName = (b: Pick<Bill, "bill_type">) =>
  b.bill_type === "gst" ? "Tax invoice" : b.bill_type === "challan" ? "Delivery challan" : b.bill_type === "return" ? "Credit note" : "Estimate";
export const docShort = (b: Pick<Bill, "bill_type">) =>
  b.bill_type === "gst" ? "GST" : b.bill_type === "challan" ? "CH" : b.bill_type === "return" ? "CN" : "EST";
async function nextNo(t: BillType, src?: BillType) {
  const series = seriesOf(t, src), f = fy(), cc = await counterCode();
  const key = `seq_${series}_${f}_${cc}`;
  let n = (await getSetting<number>(key, 0)) + 1, no = "";
  // never hand out a number that already exists on this device (lost counter after clearing browser data, a copied counter code…)
  for (;; n++) {
    no = `${series}/${f.slice(0, 2)}${cc}${String(n).padStart(4, "0")}`;
    if (!(await db.bills.where("no").equals(no).count())) break;
  }
  await setSetting(key, n);
  if (["gst", "challan"].includes(t) && no.length > 16) throw new Error("Shorten the counter code in Settings (government limit: 16 characters)");
  return { no, series: `${series}/${f}/${cc}` };
}

/** Document numbers used by more than one saved document (e.g. two counters with the same code before they synced). */
export async function duplicateNumbers(): Promise<{ no: string; ids: string[] }[]> {
  const seen = new Map<string, string[]>();
  for (const b of await db.bills.toArray()) if (b.no && !b.deleted) seen.set(b.no, [...(seen.get(b.no) || []), b.id]);
  return [...seen].filter(([, ids]) => ids.length > 1).map(([no, ids]) => ({ no, ids }));
}

/* ---------------- maths (all paise) ---------------- */
/** A line discount is blank, "10%" (0–100) or a rupee amount "25" / "25.50". Anything else is a typing mistake. */
export const DISC_RE = /^(\d+(\.\d{1,2})?)\s*%?$/;
export function discError(disc: string): string {
  const d = (disc || "").trim();
  if (!d) return "";
  const m = d.match(DISC_RE);
  if (!m) return "Discount must be a number like 10% or 25";
  if (d.endsWith("%") && Number(m[1]) > 100) return "Discount cannot be more than 100%";
  return "";
}
export function lineAmount(l: Pick<BillLine, "qty" | "rate" | "disc">) {
  const g = l.qty * l.rate;
  const d = (l.disc || "").trim();
  if (!d || discError(d)) return g;        // an invalid discount is never applied (save is blocked until it is fixed)
  const n = parseFloat(d);
  if (d.endsWith("%")) return Math.round(g - g * Math.min(100, n) / 100);
  return Math.max(0, g - Math.round(n * 100));
}
export function fixLine(l: BillLine): BillLine {
  const qty = l.pack > 1 && l.pkts > 0 ? l.pkts * l.pack : l.qty;
  const x = { ...l, qty };
  return { ...x, amount: lineAmount(x) };
}
/** Split integer paise by weights so the parts always add back to the total. */
export { allocate } from "./allocate";
/** " 3%" for a single-rate bill; "" (just "GST") when lines carry different rates. */
export const gstLabel = (b: Bill) => (b.items.some(l => l.tax != null) ? "" : ` ${b.gst_rate}%`);
export function totals(b: Bill, shopState = "", shopGstin = ""): Bill {
  const items = b.items.map(fixLine);
  const gross = items.reduce((a, l) => a + l.amount, 0);
  const total_qty = items.reduce((a, l) => a + l.qty, 0);
  const box_count = Math.max(b.box_count || 0, new Set(items.map(l => l.box_no)).size);
  // a discount can never exceed the goods on the bill, so NET can't go negative
  const pct = Number.isFinite(b.discount_pct) ? Math.min(100, Math.max(0, b.discount_pct)) : 0;
  const discount = Math.min(gross, Math.max(0, pct ? Math.round(gross * pct / 100) : (Number.isFinite(b.discount) ? b.discount : 0)));
  const packing = Number.isFinite(b.packing) ? Math.max(0, b.packing) : 0;
  // a credit note against a tax invoice reverses its GST; estimates, challans and their returns carry none
  const rate = b.bill_type === "gst" || (b.bill_type === "return" && b.src_type === "gst") ? b.gst_rate : 0;
  let base = gross - discount + packing, gst = 0, lines = items;
  // lines taxed at a different rate than the bill (e.g. a 12% item on a 3% bill) are taxed line by line
  const mixed = !!rate && items.some(l => l.gst_rate != null && l.gst_rate !== rate);
  if (mixed) {
    const shares = allocate(base, items.map(l => l.amount));
    base = 0;
    lines = items.map((l, i) => {
      const r = l.gst_rate ?? rate, s = shares[i];
      let ex = s, tax: number;
      if (b.gst_mode === "inclusive") { ex = Math.round(s * 100 / (100 + r)); tax = s - ex; } else tax = Math.round(s * r / 100);
      base += ex; gst += tax;
      return { ...l, taxable: ex, tax };
    });
  } else {
    lines = items.map(l => { const { taxable, tax, ...rest } = l; return rest; });
    if (rate) {
      if (b.gst_mode === "inclusive") { const ex = Math.round(base * 100 / (100 + rate)); gst = base - ex; base = ex; }
      else gst = Math.round(base * rate / 100);
    }
  }
  const inter = isInterState({ state: shopState, gstin: shopGstin }, b.party_state, b.party_gstin);
  // CGST/SGST are split rate by rate, so every "CGST x%" row printed on the invoice adds up to the bill's total exactly
  const groups = rateGroups(lines, mixed ? null : { rate, taxable: base, tax: gst }, rate);
  const cgst = inter ? 0 : groups.reduce((a, g) => a + Math.floor(g.tax / 2), 0);
  const sgst = inter ? 0 : gst - cgst, igst = inter ? gst : 0;
  const raw = base + gst;
  const net = Math.round(raw / 100) * 100;
  const paid = b.bill_type === "challan" ? 0 : b.payments.filter(p => p.mode !== "credit").reduce((a, p) => a + (Number.isFinite(p.amount) ? p.amount : 0), 0);
  return { ...b, items: lines, gross, total_qty, box_count, discount, discount_pct: pct, packing, gst, cgst, sgst, igst, adjust: net - raw, net, paid };
}

type RateGroup = { rate: number; taxable: number; tax: number };
function rateGroups(lines: BillLine[], single: RateGroup | null, def: number): RateGroup[] {
  if (single) return single.tax || single.rate ? [single] : [];
  const m = new Map<number, RateGroup>();
  for (const l of lines) {
    const r = l.gst_rate ?? def, g = m.get(r) || { rate: r, taxable: 0, tax: 0 };
    g.taxable += l.taxable || 0; g.tax += l.tax || 0; m.set(r, g);
  }
  return [...m.values()].sort((a, z) => a.rate - z.rate);
}

export type TaxRow = { rate: number; hsn: string; taxable: number; cgst: number; sgst: number; igst: number };
/** The tax on a saved/computed bill, line by line, so it can be summarised by rate (invoice) or by HSN (GSTR-1).
    Line values always add back to the bill's own taxable value and CGST/SGST/IGST. */
export function taxLines(b: Bill, shopHsn = "7117"): TaxRow[] {
  if (!b.gst || !b.items.length) return [];
  const mixed = b.items.every(l => l.tax != null && l.taxable != null);
  const amounts = b.items.map(l => l.amount);
  const taxable = mixed ? b.items.map(l => l.taxable!) : allocate(b.net - b.adjust - b.gst, amounts);
  const tax = mixed ? b.items.map(l => l.tax!) : allocate(b.gst, amounts);
  const rows = b.items.map((l, i) => ({ rate: mixed ? l.gst_rate ?? b.gst_rate : b.gst_rate, hsn: (l.hsn || shopHsn || "").trim(), taxable: taxable[i], cgst: 0, sgst: 0, igst: 0 }));
  // split each rate's tax the same way totals() did, then spread it over that rate's lines
  for (const r of [...new Set(rows.map(x => x.rate))]) {
    const idx = rows.map((x, i) => (x.rate === r ? i : -1)).filter(i => i >= 0);
    const t = idx.reduce((a, i) => a + tax[i], 0), w = idx.map(i => tax[i] || 1);
    const parts = b.igst ? { igst: t, cgst: 0, sgst: 0 } : { igst: 0, cgst: Math.floor(t / 2), sgst: t - Math.floor(t / 2) };
    (["cgst", "sgst", "igst"] as const).forEach(k => allocate(parts[k], w).forEach((v, j) => { rows[idx[j]][k] = v; }));
  }
  return rows;
}
/** Rows summed by a key: rate ("3") for the invoice, or HSN+rate for the HSN summary. */
export function taxSummary(b: Bill, by: "rate" | "hsn", shopHsn = "7117"): TaxRow[] {
  const m = new Map<string, TaxRow>();
  for (const r of taxLines(b, shopHsn)) {
    const k = by === "rate" ? String(r.rate) : r.hsn + "|" + r.rate;
    const g = m.get(k) || { ...r, taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    g.taxable += r.taxable; g.cgst += r.cgst; g.sgst += r.sgst; g.igst += r.igst; m.set(k, g);
  }
  return [...m.values()].sort((a, z) => a.rate - z.rate || a.hsn.localeCompare(z.hsn));
}
export const due = (b: Pick<Bill, "net" | "advance" | "paid"> & { bill_type?: BillType }) =>
  b.bill_type === "challan" ? 0 : b.net - b.advance - b.paid;   // a challan asks for no money

/* ---------------- building bills ---------------- */
export function newBill(by: string, shop: Shop, t: BillType = "estimate"): Bill {
  return {
    id: uid(), no: "", series: "", bill_type: t, status: "hold", party_name: "", party_phone: "", party_gstin: "", party_state: "",
    price_level: "wholesale",
    store_id: currentStore(),
    salesman: "", box_count: 0, total_qty: 0, gross: 0, discount: 0, discount_pct: 0, packing: 0, adjust: 0,
    gst_mode: shop.gst_mode, gst_rate: shop.gst_rate, gst: 0, cgst: 0, sgst: 0, igst: 0, net: 0, advance: 0, paid: 0,
    remarks: "", payments: [], items: [], device: deviceId(), by_staff: by, at: now(), updated_at: now(),
  };
}
export function priceFor(p: Product, level: Party["tier"] | Bill["price_level"] = "wholesale") {
  if (level === "retail") return p.retail_rate || p.mrp || p.rate || p.wholesale_rate || 0;
  return p.wholesale_rate || p.rate || p.retail_rate || p.mrp || 0;
}
export function lineFrom(p: Product, box = 1, pkts = 1, level: Party["tier"] | Bill["price_level"] = "wholesale"): BillLine {
  const pack = p.pack && p.pack > 1 ? p.pack : 1;
  return fixLine({ id: uid(), hsn: p.hsn, ...(p.gst_rate != null ? { gst_rate: p.gst_rate } : {}), product_id: p.id, code: p.code, item: p.item || (p.item_code ? "ITEM " + p.item_code : ""), type: p.type, style: p.style, color: p.color,
    box_no: box, pack, pkts: pack > 1 ? pkts : 0, qty: pack > 1 ? pkts * pack : pkts, rate: priceFor(p, level), disc: "", amount: 0 });
}

/* ---------------- saving ---------------- */
export async function holdBill(b: Bill) {
  await assertStoreRow(b);
  const before = await db.bills.get(b.id);
  if (before?.status === "final") throw new Error("Final documents cannot be moved back to held bills");
  if (before?.at) await assertUnlocked(before.at);
  await put("bills", { ...b, status: "hold" });
}

/* What the party owed before this bill, the way their khata reads: opening balance + unpaid sales − credit notes
   − receipts. A tax invoice never counts estimates (they are private and must not appear on a GST document); an
   estimate counts them only while estimates are unlocked on this device. Printed on the bill as "Previous balance". */
export async function balanceBefore(b: Bill): Promise<number> {
  if (!b.party_id) return 0;
  const withEst = b.bill_type === "estimate" && isOpen();
  const party = await db.parties.get(b.party_id);
  const fromReceipt = (p: { ref?: string }) => (p.ref || "").startsWith("RCPT");
  const others = (await db.bills.where("party_id").equals(b.party_id).toArray())
    .filter(x => x.id !== b.id && inStore(x) && x.status === "final" && !x.deleted && (withEst || !isEstimate(x)));
  let bal = party?.opening_balance || 0;
  for (const x of others) {
    if (isSale(x)) bal += x.net - x.advance - x.payments.filter(p => p.mode !== "credit" && !fromReceipt(p)).reduce((a, p) => a + p.amount, 0);
    else if (isReturn(x)) bal -= x.net - x.paid;
  }
  const rcpts = await db.receipts.where("party_id").equals(b.party_id).filter(r => inStore(r) && !r.deleted).toArray();
  for (const r of rcpts) bal -= withEst ? r.amount : r.amount - r.allocations.filter(a => /^EST\//.test(a.bill_no)).reduce((x, a) => x + a.amount, 0);
  return bal;
}

/* Final save: number it, take the pieces off the racks (fullest location first), keep a movement per rack.
   Lines marked stock_done already left on another document (merged sources, challans, a split) and are skipped.
   `after` runs inside the same transaction, so linked changes (e.g. marking merged sources) save all-or-nothing. */
export async function finalize(b: Bill, shopState: string, customerName = "", after?: (saved: Bill) => Promise<void>): Promise<Bill> {
  return db.transaction("rw", [db.bills, db.movements, db.outbox, db.stock, db.products, db.stores, db.locations, db.settings, db.config, db.parties, db.receipts], async () => {
  await assertStoreRow(b);
  b = await fillBillNames(b);
  if (b.items.some(l => !l.item?.trim() || /^ITEM\s+\d+$/i.test(l.item.trim()))) throw new Error("Every bill item needs a product name");
  if (b.compliance?.irn || b.compliance?.ewb) throw new Error("Registered documents cannot be edited; use a credit note");
  const t = totals(b, shopState, (await getShop()).gstin);
  validatePosLines(t.items);
  t.items = await trackCustomLines(t.items, t.by_staff);
  const before0 = await db.bills.get(b.id);
  if (before0?.at) await assertUnlocked(before0.at);
  const num = t.no ? { no: t.no, series: t.series } : await nextNo(t.bill_type, t.src_type);
  const bill: Bill = { ...t, ...num, status: "final", oversold: undefined, at: t.status === "hold" ? now() : t.at };
  // frozen the first time the bill is saved: a reprint next month still shows what was owed on the day
  if (isSale(bill) && bill.party_id) bill.prev_due = before0?.status === "final" && before0.party_id === bill.party_id && before0.prev_due !== undefined ? before0.prev_due : await balanceBefore(bill);
  else bill.prev_due = undefined;
  const oversold: { product_id: string; item: string; qty: number }[] = [];
  const bucket = new Set((await db.locations.filter(l => l.kind === "bucket").toArray()).map(l => l.id));
  const racks = new Set((await storeLocations()).map(l => l.id));
  await db.transaction("rw", [db.bills, db.movements, db.outbox, db.stock, db.products, db.locations], async () => {
    const before = await db.bills.get(bill.id);
    await put("bills", bill);
    if (bill.bill_type !== "return") {
      if (before?.status === "final") await setTagsSold((before.rfid_tags || []).filter(x => !(bill.rfid_tags || []).includes(x)), null); // edited: dropped tags are back
      await setTagsSold(bill.rfid_tags, bill.no);            // these tagged pieces have left the shop
    }
    if (after) await after(bill);
    if (bill.converted_from || bill.bill_type === "return") return; // stock already left with the estimate / comes back via saveReturn
    for (const l of bill.items) {
      if (!l.product_id || l.qty <= 0 || l.stock_done) continue;
      let left = l.qty;
      const recorded = (await db.stock.where("product_id").equals(l.product_id).toArray())
        .filter(c => racks.has(c.loc_id) && !bucket.has(c.loc_id)).sort((a, z) => z.qty - a.qty);
      const cells = recorded.filter(c => c.qty > 0);
      const parts: { loc: string | null; q: number }[] = [];
      for (const c of cells) { if (!left) break; const q = Math.min(left, c.qty); parts.push({ loc: c.loc_id, q }); left -= q; }
      if (left) { parts.push({ loc: recorded[0]?.loc_id || await unassignedRack(), q: left }); oversold.push({ product_id: l.product_id, item: [l.item, l.style, l.color].filter(Boolean).join(" "), qty: left }); }   // sold more than was recorded: still logged, and flagged on the bill
      for (const x of parts) {
        const m: Movement = { id: uid(), product_id: l.product_id, kind: "sale", qty: x.q, from_loc: x.loc, to_loc: null,
          person_type: "customer", person_name: customerName || bill.party_name, by_staff: bill.by_staff, note: bill.no,
          device: deviceId(), ref_bill: bill.id, at: bill.at, updated_at: now() };
        await put("movements", m);
        if (x.loc) await bumpStock(l.product_id, x.loc, -x.q);
      }
    }
    if (oversold.length) { bill.oversold = oversold; await put("bills", bill); }
  });
  return bill;
  });
}
export async function bumpStock(product_id: string, loc: string, delta: number) {
  const k = product_id + "|" + loc; const c = await db.stock.get(k);
  await db.stock.put({ key: k, product_id, loc_id: loc, qty: (c?.qty || 0) + delta });
}

/* Cancel: the bill stays on record (marked void with a reason); pieces go back to the racks they came from.
   A credit note being cancelled takes its returned pieces off the racks again.
   A merged invoice being cancelled gives its source bills / challans back (they hold their own stock). */
export async function voidBill(b: Bill, reason: string, by: string) {
  requirePerm("billing.void", "cancelling a bill");
  await assertStoreRow(b);
  if ([b.compliance?.irn, b.compliance?.ewb].some(r => r && !r.cancelled_at)) throw new Error("Cancel government registration before voiding this bill");
  await assertUnlocked(b.at);
  await db.transaction("rw", [db.bills, db.movements, db.outbox, db.stock, db.products], async () => {
    const stamp = `${reason} — by ${by} on ${new Date().toLocaleString("en-IN")}`;
    if (b.bill_type === "return") {
      await put("bills", { ...b, status: "void", void_reason: stamp });
      const ins = await db.movements.where("ref_bill").equals(b.id).filter(m => m.kind === "return" && !m.deleted).toArray();
      for (const m of ins) {
        await put("movements", { ...m, id: uid(), kind: "sale", from_loc: m.to_loc, to_loc: null, note: "Void " + b.no, at: now(), updated_at: now(), by_staff: by } as Movement);
        if (m.to_loc) await bumpStock(m.product_id, m.to_loc, -m.qty);
      }
      return;
    }
    await setTagsSold(b.rfid_tags, null);                   // goods back on the racks: tags are live again
    await put("bills", { ...b, status: "void", void_reason: stamp });
    for (const id of b.merged_from || []) {                  // un-merge: sources come back as they were
      const s = await db.bills.get(id);
      if (!s || s.status !== "merged" || s.merged_into !== b.id) continue;
      const back: Bill = { ...s, status: s.no ? "final" : "hold", merged_into: undefined, merged_into_no: undefined };
      await put("bills", back);
      if (back.status === "final") await setTagsSold(back.rfid_tags, back.no);
    }
    const src = b.converted_from || b.id;
    if (b.converted_from) { // voiding a converted GST bill: the estimate's stock is still out, return it too
      const est = await db.bills.get(b.converted_from);
      if (est) await put("bills", { ...est, status: "void", void_reason: "Voided with " + b.no });
    }
    const outs = await db.movements.where("ref_bill").equals(src).filter(m => m.kind === "sale" && !m.deleted).toArray();
    for (const m of outs) {
      const r: Movement = { ...m, id: uid(), kind: "return", from_loc: null, to_loc: m.from_loc, note: "Void " + b.no, at: now(), updated_at: now(), by_staff: by };
      await put("movements", r);
      if (m.from_loc) await bumpStock(m.product_id, m.from_loc, m.qty);
    }
  });
}

/* Estimate → GST invoice: new GST number, same goods, estimate marked "converted" (never deleted). */
export async function convertToGst(est: Bill, shop: Shop, by: string): Promise<Bill> {
  requirePerm("billing.sell", "making a tax invoice");
  const g: Bill = { ...est, id: uid(), no: "", series: "", bill_type: "gst", status: "hold", gst_rate: shop.gst_rate, gst_mode: shop.gst_mode,
    converted_from: est.id, by_staff: by, at: now(), payments: est.payments };
  const fresh = await db.bills.get(est.id);
  if (!fresh || fresh.status !== "final" || fresh.converted_to) throw new Error("This estimate was already converted or changed — reopen it");
  // the estimate is marked converted inside the same save, so a crash can never leave both live
  return finalize(g, shop.state, est.party_name, async done => { await put("bills", { ...fresh, status: "converted", converted_to: done.id }); });
}

/* ---------------- customers ---------------- */
export function newParty(name = "", phone = ""): Party {
  return { id: uid(), kind: "customer", name, alt_name: "", phone, gstin: "", address: "", city: "", state: "", pin: "",
    tier: "wholesale", credit_limit: 0, notes: "", updated_at: now() };
}
/* What the customer owes on bills: unpaid sales minus credit notes not refunded in cash (opening balance and receipts are in ledger.ts) */
export async function partyDue(party_id: string) {
  const bs = await db.bills.where("party_id").equals(party_id).filter(b => b.status === "final" && !b.deleted && (isOpen() || !isEstimate(b))).toArray();
  return bs.reduce((a, b) => a + (isSale(b) ? due(b) : isReturn(b) ? -(b.net - b.paid) : 0), 0);
}

/* ---------------- sharing ---------------- */
export const normPhone = (p: string) => { const d = (p || "").replace(/\D/g, ""); return d.length === 10 ? "91" + d : d; };
export function billText(b: Bill, shop: Shop) {
  const L = [`*${shop.name}*`, `${docName(b)} ${b.no}${b.return_of_no ? " (against " + b.return_of_no + ")" : ""}`, new Date(b.at).toLocaleString("en-IN"), ""];
  if (b.bill_type === "estimate") L.push("APPROVAL CHALLAN · SALE NOT EXECUTED · बिक्री निष्पादित नहीं", "");
  b.items.forEach((l, i) => L.push(`${i + 1}. ${[l.item, l.style, l.color].filter(Boolean).join(" ")} — ${l.pkts ? l.pkts + "×" + l.pack + "=" : ""}${l.qty} × ${billAmount(l.rate)} = ${billAmount(l.amount)}`));
  L.push("", `Pieces: ${b.total_qty} · Boxes: ${b.box_count}`);
  L.push(`Gross: ${billAmount(b.gross)}`);
  if (b.discount) L.push(`Discount: -${billAmount(b.discount)}`);
  if (b.packing) L.push(`Packing: ${billAmount(b.packing)}`);
  if (b.gst) L.push(`GST${gstLabel(b)}: ${billAmount(b.gst)}`);
  if (b.adjust) L.push(`Round off: ${billAmount(b.adjust)}`);
  L.push(b.bill_type === "return" ? `*Credit: ${billAmount(b.net)}*` : b.bill_type === "challan" ? `*Value: ${billAmount(b.net)}* (no payment due on a challan)` : `*Total: ${billAmount(b.net)}*`);
  if (b.advance) L.push(`Advance: -${billAmount(b.advance)}`);
  if (b.paid) L.push(`Paid: -${billAmount(b.paid)}`);
  const d = isSale(b) ? due(b) : 0; if (d > 0) L.push(`Balance due: ${billAmount(d)}`);
  if (isSale(b) && d < 0) L.push(`Excess received: ${billAmount(-d)}`);
  if (isSale(b) && b.prev_due) L.push(`Previous balance: ${billAmount(b.prev_due)}`, `Total due: ${billAmount(b.prev_due + d)}`);
  if (b.remarks) L.push(`Remarks: ${b.remarks}`);
  if (shop.upi && d > 0) L.push(`Pay by UPI: upi://pay?pa=${encodeURIComponent(shop.upi)}&pn=${encodeURIComponent(shop.name)}&am=${(d / 100).toFixed(2)}&cu=INR`);
  L.push("", "Thank you! 🙏");
  return L.join("\n");
}
export function waLink(phone: string, text: string) {
  const n = normPhone(phone);
  return `https://wa.me/${n}?text=${encodeURIComponent(text)}`;
}

/* A clean receipt picture drawn on a canvas — shares straight into WhatsApp as an image, no server needed. */
export async function billImage(b: Bill, shop: Shop): Promise<Blob> {
  const W = 720, pad = 32, right = W - pad;
  const c = document.createElement("canvas"); c.width = W;
  const g = c.getContext("2d")!;
  // Lay out first, then size the canvas from the actual footer. Long item names and
  // all settlement rows must survive sharing just as they do on the printed bill.
  const draw: (() => void)[] = [];
  const text = (value: string, x: number, y: number, font = "17px sans-serif", color = "#241B2E", align: CanvasTextAlign = "left") => {
    draw.push(() => { g.font = font; g.fillStyle = color; g.textAlign = align; g.fillText(value, x, y); });
  };
  const rule = (at: number) => draw.push(() => { g.strokeStyle = "#E7DBC6"; g.beginPath(); g.moveTo(pad, at); g.lineTo(right, at); g.stroke(); });
  const wrap = (value: string, width: number, font: string) => {
    g.font = font;
    const lines: string[] = []; let current = "";
    // Wrap even an unbroken style code instead of silently truncating it.
    for (const ch of value) {
      if (ch === "\n") { lines.push(current); current = ""; continue; }
      if (current && g.measureText(current + ch).width > width) { lines.push(current.trimEnd()); current = ""; }
      current += ch;
    }
    if (current || !lines.length) lines.push(current.trimEnd());
    return lines;
  };
  // The shop name can also be longer than a single header line.
  const shopLines = wrap(shop.name, W - 2 * pad, "700 28px Georgia");
  shopLines.forEach((s, i) => text(s, pad, 44 + i * 32, "700 28px Georgia", "#E2C887"));
  const headerBottom = 108 + (shopLines.length - 1) * 32;
  text([shop.tagline, shop.phone].filter(Boolean).join(" · "), pad, headerBottom - 24, "16px sans-serif", "#EFEAF2");
  if (shop.gstin && b.bill_type === "gst") text("GSTIN " + shop.gstin, pad, headerBottom - 3, "16px sans-serif", "#EFEAF2");
  let y = headerBottom + 40;
  const block = (value: string, font = "16px sans-serif", lineHeight = 24, color = "#6B6175", width = W - 2 * pad) => {
    for (const s of wrap(value, width, font)) { text(s, pad, y, font, color); y += lineHeight; }
  };
  block(docName(b).toUpperCase() + " " + b.no, "700 22px sans-serif", 28, "#241B2E");
  if (b.bill_type === "estimate") {
    block("APPROVAL CHALLAN · SALE NOT EXECUTED", "700 16px sans-serif", 24, "#8B3550");
    block("बिक्री निष्पादित नहीं · Not a tax invoice", "16px sans-serif", 24, "#8B3550");
  }
  if (b.status === "void") block("CANCELLED", "700 20px sans-serif", 28, "#B00020");
  block(new Date(b.at).toLocaleString("en-IN"));
  if (b.party_name) block("To: " + b.party_name + (b.party_phone ? " · " + b.party_phone : ""));
  if (b.party_address) block(b.party_address);
  if (b.salesman) block("Salesman: " + b.salesman);
  if (b.helper) block("Helper: " + b.helper);
  if (b.packed_by) block("Packed by: " + b.packed_by);
  if (b.checked_by) block("Rechecked by: " + b.checked_by);
  y += 8; rule(y); y += 32;
  for (const [i, l] of b.items.entries()) {
    const firstY = y;
    block((i + 1) + ". " + [l.item, l.style].filter(Boolean).join(" · "), "600 18px sans-serif", 25, "#241B2E", W - 2 * pad - 170);
    text(billAmount(l.amount), right, firstY, "600 18px sans-serif", "#241B2E", "right");
    block([l.color, l.type, l.pkts ? l.pkts + " pkt × " + l.pack + " = " + l.qty : l.qty + " pcs", "rate " + billAmount(l.rate), "Box " + l.box_no, l.disc ? "disc " + l.disc : ""].filter(Boolean).join(" · "), "15px sans-serif", 22);
    y += 10;
  }
  rule(y); y += 30;
  const row = (label: string, value: number, bold = false, negative = false) => {
    const font = (bold ? "700 22px " : "17px ") + "sans-serif", firstY = y;
    block(label, font, 30, "#241B2E", W - 2 * pad - 200);
    text((negative ? "-" : "") + billAmount(value), right, firstY, font, "#241B2E", "right");
  };
  row("Pieces " + b.total_qty + " · Boxes " + b.box_count, b.gross);
  if (b.discount) row("Discount", b.discount, false, true);
  if (b.packing) row("Packing", b.packing);
  if (b.gst) row("GST" + gstLabel(b), b.gst);
  if (b.adjust) row("Round off", b.adjust);
  row(b.bill_type === "return" ? "CREDIT" : b.bill_type === "challan" ? "VALUE" : "TOTAL", b.net, true);
  if (b.advance) row("Advance", b.advance, false, true);
  if (b.paid) row("Paid", b.paid, false, true);
  const d = isSale(b) ? due(b) : 0;
  if (d > 0) row("Balance due", d, true);
  if (isSale(b) && d < 0) row("Excess received", -d);
  if (isSale(b) && b.prev_due) { row("Previous balance", b.prev_due); row("Total due", b.prev_due + d, true); }
  if (b.remarks) { y += 10; block("Remarks: " + b.remarks); }
  if (shop.bank) block("Bank: " + shop.bank);
  y += 16; block("Thank you for shopping with us", "italic 16px Georgia", 24, "#A07E2E");
  c.height = Math.ceil(y + pad);
  g.fillStyle = "#FAF6EF"; g.fillRect(0, 0, W, c.height);
  g.fillStyle = "#241B2E"; g.fillRect(0, 0, W, headerBottom + 12);
  if (b.bill_type === "estimate") {
    g.save(); g.translate(W / 2, (headerBottom + c.height) / 2); g.rotate(-Math.PI / 7);
    g.fillStyle = "rgba(139,53,80,0.10)"; g.font = "700 74px sans-serif"; g.textAlign = "center"; g.fillText("ESTIMATE", 0, 0); g.restore();
  }
  draw.forEach(paint => paint());
  return await new Promise<Blob>((resolve, reject) => c.toBlob(blob => blob ? resolve(blob) : reject(new Error("Could not create the complete bill image")), "image/png"));
}

/* Android/iPhone: opens the share sheet with the bill picture attached (pick WhatsApp).
   Computers: opens WhatsApp Web with the bill text. */
export async function shareBill(b: Bill, shop: Shop) {
  const text = billText(b, shop);
  try {
    const blob = await billImage(b, shop);
    const file = new File([blob], `${b.no.replace(/\//g, "-") || "bill"}.png`, { type: "image/png" });
    const nav = navigator as any;
    if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text }); return "shared"; }
  } catch (e: any) { if (e?.name === "AbortError") return "cancelled"; }
  window.open(waLink(b.party_phone, text), "_blank");
  return "wa";
}

export async function lastBills(n = 50) { return db.bills.orderBy("at").reverse().filter(b => !b.deleted).limit(n).toArray(); }

/* Owner-only: remove estimates for good, from everywhere (see lib/estimatePurge.ts).
   returnStock = the goods never left (a quotation) → pieces go back to the racks they came from. */
export async function deleteEstimates(bills: Bill[], returnStock: boolean, by: string) {
  return (await purgeEstimates(bills, { returnStock, by })).estimates;
}
