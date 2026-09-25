import { useEffect } from "react";
import { createPortal } from "react-dom";
import type { Bill } from "../lib/db";
import { due, type Shop } from "../lib/billing";
import { rupees } from "../lib/format";
import { qrSvg } from "../lib/qr";

export type PrintFormat = "a5" | "a4" | "80mm" | "packing";

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
  const upi = shop.upi && d > 0 ? qrSvg(`upi://pay?pa=${shop.upi}&pn=${encodeURIComponent(shop.name)}&am=${(d / 100).toFixed(2)}&cu=INR&tn=${encodeURIComponent(b.no)}`).svg : "";
  const prices = format !== "packing";
  const title = format === "packing" ? "PACKING SLIP" : b.bill_type === "gst" ? "TAX INVOICE" : "ESTIMATE";
  const boxes = [...new Set(b.items.map(l => l.box_no))].sort((a, z) => a - z);
  const page = format === "80mm" ? "80mm auto" : format === "a4" ? "A4" : "A5";
  return (
    <div className={"inv " + (format === "80mm" ? "thermal" : "")}>
      <style>{`@page{size:${page};margin:${format === "80mm" ? "2mm" : "8mm"}}`}</style>
      <div className="inv-head">
        <div><div className="inv-shop">{shop.name}</div><div className="inv-sub">{shop.tagline}</div>
          <div className="inv-sub">{[shop.address, shop.phone].filter(Boolean).join(" · ")}</div>
          {shop.gstin && b.bill_type === "gst" && <div className="inv-sub">GSTIN: <b>{shop.gstin}</b>{shop.state ? " · State: " + shop.state : ""}</div>}</div>
        <div className="inv-title">{title}{b.status === "void" && <div className="inv-void">CANCELLED</div>}</div>
      </div>
      <div className="inv-meta">
        <div><b>{b.bill_type === "gst" ? "Invoice" : "Estimate"} No:</b> {b.no || "(draft)"}<br /><b>Date:</b> {new Date(b.at).toLocaleString("en-IN")}</div>
        <div><b>Party:</b> {b.party_name || "Cash"}{b.party_phone ? " · " + b.party_phone : ""}{b.party_gstin ? <><br /><b>GSTIN:</b> {b.party_gstin}</> : null}{b.party_state ? <><br /><b>State:</b> {b.party_state}</> : null}</div>
      </div>
      <table className="inv-t">
        <thead><tr><th>#</th><th>Box</th><th>Item / Style / Colour</th><th className="r">Pkt</th><th className="r">Pcs</th>{prices && <><th className="r">Rate</th><th className="r">Amount</th></>}</tr></thead>
        <tbody>
          {b.items.map((l, i) => (
            <tr key={l.id}><td>{i + 1}</td><td>{l.box_no}</td>
              <td><b>{l.item}</b> {l.style} <span className="inv-c">{l.color}</span>{l.disc ? <span className="inv-c"> · disc {l.disc}</span> : null}</td>
              <td className="r">{l.pkts ? `${l.pkts}×${l.pack}` : ""}</td><td className="r">{l.qty}</td>
              {prices && <><td className="r">{(l.rate / 100).toFixed(2)}</td><td className="r">{(l.amount / 100).toFixed(2)}</td></>}</tr>))}
        </tbody>
      </table>
      <div className="inv-foot">
        <div className="inv-left">
          <div><b>Total pieces:</b> {b.total_qty} · <b>Boxes:</b> {b.box_count}</div>
          {format === "packing" && <div className="inv-boxes">{boxes.map(x => <span key={x}>Box {x}: {b.items.filter(l => l.box_no === x).reduce((a, l) => a + l.qty, 0)} pcs</span>)}</div>}
          {prices && <div className="inv-words">{inWords(b.net)}</div>}
          {b.bill_type === "gst" && prices && <div className="inv-sub">HSN {shop.hsn} · GST {b.gst_rate}% {b.gst_mode === "inclusive" ? "(included in rates)" : ""}</div>}
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
          <tr className="inv-net"><td>NET</td><td className="r">{rupees(b.net)}</td></tr>
          {b.advance ? <tr><td>Advance</td><td className="r">-{rupees(b.advance)}</td></tr> : null}
          {b.paid ? <tr><td>Paid ({b.payments.filter(p => p.mode !== "credit").map(p => p.mode.toUpperCase()).join("+")})</td><td className="r">-{rupees(b.paid)}</td></tr> : null}
          {d > 0 ? <tr className="inv-net"><td>Balance</td><td className="r">{rupees(d)}</td></tr> : null}
        </tbody></table>}
      </div>
      <div className="inv-terms">{shop.terms}<span>For {shop.name}</span></div>
    </div>
  );
}

export function PrintBill({ b, shop, format, onDone }: { b: Bill; shop: Shop; format: PrintFormat; onDone: () => void }) {
  useEffect(() => { const t = setTimeout(() => { window.print(); onDone(); }, 200); return () => clearTimeout(t); }, []);
  return createPortal(<InvoiceSheet b={b} shop={shop} format={format} />, document.getElementById("printroot")!);
}
