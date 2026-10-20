import { Fragment, useEffect, useState } from "react";
import { getSetting } from "../lib/db";
import { usePrintJob } from "../lib/printing";
import { createPortal } from "react-dom";
import type { Bill } from "../lib/db";
import { due, docName, taxSummary, type Shop } from "../lib/billing";
import { placeCode, GST_STATES } from "../lib/states";
import { billAmount } from "../lib/format";
import { qrSvg } from "../lib/qr";
import { toast } from "../lib/app";

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

export function InvoiceSheet({ b, shop, format, copy }: { b: Bill; shop: Shop; format: PrintFormat; copy?: string }) {
  const d = due(b);
  const money = b.bill_type !== "challan" && b.bill_type !== "return"; // no "pay now" on a challan or credit note
  const upi = money && shop.upi && d > 0 ? qrSvg(`upi://pay?pa=${shop.upi}&pn=${encodeURIComponent(shop.name)}&am=${(d / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(b.no)}`).svg : "";
  const prices = format !== "packing";
  const estimate = prices && b.bill_type === "estimate";
  const title = format === "packing" ? "PACKING SLIP" : docName(b).toUpperCase();
  const boxes = [...new Set(b.items.map(l => l.box_no))].sort((a, z) => a - z);
  const thermal = format === "80mm" || format === "58mm";
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
        <div><div className="inv-shop">{shop.name}</div><div className="inv-sub">{shop.tagline}</div>
          <div className="inv-sub">{[shop.address, shop.phone].filter(Boolean).join(" · ")}</div>
          {shop.gstin && taxDoc && <div className="inv-sub">GSTIN: <b>{shop.gstin}</b>{shop.state ? " · State: " + shop.state + (shopCode ? " (" + shopCode + ")" : "") : ""}</div>}</div>
        <div className="inv-title">{title}{estimate && <div className="inv-approval">APPROVAL CHALLAN</div>}{copy && <div className="inv-copy">{copy}</div>}{b.status === "void" && <div className="inv-void">CANCELLED</div>}
          {notExecuted && <div><span className="inv-notexec">SALE NOT EXECUTED · बिक्री निष्पादित नहीं</span></div>}</div>
      </div>
      {b.compliance && format !== "packing" && <div className="inv-compliance">
        {b.compliance.irn && <><div>{b.compliance.irn.sandbox ? "SANDBOX · " : ""}IRN: {b.compliance.irn.id}{b.compliance.irn.cancelled_at ? " · CANCELLED" : ""}</div><div>Acknowledgement: {b.compliance.irn.ack_no} · {b.compliance.irn.generated_at}</div>{b.compliance.irn.signed_qr && !b.compliance.irn.cancelled_at && <span className="signed-qr" dangerouslySetInnerHTML={{ __html: qrSvg(b.compliance.irn.signed_qr).svg }} />}</>}
        {b.compliance.ewb && <div>{b.compliance.ewb.sandbox ? "SANDBOX · " : ""}EWB: {b.compliance.ewb.id}{b.compliance.ewb.cancelled_at ? " · CANCELLED" : ""}</div>}
      </div>}
      {notExecuted && (!thermal || estimate) && <div className="inv-wm" aria-hidden="true">
        <span>{estimate && <>ESTIMATE{!thermal && <br />}</>}{!thermal && <>SALE NOT EXECUTED<br />बिक्री निष्पादित नहीं</>}</span>
      </div>}
      <div className="inv-meta">
        <div><b>{docName(b)} No:</b> {b.no || "(draft)"}<br /><b>Date:</b> {new Date(b.at).toLocaleString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
          {b.salesman ? <><br /><b>Salesman:</b> {b.salesman}</> : null}{b.helper ? <><br /><b>Helper:</b> {b.helper}</> : null}
          {b.return_of_no ? <><br /><b>Against:</b> {b.return_of_no}</> : null}
          {b.merged_from?.length ? <><br /><b>Covers:</b> {b.merged_from.length} earlier {b.merged_from.length > 1 ? "documents" : "document"}</> : null}</div>
        <div><b>Party:</b> {b.party_name || "Cash"}{b.party_phone ? " · " + b.party_phone : ""}{b.party_gstin ? <><br /><b>GSTIN:</b> {b.party_gstin}</> : null}{b.party_address ? <><br />{b.party_address}</> : null}{taxDoc && pos ? <><br /><b>Place of supply:</b> {pos}-{GST_STATES[pos]}</> : b.party_state ? <><br /><b>State:</b> {b.party_state}</> : null}</div>
      </div>
      <table className="inv-t">
        <thead><tr><th>#</th><th>Box</th><th>Item / Style / Colour</th><th className="r">Pkt</th><th className="r">Qty</th>{prices && <><th className="r">Rate</th><th className="r">Amount</th></>}</tr></thead>
        <tbody>
          {thermal ? boxes.map(box => <ReceiptBox key={box} b={b} box={box} prices={prices} narrow={format === "58mm"} />) :
          b.items.map((l, i) => (
            <tr key={l.id}><td>{i + 1}</td><td>{l.box_no}</td>
              <td><b>{l.item}</b> {l.style} <span className="inv-c">{[l.color, l.type].filter(Boolean).join(" · ")}</span>{l.disc && prices ? <span className="inv-c"> · disc {l.disc}</span> : null}</td>
              <td className="r">{l.pkts ? `${l.pkts}×${l.pack}` : ""}</td><td className="r">{l.qty}</td>
              {prices && <><td className="r">{(l.rate / 100).toFixed(2)}</td><td className="r">{(l.amount / 100).toFixed(2)}</td></>}</tr>))}
        </tbody>
      </table>
      <div className="inv-foot">
        <div className="inv-left">
          <div><b>Total quantity:</b> {b.total_qty} · <b>Boxes:</b> {b.box_count}</div>
          {format === "packing" && <div className="inv-boxes">{boxes.map(x => <span key={x}>Box {x}: {b.items.filter(l => l.box_no === x).reduce((a, l) => a + l.qty, 0)} pcs</span>)}</div>}
          {estimate && <div className="inv-sub">Approval challan · Not a tax invoice.</div>}
          {b.bill_type === "challan" && <div className="inv-sub">Goods sent on approval / for delivery. Not a tax invoice — the invoice follows.</div>}
          {taxDoc && prices && (byHsn.length > 1
            ? <div className="inv-sub">{byHsn.map(h => <span key={h.hsn + h.rate} style={{ display: "block" }}>HSN {h.hsn} · GST {pct(h.rate)}% · taxable {billAmount(h.taxable)}</span>)}{b.gst_mode === "inclusive" ? "(GST included in rates)" : ""}</div>
            : <div className="inv-sub">HSN {byHsn[0]?.hsn || shop.hsn} · GST {pct(byRate[0]?.rate ?? b.gst_rate)}% {b.gst_mode === "inclusive" ? "(included in rates)" : ""} · Reverse charge: No</div>)}
          {b.remarks && <div><b>Remarks:</b> {b.remarks}</div>}
          {shop.bank && prices && <div className="inv-sub">Bank: {shop.bank}</div>}
          {upi && prices && <div className="row" style={{ gap: 6, alignItems: "center" }}><span className="inv-qr" dangerouslySetInnerHTML={{ __html: upi }} /><span className="inv-sub">Scan to pay {billAmount(d)}<br />UPI: {shop.upi}</span></div>}
        </div>
        {prices && <table className="inv-sum"><tbody>
          <tr><td>Gross</td><td className="r">{billAmount(b.gross)}</td></tr>
          {b.discount ? <tr><td>Discount{b.discount_pct ? ` ${b.discount_pct}%` : ""}</td><td className="r">-{billAmount(b.discount)}</td></tr> : null}
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
    </div>
  );
}

/* How many copies of a tax invoice (Settings › Printing), read before anything prints so the job starts once. */
export function PrintBill(props: { b: Bill; shop: Shop; format: PrintFormat; onDone: () => void }) {
  const [copies, setCopies] = useState<number | null>(null);
  useEffect(() => { getSetting<number>("invoice_copies", 1).then(n => setCopies(Number(n) || 1)).catch(() => setCopies(1)); }, []);
  return copies === null ? null : <PrintBillNow {...props} copies={copies} />;
}

function PrintBillNow({ b, shop, format, onDone, copies = 1 }: { b: Bill; shop: Shop; format: PrintFormat; onDone: () => void; copies?: number }) {
  usePrintJob(true, onDone, b.id + format + copies, message => toast(message, true));
  // copies are for numbered tax invoices on sheets; a receipt, slip or estimate prints once
  const n = (format === "a4" || format === "a5") && b.bill_type === "gst" && b.no ? Math.max(1, Math.min(3, copies)) : 1;
  const sheets = n === 1 ? <InvoiceSheet b={b} shop={shop} format={format} /> :
    <>{COPY_NAMES.slice(0, n).map((c, i) => <div key={c} className="inv-copy-page" style={{ breakAfter: i < n - 1 ? "page" : "auto", pageBreakAfter: i < n - 1 ? "always" : "auto" }}><InvoiceSheet b={b} shop={shop} format={format} copy={c} /></div>)}</>;
  return <>{createPortal(sheets, document.getElementById("printroot")!)}<div className="print-notice" role="status">Print prepared · {b.no}<button className="btn sm" onClick={onDone}>Close print</button></div></>;
}

function ReceiptBox({ b, box, prices, narrow }: { b: Bill; box: number; prices: boolean; narrow: boolean }) {
  const lines = b.items.filter(l => l.box_no === box);
  const columns = prices ? narrow ? 4 : 6 : narrow ? 2 : 4;
  return <><tr className="receipt-box"><td colSpan={columns}>Box No.: {box}</td></tr>
    {lines.map(l => <tr key={l.id}><td>{b.items.indexOf(l) + 1}</td><td>{box}</td><td><b>{l.item}</b><div className="inv-c">{[l.style, l.color, l.type].filter(Boolean).join(" · ")}{l.disc && prices ? ` · disc ${l.disc}` : ""}</div></td><td className="r">{l.pkts ? `${l.pkts}×${l.pack}` : ""}</td><td className="r">{l.qty}</td>{prices && <><td className="r">{(l.rate / 100).toFixed(2)}</td><td className="r">{(l.amount / 100).toFixed(2)}</td></>}</tr>)}
    <tr className="receipt-box"><td colSpan={columns}>Box qty: {lines.reduce((n, l) => n + l.qty, 0)}</td></tr></>;
}
