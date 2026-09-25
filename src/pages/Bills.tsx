import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type Bill, type Payment } from "../lib/db";
import { due, getShop, voidBill, convertToGst, shareBill, billText, waLink, deleteEstimates, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { usePrivate, visibleBill, lockNow } from "../lib/privacy";
import { Icon } from "../components/Icon";
import { Modal, Switch } from "../components/common";
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
  const { me } = useApp();
  const open = usePrivate();
  const [range, setRange] = useState(0);
  const [type, setType] = useState<"" | "gst" | "estimate">("");
  const [status, setStatus] = useState<"" | "final" | "void" | "hold" | "converted">("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [del, setDel] = useState<Bill[] | null>(null);
  const since = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - range); return d.toISOString(); }, [range]);
  const bills = useLiveQuery(() => db.bills.where("at").aboveOrEqual(since).reverse().sortBy("at"), [since], []);
  useEffect(() => { if (!open) { setSel(new Set()); if (type === "estimate") setType(""); } }, [open]);
  const list = bills.filter(b => visibleBill(b, open) && (!type || b.bill_type === type) && (!status || b.status === status) &&
    (!q || (b.no + " " + b.party_name + " " + b.party_phone).toLowerCase().includes(q.toLowerCase())));
  const fin = list.filter(b => b.status === "final");
  const sum = (f: (b: Bill) => number) => fin.reduce((a, b) => a + f(b), 0);
  const ests = list.filter(b => b.bill_type === "estimate");
  const manage = open && can(me, "void");
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div>
      <Head title="Bills" sub={open ? "Estimates are showing. They hide again when you lock or leave the app." : "Every bill stays on record. Cancelled bills are kept and marked."}>
        {open && <button className="btn" onClick={() => lockNow()}><Icon n="lock" size={16} />Lock</button>}
        <button className="btn p" onClick={() => go("bill")}><Icon n="plus" size={18} />New bill</button>
      </Head>
      <div className={"grid " + (open ? "g4" : "g3")} style={{ marginBottom: 12 }}>
        <div className="tile"><div className="k">Sales</div><div className="v">{rupees(sum(b => b.net))}</div><div className="xs mut">{fin.length} bills</div></div>
        <div className="tile"><div className="k">GST invoices</div><div className="v">{rupees(fin.filter(b => b.bill_type === "gst").reduce((a, b) => a + b.net, 0))}</div><div className="xs mut">GST {rupees(sum(b => b.gst))}</div></div>
        {open && <div className="tile"><div className="k">Estimates</div><div className="v">{rupees(fin.filter(b => b.bill_type === "estimate").reduce((a, b) => a + b.net, 0))}</div><div className="xs mut">{fin.filter(b => b.bill_type === "estimate").length} bills</div></div>}
        <div className="tile"><div className="k">Credit given</div><div className="v" style={{ color: "var(--rose)" }}>{rupees(sum(b => Math.max(0, due(b))))}</div><div className="xs mut">{sum(b => b.total_qty)} pieces sold</div></div>
      </div>
      <div className="card pad stack" style={{ marginBottom: 12 }}>
        <div className="row">
          <div className="chips">{RANGES.map(([l, n]) => <button key={l} className="chip" aria-pressed={range === n} onClick={() => setRange(n)}>{l}</button>)}</div>
          {open && <select className="in" style={{ width: "auto" }} value={type} onChange={e => setType(e.target.value as any)}><option value="">All types</option><option value="gst">GST</option><option value="estimate">Estimates</option></select>}
          <select className="in" style={{ width: "auto" }} value={status} onChange={e => setStatus(e.target.value as any)}><option value="">All status</option><option value="final">Final</option><option value="hold">On hold</option><option value="void">Cancelled</option>{open && <option value="converted">Converted</option>}</select>
          <input className="in grow" placeholder="Bill no, customer, phone" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {manage && ests.length > 0 && <div className="row">
          <span className="sm mut grow">{sel.size ? `${sel.size} estimate${sel.size > 1 ? "s" : ""} selected` : "Tick estimates to delete them, or delete every estimate shown."}</span>
          {sel.size > 0 && <button className="btn sm bad" onClick={() => setDel(ests.filter(b => sel.has(b.id)))}>Delete selected</button>}
          <button className="btn sm bad" onClick={() => setDel(ests)}>Delete all {ests.length} estimates shown</button>
        </div>}
      </div>
      <div className="card tw"><table>
        <thead><tr>{manage && <th style={{ width: 36 }} />}<th>Bill</th><th>Customer</th><th>When</th><th className="r">Pcs</th><th className="r">Net</th><th className="r">Due</th><th>Status</th></tr></thead>
        <tbody>{list.map(b => (
          <tr key={b.id} className="click" onClick={() => go(b.status === "hold" ? "bill/" + b.id : "bills/" + b.id)}>
            {manage && <td onClick={e => e.stopPropagation()}>{b.bill_type === "estimate" && <input type="checkbox" style={{ width: 18, height: 18 }} checked={sel.has(b.id)} onChange={() => toggle(b.id)} aria-label="Select estimate" />}</td>}
            <td className="mono">{open && <span className={"pill " + (b.bill_type === "gst" ? "ok" : "")}>{b.bill_type === "gst" ? "GST" : "EST"}</span>} {b.no || "—"}</td>
            <td>{b.party_name || "Walk-in"}<div className="xs mut">{b.party_phone}</div></td>
            <td className="xs">{when(b.at)}</td><td className="r mono">{b.total_qty}</td><td className="r mono b">{rupees(b.net)}</td>
            <td className="r mono" style={{ color: due(b) > 0 && b.status === "final" ? "var(--rose)" : undefined }}>{b.status === "final" && due(b) > 0 ? rupees(due(b)) : ""}</td>
            <td><span className={"pill " + (b.status === "void" ? "bad" : b.status === "hold" ? "warn" : b.status === "final" ? "ok" : "")}>{b.status === "void" ? "cancelled" : b.status}</span></td>
          </tr>))}
          {!list.length && <tr><td colSpan={8} className="empty">No bills in this range.</td></tr>}
        </tbody></table></div>
      {del && <DeleteEstimates bills={del} onClose={() => { setDel(null); setSel(new Set()); }} />}
    </div>
  );
}

