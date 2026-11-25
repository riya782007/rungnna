import type { Bill } from "./db";
import { due, docName, taxSummary, type Shop } from "./billing";
import { placeCode, GST_STATES } from "./states";
import { documentAmount, documentDiscount } from "./estimate-display";
import { billNarration } from "./payment-narration";
import { qrAccount, upiLink } from "./upi";
import { carryBags, bagPayload } from "./bag-labels";
import type { ReceiptCut } from "./printing";
import { billItems, billItemsText } from "./itemSummary";

/* Text-mode bills for the roll printer (owner, 24–25 Nov: "at least four bills to get one right — mental harassment").
   A bill drawn as a picture is 100–400 KB for the printer; on his POS-80 parts of that picture were lost and the rest
   came out as "p88 L L" junk, on long bills and short ones, through the Print box and straight. Every billing
   program in the market sends the printer plain text in its own font instead (ESC/POS): a 200-line bill is a few
   KB, prints at full speed, never shrinks, never splits into pages with gaps, and the cutter cuts once at the end.
   Same content as the picture bill (Invoice.tsx), in the printer's own letters. */

const ESC = 0x1b, GS = 0x1d;
export type Line = { t: string; bold?: boolean; big?: boolean; center?: boolean; right?: boolean };

/** Only what the printer's own font has: Hindi, ₹, · and the like become plain ASCII. */
export const ascii = (s: string) => String(s ?? "")
  .replace(/₹/g, "Rs.").replace(/[·•]/g, "-").replace(/[×✕]/g, "x").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  .normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/\t/g, " ").replace(/[^\x20-\x7e]/g, "");
