import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type Bill, type Payment } from "../lib/db";
import { due, getShop, voidBill, convertToGst, shareBill, billText, waLink, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { useApp, toast, go } from "../lib/app";
import { can } from "../lib/roles";
import { rupees, toPaise, when } from "../lib/format";
import { Head, Thumb } from "../components/common";
import { VoiceNotes } from "../components/Voice";
import { InvoiceSheet, PrintBill, type PrintFormat } from "../components/Invoice";

export default function Bills({ args }: { args: string[] }) {
  return args[0] ? <BillView id={args[0]} /> : <BillList />;
}

const RANGES: [string, number][] = [["Today", 0], ["7 days", 7], ["30 days", 30], ["All", 99999]];

function BillList() {
  const [range, setRange] = useState(0);
  const [type, setType] = useState<"" | "gst" | "estimate">("");
  const [status, setStatus] = useState<"" | "final" | "void" | "hold" | "converted">("");
  const [q, setQ] = useState("");
  const since = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - range); return d.toISOString(); }, [range]);
  const bills = useLiveQuery(() => db.bills.where("at").aboveOrEqual(since).reverse().sortBy("at"), [since], []);
  const list = bills.filter(b => !b.deleted && (!type || b.bill_type === type) && (!status || b.status === status) &&
    (!q || (b.no + " " + b.party_name + " " + b.party_phone).toLowerCase().includes(q.toLowerCase())));
  const fin = list.filter(b => b.status === "final");
  const sum = (f: (b: Bill) => number) => fin.reduce((a, b) => a + f(b), 0);
  return (
    <div>
      <Head eyebrow="Sales register" title="Bills" sub="Every bill ever made stays here. Cancelled bills are kept and marked, never deleted.">
        <button className="btn p" onClick={() => go("bill")}>+ New bill · F2</button>
      </Head>
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <div className="tile"><div className="k">Sales</div><div className="v">{rupees(sum(b => b.net))}</div><div className="xs mut">{fin.length} bills</div></div>
        <div className="tile"><div className="k">GST invoices</div><div className="v">{rupees(fin.filter(b => b.bill_type === "gst").reduce((a, b) => a + b.net, 0))}</div><div className="xs mut">GST {rupees(sum(b => b.gst))}</div></div>
        <div className="tile"><div className="k">Estimates</div><div className="v">{rupees(fin.filter(b => b.bill_type === "estimate").reduce((a, b) => a + b.net, 0))}</div><div className="xs mut">{fin.filter(b => b.bill_type === "estimate").length} bills</div></div>
        <div className="tile"><div className="k">Credit given</div><div className="v" style={{ color: "var(--rose)" }}>{rupees(sum(b => Math.max(0, due(b))))}</div><div className="xs mut">{sum(b => b.total_qty)} pieces sold</div></div>
      </div>
      <div className="card pad stack" style={{ marginBottom: 12 }}>
        <div className="row">
          <div className="chips">{RANGES.map(([l, n]) => <button key={l} className="chip" aria-pressed={range === n} onClick={() => setRange(n)}>{l}</button>)}</div>
          <select className="in" style={{ width: "auto" }} value={type} onChange={e => setType(e.target.value as any)}><option value="">All types</option><option value="gst">GST</option><option value="estimate">Estimate</option></select>
          <select className="in" style={{ width: "auto" }} value={status} onChange={e => setStatus(e.target.value as any)}><option value="">All status</option><option value="final">Final</option><option value="hold">On hold</option><option value="void">Cancelled</option><option value="converted">Converted</option></select>
          <input className="in grow" placeholder="Bill no, customer, phone" value={q} onChange={e => setQ(e.target.value)} />
        </div>
      </div>
      <div className="card tw"><table>
        <thead><tr><th>Bill</th><th>Customer</th><th>When</th><th className="r">Pcs</th><th className="r">Net</th><th className="r">Due</th><th>Status</th></tr></thead>
        <tbody>{list.map(b => (
          <tr key={b.id} className="click" onClick={() => go(b.status === "hold" ? "bill/" + b.id : "bills/" + b.id)}>
            <td className="mono"><span className={"pill " + (b.bill_type === "gst" ? "ok" : "")}>{b.bill_type === "gst" ? "GST" : "EST"}</span> {b.no || "—"}</td>
            <td>{b.party_name || "Walk-in"}<div className="xs mut">{b.party_phone}</div></td>
            <td className="xs">{when(b.at)}</td><td className="r mono">{b.total_qty}</td><td className="r mono b">{rupees(b.net)}</td>
            <td className="r mono" style={{ color: due(b) > 0 && b.status === "final" ? "var(--rose)" : undefined }}>{b.status === "final" && due(b) > 0 ? rupees(due(b)) : ""}</td>
            <td><span className={"pill " + (b.status === "void" ? "bad" : b.status === "hold" ? "warn" : b.status === "final" ? "ok" : "")}>{b.status === "void" ? "cancelled" : b.status}</span></td>
          </tr>))}
          {!list.length && <tr><td colSpan={7} className="mut" style={{ padding: 20 }}>No bills in this range.</td></tr>}
        </tbody></table></div>
    </div>
  );
}

