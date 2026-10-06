import { useEffect, useMemo, useState } from "react";
import { usePrintJob } from "../lib/printing";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting, type Bill } from "../lib/db";
import { eodReport, modesTotal, type Modes } from "../lib/eod";
import { localDay } from "../lib/ledger";
import { getShop, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { usePrivate } from "../lib/privacy";
import { rupees, toPaise } from "../lib/format";
import { Modal } from "./common";
import { inStore, currentStore } from "../lib/scope";

const MODES: (keyof Modes)[] = ["cash", "upi", "card", "bank"];

/* End-of-day report: sales by mode, estimates apart (only when unlocked), returns, receipts, closing cash. Printable. */
export function EndOfDay({ onClose }: { onClose: () => void }) {
  const open = usePrivate();
  const [day, setDay] = useState(localDay(new Date().toISOString()));
  const [opening, setOpening] = useState("");
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [printing, setPrinting] = useState(false);
  useEffect(() => { getShop().then(setShop); }, []);
  const openingKey = "eod_open_" + currentStore() + "_" + day;
  useEffect(() => { getSetting<number>(openingKey, 0).then(v => setOpening(v ? String(v / 100) : "")); }, [openingKey]);
  const start = new Date(day + "T00:00").toISOString(), end = new Date(new Date(day + "T00:00").getTime() + 864e5).toISOString();
  // bills made that day, plus any bill touched since (a payment taken that day on an older bill)
  const bills = useLiveQuery(async () => {
    const [a, b] = await Promise.all([db.bills.where("at").between(start, end).toArray(), db.bills.where("updated_at").aboveOrEqual(start).toArray()]);
    const m = new Map<string, Bill>(); [...a, ...b].filter(x => inStore(x)).forEach(x => m.set(x.id, x)); return [...m.values()];
  }, [start, end], []);
  const receipts = useLiveQuery(() => db.receipts.where("at").between(start, end).filter(inStore).toArray(), [start, end], []);
  const vouchers = useLiveQuery(() => db.vouchers.where("at").between(start, end).filter(inStore).toArray(), [start, end], []);
  const r = useMemo(() => eodReport(bills, receipts, day, toPaise(opening), open, vouchers), [bills, receipts, vouchers, day, opening, open]);
  usePrintJob(printing, () => setPrinting(false));
  const isToday = day === localDay(new Date().toISOString());
  const nice = new Date(day + "T00:00").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  const body = (print: boolean) => (
    <div className={print ? "inv" : "stack"} style={print ? undefined : { gap: 10 }}>
      {print && <><style>{"@page{size:A5;margin:8mm}"}</style>
        <div className="inv-head"><div><div className="inv-shop">{shop.name}</div><div className="inv-sub">{nice}</div></div><div className="inv-title">END OF DAY</div></div></>}
      <div className={print ? "" : "eod-wrap"}><table className={print ? "inv-t" : "eod-t"} style={{ width: "100%" }}>
        <thead><tr><th style={{ textAlign: "left" }} /><th className="r">Bills</th>{MODES.map(m => <th key={m} className="r">{m.toUpperCase()}</th>)}<th className="r">Credit</th><th className="r">Total</th></tr></thead>
        <tbody>
          <SalesRow name="GST invoices" p={r.gst} />
          {r.est && <SalesRow name="Estimates" p={r.est} />}
          {modesTotal(r.orders) > 0 && <ModeRow name="Advance on orders" m={r.orders} />}
          {modesTotal(r.later) > 0 && <ModeRow name="Paid on older bills" m={r.later} />}
          <ModeRow name={`Receipts (${r.receipts.count})`} m={r.receipts.modes} />
          {modesTotal(r.vouchers.in) > 0 && <ModeRow name="Receipt vouchers" m={r.vouchers.in} />}
          {modesTotal(r.vouchers.out) > 0 && <tr><td>Payment / expense vouchers ({r.vouchers.count})</td><td />{MODES.map(m => <td key={m} className="r mono">{r.vouchers.out[m] ? "−" + rupees(r.vouchers.out[m]) : ""}</td>)}<td /><td className="r mono">−{rupees(modesTotal(r.vouchers.out))}</td></tr>}
          {r.returns.count > 0 || modesTotal(r.returns.refunds) > 0 ? <tr><td>Returns ({r.returns.count}) · credit {rupees(r.returns.net)}</td><td />
            {MODES.map(m => <td key={m} className="r mono">{r.returns.refunds[m] ? "−" + rupees(r.returns.refunds[m]) : ""}</td>)}<td /><td className="r mono">{modesTotal(r.returns.refunds) ? "−" + rupees(modesTotal(r.returns.refunds)) : ""}</td></tr> : null}
        </tbody>
      </table></div>
      {r.challans.count > 0 && <div className="sm">Challans: {r.challans.count} · {r.challans.pcs} pcs sent out (no money)</div>}
      <table className={print ? "inv-sum" : "eod-t"} style={print ? undefined : { width: "100%" }}><tbody>
        <tr><td>Opening cash</td><td className="r mono">{rupees(r.opening)}</td></tr>
        <tr><td>+ Cash in</td><td className="r mono">{rupees(r.cashIn)}</td></tr>
        {r.cashOut ? <tr><td>− Cash refunds</td><td className="r mono">{rupees(r.cashOut)}</td></tr> : null}
        <tr className="inv-net"><td><b>Closing cash</b></td><td className="r mono"><b>{rupees(r.closing)}</b></td></tr>
        <tr><td>All money in today</td><td className="r mono">{rupees(r.collected)}</td></tr>
      </tbody></table>
      {print && <div className="inv-terms">Printed {new Date().toLocaleString("en-IN")}<span>Checked by ____________</span></div>}
    </div>
  );

  return (
    <Modal title="End of day" onClose={onClose}>
      <div className="stack">
        <div className="grid g2">
          <label className="f">Day<input className="in" type="date" value={day} max={localDay(new Date().toISOString())} onChange={e => e.target.value && setDay(e.target.value)} /></label>
          <label className="f">Opening cash ₹<input className="in mono" inputMode="decimal" placeholder="0" value={opening}
            onChange={e => { setOpening(e.target.value); setSetting(openingKey, toPaise(e.target.value)); }} /></label>
        </div>
        {body(false)}
        <div className="xs mut">Money is counted on the day it was received. Receipts against old dues are under Receipts.{isToday ? " Today's figures update as you bill." : ""}</div>
        <button className="btn p big" onClick={() => setPrinting(true)}>Print</button>
      </div>
      {printing && createPortal(body(true), document.getElementById("printroot")!)}
    </Modal>
  );
}

function SalesRow({ name, p }: { name: string; p: { count: number; net: number; received: Modes; credit: number } }) {
  return <tr><td>{name}<div className="xs mut">{rupees(p.net)} billed</div></td><td className="r mono">{p.count}</td>
    {MODES.map(m => <td key={m} className="r mono">{p.received[m] ? rupees(p.received[m]) : ""}</td>)}
    <td className="r mono" style={{ color: p.credit ? "var(--bad)" : undefined }}>{p.credit ? rupees(p.credit) : ""}</td><td className="r mono b">{rupees(modesTotal(p.received) + p.credit)}</td></tr>;
}
function ModeRow({ name, m }: { name: string; m: Modes }) {
  return <tr><td>{name}</td><td />{MODES.map(k => <td key={k} className="r mono">{m[k] ? rupees(m[k]) : ""}</td>)}<td /><td className="r mono b">{rupees(modesTotal(m))}</td></tr>;
}
