import { usePrintJob } from "../lib/printing";
import { createPortal } from "react-dom";
import type { Bill } from "../lib/db";
import { due, docName, type Shop } from "../lib/billing";
import { rupees } from "../lib/format";
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

export function InvoiceSheet({ b, shop, format }: { b: Bill; shop: Shop; format: PrintFormat }) {
  const d = due(b);
  const money = b.bill_type !== "challan" && b.bill_type !== "return"; // no "pay now" on a challan or credit note
  const upi = money && shop.upi && d > 0 ? qrSvg(`upi://pay?pa=${shop.upi}&pn=${encodeURIComponent(shop.name)}&am=${(d / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(b.no)}`).svg : "";
  const prices = format !== "packing";
  const title = format === "packing" ? "PACKING SLIP" : docName(b).toUpperCase();
  const boxes = [...new Set(b.items.map(l => l.box_no))].sort((a, z) => a - z);
  const thermal = format === "80mm" || format === "58mm";
  const page = thermal ? "auto" : format === "a4" ? "A4" : "A5";
  return (
    <div className={"inv " + (thermal ? "thermal " : "") + (format === "58mm" ? "narrow" : "")}>
      <style data-thermal-width={thermal ? format.slice(0, 2) : undefined}>{`@page{size:${page};margin:${thermal ? "2mm" : "8mm"}}`}</style>
      <div className="inv-head">
        <div><div className="inv-shop">{shop.name}</div><div className="inv-sub">{shop.tagline}</div>
          <div className="inv-sub">{[shop.address, shop.phone].filter(Boolean).join(" · ")}</div>
          {shop.gstin && (b.bill_type === "gst" || (b.bill_type === "return" && b.src_type === "gst")) && <div className="inv-sub">GSTIN: <b>{shop.gstin}</b>{shop.state ? " · State: " + shop.state : ""}</div>}</div>
        <div className="inv-title">{title}{b.status === "void" && <div className="inv-void">CANCELLED</div>}</div>
      </div>
      {b.compliance && format !== "packing" && <div className="inv-compliance">
        {b.compliance.irn && <><div>{b.compliance.irn.sandbox ? "SANDBOX · " : ""}IRN: {b.compliance.irn.id}{b.compliance.irn.cancelled_at ? " · CANCELLED" : ""}</div><div>Acknowledgement: {b.compliance.irn.ack_no} · {b.compliance.irn.generated_at}</div>{b.compliance.irn.signed_qr && !b.compliance.irn.cancelled_at && <span className="signed-qr" dangerouslySetInnerHTML={{ __html: qrSvg(b.compliance.irn.signed_qr).svg }} />}</>}
        {b.compliance.ewb && <div>{b.compliance.ewb.sandbox ? "SANDBOX · " : ""}EWB: {b.compliance.ewb.id}{b.compliance.ewb.cancelled_at ? " · CANCELLED" : ""}</div>}
      </div>}
      <div className="inv-meta">
        <div><b>{docName(b)} No:</b> {b.no || "(draft)"}<br /><b>Date:</b> {new Date(b.at).toLocaleString("en-IN")}
          {b.return_of_no ? <><br /><b>Against:</b> {b.return_of_no}</> : null}
          {b.merged_from?.length ? <><br /><b>Covers:</b> {b.merged_from.length} earlier {b.merged_from.length > 1 ? "documents" : "document"}</> : null}</div>
        <div><b>Party:</b> {b.party_name || "Cash"}{b.party_phone ? " · " + b.party_phone : ""}{b.party_gstin ? <><br /><b>GSTIN:</b> {b.party_gstin}</> : null}{b.party_state ? <><br /><b>State:</b> {b.party_state}</> : null}</div>
      </div>
      <table className="inv-t">
        <thead><tr><th>#</th><th>Box</th><th>Item / Style / Colour</th><th className="r">Pkt</th><th className="r">Qty</th>{prices && <><th className="r">Rate</th><th className="r">Amount</th></>}</tr></thead>
        <tbody>
          {thermal ? boxes.map(box => <ReceiptBox key={box} b={b} box={box} prices={prices} narrow={format === "58mm"} />) :
          b.items.map((l, i) => (
            <tr key={l.id}><td>{i + 1}</td><td>{l.box_no}</td>
              <td><b>{l.item}</b> {l.style} <span className="inv-c">{l.color} · {l.type}</span>{l.disc ? <span className="inv-c"> · disc {l.disc}</span> : null}</td>
              <td className="r">{l.pkts ? `${l.pkts}×${l.pack}` : ""}</td><td className="r">{l.qty}</td>
              {prices && <><td className="r">{(l.rate / 100).toFixed(2)}</td><td className="r">{(l.amount / 100).toFixed(2)}</td></>}</tr>))}
        </tbody>
      </table>
      <div className="inv-foot">
        <div className="inv-left">
          <div><b>Total quantity:</b> {b.total_qty} · <b>Boxes:</b> {b.box_count}</div>
          {format === "packing" && <div className="inv-boxes">{boxes.map(x => <span key={x}>Box {x}: {b.items.filter(l => l.box_no === x).reduce((a, l) => a + l.qty, 0)} pcs</span>)}</div>}
          {prices && <div className="inv-words">{b.bill_type === "return" ? "Credit: " : ""}{inWords(b.net)}</div>}
          {b.bill_type === "challan" && <div className="inv-sub">Goods sent on approval / for delivery. Not a tax invoice — the invoice follows.</div>}
          {(b.bill_type === "gst" || (b.bill_type === "return" && b.src_type === "gst")) && prices && <div className="inv-sub">HSN {shop.hsn} · GST {b.gst_rate}% {b.gst_mode === "inclusive" ? "(included in rates)" : ""}</div>}
          {b.remarks && <div><b>Remarks:</b> {b.remarks}</div>}
          {shop.bank && prices && <div className="inv-sub">Bank: {shop.bank}</div>}
          {upi && prices && <div className="row" style={{ gap: 6, alignItems: "center" }}><span className="inv-qr" dangerouslySetInnerHTML={{ __html: upi }} /><span className="inv-sub">Scan to pay {rupees(d)}<br />UPI: {shop.upi}</span></div>}
        </div>
        {prices && <table className="inv-sum"><tbody>
          <tr><td>Gross</td><td className="r">{rupees(b.gross)}</td></tr>
          {b.discount ? <tr><td>Discount{b.discount_pct ? ` ${b.discount_pct}%` : ""}</td><td className="r">-{rupees(b.discount)}</td></tr> : null}
          {b.packing ? <tr><td>Packing</td><td className="r">{rupees(b.packing)}</td></tr> : null}
          {b.cgst ? <tr><td>CGST {b.gst_rate / 2}%</td><td className="r">{rupees(b.cgst)}</td></tr> : null}
          {b.sgst ? <tr><td>SGST {b.gst_rate / 2}%</td><td className="r">{rupees(b.sgst)}</td></tr> : null}
          {b.igst ? <tr><td>IGST {b.gst_rate}%</td><td className="r">{rupees(b.igst)}</td></tr> : null}
          {b.adjust ? <tr><td>Round off</td><td className="r">{rupees(b.adjust)}</td></tr> : null}
          <tr className="inv-net"><td>{b.bill_type === "return" ? "CREDIT" : b.bill_type === "challan" ? "VALUE" : "NET"}</td><td className="r">{rupees(b.net)}</td></tr>
          {b.advance ? <tr><td>Advance</td><td className="r">-{rupees(b.advance)}</td></tr> : null}
          {b.paid ? <tr><td>Paid ({b.payments.filter(p => p.mode !== "credit").map(p => p.mode.toUpperCase()).join("+")})</td><td className="r">-{rupees(b.paid)}</td></tr> : null}
          {money && d > 0 ? <tr className="inv-net"><td>Balance</td><td className="r">{rupees(d)}</td></tr> : null}
        </tbody></table>}
      </div>
      <div className="inv-terms">{shop.terms}<span>For {shop.name}</span></div>
    </div>
  );
}