function BillView({ id }: { id: string }) {
  const { me } = useApp();
  const b = useLiveQuery(() => db.bills.get(id), [id]);
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [printing, setPrinting] = useState<PrintFormat | null>(null);
  const [payAmt, setPayAmt] = useState("");
  useEffect(() => { getShop().then(setShop); }, []);
  if (!b) return <div className="card pad">Loading…</div>;
  const d = due(b);
  const boss = can(me, "void");
  const addPayment = async (mode: Payment["mode"]) => {
    const amt = toPaise(payAmt || String(d / 100)); if (!amt) return;
    await put("bills", { ...b, payments: [...b.payments, { mode, amount: amt, ref: "Received " + new Date().toLocaleDateString("en-IN") }], paid: b.paid + amt });
    setPayAmt(""); toast("Payment recorded");
  };
  return (
    <div>
      <Head eyebrow={b.bill_type === "gst" ? "Tax invoice" : "Estimate"} title={b.no || "Draft"} sub={`${b.party_name || "Walk-in"} · ${when(b.at)} · ${b.status === "void" ? "CANCELLED" : b.status}`}>
        <button className="btn" onClick={() => setPrinting("a5")}>Print A5</button>
        <button className="btn" onClick={() => setPrinting("80mm")}>Thermal</button>
        <button className="btn" onClick={() => setPrinting("packing")}>Packing slip</button>
        <button className="btn g" onClick={() => shareBill(b, shop)}>WhatsApp</button>
      </Head>
      <div className="split">
        <div className="card pad" style={{ overflow: "auto" }}><div className="inv-preview"><InvoiceSheet b={b} shop={shop} format="a5" /></div></div>
        <div className="stack">
          {b.status === "final" && d > 0 && <div className="card"><header><h3>Receive payment</h3><span className="pill bad">Due {rupees(d)}</span></header>
            <div className="pad stack"><input className="in mono" inputMode="decimal" placeholder={String(d / 100)} value={payAmt} onChange={e => setPayAmt(e.target.value)} />
              <div className="chips">{(["cash", "upi", "card", "bank"] as const).map(m => <button key={m} className="chip" onClick={() => addPayment(m)}>{m.toUpperCase()}</button>)}</div>
              {b.party_phone && <a className="btn sm" target="_blank" rel="noreferrer" href={waLink(b.party_phone, `Namaste ${b.party_name}, a gentle reminder: ${rupees(d)} is pending on bill ${b.no}.${shop.upi ? `\nUPI: upi://pay?pa=${shop.upi}&am=${(d / 100).toFixed(2)}&cu=INR` : ""}\n— ${shop.name}`)}>💬 Send payment reminder</a>}
            </div></div>}
          <div className="card"><header><h3>Actions</h3></header>
            <div className="pad stack">
              {b.status === "final" && b.bill_type === "estimate" && <button className="btn p" onClick={async () => {
                if (!confirm("Make a GST invoice for this estimate? The estimate stays on record as 'converted'.")) return;
                const g = await convertToGst(b, shop, me?.id || ""); toast("GST invoice " + g.no); go("bills/" + g.id);
              }}>Convert to GST invoice</button>}
              {b.status === "final" && (boss ? <button className="btn bad" onClick={async () => {
                const r = prompt("Reason for cancelling this bill (kept on record):"); if (!r) return;
                await voidBill(b, r, me?.name || ""); toast("Bill cancelled — pieces returned to their racks");
              }}>Cancel bill (void)</button> : <div className="xs mut">Only the owner or a manager can cancel a bill.</div>)}
              <button className="btn" onClick={() => { navigator.clipboard?.writeText(billText(b, shop)); toast("Bill text copied"); }}>Copy bill text</button>
              {b.converted_from && <a className="btn sm" href={"#/bills/" + b.converted_from}>Open original estimate</a>}
              {b.converted_to && <a className="btn sm" href={"#/bills/" + b.converted_to}>Open GST invoice</a>}
              {b.void_reason && <div className="note bad sm">Cancelled: {b.void_reason}</div>}
            </div></div>
          {(b.photo_id || b.photo_url) && <div className="card pad"><b className="sm">Parcel photo</b><div style={{ marginTop: 8 }}><Thumb photo_id={b.photo_id} url={b.photo_url} size={200} /></div></div>}
          <div className="card pad"><VoiceNotes entity="bill" entityId={b.id} /></div>
        </div>
      </div>
      {printing && <PrintBill b={b} shop={shop} format={printing} onDone={() => setPrinting(null)} />}
    </div>
  );
}
