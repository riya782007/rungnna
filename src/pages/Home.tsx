import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { useLocations } from "../components/common";
import { Icon } from "../components/Icon";
import { useApp } from "../lib/app";
import { can } from "../lib/roles";
import { rupees, when } from "../lib/format";
import { label, isDead } from "../lib/products";
import { due } from "../lib/billing";
import { usePrivate, maskNote } from "../lib/privacy";

/* One glance: money today, what needs a hand, where the stock sits. Nothing else. */
export default function Home() {
  const { me } = useApp();
  const money = can(me, "sales");
  const locs = useLocations();
  const start = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.toISOString(); }, []);
  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], []);
  const cells = useLiveQuery(() => db.stock.toArray(), [], []);
  const recent = useLiveQuery(() => db.movements.orderBy("at").reverse().limit(8).toArray(), [], []);
  const priv = usePrivate();
  const bills = useLiveQuery(() => db.bills.where("at").aboveOrEqual(start).filter(b => !b.deleted && (priv || b.bill_type !== "estimate")).toArray(), [start, priv], []);
  const held = useLiveQuery(() => db.bills.where("status").equals("hold").filter(b => !b.deleted && !b.no && (priv || b.bill_type !== "estimate")).count(), [priv], 0);

  // Everything the shop owes the owner's attention: dues per customer, and how
  // low each live product has run so it can be re-ordered before it hits zero.
  const allBills = useLiveQuery(() => db.bills.filter(b => !b.deleted && b.status === "final" && (priv || b.bill_type !== "estimate")).toArray(), [priv], []);
  const REORDER_AT = 6; // pieces at or below this (and >0-ish) means "order more soon"

  const s = useMemo(() => {
    const bucket = new Set(locs.filter(l => l.kind === "bucket").map(l => l.id));
    const byId = new Map(products.map(p => [p.id, p]));
    let pcs = 0, value = 0, flagged = 0, deadPcs = 0, deadVal = 0;
    const floor = new Map<string, number>(); const perProd = new Map<string, number>();
    cells.forEach(c => {
      if (bucket.has(c.loc_id)) { flagged += c.qty; return; }
      const p = byId.get(c.product_id);
      pcs += c.qty; value += c.qty * (p?.rate || 0);
      if (p && isDead(p)) { deadPcs += c.qty; deadVal += c.qty * p.rate; }
      const f = locs.find(l => l.id === c.loc_id)?.floor || "?";
      floor.set(f, (floor.get(f) || 0) + c.qty);
      perProd.set(c.product_id, (perProd.get(c.product_id) || 0) + c.qty);
    });
    const fin = bills.filter(b => b.status === "final");
    const collected = fin.reduce((a, b) => a + b.payments.filter(p => p.mode !== "credit").reduce((x, p) => x + p.amount, 0) + b.advance, 0);

    // Reorder list: live (non-dead) products that have ever held stock but are now
    // low or out. "Ever held" = they appear in a stock cell, so brand-new draft
    // products with no stock yet don't spam the list.
    const live = products.filter(p => !isDead(p));
    const reorder = live
      .map(p => ({ p, qty: perProd.get(p.id) || 0 }))
      .filter(x => perProd.has(x.p.id) && x.qty <= REORDER_AT)
      .sort((a, b) => a.qty - b.qty);
    const outOfStock = reorder.filter(x => x.qty <= 0).length;

    // Customer dues (order/payment follow-ups): total outstanding + who owes.
    const owed = new Map<string, { name: string; amt: number }>();
    for (const b of allBills) {
      const d = Math.max(0, due(b));
      if (d <= 0) continue;
      const key = b.party_id || b.party_name || "walk-in";
      const cur = owed.get(key) || { name: b.party_name || "Walk-in / cash", amt: 0 };
      cur.amt += d; owed.set(key, cur);
    }
    const debtors = [...owed.values()].filter(x => x.amt > 0).sort((a, b) => b.amt - a.amt);

    return {
      pcs, value, flagged, floor, deadPcs, deadVal, reorder, outOfStock, debtors,
      creditTotal: debtors.reduce((a, x) => a + x.amt, 0),
      noPhoto: products.filter(p => !p.photo_id && !p.photo_url).length, noRate: products.filter(p => !p.rate).length,
      sales: fin.reduce((a, b) => a + b.net, 0), n: fin.length, sold: fin.reduce((a, b) => a + b.total_qty, 0),
      gst: fin.filter(b => b.bill_type === "gst").reduce((a, b) => a + b.net, 0), collected,
      credit: fin.reduce((a, b) => a + Math.max(0, due(b)), 0),
    };
  }, [cells, products, locs, bills, allBills]);

  const maxF = Math.max(1, ...s.floor.values());
  const floorName = (f: string) => (f === "G" ? "Ground" : f === "GD" ? "Godown" : f === "?" ? "Unplaced" : "Floor " + f);
  const pName = (id: string) => products.find(p => p.id === id);
  const hour = new Date().getHours();
  const todo = [
    s.outOfStock ? { t: "Out of stock — reorder now", to: "products", n: s.outOfStock, urgent: true } : null,
    s.reorder.length ? { t: "Running low — order soon", to: "products", n: s.reorder.length } : null,
    money && s.debtors.length ? { t: `On credit · ${rupees(s.creditTotal)}`, to: "customers", n: s.debtors.length } : null,
    held ? { t: `${held} bill${held > 1 ? "s" : ""} on hold`, to: "bill", n: held } : null,
    s.noRate ? { t: "Products without a rate", to: "products", n: s.noRate } : null,
    s.noPhoto ? { t: "Products without a photo", to: "products", n: s.noPhoto } : null,
    s.deadPcs ? { t: `Dead stock (TK) · ${money ? rupees(s.deadVal) : ""}`, to: "products", n: s.deadPcs } : null,
    s.flagged ? { t: "Pieces marked damaged / missing", to: "racks", n: s.flagged } : null,
  ].filter(Boolean) as { t: string; to: string; n: number; urgent?: boolean }[];

  return (
    <div>
      <div className="head"><div>
        <div className="eyebrow">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
        <h1 className="h1">{hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, {me?.name}</h1>
      </div></div>

      {money && (
        <div className="hero">
          <div><span className="k">Sales today</span><b>{rupees(s.sales)}</b><span className="xs">{s.n} bills · {s.sold} pieces</span></div>
          <div><span className="k">Collected</span><b>{rupees(s.collected)}</b></div>
          <div><span className="k">On credit</span><b style={{ color: s.credit ? "var(--bad)" : undefined }}>{rupees(s.credit)}</b></div>
          <div><span className="k">GST invoices</span><b>{rupees(s.gst)}</b></div>
        </div>)}

      <div className="quick">
        {can(me, "bill") && <a href="#/bill" className="gold"><span className="i"><Icon n="plus" /></span>New bill</a>}
        <a href="#/stockin"><span className="i"><Icon n="scan" /></span>Stock in</a>
        <a href="#/move"><span className="i"><Icon n="stock" /></span>Move stock</a>
        {can(me, "ai") ? <a href="#/ask"><span className="i"><Icon n="ask" /></span>Ask the shop</a> : <a href="#/labels"><span className="i"><Icon n="print" /></span>Print labels</a>}
      </div>

      <div className="split">
        <div className="stack">
          {todo.length > 0 && <div><div className="eyebrow" style={{ margin: "0 4px 8px" }}>Needs attention</div>
            <div className="list">{todo.map(x => <a key={x.t} href={"#/" + x.to}><span className="grow sm">{x.urgent ? "⚠️ " : ""}{x.t}</span><b className="mono" style={x.urgent ? { color: "var(--bad)" } : undefined}>{x.n}</b><Icon n="chev" size={16} /></a>)}</div></div>}

          {s.reorder.length > 0 && <div><div className="eyebrow" style={{ margin: "0 4px 8px" }}>Reorder soon</div>
            <div className="list">
              {s.reorder.slice(0, 6).map(({ p, qty }) => (
                <a key={p.id} href={"#/product/" + p.id}>
                  <span className="grow" style={{ minWidth: 0 }}>
                    <div className="sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label(p)}</div>
                    <div className="xs mut mono">{p.code}</div>
                  </span>
                  <b className="mono" style={{ color: qty <= 0 ? "var(--bad)" : undefined }}>{qty <= 0 ? "OUT" : qty}</b>
                  <Icon n="chev" size={16} />
                </a>))}
              {s.reorder.length > 6 && <a href="#/products"><span className="grow sm mut">+{s.reorder.length - 6} more low items</span><Icon n="chev" size={16} /></a>}
            </div></div>}
          <div className="card pad stack">
            <div className="row between"><b>Stock on racks</b><span className="mono b">{s.pcs.toLocaleString("en-IN")} pcs{money ? " · " + rupees(s.value) : ""}</span></div>
            {[...s.floor.entries()].sort().map(([f, n]) => (
              <div key={f} className="stack" style={{ gap: 6 }}>
                <div className="row between sm"><span>{floorName(f)}</span><span className="mono mut">{n.toLocaleString("en-IN")}</span></div>
                <div className="bar"><span style={{ width: (n / maxF) * 100 + "%" }} /></div>
              </div>))}
            {!s.floor.size && <div className="mut sm">Nothing on racks yet — create racks, then scan.</div>}
          </div>
        </div>
        <div>
          <div className="row between" style={{ margin: "0 4px 8px" }}><span className="eyebrow">Latest activity</span><a className="xs mut" href="#/activity">See all</a></div>
          <div className="list">
            {recent.map(m => { const p = pName(m.product_id); return (
              <a key={m.id} href={"#/product/" + m.product_id}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <div className="sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p ? label(p) : "…"}</div>
                  <div className="xs mut">{m.kind} · {when(m.at)}</div>
                </span><b className="mono">{m.kind === "sale" || m.kind === "damage" || m.kind === "missing" ? "−" : ""}{m.qty}</b></a>); })}
            {!recent.length && <div className="empty"><b>Quiet so far</b>Scans, moves and sales show up here.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}