const words = (s: string) => ascii(s).replace(/\s+/g, " ").trim();
const padL = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : " ".repeat(n - s.length) + s);
const padR = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length));
/** Words wrapped to the width, long words broken. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = []; let cur = "";
  for (let w of words(text).split(" ").filter(Boolean)) {
    while (w.length > width) { if (cur) { out.push(cur); cur = ""; } out.push(w.slice(0, width)); w = w.slice(width); }
    if (!cur) cur = w; else if (cur.length + 1 + w.length <= width) cur += " " + w; else { out.push(cur); cur = w; }
  }
  if (cur) out.push(cur);
  return out.length ? out : [""];
}
const pair = (label: string, value: string, width: number) => { const v = words(value), l = words(label); return l.length + v.length + 1 > width ? [l, padL(v, width)] : [l + " ".repeat(width - l.length - v.length) + v]; };

/** The bill as lines of text, width = characters across (48 on 80 mm, 32 on 58 mm). */
export function receiptLines(b: Bill, shop: Shop, width = 48): Line[] {
  const W = width, out: Line[] = [];
  const add = (t: string, o: Omit<Line, "t"> = {}) => out.push({ t: ascii(t), ...o });
  const many = (t: string, o: Omit<Line, "t"> = {}) => wrap(t, W).forEach(x => out.push({ t: x, ...o }));
  const rule = (c = "-") => add(c.repeat(W));
  const amt = (v: number) => documentAmount(b, v);
  const d = due(b);
  const money = b.bill_type !== "challan" && b.bill_type !== "return";
  const estimate = b.bill_type === "estimate";
  const notExecuted = b.bill_type === "estimate" || (b.bill_type !== "return" && !b.no);
  const taxDoc = b.bill_type === "gst" || (b.bill_type === "return" && b.src_type === "gst");
  const full = shop.bill_lines === "full";
  const initials = (shop.name || "").split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(and|co\.?|company|pvt\.?|ltd\.?|private|limited)$/i.test(w)).slice(0, 3).map(w => w[0]).join("").toUpperCase() || shop.name;

  // head
  add(estimate ? initials : shop.name, { big: true, bold: true, center: true });
  if (!estimate) { if (shop.tagline) many(shop.tagline, { center: true }); const a = [shop.address, shop.phone, shop.email].filter(Boolean).join(" - "); if (a) many(a, { center: true }); }
  if (shop.gstin && taxDoc) { const sc = placeCode(shop.gstin, shop.state); many(`GSTIN: ${shop.gstin}${shop.state ? " - State: " + shop.state + (sc ? " (" + sc + ")" : "") : ""}`, { center: true }); }
  add(docName(b).toUpperCase(), { bold: true, center: true });
  if (estimate) add("APPROVAL CHALLAN", { center: true });
  if (b.price_level === "retail") add("RETAIL", { center: true });
  if (b.status === "void") add("*** CANCELLED ***", { bold: true, center: true });
  if (notExecuted) add("** SALE NOT EXECUTED **", { bold: true, center: true });
  rule("=");
  // meta
  add(`${docName(b)} No: ${b.no || "(draft)"}${estimate && b.inv_no ? " - Invoice No: " + b.inv_no : ""}`, { bold: true });
  add("Date: " + new Date(b.at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }));
  for (const [k, v] of [["Salesman", b.salesman], ["Helper", b.helper], ["Packed by", b.packed_by], ["Rechecked by", b.checked_by], ["Against", b.return_of_no]] as const) if (v) many(`${k}: ${v}`);
  many(`Party: ${b.party_name || "Cash"}${b.party_phone ? " - " + b.party_phone : ""}`, { bold: true });
  if (b.party_gstin) add("GSTIN: " + b.party_gstin);
  if (b.party_address) many(b.party_address);
  const pos = taxDoc ? placeCode(b.party_gstin, b.party_state || shop.state) : "";
  if (taxDoc && pos) many(`Place of supply: ${pos}-${GST_STATES[pos]}`); else if (b.party_state) many("State: " + b.party_state);
  rule();
  // lines: # item unit qty rate amount (58 mm: item on its own line)
  const wide = W >= 42;
  const NO = 3, UNIT = 4, QTY = 4, RATE = wide ? 8 : 7, AMT = wide ? 9 : 8;
  const ITEM = wide ? W - (NO + 1 + 1 + UNIT + 1 + QTY + 1 + RATE + 1 + AMT) : W - NO - 1;
  const nums = (unit: string, qty: string, rate: string, amount: string) => [padR(unit, UNIT), padL(qty, QTY), padL(rate, RATE), padL(amount, AMT)].join(" ");
  if (wide) add(padR("#", NO) + " " + padR("Item", ITEM) + " " + nums("Unit", "Qty", "Rate", "Amount"), { bold: true });
  else add(padR("#", NO) + " Item / Unit Qty Rate Amount", { bold: true });
  rule();
  const boxes = [...new Set(b.items.map(l => l.box_no))].sort((a, z) => a - z);
  let n = 0;
  for (const box of boxes) {
    const lines = b.items.filter(l => l.box_no === box);
    add(`Box No.: ${box} - Qty: ${lines.reduce((s, l) => s + l.qty, 0)}`, { bold: true });
    for (const l of lines) {
      n++;
      const name = words(l.item || l.style || "Item") + (l.pkts ? ` ${l.pkts}x${l.pack}` : "");
      const extra = [full ? [l.style, l.color].filter(Boolean).join(" - ") : "", l.disc ? "disc " + documentDiscount(b, l.disc) : ""].filter(Boolean).join(" - ");
      const values = nums(words(l.type || "PCS"), String(l.qty), amt(l.rate), amt(l.amount));
      if (wide) {
        const parts = wrap(name, ITEM);
        add(padR(String(n), NO) + " " + padR(parts[0], ITEM) + " " + values);
        parts.slice(1).forEach(p => add(" ".repeat(NO + 1) + p));
      } else {
        wrap(name, ITEM).forEach((p, i) => add((i ? " ".repeat(NO) : padR(String(n), NO)) + " " + p));
        add(padL(values, W));
      }
      if (extra) wrap(extra, W - NO - 1).forEach(p => add(" ".repeat(NO + 1) + p));
    }
  }
  rule();
  // foot
  add(`Total quantity: ${b.total_qty} - Boxes: ${b.box_count}${b.carry_bags ? " - Carry bags: " + b.carry_bags : ""}`, { bold: true });
  if (billItems(b).length > 1) many("Items: " + billItemsText(b, ", "));
  if (estimate) many("Approval challan - Not a tax invoice.");
  if (b.bill_type === "challan") many("Goods sent on approval / for delivery. Not a tax invoice - the invoice follows.");
  if (taxDoc) {
    const byHsn = taxSummary(b, "hsn", shop.hsn), byRate = taxSummary(b, "rate", shop.hsn);
    const pct = (r: number) => (Math.round(r * 100) / 100).toString();
    if (byHsn.length > 1) byHsn.forEach(h => many(`HSN ${h.hsn} - GST ${pct(h.rate)}% - taxable ${amt(h.taxable)}`));
    else many(`HSN ${byHsn[0]?.hsn || shop.hsn} - GST ${pct(byRate[0]?.rate ?? b.gst_rate)}% ${b.gst_mode === "inclusive" ? "(included in rates) " : ""}- Reverse charge: No`);
  }
  const narration = billNarration(b, amt);
  if (narration) many("Remarks: " + narration);
  if (shop.bank) many("Bank: " + shop.bank);
  rule();
  const sum = (label: string, value: string, o: Omit<Line, "t"> = {}) => pair(label, value, W).forEach(x => out.push({ t: x, ...o }));
  sum("Gross", amt(b.gross));
  if (b.discount) sum(`Discount${b.discount_pct ? " " + b.discount_pct + "%" : ""}${b.less_pct ? " + less " + b.less_pct + "%" : ""}`, "-" + amt(b.discount));
  if (b.packing) sum("Packing", amt(b.packing));
  if (taxDoc && b.gst) sum("Taxable value", amt(b.net - b.adjust - b.gst));
  if (taxDoc) for (const g of taxSummary(b, "rate", shop.hsn)) {
    const pct = (r: number) => (Math.round(r * 100) / 100).toString();
    if (g.cgst) sum(`CGST ${pct(g.rate / 2)}%`, amt(g.cgst));
    if (g.sgst) sum(`SGST ${pct(g.rate / 2)}%`, amt(g.sgst));
    if (g.igst) sum(`IGST ${pct(g.rate)}%`, amt(g.igst));
  }
  if (b.adjust) sum("Round off", amt(b.adjust));
  sum(b.bill_type === "return" ? "CREDIT" : b.bill_type === "challan" ? "VALUE" : "NET", amt(b.net), { bold: true, big: false });
  if (b.advance) sum("Advance", "-" + amt(b.advance));
  if (b.paid) sum(`Paid (${b.payments.filter(p => p.mode !== "credit").map(p => p.mode.toUpperCase()).join("+")})`, "-" + amt(b.paid));
  if (money && d > 0) sum("Balance", amt(d), { bold: true });
  if (money && d < 0) sum("Excess received", amt(-d));
  if (money && b.bill_type !== "return" && b.prev_due) { sum("Previous balance", amt(b.prev_due)); sum("Total due", amt(b.prev_due + d), { bold: true }); }
  if (taxDoc) { rule(); if (shop.terms) many(shop.terms); add("For " + shop.name, { right: true }); }
  return out;
}

