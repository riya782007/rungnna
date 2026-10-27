import { Fragment, useEffect, useState, type ReactNode } from "react";
import { bagPayload, carryBags } from "../lib/bag-labels";
import { getSetting } from "../lib/db";
import { usePrintJob, receiptFeed, DEFAULT_RECEIPT_FEED } from "../lib/printing";
import { createPortal } from "react-dom";
import type { Bill } from "../lib/db";
import { due, docName, taxSummary, type Shop } from "../lib/billing";
import { placeCode, GST_STATES } from "../lib/states";
import { billAmount } from "../lib/format";
import { qrSvg } from "../lib/qr";
import { toast } from "../lib/app";
import { billNarration } from "../lib/payment-narration";

export type PrintFormat = "a5" | "a4" | "80mm" | "58mm" | "packing";

const ONES = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
function two(n: number) { return n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? " " + ONES[n % 10] : ""); }
function three(n: number) { return (n >= 100 ? ONES[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " : "") : "") + (n % 100 ? two(n % 100) : ""); }
/* Indian system: crore, lakh, thousand */
export function inWords(paise: number) {
  let n = Math.round(paise / 100);
  if (!n) return "Rupees Zero Only";
  const parts: string[] = [];
  const cr = Math.floor(n / 1e7); n %= 1e7;
  const lk = Math.floor(n / 1e5); n %= 1e5;
  const th = Math.floor(n / 1e3); n %= 1e3;
  if (cr) parts.push(three(cr) + " Crore");
  if (lk) parts.push(two(lk) + " Lakh");
  if (th) parts.push(two(th) + " Thousand");
  if (n) parts.push(three(n));
  return "Rupees " + parts.join(" ") + " Only";
}

/* GST rule 48: a tax invoice for goods is made out in triplicate. Each printed copy says which one it is. */
export const COPY_NAMES = ["ORIGINAL FOR RECIPIENT", "DUPLICATE FOR TRANSPORTER", "TRIPLICATE FOR SUPPLIER"];

export function InvoiceSheet({ b, shop, format, copy, feed = 0 }: { b: Bill; shop: Shop; format: PrintFormat; copy?: string; feed?: number }) {
  const d = due(b);
  const money = b.bill_type !== "challan" && b.bill_type !== "return"; // no "pay now" on a challan or credit note
  const upi = money && shop.upi && d > 0 ? qrSvg(`upi://pay?pa=${shop.upi}&pn=${encodeURIComponent(shop.name)}&am=${(d / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(b.no)}`).svg : "";
  const prices = format !== "packing";
  const narration = prices ? billNarration(b) : b.remarks;
  const estimate = prices && b.bill_type === "estimate";
  const title = format === "packing" ? "PACKING SLIP" : docName(b).toUpperCase();
  const boxes = [...new Set(b.items.map(l => l.box_no))].sort((a, z) => a - z);
  const thermal = format === "80mm" || format === "58mm";
  const full = shop.bill_lines === "full";   // item name only unless the shop chose item + style + colour
  /* Owner rule (R-204): an estimate is a quotation, not a sale. It carries "sale not executed"
     in Hindi and English so it can never be mistaken for a bill — by the party, by a salesman,
     or by an inspector reading it a year later. A numbered tax invoice never carries it. */
  const notExecuted = format !== "packing" && (b.bill_type === "estimate" || (b.bill_type !== "return" && !b.no));
  const taxDoc = b.bill_type === "gst" || (b.bill_type === "return" && b.src_type === "gst");
  const byRate = taxDoc ? taxSummary(b, "rate", shop.hsn) : [];
  const byHsn = taxDoc ? taxSummary(b, "hsn", shop.hsn) : [];
  const pct = (r: number) => (Math.round(r * 100) / 100).toString();
  const pos = taxDoc ? placeCode(b.party_gstin, b.party_state || shop.state) : "";
  const shopCode = placeCode(shop.gstin, shop.state);
  const page = thermal ? "auto" : format === "a4" ? "A4" : "A5";
  const pageName = thermal ? "rj-receipt" : format === "a4" ? "rj-a4" : "rj-a5";
  return (
    <div style={{ page: pageName }} className={"inv " + (thermal ? "thermal " : "") + (format === "58mm" ? "narrow" : "")}>
      <style data-thermal-width={thermal ? format.slice(0, 2) : undefined}>{`@page ${pageName}{size:${page};margin:${thermal ? "2mm" : "8mm"}}`}</style>
      <div className="inv-head">
        {/* Owner, 22 Oct: an estimate carries only the shop's initials ("RJ") at the top, no name or tagline.
            Tax invoices keep the full name, as the law needs. */}
        <div><div className="inv-shop">{estimate ? initials(shop.name) : shop.name}</div>{!estimate && <div className="inv-sub">{shop.tagline}</div>}
          {!estimate && <div className="inv-sub">{[shop.address, shop.phone, shop.email].filter(Boolean).join(" · ")}</div>}
          {shop.gstin && taxDoc && <div className="inv-sub">GSTIN: <b>{shop.gstin}</b>{shop.state ? " · State: " + shop.state + (shopCode ? " (" + shopCode + ")" : "") : ""}</div>}</div>
        <div className="inv-title">{title}{estimate && <div className="inv-approval">APPROVAL CHALLAN</div>}{copy && <div className="inv-copy">{copy}</div>}{b.status === "void" && <div className="inv-void">CANCELLED</div>}
          {notExecuted && <div><span className="inv-notexec">SALE NOT EXECUTED · बिक्री निष्पादित नहीं</span></div>}</div>
      </div>
      {b.compliance && format !== "packing" && <div className="inv-compliance">
        {b.compliance.irn && <><div>{b.compliance.irn.sandbox ? "SANDBOX · " : ""}IRN: {b.compliance.irn.id}{b.compliance.irn.cancelled_at ? " · CANCELLED" : ""}</div><div>Acknowledgement: {b.compliance.irn.ack_no} · {b.compliance.irn.generated_at}</div>{b.compliance.irn.signed_qr && !b.compliance.irn.cancelled_at && <span className="signed-qr" dangerouslySetInnerHTML={{ __html: qrSvg(b.compliance.irn.signed_qr).svg }} />}</>}
        {b.compliance.ewb && <div>{b.compliance.ewb.sandbox ? "SANDBOX · " : ""}EWB: {b.compliance.ewb.id}{b.compliance.ewb.cancelled_at ? " · CANCELLED" : ""}</div>}
      </div>}
      {notExecuted && (!thermal || estimate) && <div className="inv-wm" aria-hidden="true">
        <span>{estimate && <>ESTIMATE<br /></>}SALE NOT EXECUTED{!thermal && <><br />बिक्री निष्पादित नहीं</>}</span>
      </div>}
      <div className="inv-meta">
        <div><b>{docName(b)} No:</b> {b.no || "(draft)"}{b.bill_type === "estimate" && b.inv_no ? <> · <b>Invoice No:</b> {b.inv_no}</> : null}<br /><b>Date:</b> {new Date(b.at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          {b.salesman ? <><br /><b>Salesman:</b> {b.salesman}</> : null}{b.helper ? <><br /><b>Helper:</b> {b.helper}</> : null}{b.packed_by ? <><br /><b>Packed by:</b> {b.packed_by}</> : null}{b.checked_by ? <><br /><b>Rechecked by:</b> {b.checked_by}</> : null}
          {b.return_of_no ? <><br /><b>Against:</b> {b.return_of_no}</> : null}
          {b.merged_from?.length ? <><br /><b>Covers:</b> {b.merged_from.length} earlier {b.merged_from.length > 1 ? "documents" : "document"}</> : null}</div>
        <div><b>Party:</b> {b.party_name || "Cash"}{b.party_phone ? " · " + b.party_phone : ""}{b.party_gstin ? <><br /><b>GSTIN:</b> {b.party_gstin}</> : null}{b.party_address ? <><br />{b.party_address}</> : null}{taxDoc && pos ? <><br /><b>Place of supply:</b> {pos}-{GST_STATES[pos]}</> : b.party_state ? <><br /><b>State:</b> {b.party_state}</> : null}</div>
      </div>
      <table className={"inv-t" + (thermal && !b.items.some(l => l.pkts) ? " no-pkt" : "")}>
        {/* the slip (owner, 27 Oct, photo of estimate EST/26CUJE0005): the blank heading over the item column read as
            "item name not written" — the slip now says "#" and "Item" too (replaces the 22 Oct blank heading) */}
        {/* the unit (PCS / PAIR / SET) has its own column before Qty, never a faint word under the item (owner, 22 Oct) */}
        <thead><tr><th>#</th><th>Box</th><th>{full && !thermal ? "Item / Style / Colour" : "Item"}</th><th className="r">Pkt</th><th>Unit</th><th className="r">Qty</th>{prices && <><th className="r">Rate</th><th className="r">Amount</th></>}</tr></thead>
        <tbody>
          {thermal ? boxes.map(box => <ReceiptBox key={box} b={b} box={box} prices={prices} narrow={format === "58mm"} full={full} />) :
          b.items.map((l, i) => (
            <tr key={l.id}><td>{i + 1}</td><td>{l.box_no}</td>
              <td><b>{l.item}</b>{full && <> {l.style} <span className="inv-c">{l.color}</span></>}{l.disc && prices ? <span className="inv-c"> · disc {l.disc}</span> : null}</td>
              <td className="r">{l.pkts ? `${l.pkts}×${l.pack}` : ""}</td><td>{l.type || "PCS"}</td><td className="r">{l.qty}</td>
              {prices && <><td className="r">{(l.rate / 100).toFixed(2)}</td><td className="r">{(l.amount / 100).toFixed(2)}</td></>}</tr>))}
        </tbody>
      </table>
      <div className="inv-foot">
        <div className="inv-left">
          <div><b>Total quantity:</b> {b.total_qty} · <b>Boxes:</b> {b.box_count}{b.carry_bags ? <> · <b>Carry bags:</b> {b.carry_bags}</> : null}</div>
          {format === "packing" && <div className="inv-boxes">{boxes.map(x => <span key={x}>Box {x}: {b.items.filter(l => l.box_no === x).reduce((a, l) => a + l.qty, 0)} pcs</span>)}</div>}
          {estimate && <div className="inv-sub">Approval challan · Not a tax invoice.</div>}
          {b.bill_type === "challan" && <div className="inv-sub">Goods sent on approval / for delivery. Not a tax invoice — the invoice follows.</div>}
          {taxDoc && prices && (byHsn.length > 1
            ? <div className="inv-sub">{byHsn.map(h => <span key={h.hsn + h.rate} style={{ display: "block" }}>HSN {h.hsn} · GST {pct(h.rate)}% · taxable {billAmount(h.taxable)}</span>)}{b.gst_mode === "inclusive" ? "(GST included in rates)" : ""}</div>
            : <div className="inv-sub">HSN {byHsn[0]?.hsn || shop.hsn} · GST {pct(byRate[0]?.rate ?? b.gst_rate)}% {b.gst_mode === "inclusive" ? "(included in rates)" : ""} · Reverse charge: No</div>)}
          {narration && <div style={{ whiteSpace: "pre-wrap" }}><b>Remarks:</b> {narration}</div>}
          {shop.bank && prices && <div className="inv-sub">Bank: {shop.bank}</div>}
          {upi && prices && <div className="row" style={{ gap: 6, alignItems: "center" }}><span className="inv-qr" dangerouslySetInnerHTML={{ __html: upi }} /><span className="inv-sub">Scan to pay {billAmount(d)}<br />UPI: {shop.upi}</span></div>}
        </div>
        {prices && <table className="inv-sum"><tbody>
          <tr><td>Gross</td><td className="r">{billAmount(b.gross)}</td></tr>
          {b.discount ? <tr><td>Discount{b.discount_pct ? ` ${b.discount_pct}%` : ""}{b.less_pct ? ` + less ${b.less_pct}%` : ""}</td><td className="r">-{billAmount(b.discount)}</td></tr> : null}
          {b.packing ? <tr><td>Packing</td><td className="r">{billAmount(b.packing)}</td></tr> : null}
          {taxDoc && b.gst ? <tr><td>Taxable value</td><td className="r">{billAmount(b.net - b.adjust - b.gst)}</td></tr> : null}
          {byRate.map(g => <Fragment key={g.rate}>{g.cgst ? <tr key={"c" + g.rate}><td>CGST {pct(g.rate / 2)}%</td><td className="r">{billAmount(g.cgst)}</td></tr> : null}
            {g.sgst ? <tr key={"s" + g.rate}><td>SGST {pct(g.rate / 2)}%</td><td className="r">{billAmount(g.sgst)}</td></tr> : null}
            {g.igst ? <tr key={"i" + g.rate}><td>IGST {pct(g.rate)}%</td><td className="r">{billAmount(g.igst)}</td></tr> : null}</Fragment>)}
          {b.adjust ? <tr><td>Round off</td><td className="r">{billAmount(b.adjust)}</td></tr> : null}
          <tr className="inv-net"><td>{b.bill_type === "return" ? "CREDIT" : b.bill_type === "challan" ? "VALUE" : "NET"}</td><td className="r">{billAmount(b.net)}</td></tr>
          {b.advance ? <tr><td>Advance</td><td className="r">-{billAmount(b.advance)}</td></tr> : null}
          {b.paid ? <tr><td>Paid ({b.payments.filter(p => p.mode !== "credit").map(p => p.mode.toUpperCase()).join("+")})</td><td className="r">-{billAmount(b.paid)}</td></tr> : null}
          {money && d > 0 ? <tr className="inv-net"><td>Balance</td><td className="r">{billAmount(d)}</td></tr> : null}
          {money && d < 0 ? <tr><td>Excess received</td><td className="r">{billAmount(-d)}</td></tr> : null}
          {/* wholesale: what the party owed before this bill, and what they owe now in all */}
          {money && b.bill_type !== "return" && b.prev_due ? <>
            <tr><td>Previous balance</td><td className="r">{billAmount(b.prev_due)}</td></tr>
            <tr className="inv-net"><td>Total due</td><td className="r">{billAmount(b.prev_due + d)}</td></tr></> : null}
        </tbody></table>}
      </div>
      {/* Estimates and challans end at the totals (owner's request). A GST tax invoice keeps the
          supplier's signature line, which CGST Rule 46 requires; its terms come from Settings. */}
      {taxDoc && <div className="inv-terms">{shop.terms}<span>For {shop.name}{!thermal ? <><br /><br />Authorised signatory</> : null}</span></div>}
      {/* blank paper so the last line has come out past the tear bar / cutter (Settings › Printing) */}
      {thermal && feed > 0 && <div className="inv-feed" aria-hidden="true" style={{ height: feed + "mm" }} />}
    </div>
  );
}

/* Owner, 26 Oct (voice): on the roll printer every bill comes out as separate cut slips —
     1. the bill, handed to the customer;
     2. a small tag for each carry bag ("BAG 1 OF 2", name, bill no.), stuck outside the bag like a
        Swiggy / Zomato ticket;
     3. a cash-counter slip with the customer's name, bill no. and the amount, handed to the cashier.
   Each slip is its own print job: the printer cuts at the end of every job (Settings › Printing › cutter). */
export type RollSlips = { tags: boolean; cash: boolean };
export type RollSlip = { kind: "tag"; n: number } | { kind: "cash" };
export function rollSlips(b: Bill, format: PrintFormat, want?: RollSlips): RollSlip[] {
  if (!want || (format !== "80mm" && format !== "58mm") || !b.no || b.status !== "final" || b.bill_type === "return") return [];
  const out: RollSlip[] = [];
  if (want.tags) for (let n = 1; n <= carryBags(b); n++) out.push({ kind: "tag", n });
  if (want.cash && b.bill_type !== "challan") out.push({ kind: "cash" });
  return out;
}

/* How many copies of a tax invoice (Settings › Printing), read before anything prints so the job starts once. */
export function PrintBill(props: { b: Bill; shop: Shop; format: PrintFormat; onDone: () => void; slips?: RollSlips }) {
  const [copies, setCopies] = useState<number | null>(null);
  const [feed, setFeed] = useState<number | null>(null);
  useEffect(() => {
    getSetting<number>("invoice_copies", 1).then(n => setCopies(Number(n) || 1)).catch(() => setCopies(1));
    getSetting<number>("receipt_feed", DEFAULT_RECEIPT_FEED).then(n => setFeed(receiptFeed(n))).catch(() => setFeed(DEFAULT_RECEIPT_FEED));
  }, []);
  return copies === null || feed === null ? null : <PrintBillNow {...props} copies={copies} feed={feed} />;
}

function PrintBillNow({ b, shop, format, onDone, copies = 1, feed = 0, slips }: { b: Bill; shop: Shop; format: PrintFormat; onDone: () => void; copies?: number; feed?: number; slips?: RollSlips }) {
  const [extra] = useState(() => rollSlips(b, format, slips));
  const [step, setStep] = useState(0);   // 0 = the bill, then each extra slip in turn
  usePrintJob(true, () => step < extra.length ? setStep(step + 1) : onDone(), b.id + format + copies + "#" + step, message => toast(message, true));
  // copies are for numbered tax invoices on sheets; a receipt, slip or estimate prints once
  const n = (format === "a4" || format === "a5") && b.bill_type === "gst" && b.no ? Math.max(1, Math.min(3, copies)) : 1;
  const width = format === "58mm" ? 58 : 80;
  const slip = step > 0 ? extra[step - 1] : undefined;
  const sheets = slip ? (slip.kind === "tag" ? <BagTag b={b} shop={shop} n={slip.n} width={width} feed={feed} /> : <CashSlip b={b} shop={shop} width={width} feed={feed} />) :
    n === 1 ? <InvoiceSheet b={b} shop={shop} format={format} feed={feed} /> :
    <>{COPY_NAMES.slice(0, n).map((c, i) => <div key={c} className="inv-copy-page" style={{ breakAfter: i < n - 1 ? "page" : "auto", pageBreakAfter: i < n - 1 ? "always" : "auto" }}><InvoiceSheet b={b} shop={shop} format={format} copy={c} /></div>)}</>;
  const what = !slip ? (extra.length ? `bill (1 of ${extra.length + 1})` : "") : slip.kind === "tag" ? `bag tag ${slip.n} of ${carryBags(b)} (${step + 1} of ${extra.length + 1})` : `cash counter slip (${step + 1} of ${extra.length + 1})`;
  return <>{createPortal(<Fragment key={step}>{sheets}</Fragment>, document.getElementById("printroot")!)}<div className="print-notice" role="status">Print prepared · {b.no}{what ? " · " + what : ""}<button className="btn sm" onClick={onDone}>Close print</button></div></>;
}

/** One slip on the roll: measured to its own length, blank paper after it so it clears the cutter. */
function RollSlipSheet({ width, feed, className, children }: { width: number; feed: number; className: string; children: ReactNode }) {
  return <div style={{ page: "rj-receipt" }} className={"inv thermal slip " + (width === 58 ? "narrow " : "") + className}>
    <style data-thermal-width={String(width)}>{"@page rj-receipt{size:auto;margin:2mm}"}</style>
    {children}
    {feed > 0 && <div className="inv-feed" aria-hidden="true" style={{ height: feed + "mm" }} />}
  </div>;
}
const slipDate = (at: string) => new Date(at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const slipShop = (b: Bill, shop: Shop) => b.bill_type === "estimate" ? initials(shop.name) : shop.name;

/** The tag stuck outside a carry bag: whose bag, which bill, bag n of N. Its QR scans back to the bill. */
export function BagTag({ b, shop, n, width = 80, feed = 0 }: { b: Bill; shop: Shop; n: number; width?: number; feed?: number }) {
  const total = carryBags(b);
  const qr = qrSvg(bagPayload({ billId: b.id, number: n })).svg;
  return <RollSlipSheet width={width} feed={feed} className="slip-tag">
    <div className="slip-head"><span>{slipShop(b, shop)}</span><span>BAG TAG</span></div>
    <div className="slip-big">BAG {n} OF {total}</div>
    <div className="slip-name">{b.party_name || "Walk-in / cash"}</div>
    {b.party_phone && <div className="slip-c">{b.party_phone}</div>}
    <div className="slip-row"><span>{docName(b)} No: <b>{b.no}</b></span><span>{slipDate(b.at)}</span></div>
    <div className="slip-row"><span>Items: <b>{b.items.length}</b> lines</span><span>Qty: <b>{b.total_qty}</b></span></div>
    {(b.packed_by || b.checked_by) && <div className="slip-row">{b.packed_by && <span>Packed: {b.packed_by}</span>}{b.checked_by && <span>Checked: {b.checked_by}</span>}</div>}
    <span className="slip-qr" dangerouslySetInnerHTML={{ __html: qr }} />
  </RollSlipSheet>;
}

/** The slip the billing counter hands to the cash counter: who, which bill, how much to collect. */
export function CashSlip({ b, shop, width = 80, feed = 0 }: { b: Bill; shop: Shop; width?: number; feed?: number }) {
  const d = due(b);
  return <RollSlipSheet width={width} feed={feed} className="slip-cash">
    <div className="slip-head"><span>{slipShop(b, shop)}</span><span>CASH COUNTER</span></div>
    <div className="slip-name">{b.party_name || "Walk-in / cash"}</div>
    {b.party_phone && <div className="slip-c">{b.party_phone}</div>}
    <div className="slip-row"><span>{docName(b)} No: <b>{b.no}</b></span><span>{slipDate(b.at)}</span></div>
    {b.salesman && <div className="slip-row"><span>Salesman: {b.salesman}</span></div>}
    <div className="slip-row"><span>Qty: <b>{b.total_qty}</b></span><span>Carry bags: <b>{carryBags(b)}</b></span></div>
    <div className="slip-amt"><span>Bill amount</span><b>{billAmount(b.net)}</b></div>
    {b.advance ? <div className="slip-amt"><span>Advance</span><span>-{billAmount(b.advance)}</span></div> : null}
    {b.paid ? <div className="slip-amt"><span>Paid ({b.payments.filter(p => p.mode !== "credit").map(p => p.mode.toUpperCase()).join("+")})</span><span>-{billAmount(b.paid)}</span></div> : null}
    <div className="slip-collect"><span>{d > 0 ? "TO COLLECT" : d < 0 ? "RETURN" : "PAID"}</span><span>{billAmount(Math.abs(d))}</span></div>
    {b.prev_due ? <div className="slip-amt"><span>Previous balance</span><span>{billAmount(b.prev_due)}</span></div> : null}
  </RollSlipSheet>;
}

function ReceiptBox({ b, box, prices, narrow, full }: { b: Bill; box: number; prices: boolean; narrow: boolean; full: boolean }) {
  const lines = b.items.filter(l => l.box_no === box);
  const columns = prices ? narrow ? 5 : 7 : narrow ? 3 : 5;   // the columns that show (Box is hidden on the roll; # and Pkt on 58 mm)
  return <><tr className="receipt-box"><td colSpan={columns}>Box No.: {box}</td></tr>
    {lines.map(l => <tr key={l.id}><td>{b.items.indexOf(l) + 1}</td><td>{box}</td><td><b>{l.item}</b>{full && (l.style || l.color) ? <div className="inv-c">{[l.style, l.color].filter(Boolean).join(" · ")}</div> : null}{l.disc && prices ? <div className="inv-c">disc {l.disc}</div> : null}</td><td className="r">{l.pkts ? `${l.pkts}×${l.pack}` : ""}</td><td>{l.type || "PCS"}</td><td className="r">{l.qty}</td>{prices && <><td className="r">{(l.rate / 100).toFixed(2)}</td><td className="r">{(l.amount / 100).toFixed(2)}</td></>}</tr>)}
    <tr className="receipt-box"><td colSpan={columns}>Box qty: {lines.reduce((n, l) => n + l.qty, 0)}</td></tr></>;
}

/** "RUNGNNA JEWELLERY & CO" → "RJ": what an estimate shows instead of the shop's name. */
export function initials(name: string) {
  const words = (name || "").split(/\s+/).filter(w => /^[A-Za-z]/.test(w) && !/^(and|co\.?|company|pvt\.?|ltd\.?|private|limited)$/i.test(w));
  return (words.slice(0, 3).map(w => w[0]).join("") || name || "").toUpperCase();
}
