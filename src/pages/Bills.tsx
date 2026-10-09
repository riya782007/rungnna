import { useEffect, useMemo, useState } from "react";
import { fillBillNames } from "../lib/billing-products";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, getSetting, type Bill, type BillType, type Payment } from "../lib/db";
import { GstBill } from "../components/GstBill";
import { inStore } from "../lib/scope";
import { due, getShop, voidBill, convertToGst, shareBill, billText, waLink, deleteEstimates, totals, gstLabel, isSale, docName, docShort, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { canMerge, mergeable, mergeBills, mergeLines, splitBill, splittable, returnable, returnableBill, buildReturn, saveReturn } from "../lib/docs";
import { usePrivate, visibleBill, lockNow, isEstimate } from "../lib/privacy";
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
const STATUS_LABEL: Record<string, string> = { void: "cancelled", merged: "merged", converted: "converted", hold: "on hold", final: "final" };
const statusText = (b: Bill) => b.status === "merged" ? `${b.bill_type === "challan" ? "invoiced" : "merged"} into ${b.merged_into_no || "…"}` : STATUS_LABEL[b.status] || b.status;

function BillList() {
  const { me } = useApp();
  const open = usePrivate();
  const [range, setRange] = useState(0);
  const [type, setType] = useState<"" | BillType>("");
  const [status, setStatus] = useState<"" | Bill["status"]>("");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [del, setDel] = useState<Bill[] | null>(null);
  const [merge, setMerge] = useState<Bill[] | null>(null);
  const since = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - range); return d.toISOString(); }, [range]);
  const bills = useLiveQuery(() => db.bills.where("at").aboveOrEqual(since).reverse().sortBy("at"), [since], []);
  useEffect(() => { if (!open) { setSel(new Set()); if (type === "estimate") setType(""); } }, [open]);
  const list = bills.filter(b => inStore(b) && visibleBill(b, open) && (!type || b.bill_type === type) && (!status || b.status === status) &&
    (!q || (b.no + " " + b.party_name + " " + b.party_phone).toLowerCase().includes(q.toLowerCase())));
  const fin = list.filter(b => b.status === "final" && isSale(b));
  const sum = (f: (b: Bill) => number) => fin.reduce((a, b) => a + f(b), 0);
  const ests = list.filter(b => b.bill_type === "estimate");
  const cns = list.filter(b => b.status === "final" && b.bill_type === "return");
  const manage = open && can(me, "void");
  const canBill = can(me, "bill");
  const selected = bills.filter(b => sel.has(b.id));
  const selEsts = selected.filter(b => b.bill_type === "estimate");
  const allChallans = selected.length > 0 && selected.every(b => b.bill_type === "challan");
  const why = selected.length ? canMerge(selected) : null;
  const tickable = (b: Bill) => (canBill && mergeable(b)) || (manage && b.bill_type === "estimate");
  const toggle = (id: string) => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  return (
    <div>
      <Head title="Bills" sub={open ? "Estimates are showing. They hide again when you lock or leave the app." : "Every bill stays on record. Cancelled bills are kept and marked."}>
        {open && <button className="btn" onClick={() => lockNow()}><Icon n="lock" size={16} />Lock</button>}
        <button className="btn p" onClick={() => go("bill")}><Icon n="plus" size={18} />New bill</button>
      </Head>
      <div className={"grid " + (open ? "g4" : "g3")} style={{ marginBottom: 12 }}>
        <div className="tile"><div className="k">Sales</div><div className="v">{rupees(sum(b => b.net))}</div><div className="xs mut">{fin.length} bills{cns.length ? ` · returns ${rupees(cns.reduce((a, b) => a + b.net, 0))}` : ""}</div></div>
        <div className="tile"><div className="k">GST invoices</div><div className="v">{rupees(fin.filter(b => b.bill_type === "gst").reduce((a, b) => a + b.net, 0))}</div><div className="xs mut">GST {rupees(sum(b => b.gst))}</div></div>
        {open && <div className="tile"><div className="k">Estimates</div><div className="v">{rupees(fin.filter(b => b.bill_type === "estimate").reduce((a, b) => a + b.net, 0))}</div><div className="xs mut">{fin.filter(b => b.bill_type === "estimate").length} bills</div></div>}
        <div className="tile"><div className="k">Credit given</div><div className="v" style={{ color: "var(--rose)" }}>{rupees(sum(b => Math.max(0, due(b))))}</div><div className="xs mut">{sum(b => b.total_qty)} pieces sold</div></div>
      </div>
      <div className="card pad stack" style={{ marginBottom: 12 }}>
        <div className="row">
          <div className="chips">{RANGES.map(([l, n]) => <button key={l} className="chip" aria-pressed={range === n} onClick={() => setRange(n)}>{l}</button>)}</div>
          <select className="in" style={{ width: "auto" }} value={type} onChange={e => setType(e.target.value as any)}>
            <option value="">All types</option><option value="gst">GST invoices</option>{open && <option value="estimate">Estimates</option>}<option value="challan">Challans</option><option value="return">Credit notes</option></select>
          <select className="in" style={{ width: "auto" }} value={status} onChange={e => setStatus(e.target.value as any)}><option value="">All status</option><option value="final">Final</option><option value="hold">On hold</option><option value="merged">Merged / invoiced</option><option value="void">Cancelled</option>{open && <option value="converted">Converted</option>}</select>
          <input className="in grow" placeholder="Bill no, customer, phone" value={q} onChange={e => setQ(e.target.value)} />
        </div>
        {canBill && <div className="row">
          <span className="sm mut grow">{selected.length
            ? `${selected.length} selected${why && !(manage && selEsts.length === selected.length) ? " — " + why : ""}`
            : `Tick ${open ? "estimates, " : ""}held orders or challans of one customer to merge them into one invoice${manage ? ", or estimates to delete them" : ""}.`}</span>
          {selected.length > 0 && !why && <button className="btn sm p" onClick={() => setMerge(selected)}>{allChallans ? `Convert ${selected.length > 1 ? selected.length + " challans" : "challan"} to invoice` : "Merge into one invoice"}</button>}
          {manage && selEsts.length > 0 && selEsts.length === selected.length && <button className="btn sm bad" onClick={() => setDel(selEsts)}>Delete selected</button>}
          {selected.length > 0 && <button className="btn sm" onClick={() => setSel(new Set())}>Clear</button>}
          {manage && ests.length > 0 && !selected.length && <button className="btn sm bad" onClick={() => setDel(ests)}>Delete all {ests.length} estimates shown</button>}
        </div>}
      </div>
      <div className="card tw"><table>
        <thead><tr>{canBill && <th style={{ width: 36 }} />}<th>Bill</th><th>Customer</th><th>When</th><th className="r">Pcs</th><th className="r">Net</th><th className="r">Due</th><th>Status</th></tr></thead>
        <tbody>{list.map(b => (
          <tr key={b.id} className="click" onClick={() => go(b.status === "hold" ? "bill/" + b.id : "bills/" + b.id)}>
            {canBill && <td onClick={e => e.stopPropagation()}>{tickable(b) && <input type="checkbox" style={{ width: 18, height: 18 }} checked={sel.has(b.id)} onChange={() => toggle(b.id)} aria-label={"Select " + (b.no || "held bill")} />}</td>}
            <td className="mono">{(open || b.bill_type !== "gst") && <span className={"pill " + (b.bill_type === "gst" ? "ok" : b.bill_type === "return" ? "bad" : b.bill_type === "challan" ? "warn" : "")}>{docShort(b)}</span>} {b.no || "—"}</td>
            <td>{b.party_name || "Walk-in"}<div className="xs mut">{b.party_phone}</div></td>
            <td className="xs">{when(b.at)}</td><td className="r mono">{b.total_qty}</td>
            <td className="r mono b" style={b.bill_type === "return" ? { color: "var(--ok)" } : undefined}>{b.bill_type === "return" ? "−" : ""}{rupees(b.net)}</td>
            <td className="r mono" style={{ color: "var(--rose)" }}>{b.status === "final" && isSale(b) && due(b) > 0 ? rupees(due(b)) : ""}</td>
            <td><span className={"pill " + (b.status === "void" ? "bad" : b.status === "hold" ? "warn" : b.status === "final" ? "ok" : "")}>{statusText(b)}</span></td>
          </tr>))}
          {!list.length && <tr><td colSpan={8} className="empty">No bills in this range.</td></tr>}
        </tbody></table></div>
      {del && <DeleteEstimates bills={del} onClose={() => { setDel(null); setSel(new Set()); }} />}
      {merge && <MergeDialog sources={merge} onClose={() => setMerge(null)} onDone={b => { setMerge(null); setSel(new Set()); go("bills/" + b.id); }} />}
    </div>
  );
}