/** Bag tag and cash-counter slip, as text. */
export function slipLines(b: Bill, shop: Shop, slip: { kind: "tag"; n: number } | { kind: "cash" }, width = 48): Line[] {
  const W = width, out: Line[] = [], add = (t: string, o: Omit<Line, "t"> = {}) => out.push({ t: ascii(t), ...o });
  const amt = (v: number) => documentAmount(b, v), d = due(b);
  const head = b.bill_type === "estimate" ? (shop.name || "").split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(and|co\.?|company)$/i.test(w)).slice(0, 3).map(w => w[0]).join("").toUpperCase() : shop.name;
  const two = (l: string, r: string) => pair(l, r, W).forEach(x => add(x));
  two(head, slip.kind === "tag" ? "BAG TAG" : "CASH COUNTER");
  add("-".repeat(W));
  if (slip.kind === "tag") add(`BAG ${slip.n} OF ${carryBags(b)}`, { big: true, bold: true, center: true });
  wrap(b.party_name || "Walk-in / cash", W).forEach(x => add(x, { bold: true, center: slip.kind === "tag" }));
  if (b.party_phone) add(b.party_phone, { center: slip.kind === "tag" });
  two(`${docName(b)} No: ${b.no}`, new Date(b.at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }));
  if (slip.kind === "tag") {
    two(`Items: ${b.items.length} lines`, `Qty: ${b.total_qty}`);
    if (b.packed_by || b.checked_by) two(b.packed_by ? "Packed: " + b.packed_by : "", b.checked_by ? "Checked: " + b.checked_by : "");
  } else {
    if (b.salesman) add("Salesman: " + b.salesman);
    two(`Qty: ${b.total_qty}`, `Carry bags: ${carryBags(b)}`);
    two("Bill amount", amt(b.net));
    if (b.advance) two("Advance", "-" + amt(b.advance));
    if (b.paid) two(`Paid (${b.payments.filter(p => p.mode !== "credit").map(p => p.mode.toUpperCase()).join("+")})`, "-" + amt(b.paid));
    pair(d > 0 ? "TO COLLECT" : d < 0 ? "RETURN" : "PAID", amt(Math.abs(d)), W).forEach(x => add(x, { bold: true }));
    if (b.prev_due) two("Previous balance", amt(b.prev_due));
  }
  return out;
}

