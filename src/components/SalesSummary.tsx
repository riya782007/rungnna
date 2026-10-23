import { useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting, type Bill, type Party } from "../lib/db";
import { inStore } from "../lib/scope";
import { isSale, fy, counterCode, type Shop } from "../lib/billing";
import { isOpen } from "../lib/privacy";
import { usePrintJob } from "../lib/printing";
import { inWords } from "./Invoice";
import { rupees } from "../lib/format";
import { toast } from "../lib/app";

/* Owner, 23 Oct (the "SALES SUMMARY SA/2627/PL/3782" page his supplier's Invoke software sends him): one page
   that lists a customer's estimates for the days chosen, shows the 3% tax on them and takes it off again
   ("GST LESS"), with the amount in words and a narration. The estimates themselves are unchanged. */
const ymd = (d: Date) => d.toISOString().slice(0, 10);
export function SalesSummaryButton({ party, shop }: { party: Party; shop: Shop }) {
  const today = ymd(new Date());
  const [open, setOpen] = useState(false), [from, setFrom] = useState(today), [to, setTo] = useState(today), [narration, setNarration] = useState("");
  const [doc, setDoc] = useState<{ no: string; bills: Bill[] } | null>(null);
  const bills = useLiveQuery(async () => {
    const a = new Date(from + "T00:00:00").toISOString(), b = new Date(new Date(to + "T00:00:00").getTime() + 86400000).toISOString();
    return (await db.bills.where("party_id").equals(party.id).toArray())
      .filter(x => inStore(x) && !x.deleted && x.status === "final" && isSale(x) && x.at >= a && x.at < b && (isOpen() || x.bill_type !== "estimate"))
      .sort((x, y) => (x.at < y.at ? -1 : 1));
  }, [party.id, from, to], [] as Bill[]);
  usePrintJob(!!doc, () => setDoc(null));
  const start = async () => {
    if (!bills.length) return toast("No bills for these days", true);
    const f = fy(), cc = await counterCode(), key = `seq_SA_${f}_${cc}`, n = (await getSetting<number>(key, 0)) + 1;
    await setSetting(key, n);
    setDoc({ no: `SA/${f.replace(/\D/g, "").slice(0, 4)}/${cc}/${n}`, bills });
  };
  const total = (doc?.bills || bills).reduce((a, b) => a + b.net, 0);
  const rate = shop.gst_rate || 3, tax = Math.round(total * rate / 100);
  const same = !party.state || !shop.state || party.state.trim().toUpperCase() === shop.state.trim().toUpperCase();
  return <>
    <button className="btn sm" onClick={() => setOpen(o => !o)}>Sales summary</button>
    {open && <div className="note stack" style={{ marginTop: 8 }}>
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="f">From<input className="in" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
        <label className="f">To<input className="in" type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
      </div>
      <label className="f">Narration (optional)<input className="in" value={narration} onChange={e => setNarration(e.target.value)} placeholder="e.g. 5400 DEL AT SUHAG" /></label>
      <div className="sm">{bills.length} bill{bills.length === 1 ? "" : "s"} · {rupees(total)}</div>
      <button className="btn p" disabled={!bills.length} onClick={() => void start()}>Print sales summary</button>
    </div>}
    {doc && createPortal(<div className="inv sales-summary">
      <style>{"@page{size:A4;margin:10mm}"}</style>
      <div className="inv-head"><div><div className="inv-title">SALES SUMMARY # {doc.no}</div><div className="inv-sub">Date {new Date().toLocaleDateString("en-IN")} · Total Amount {rupees(total)}</div></div>
        <div className="inv-shop">M/S {shop.name}{doc.bills.some(b => b.bill_type === "estimate") ? " - ESTIMATE" : ""}</div></div>
      <div className="inv-meta"><div><b>Bill To</b><br /><b>{party.name}</b><br />{[party.address, party.city].filter(Boolean).join(", ")}<br />{party.phone}{party.gstin ? <><br />GSTIN: {party.gstin}</> : null}</div></div>
      <b>Vouchers</b>
      <table className="inv-t"><thead><tr><th>Sr.</th><th>Date</th><th>{doc.bills.every(b => b.bill_type === "estimate") ? "Estimate No" : "Bill No"}</th><th>Narration</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
        <tbody>{doc.bills.map((b, i) => <tr key={b.id}><td>{i + 1}</td><td>{new Date(b.at).toLocaleDateString("en-IN")}</td><td>{b.no}{b.inv_no ? ` · ${b.inv_no}` : ""}</td><td>{b.remarks || ""}</td><td style={{ textAlign: "right" }}>{(b.net / 100).toFixed(2)}</td></tr>)}</tbody></table>
      <div className="inv-foot">
        <table className="inv-t"><thead><tr><th>HSN</th><th>Tax</th><th>IGST</th><th>SGST</th><th>CGST</th></tr></thead>
          <tbody><tr><td>{shop.hsn || "711719"}</td><td>{(tax / 100).toFixed(0)} ({rate}%)</td><td>{same ? "0" : (tax / 100).toFixed(0)}</td><td>{same ? (tax / 200).toFixed(2) : "0"} ({rate / 2}%)</td><td>{same ? (tax / 200).toFixed(2) : "0"} ({rate / 2}%)</td></tr></tbody></table>
        <table className="inv-sum"><tbody>
          <tr><td>Total Estimate</td><td style={{ textAlign: "right" }}>{rupees(total)}</td></tr>
          <tr><td>Total Tax</td><td style={{ textAlign: "right" }}>{rupees(tax)}</td></tr>
          <tr><td>GST LESS</td><td style={{ textAlign: "right" }}>-{rupees(tax)}</td></tr>
          <tr className="inv-net"><td>Total Amount</td><td style={{ textAlign: "right" }}>{rupees(total)}</td></tr>
        </tbody></table>
      </div>
      <div><b>Amount in Words</b> {inWords(total)}</div>
      {narration && <div><b>Narration</b> {narration}</div>}
    </div>, document.getElementById("printroot")!)}
  </>;
}
