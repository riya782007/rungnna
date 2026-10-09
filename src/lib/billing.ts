import { db, put, uid, now, deviceId, getSetting, setSetting, type Bill, type BillLine, type BillType, type Movement, type Party, type Product, type Config } from "./db";
import { rupees } from "./format";
import { isOpen, isEstimate } from "./privacy";
import { setTagsSold } from "./rfid";
import { assertUnlocked } from "./finance";
import { currentStore, inStore, assertStoreRow, storeLocations } from "./stores";
import { fillBillNames } from "./billing-products";
import { validatePosLines } from "./pos";
import { isInterState } from "./states";

/* ---------------- shop profile (synced to every device) ---------------- */
export interface Shop {
  name: string; tagline: string; address: string; phone: string; whatsapp: string; gstin: string;
  state: string; upi: string; bank: string; terms: string; hsn: string; gst_rate: number; gst_mode: "exclusive" | "inclusive"; max_disc: number;
}
export const DEFAULT_SHOP: Shop = {
  name: "RUNGNNA JEWELLERY & CO", tagline: "Fashion & Imitation Jewellery", address: "", phone: "", whatsapp: "", gstin: "",
  state: "", upi: "", bank: "", terms: "Goods once sold will not be taken back. Subject to local jurisdiction.",
  hsn: "7117", gst_rate: 3, gst_mode: "exclusive", max_disc: 10,
};
export async function getShop(): Promise<Shop> {
  const c = await db.config.get("shop");
  return { ...DEFAULT_SHOP, ...(c?.value || {}) };
}
export async function saveShop(v: Shop) { await put("config", { id: "shop", value: v, updated_at: now() } as Config); }

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
export function lineAmount(l: Pick<BillLine, "qty" | "rate" | "disc">) {
  const g = l.qty * l.rate;
  const d = (l.disc || "").trim();
  if (!d) return g;
  if (d.endsWith("%")) return Math.round(g - g * (parseFloat(d) || 0) / 100);
  return Math.max(0, g - Math.round((parseFloat(d) || 0) * 100));
}
export function fixLine(l: BillLine): BillLine {
  const qty = l.pack > 1 && l.pkts > 0 ? l.pkts * l.pack : l.qty;
  const x = { ...l, qty };
  return { ...x, amount: lineAmount(x) };
}
/** Split integer paise by weights so the parts always add back to the total. */
export function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, n) => a + n, 0);
  const out = weights.map(n => (sum ? Math.floor(total * n / sum) : 0));
  let left = total - out.reduce((a, n) => a + n, 0);
  for (let i = 0; left > 0 && i < out.length; i++, left--) out[i]++;
  return out;
}
/** " 3%" for a single-rate bill; "" (just "GST") when lines carry different rates. */
export const gstLabel = (b: Bill) => (b.items.some(l => l.tax != null) ? "" : ` ${b.gst_rate}%`);
export function totals(b: Bill, shopState = "", shopGstin = ""): Bill {
  const items = b.items.map(fixLine);
  const gross = items.reduce((a, l) => a + l.amount, 0);
  const total_qty = items.reduce((a, l) => a + l.qty, 0);
  const box_count = Math.max(b.box_count || 0, new Set(items.map(l => l.box_no)).size);
  // a discount can never exceed the goods on the bill, so NET can't go negative
  const discount = Math.min(gross, Math.max(0, b.discount_pct ? Math.round(gross * b.discount_pct / 100) : b.discount));
  // a credit note against a tax invoice reverses its GST; estimates, challans and their returns carry none
  const rate = b.bill_type === "gst" || (b.bill_type === "return" && b.src_type === "gst") ? b.gst_rate : 0;
  let base = gross - discount + b.packing, gst = 0, lines = items;
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
  const igst = inter ? gst : 0, cgst = inter ? 0 : Math.floor(gst / 2), sgst = inter ? 0 : gst - Math.floor(gst / 2);
  const raw = base + gst;
  const net = Math.round(raw / 100) * 100;
  const paid = b.bill_type === "challan" ? 0 : b.payments.filter(p => p.mode !== "credit").reduce((a, p) => a + p.amount, 0);
  return { ...b, items: lines, gross, total_qty, box_count, discount, gst, cgst, sgst, igst, adjust: net - raw, net, paid };
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

/* Final save: number it, take the pieces off the racks (fullest location first), keep a movement per rack.
   Lines marked stock_done already left on another document (merged sources, challans, a split) and are skipped.
   `after` runs inside the same transaction, so linked changes (e.g. marking merged sources) save all-or-nothing. */
export async function finalize(b: Bill, shopState: string, customerName = "", after?: (saved: Bill) => Promise<void>): Promise<Bill> {
  return db.transaction("rw", [db.bills, db.movements, db.outbox, db.stock, db.products, db.stores, db.locations, db.settings, db.config], async () => {
  await assertStoreRow(b);
  b = await fillBillNames(b);
  if (b.items.some(l => !l.item?.trim() || /^ITEM\s+\d+$/i.test(l.item.trim()))) throw new Error("Every bill item needs a product name");
  if (b.compliance?.irn || b.compliance?.ewb) throw new Error("Registered documents cannot be edited; use a credit note");
  const t = totals(b, shopState, (await getShop()).gstin);
  validatePosLines(t.items);
  const before0 = await db.bills.get(b.id);
  if (before0?.at) await assertUnlocked(before0.at);
  const num = t.no ? { no: t.no, series: t.series } : await nextNo(t.bill_type, t.src_type);
  const bill: Bill = { ...t, ...num, status: "final", oversold: undefined, at: t.status === "hold" ? now() : t.at };
  const oversold: { product_id: string; item: string; qty: number }[] = [];
  const bucket = new Set((await db.locations.filter(l => l.kind === "bucket").toArray()).map(l => l.id));
  const racks = new Set((await storeLocations()).map(l => l.id));
  await db.transaction("rw", [db.bills, db.movements, db.outbox, db.stock, db.products], async () => {
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
      const cells = (await db.stock.where("product_id").equals(l.product_id).toArray())
        .filter(c => c.qty > 0 && racks.has(c.loc_id) && !bucket.has(c.loc_id)).sort((a, z) => z.qty - a.qty);
      const parts: { loc: string | null; q: number }[] = [];
      for (const c of cells) { if (!left) break; const q = Math.min(left, c.qty); parts.push({ loc: c.loc_id, q }); left -= q; }
      if (left) { parts.push({ loc: null, q: left }); oversold.push({ product_id: l.product_id, item: [l.item, l.style, l.color].filter(Boolean).join(" "), qty: left }); }   // sold more than was recorded: still logged, and flagged on the bill
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
  const g: Bill = { ...est, id: uid(), no: "", series: "", bill_type: "gst", status: "hold", gst_rate: shop.gst_rate, gst_mode: shop.gst_mode,
    converted_from: est.id, by_staff: by, at: now(), payments: est.payments };
  const done = await finalize(g, shop.state);
  await put("bills", { ...est, status: "converted", converted_to: done.id });
  return done;
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
  b.items.forEach((l, i) => L.push(`${i + 1}. ${[l.item, l.style, l.color].filter(Boolean).join(" ")} — ${l.pkts ? l.pkts + "×" + l.pack + "=" : ""}${l.qty} × ${rupees(l.rate)} = ${rupees(l.amount)}`));
  L.push("", `Pieces: ${b.total_qty} · Boxes: ${b.box_count}`);
  if (b.discount) L.push(`Discount: -${rupees(b.discount)}`);
  if (b.packing) L.push(`Packing: ${rupees(b.packing)}`);
  if (b.gst) L.push(`GST${gstLabel(b)}: ${rupees(b.gst)}`);
  L.push(b.bill_type === "return" ? `*Credit: ${rupees(b.net)}*` : b.bill_type === "challan" ? `*Value: ${rupees(b.net)}* (no payment due on a challan)` : `*Total: ${rupees(b.net)}*`);
  const d = isSale(b) ? due(b) : 0; if (d > 0) L.push(`Balance due: ${rupees(d)}`);
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
  const W = 720, pad = 32, lh = 30;
  const rows = b.items.length;
  const H = 360 + rows * lh * 1.6 + 260;
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const g = c.getContext("2d")!;
  g.fillStyle = "#FAF6EF"; g.fillRect(0, 0, W, H);
  g.fillStyle = "#241B2E"; g.fillRect(0, 0, W, 120);
  g.fillStyle = "#E2C887"; g.font = "700 30px Georgia"; g.fillText(shop.name, pad, 52);
  g.fillStyle = "#EFEAF2"; g.font = "16px sans-serif"; g.fillText([shop.tagline, shop.phone].filter(Boolean).join(" · "), pad, 82);
  if (shop.gstin && b.bill_type === "gst") g.fillText("GSTIN " + shop.gstin, pad, 104);
  let y = 160;
  g.fillStyle = "#241B2E"; g.font = "700 22px sans-serif";
  g.fillText(docName(b).toUpperCase() + " " + b.no, pad, y);
  g.font = "16px sans-serif"; g.fillStyle = "#6B6175";
  g.fillText(new Date(b.at).toLocaleString("en-IN"), pad, y += 26);
  if (b.party_name) g.fillText("To: " + b.party_name + (b.party_phone ? " · " + b.party_phone : ""), pad, y += 24);
  y += 20; g.strokeStyle = "#E7DBC6"; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke(); y += 10;
  for (const l of b.items) {
    y += lh;
    g.fillStyle = "#241B2E"; g.font = "600 18px sans-serif";
    g.fillText([l.item, l.style].filter(Boolean).join(" · ").slice(0, 40), pad, y);
    g.textAlign = "right"; g.fillText(rupees(l.amount), W - pad, y); g.textAlign = "left";
    g.fillStyle = "#6B6175"; g.font = "15px sans-serif";
    g.fillText(`${l.color || ""}  ${l.pkts ? l.pkts + " pkt × " + l.pack + " = " : ""}${l.qty} pcs × ${rupees(l.rate)}  · Box ${l.box_no}`, pad, y += lh * 0.6);
  }
  y += 24; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
  const row = (k: string, v: string, bold = false) => {
    y += 30; g.font = (bold ? "700 22px " : "17px ") + "sans-serif"; g.fillStyle = "#241B2E";
    g.fillText(k, pad, y); g.textAlign = "right"; g.fillText(v, W - pad, y); g.textAlign = "left";
  };
  row(`Pieces ${b.total_qty} · Boxes ${b.box_count}`, rupees(b.gross));
  if (b.discount) row("Discount", "-" + rupees(b.discount));
  if (b.packing) row("Packing", rupees(b.packing));
  if (b.gst) row(`GST${gstLabel(b)}`, rupees(b.gst));
  row(b.bill_type === "return" ? "CREDIT" : b.bill_type === "challan" ? "VALUE" : "TOTAL", rupees(b.net), true);
  const d = isSale(b) ? due(b) : 0; if (d > 0) row("Balance due", rupees(d), true);
  g.fillStyle = "#A07E2E"; g.font = "italic 16px Georgia"; g.fillText("Thank you for shopping with us", pad, y += 44);
  return await new Promise<Blob>(r => c.toBlob(x => r(x!), "image/png"));
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

/* Owner-only: remove estimates for good. The rows are emptied and marked deleted on every device and in the cloud.
   returnStock = the goods never left (a quotation) → pieces go back to the racks they came from. */
export async function deleteEstimates(bills: Bill[], returnStock: boolean, by: string) {
  let n = 0;
  for (const b of bills) {
    if (b.bill_type !== "estimate" || b.deleted || b.status === "merged" || b.status === "converted") continue; // its goods live on in another invoice
    await db.transaction("rw", [db.bills, db.movements, db.outbox, db.stock, db.products], async () => {
      if (returnStock && b.status === "final") {
        await setTagsSold(b.rfid_tags, null);
        const outs = await db.movements.where("ref_bill").equals(b.id).filter(m => m.kind === "sale" && !m.deleted).toArray();
        for (const m of outs) {
          await put("movements", { ...m, id: uid(), kind: "return", from_loc: null, to_loc: m.from_loc, note: "Estimate removed", at: now(), updated_at: now(), by_staff: by });
          if (m.from_loc) { const k = m.product_id + "|" + m.from_loc; const c = await db.stock.get(k); await db.stock.put({ key: k, product_id: m.product_id, loc_id: m.from_loc, qty: (c?.qty || 0) + m.qty }); }
        }
      }
      // keep only the id and number as a tombstone so other devices know to drop it
      await put("bills", { ...b, deleted: 1, items: [], payments: [], rfid_tags: [], party_id: undefined, party_name: "", party_phone: "", party_gstin: "", party_state: "",
        remarks: "", gross: 0, discount: 0, packing: 0, gst: 0, cgst: 0, sgst: 0, igst: 0, net: 0, advance: 0, paid: 0, total_qty: 0, void_reason: "Deleted by " + by });
    });
    n++;
  }
  return n;
}