/** Lines → printer bytes: initialise, the lines, a QR if asked, blank paper, one cut. */
export function escpos(lines: Line[], o: { feedMm?: number; cut?: ReceiptCut; qr?: string; qrCaption?: string } = {}): Uint8Array {
  const bytes: number[] = [ESC, 0x40, ESC, 0x74, 0x00];        // reset; code page 437 (plain ASCII is the same in all)
  const text = (s: string) => { for (const ch of s) bytes.push(ch.charCodeAt(0) & 0x7f); };
  for (const l of lines) {
    bytes.push(ESC, 0x61, l.center ? 1 : l.right ? 2 : 0);     // align
    bytes.push(ESC, 0x45, l.bold ? 1 : 0);                      // bold
    bytes.push(GS, 0x21, l.big ? 0x11 : 0x00);                  // double width + height
    text(l.t); bytes.push(0x0a);
  }
  bytes.push(GS, 0x21, 0, ESC, 0x45, 0);
  if (o.qr) {
    const data = Array.from(new TextEncoder().encode(o.qr)), len = data.length + 3;
    bytes.push(ESC, 0x61, 1);
    bytes.push(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0x00);             // model 2
    bytes.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, 6);                      // module size 6
    bytes.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);                   // error correction M
    bytes.push(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30, ...data);
    bytes.push(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);                   // print it
    if (o.qrCaption) { text(ascii(o.qrCaption)); bytes.push(0x0a); }
    bytes.push(ESC, 0x61, 0);
  }
  const feed = Math.max(0, Math.round((o.feedMm ?? 25) / 0.125));          // dots (8 per mm)
  for (let left = feed; left > 0; left -= 255) bytes.push(ESC, 0x4a, Math.min(255, left));
  if (o.cut !== "manual") bytes.push(GS, 0x56, o.cut === "full" ? 0x00 : 0x01);
  return Uint8Array.from(bytes);
}

/** The whole job for one bill: the bill, then each slip, every one cut on its own — one printer job, in order. */
export function billJob(b: Bill, shop: Shop, o: { width: 80 | 58; feedMm: number; cut: ReceiptCut; slips?: ({ kind: "tag"; n: number } | { kind: "cash" })[] }): Uint8Array {
  const W = o.width === 58 ? 32 : 48;
  const d = due(b), money = b.bill_type !== "challan" && b.bill_type !== "return";
  const payTo = money && d > 0 ? qrAccount(b, shop) : undefined;
  const parts = [escpos(receiptLines(b, shop, W), { feedMm: o.feedMm, cut: o.cut, ...(payTo ? { qr: upiLink(payTo, shop.name, d, b.no), qrCaption: `Scan to pay ${documentAmount(b, d)} - UPI: ${payTo.upi}` } : {}) })];
  for (const s of o.slips || []) parts.push(escpos(slipLines(b, shop, s, W), { feedMm: o.feedMm, cut: o.cut, ...(s.kind === "tag" ? { qr: bagPayload({ billId: b.id, number: s.n }) } : {}) }));
  const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0;
  for (const p of parts) { all.set(p, at); at += p.length; }
  return all;
}
