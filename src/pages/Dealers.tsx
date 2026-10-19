import { DeleteButton } from "../components/DeleteButton";
import { confirmDelete } from "../lib/confirm-delete";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Dealer, type TradeOrder } from "../lib/db";
import { Head, Modal, MoneyInput } from "../components/common";
import { useApp, toast, go } from "../lib/app";
import { can } from "../lib/roles";
import { rupees, when } from "../lib/format";
import { waLink } from "../lib/billing";
import { copy, waShare } from "../lib/listing";
import { dealerUrl, setDealerStatus, orderToBill, cancelOrder, refreshOrderStatus, getMinOrder, setMinOrder } from "../lib/trade";

/* Trade portal, shop side (reference: the wholesale dealer console): who may order, what they ordered,
   and one tap to turn an order into a bill with the same rates. */
export default function Dealers() {
  const { me } = useApp();
  const dealers = useLiveQuery(() => db.dealers.filter(d => !d.deleted).toArray(), [], [] as Dealer[]);
  const orders = useLiveQuery(() => db.trade_orders.orderBy("at").reverse().filter(o => !o.deleted).toArray(), [], [] as TradeOrder[]);
  const [tab, setTab] = useState<"orders" | "dealers">("orders");
  const [open, setOpen] = useState<TradeOrder | null>(null);
  const [min, setMin] = useState(0), [minEdit, setMinEdit] = useState<number | null>(null);
  useEffect(() => { getMinOrder().then(setMin); }, []);
  useEffect(() => { orders.filter(o => o.bill_id && o.status !== "billed" && o.status !== "cancelled").forEach(o => void refreshOrderStatus(o)); }, [orders.length]);
  const pending = dealers.filter(d => d.status === "pending"), fresh = orders.filter(o => o.status === "new");
  const act = (f: () => Promise<unknown>, ok: string) => f().then(() => toast(ok)).catch((e: any) => toast(e.message, true));
  if (!can(me, "dealers.manage")) return <div className="card empty"><b>Not available for your role</b>Ask the owner for “Approve dealers & handle trade orders”.</div>;

  return <div>
    <Head eyebrow="Trade portal" title="Dealers & trade orders" sub="Retailers register on your portal with their mobile and a PIN. Approve them, and their orders arrive here priced at your trade rates.">
      <button className="btn" onClick={async () => toast((await copy(dealerUrl())) ? "Portal link copied" : dealerUrl())}>Copy portal link</button>
      <a className="btn g" href={waShare(`Order from our wholesale catalogue — register once with your mobile: ${dealerUrl()}`)} target="_blank" rel="noopener">Invite on WhatsApp</a>
    </Head>
    <div className="hero three">
      <div><span className="k">New orders</span><b>{fresh.length}</b><span className="xs">{rupees(fresh.reduce((a, o) => a + o.total, 0))}</span></div>
      <div><span className="k">Waiting for approval</span><b>{pending.length}</b></div>
      <div><span className="k">Minimum order</span>{minEdit === null
        ? <b style={{ fontSize: 22 }}>{min ? rupees(min) : "None"} <button className="linkbtn sm" onClick={() => setMinEdit(min)}>change</button></b>
        : <span className="row"><MoneyInput className="in mono" style={{ maxWidth: 120 }} paise={minEdit} onPaise={setMinEdit} />
          <button className="btn sm p" onClick={() => act(async () => { await setMinOrder(minEdit); setMin(minEdit); setMinEdit(null); }, "Minimum order saved")}>Save</button></span>}</div>
    </div>
    <div className="seg" role="group" style={{ marginBottom: 12 }}>
      <button aria-pressed={tab === "orders"} onClick={() => setTab("orders")}>Orders {fresh.length ? `(${fresh.length} new)` : ""}</button>
      <button aria-pressed={tab === "dealers"} onClick={() => setTab("dealers")}>Dealers {pending.length ? `(${pending.length} waiting)` : ""}</button>
    </div>

    {tab === "orders" && <div className="list">{orders.map(o => <button key={o.id} className="li" style={{ textAlign: "left", width: "100%", background: "var(--surface)", border: 0 }} onClick={() => setOpen(o)}>
      <span className="grow"><b className="sm">{o.no}</b> <span className={"pill " + (o.status === "new" ? "gold" : o.status === "billed" ? "ok" : o.status === "cancelled" ? "bad" : "")}>{o.status}</span>
        <div className="xs mut">{o.dealer_shop || o.dealer_name} · {o.dealer_phone} · {when(o.at)} · {o.total_qty} pcs{o.bill_no ? " · bill " + o.bill_no : ""}</div></span>
      <b className="mono">{rupees(o.total)}</b></button>)}
      {!orders.length && <div className="empty"><b>No trade orders yet</b>Share the portal link with your retailers.</div>}</div>}

    {tab === "dealers" && <div className="list">{[...pending, ...dealers.filter(d => d.status !== "pending")].map(d => <div key={d.id} className="li">
      <span className="grow"><b className="sm">{d.shop_name || d.name}</b> <span className={"pill " + (d.status === "approved" ? "ok" : d.status === "pending" ? "gold" : "bad")}>{d.status}</span>
        <div className="xs mut">{[d.name, d.phone, d.city, d.gstin].filter(Boolean).join(" · ")} · registered {when(d.created_at)}</div></span>
      {d.status !== "approved" && <button className="btn sm p" onClick={() => act(() => setDealerStatus(d, "approved"), "Approved — they can log in now")}>Approve</button>}
      {d.status !== "blocked" && <DeleteButton className="btn sm bad" onDelete={async () => { if (await confirmDelete(`Block ${d.shop_name || d.name}? They won't be able to log in or order.`)) await act(() => setDealerStatus(d, "blocked"), "Blocked"); }}>Block</DeleteButton>}
      <a className="btn sm" href={waLink(d.phone, `Namaste ${d.name}, your account on our wholesale portal is ${d.status === "approved" ? "approved — log in at " + dealerUrl() : "being checked"}.`)} target="_blank" rel="noopener">WhatsApp</a>
    </div>)}{!dealers.length && <div className="empty"><b>No dealers yet</b>They appear here as soon as they register.</div>}</div>}

    {open && <Modal title={`${open.no} · ${open.dealer_shop || open.dealer_name}`} onClose={() => setOpen(null)}>
      <div className="stack">
        <div className="tw"><table><thead><tr><th>Design</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Amount</th></tr></thead><tbody>
          {open.items.map(l => <tr key={l.product_id}><td><b>{l.title}</b><div className="xs mut">{[l.code, l.style, l.color, l.size].filter(Boolean).join(" · ")}</div></td>
            <td className="r">{l.qty}</td><td className="r mono">{rupees(l.rate)}</td><td className="r mono">{rupees(l.amount)}</td></tr>)}</tbody></table></div>
        <div className="row"><span className="grow">{open.total_qty} pieces{open.note ? " · " + open.note : ""}</span><b className="mono">{rupees(open.total)}</b></div>
        {open.status === "new" && <div className="row">
          {can(me, "billing.sell") && <button className="btn p" onClick={() => act(async () => { const b = await orderToBill(open, "gst", me?.id || ""); setOpen(null); go("bill/" + b.id); }, "Bill ready — check, pack and save")}>Make GST invoice</button>}
          {can(me, "estimates.open") && <button className="btn" onClick={() => act(async () => { const b = await orderToBill(open, "estimate", me?.id || ""); setOpen(null); go("bill/" + b.id); }, "Estimate ready")}>Make estimate</button>}
          <DeleteButton className="btn bad" onDelete={async () => { if (await confirmDelete("Cancel this order?")) await act(async () => { await cancelOrder(open); setOpen(null); }, "Order cancelled"); }}>Cancel order</DeleteButton>
        </div>}
        {open.bill_id && <button className="btn" onClick={() => go((open.status === "billed" ? "bills/" : "bill/") + open.bill_id)}>Open the bill</button>}
        <a className="btn g" href={waLink(open.dealer_phone, `Namaste ${open.dealer_name}, we received your order ${open.no} (${open.total_qty} pcs, ${rupees(open.total)}). We'll confirm dispatch shortly.`)} target="_blank" rel="noopener">Confirm on WhatsApp</a>
      </div>
    </Modal>}
  </div>;
}