export function PrintBill({ b, shop, format, onDone }: { b: Bill; shop: Shop; format: PrintFormat; onDone: () => void }) {
  usePrintJob(true, onDone, b.id + format, message => toast(message, true));
  return <>{createPortal(<InvoiceSheet b={b} shop={shop} format={format} />, document.getElementById("printroot")!)}<div className="print-notice" role="status">Print prepared · {b.no}<button className="btn sm" onClick={onDone}>Close print</button></div></>;
}

function ReceiptBox({ b, box, prices, narrow }: { b: Bill; box: number; prices: boolean; narrow: boolean }) {
  const lines = b.items.filter(l => l.box_no === box);
  const columns = prices ? narrow ? 4 : 6 : narrow ? 2 : 4;
  return <><tr className="receipt-box"><td colSpan={columns}>Box No.: {box}</td></tr>
    {lines.map(l => <tr key={l.id}><td>{b.items.indexOf(l) + 1}</td><td>{box}</td><td><b>{l.item}</b><div className="inv-c">{[l.style, l.color, l.type].filter(Boolean).join(" · ")}{l.disc ? ` · disc ${l.disc}` : ""}</div></td><td className="r">{l.pkts ? `${l.pkts}×${l.pack}` : ""}</td><td className="r">{l.qty}</td>{prices && <><td className="r">{(l.rate / 100).toFixed(2)}</td><td className="r">{(l.amount / 100).toFixed(2)}</td></>}</tr>)}
    <tr className="receipt-box"><td colSpan={columns}>Box qty: {lines.reduce((n, l) => n + l.qty, 0)}</td></tr></>;
}