/* Merge several estimates / held orders / challans of one customer into one invoice (or convert challans). */
function MergeDialog({ sources, onClose, onDone }: { sources: Bill[]; onClose: () => void; onDone: (b: Bill) => void }) {
  const { me } = useApp();
  const open = usePrivate();
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [type, setType] = useState<BillType>("gst");
  const [busy, setBusy] = useState(false);
  useEffect(() => { getShop().then(setShop); }, []);
  const lines = useMemo(() => mergeLines(sources), [sources]);
  const preview = useMemo(() => totals({ ...sources[0], items: lines, bill_type: type, gst_rate: shop.gst_rate, gst_mode: shop.gst_mode, discount_pct: 0,
    discount: sources.reduce((a, s) => a + totals(s, shop.state, shop.gstin).discount, 0), packing: sources.reduce((a, s) => a + s.packing, 0) }, shop.state, shop.gstin), [sources, lines, type, shop]);
  const already = lines.filter(l => l.stock_done).reduce((a, l) => a + l.qty, 0);
  const challans = sources.every(s => s.bill_type === "challan");
  const run = async () => {
    setBusy(true);
    try { const b = await mergeBills(sources, type, shop, me?.id || ""); toast(`${docName(b)} ${b.no} made from ${sources.length} document${sources.length > 1 ? "s" : ""}`); onDone(b); }
    catch (e: any) { toast(e.message, true); setBusy(false); }
  };
  return (
    <Modal title={challans ? "Convert challans to invoice" : "Merge into one invoice"} onClose={onClose}>
      <div className="stack">
        <div className="sm"><b>{sources[0].party_name || "Walk-in"}</b> · {sources.map(s => s.no || "held order").join(", ")}</div>
        <div className="seg" role="group" aria-label="Make">
          <button aria-pressed={type === "gst"} onClick={() => setType("gst")}>GST invoice</button>
          {open && <button aria-pressed={type === "estimate"} onClick={() => setType("estimate")}>Estimate</button>}
        </div>
        <div className="row between sm"><span>{lines.length} lines (combined from {sources.reduce((a, s) => a + s.items.length, 0)})</span><b className="mono">{preview.total_qty} pcs</b></div>
        {preview.discount ? <div className="row between sm"><span>Discount carried over</span><span className="mono">−{rupees(preview.discount)}</span></div> : null}
        {preview.gst ? <div className="row between sm"><span>GST{gstLabel(preview)}</span><span className="mono">{rupees(preview.gst)}</span></div> : null}
        <div className="net"><span>NET</span><b>{rupees(preview.net)}</b></div>
        {preview.paid || sources.some(s => s.advance) ? <div className="xs mut">Payments and advances on the sources move to the new invoice.</div> : null}
        <div className="note sm">{already ? `${already} pieces already left the racks with the sources — they won't be taken off again. ` : ""}
          The sources stay on record, marked “{challans ? "invoiced" : "merged"} into” the new number. Cancelling the new invoice brings them back.</div>
        <button className="btn p big" disabled={busy} onClick={run}>{busy ? "Saving…" : `Make ${type === "gst" ? "GST invoice" : "estimate"}`}</button>
      </div>
    </Modal>
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
  const b = useLiveQuery(async () => { const bill = await db.bills.get(id); return bill ? fillBillNames(bill) : undefined; }, [id]);
  const related = useLiveQuery(() => db.bills.where("return_of").equals(id).filter(x => !x.deleted).toArray(), [id], []);
  const sources = useLiveQuery(async () => (b?.merged_from?.length ? ((await db.bills.bulkGet(b.merged_from)).filter(Boolean) as Bill[]) : []), [b?.merged_from?.join()], []);
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [printing, setPrinting] = useState<PrintFormat | null>(null);
  const [payAmt, setPayAmt] = useState("");
  const [split, setSplit] = useState(false);
  const [ret, setRet] = useState(false);
  const [conv, setConv] = useState(false);
  useEffect(() => { getShop().then(setShop); }, []);
  const openP = usePrivate();
  if (!b) return <div className="card pad">Loading…</div>;
  if (!inStore(b) || !visibleBill(b, openP)) return <div className="card empty"><b>Not available</b>This bill can't be opened here.</div>;
  const d = isSale(b) ? due(b) : 0;
  const boss = can(me, "void");
  const cns = related.filter(x => x.status === "final" && (openP || !isEstimate(x)));
  const addPayment = async (mode: Payment["mode"]) => {
    const amt = toPaise(payAmt || String(d / 100)); if (!amt) return;
    await put("bills", { ...b, payments: [...b.payments, { mode, amount: amt, ref: "Received " + new Date().toLocaleDateString("en-IN"), at: new Date().toISOString() }], paid: b.paid + amt });
    setPayAmt(""); toast("Payment recorded");
  };
  return (
    <div>
      <Head eyebrow={docName(b)} title={b.no || "Draft"} sub={`${b.party_name || "Walk-in"} · ${when(b.at)} · ${b.status === "void" ? "CANCELLED" : statusText(b)}`}>
        <button className="btn" onClick={() => setPrinting("a5")}>Print A5</button>
        <button className="btn" onClick={async () => setPrinting(await getSetting<PrintFormat>("thermal_width", "80mm"))}>Thermal</button>
        <button className="btn" onClick={() => setPrinting("packing")}>Packing slip</button>
        <button className="btn g" onClick={() => shareBill(b, shop)}>WhatsApp</button>
      </Head>
      <div className="split">
        <div className="card pad" style={{ overflow: "auto" }}><div className="inv-preview"><InvoiceSheet b={b} shop={shop} format="a5" /></div></div>
        <div className="stack">
          <GstBill b={b} shop={shop} />
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
              {b.bill_type === "challan" && mergeable(b) && <button className="btn p" onClick={() => setConv(true)}>Convert challan to invoice</button>}
              {returnableBill(b) && can(me, "bill") && <button className="btn" onClick={() => setRet(true)}>Sales return (credit note)</button>}
              {splittable(b) && b.items.length > 1 && can(me, "bill") && <button className="btn" onClick={() => setSplit(true)}>Split — move lines to a new bill</button>}
              {b.status === "final" && (boss ? <button className="btn bad" onClick={async () => {
                const r = prompt(b.merged_from?.length ? "Reason for cancelling (the merged bills / challans come back as they were):" : "Reason for cancelling this bill (kept on record):"); if (!r) return;
                await voidBill(b, r, me?.name || ""); toast(b.bill_type === "return" ? "Credit note cancelled — pieces taken off the racks again" : "Bill cancelled — pieces returned to their racks");
              }}>Cancel {b.bill_type === "return" ? "credit note" : "bill"} (void)</button> : <div className="xs mut">Only the owner or a manager can cancel a bill.</div>)}
              <button className="btn" onClick={() => { navigator.clipboard?.writeText(billText(b, shop)); toast("Bill text copied"); }}>Copy bill text</button>
              {b.converted_from && <a className="btn sm" href={"#/bills/" + b.converted_from}>Open original estimate</a>}
              {b.converted_to && <a className="btn sm" href={"#/bills/" + b.converted_to}>Open GST invoice</a>}
              {b.merged_into && <a className="btn sm" href={"#/bills/" + b.merged_into}>Open {b.merged_into_no || "invoice"} (merged into)</a>}
              {b.return_of && <a className="btn sm" href={"#/bills/" + b.return_of}>Open {b.return_of_no || "original bill"}</a>}
              {sources.filter(s => openP || !isEstimate(s)).map(s => <a key={s.id} className="btn sm" href={"#/bills/" + s.id}>Made from {s.no || "held order"}</a>)}
              {cns.map(c => <a key={c.id} className="btn sm" href={"#/bills/" + c.id}>Credit note {c.no} · −{rupees(c.net)}</a>)}
              {b.void_reason && <div className="note bad sm">Cancelled: {b.void_reason}</div>}
            </div></div>
          {(b.photo_id || b.photo_url) && <div className="card pad"><b className="sm">Parcel photo</b><div style={{ marginTop: 8 }}><Thumb photo_id={b.photo_id} url={b.photo_url} size={200} /></div></div>}
          <div className="card pad"><VoiceNotes entity="bill" entityId={b.id} /></div>
        </div>
      </div>
      {printing && <PrintBill b={b} shop={shop} format={printing} onDone={() => setPrinting(null)} />}
      {split && <SplitDialog b={b} shop={shop} onClose={() => setSplit(false)} />}
      {ret && <ReturnDialog b={b} cns={related} shop={shop} onClose={() => setRet(false)} />}
      {conv && <MergeDialog sources={[b]} onClose={() => setConv(false)} onDone={x => { setConv(false); go("bills/" + x.id); }} />}
    </div>
  );
}

/* Split: tick lines → they move to a new bill for the same customer. */
function SplitDialog({ b, shop, onClose }: { b: Bill; shop: Shop; onClose: () => void }) {
  const { me } = useApp();
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const moving = b.items.filter(l => pick.has(l.id));
  return (
    <Modal title="Split — move lines to a new bill" onClose={onClose}>
      <div className="stack">
        <div className="stack" style={{ gap: 4, maxHeight: 320, overflow: "auto" }}>{b.items.map(l => (
          <label key={l.id} className="row sm" style={{ flexWrap: "nowrap", gap: 8 }}>
            <input type="checkbox" style={{ width: 18, height: 18 }} checked={pick.has(l.id)} onChange={() => setPick(s => { const n = new Set(s); n.has(l.id) ? n.delete(l.id) : n.add(l.id); return n; })} />
            <span className="grow"><b>{l.item || "—"}</b> <span className="mono">{l.style}</span> <span className="mut">{l.color}</span> · box {l.box_no}</span>
            <span className="mono">{l.qty} pcs</span><span className="mono b">{rupees(l.amount)}</span></label>))}</div>
        {moving.length > 0 && <div className="row between sm"><span>Moving {moving.length} line{moving.length > 1 ? "s" : ""} · {moving.reduce((a, l) => a + l.qty, 0)} pcs</span><b className="mono">{rupees(moving.reduce((a, l) => a + l.amount, 0))}</b></div>}
        <div className="xs mut">{b.status === "hold" ? "Both bills stay on hold." : `The new bill gets the next ${docName(b).toLowerCase()} number; this one keeps ${b.no}. No stock moves — the pieces already left. Payments stay on ${b.no}.`}
          {b.bill_type === "gst" && b.status === "final" ? " Changing a filed tax invoice may need a credit note instead — check with your accountant." : ""}</div>
        <button className="btn p big" disabled={busy || !moving.length || moving.length === b.items.length} onClick={async () => {
          setBusy(true);
          try { const r = await splitBill(b, [...pick], shop, me?.id || ""); toast(`Moved to ${r.split.no || "a new held bill"}`); onClose(); go(r.split.status === "hold" ? "bill/" + r.split.id : "bills/" + r.split.id); }
          catch (e: any) { toast(e.message, true); setBusy(false); }
        }}>{moving.length === b.items.length ? "Leave at least one line here" : busy ? "Moving…" : "Move to a new bill"}</button>
      </div>
    </Modal>
  );
}

/* Sales return: pick lines and how many pieces came back → credit note; optional refund now. */
function ReturnDialog({ b, cns, shop, onClose }: { b: Bill; cns: Bill[]; shop: Shop; onClose: () => void }) {
  const { me } = useApp();
  const left = useMemo(() => returnable(b, cns), [b, cns]);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [refund, setRefund] = useState<"" | Payment["mode"]>("");
  const [busy, setBusy] = useState(false);
  const picks = b.items.map(l => ({ line_id: l.id, qty: parseInt(qty[l.id] || "") || 0 })).filter(p => p.qty > 0);
  const cn = useMemo(() => totals(buildReturn(b, picks, left, shop, me?.id || ""), shop.state, shop.gstin), [JSON.stringify(picks), left, shop]);
  const owed = Math.max(0, due(b));
  return (
    <Modal title={`Sales return · ${b.no}`} onClose={onClose}>
      <div className="stack">
        <div className="stack" style={{ gap: 4, maxHeight: 320, overflow: "auto" }}>{b.items.map(l => { const max = left.get(l.id) || 0; return (
          <div key={l.id} className="row sm" style={{ flexWrap: "nowrap", gap: 8, opacity: max ? 1 : 0.5 }}>
            <span className="grow"><b>{l.item || "—"}</b> <span className="mono">{l.style}</span> <span className="mut">{l.color}</span>
              <div className="xs mut">{l.qty} sold · {rupees(l.rate)} each{max < l.qty ? ` · ${l.qty - max} already returned` : ""}</div></span>
            <button className="btn sm" disabled={!max} onClick={() => setQty(x => ({ ...x, [l.id]: String(max) }))}>All</button>
            <input className="cell r" style={{ width: 56 }} inputMode="numeric" placeholder="0" disabled={!max} value={qty[l.id] || ""}
              onChange={e => { const n = Math.min(max, parseInt(e.target.value.replace(/\D/g, "")) || 0); setQty(x => ({ ...x, [l.id]: n ? String(n) : "" })); }} />
          </div>); })}</div>
        <div className="row between sm"><span>{cn.total_qty} pcs coming back{cn.discount ? ` · bill discount −${rupees(cn.discount)}` : ""}{cn.gst ? ` · GST ${rupees(cn.gst)}` : ""}</span><b className="mono">Credit {rupees(cn.net)}</b></div>
        <label className="f">Money back now? <span className="xs mut">(otherwise the customer's account is credited{owed ? ` — they owe ${rupees(owed)} on this bill` : ""})</span>
          <select className="in" value={refund} onChange={e => setRefund(e.target.value as any)}>
            <option value="">No — credit their account</option>{(["cash", "upi", "bank"] as const).map(m => <option key={m} value={m}>Refund {rupees(cn.net)} by {m.toUpperCase()}</option>)}</select></label>
        <div className="xs mut">Pieces go back to the racks they were sold from.</div>
        <button className="btn p big" disabled={busy || !cn.items.length} onClick={async () => {
          setBusy(true);
          try {
            const draft = buildReturn(b, picks, left, shop, me?.id || "");
            const done = await saveReturn(draft, b, shop, refund ? { mode: refund, amount: totals(draft, shop.state, shop.gstin).net } : undefined);
            toast(`Credit note ${done.no} · ${rupees(done.net)}`); onClose(); go("bills/" + done.id);
          } catch (e: any) { toast(e.message, true); setBusy(false); }
        }}>{busy ? "Saving…" : "Save credit note"}</button>
      </div>
    </Modal>
  );
}