function DeleteEstimates({ bills, onClose }: { bills: Bill[]; onClose: () => void }) {
  const { me } = useApp();
  const [back, setBack] = useState(false);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const total = bills.reduce((a, b) => a + b.net, 0);
  const paid = bills.filter(b => b.paid || b.advance).length;
  const word = bills.length > 1 ? "DELETE" : "YES";
  return (
    <Modal title={`Delete ${bills.length} estimate${bills.length > 1 ? "s" : ""}`} onClose={onClose}>
      <div className="stack">
        <div className="sm">{bills.length} estimate{bills.length > 1 ? "s" : ""} worth <b>{rupees(total)}</b> will be removed from every device and the cloud. This cannot be undone.</div>
        {paid > 0 && <div className="note warn sm">{paid} of them have payments recorded. Those payments disappear with them, which changes the customer's balance.</div>}
        <Switch on={back} onChange={setBack} label="Put the pieces back on the racks" hint="Turn on only if the goods never left the shop (a quotation). Leave off if they were delivered." />
        <label className="f">Type {word} to confirm<input className="in mono" value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} /></label>
        <button className="btn bad big" disabled={typed !== word || busy} onClick={async () => {
          setBusy(true);
          const n = await deleteEstimates(bills, back, me?.name || "");
          toast(`${n} estimate${n > 1 ? "s" : ""} deleted${back ? " · pieces back on racks" : ""}`); onClose();
        }}>{busy ? "Deleting…" : "Delete permanently"}</button>
      </div>
    </Modal>
  );
}

function BillView({ id }: { id: string }) {
  const { me } = useApp();
  const b = useLiveQuery(() => db.bills.get(id), [id]);
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [printing, setPrinting] = useState<PrintFormat | null>(null);
  const [payAmt, setPayAmt] = useState("");
  useEffect(() => { getShop().then(setShop); }, []);
  const openP = usePrivate();
  if (!b) return <div className="card pad">Loading…</div>;
  if (!visibleBill(b, openP)) return <div className="card empty"><b>Not available</b>This bill can't be opened here.</div>;
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
