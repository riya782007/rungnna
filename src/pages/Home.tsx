import { inStore, storeStock, currentStore, MAIN_STORE } from "../lib/stores";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Bill } from "../lib/db";
import { useLocations } from "../components/common";
import { Icon } from "../components/Icon";
import { AnimatedNumber, BarChart, Donut, Sparkline, type DonutSlice } from "../components/Charts";
import { useApp } from "../lib/app";
import { can } from "../lib/roles";
import { rupees, when } from "../lib/format";
import { label, isDead } from "../lib/products";
import { due, isSale } from "../lib/billing";
import { usePrivate, isEstimate } from "../lib/privacy";
import { EndOfDay } from "../components/EndOfDay";

type Period = "today" | "week" | "month";
const PERIODS: [Period, string][] = [["today", "Today"], ["week", "This week"], ["month", "This month"]];

function periodStart(p: Period): Date {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  if (p === "week") { const dow = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dow); }
  else if (p === "month") d.setDate(1);
  return d;
}

/* The command centre: one glance tells the owner how the shop is doing today —
   money by payment channel, profit, the sales trend, what stock needs a hand,
   who's selling, and the jobs that can't wait. Everything is real data from this
   device; panels that need features not built yet show an honest placeholder. */
export default function Home() {
  const { me } = useApp();
  const money = can(me, "sales");
  const locs = useLocations();
  const priv = usePrivate();
  const [period, setPeriod] = useState<Period>("today");
  const [eod, setEod] = useState(false);
  const start = useMemo(() => periodStart(period).toISOString(), [period]);

  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], []);
  const cells = useLiveQuery(() => storeStock(), [], []);
  const recent = useLiveQuery(() => db.movements.orderBy("at").filter(inStore).reverse().limit(6).toArray(), [], []);
  const bills = useLiveQuery(() => db.bills.where("at").aboveOrEqual(start).filter(b => inStore(b) && !b.deleted && (priv || !isEstimate(b))).toArray(), [start, priv], []);
  const allFinal = useLiveQuery(() => db.bills.filter(b => inStore(b) && !b.deleted && b.status === "final" && (priv || !isEstimate(b))).toArray(), [priv], []);
  const held = useLiveQuery(() => db.bills.where("status").equals("hold").filter(b => inStore(b) && !b.deleted && !b.no && (priv || !isEstimate(b))).count(), [priv], 0);

  const d = useMemo(() => {
    const bucket = new Set(locs.filter(l => l.kind === "bucket").map(l => l.id));
    const byId = new Map(products.map(p => [p.id, p]));
    const costOf = new Map(products.map(p => [p.id, p.cost || 0]));

    // ---- stock ----
    let pcs = 0, value = 0, flagged = 0, deadPcs = 0, deadVal = 0;
    const floor = new Map<string, number>(); const perProd = new Map<string, number>();
    cells.forEach(c => {
      if (bucket.has(c.loc_id)) { flagged += c.qty; return; }
      const p = byId.get(c.product_id);
      pcs += c.qty; value += c.qty * (p?.rate || 0);
      if (p && isDead(p)) { deadPcs += c.qty; deadVal += c.qty * p.rate; }
      floor.set(locs.find(l => l.id === c.loc_id)?.floor || "?", (floor.get(locs.find(l => l.id === c.loc_id)?.floor || "?") || 0) + c.qty);
      perProd.set(c.product_id, (perProd.get(c.product_id) || 0) + c.qty);
    });

    // ---- period sales ----
    const fin = bills.filter(b => b.status === "final" && isSale(b));   // challans move goods, credit notes are in the end-of-day report
    const sales = fin.reduce((a, b) => a + b.net, 0);
    const collected = fin.reduce((a, b) => a + b.payments.filter(p => p.mode !== "credit").reduce((x, p) => x + p.amount, 0) + b.advance, 0);
    const credit = fin.reduce((a, b) => a + Math.max(0, due(b)), 0);
    const gst = fin.filter(b => b.bill_type === "gst").reduce((a, b) => a + b.net, 0);

    // profit for the period = sold value − cost of goods sold (needs product cost)
    let cogs = 0, haveCost = false;
    for (const b of fin) for (const l of b.items) { const c = costOf.get(l.product_id || "") || 0; if (c) haveCost = true; cogs += c * l.qty; }
    const profit = sales - cogs;

    // payment channels (the real "channels" today: how money came in)
    const chan = { cash: 0, upi: 0, card: 0, bank: 0, credit: 0 };
    for (const b of fin) for (const p of b.payments) {
      if (p.mode === "cash") chan.cash += p.amount;
      else if (p.mode === "upi") chan.upi += p.amount;
      else if (p.mode === "card") chan.card += p.amount;
      else if (p.mode === "bank") chan.bank += p.amount;
    }
    // credit portion = the unpaid balance still owed
    chan.credit = credit;

    // salesman leaderboard
    const byMan = new Map<string, number>();
    for (const b of fin) if (b.salesman) byMan.set(b.salesman, (byMan.get(b.salesman) || 0) + b.net);
    const leaders = [...byMan.entries()].map(([name, amt]) => ({ name, amt })).sort((a, b) => b.amt - a.amt).slice(0, 5);

    // reorder / dead / hygiene
    const live = products.filter(p => !isDead(p));
    const reorder = live.map(p => ({ p, qty: perProd.get(p.id) || 0 })).filter(x => perProd.has(x.p.id) && x.qty <= 6).sort((a, b) => a.qty - b.qty);
    const outOfStock = reorder.filter(x => x.qty <= 0).length;

    // debtors
    const owed = new Map<string, number>();
    for (const b of allFinal) { if (!isSale(b)) continue; const bal = Math.max(0, due(b)); if (bal > 0) owed.set(b.party_id || b.party_name || "walk-in", (owed.get(b.party_id || b.party_name || "walk-in") || 0) + bal); }
    const debtors = [...owed.values()].filter(x => x > 0);
    const creditTotal = debtors.reduce((a, x) => a + x, 0);

    return {
      pcs, value, flagged, floor, deadPcs, deadVal, reorder, outOfStock,
      sales, collected, credit, gst, n: fin.length, sold: fin.reduce((a, b) => a + b.total_qty, 0),
      profit, haveCost, margin: sales > 0 ? (profit / sales) * 100 : 0, chan, leaders,
      debtors: debtors.length, creditTotal,
      noPhoto: products.filter(p => !p.photo_id && !p.photo_url).length, noRate: products.filter(p => !p.rate).length,
    };
  }, [cells, products, locs, bills, allFinal]);

  // 14-day sales trend (independent of the period switch)
  const trendBills = useLiveQuery(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0); from.setDate(from.getDate() - 13);
    return db.bills.where("at").aboveOrEqual(from.toISOString()).filter(b => inStore(b) && !b.deleted && b.status === "final" && (priv || !isEstimate(b))).toArray();
  }, [priv], [] as Bill[]);
  const trend = useMemo(() => {
    const days: { label: string; value: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(); day.setHours(0, 0, 0, 0); day.setDate(day.getDate() - i);
      const next = new Date(day); next.setDate(day.getDate() + 1);
      const v = trendBills.filter(b => isSale(b) && b.at >= day.toISOString() && b.at < next.toISOString()).reduce((a, b) => a + b.net, 0);
      days.push({ label: day.toLocaleDateString("en-IN", { day: "numeric" }), value: v });
    }
    return days;
  }, [trendBills]);

  const hour = new Date().getHours();
  const maxF = Math.max(1, ...d.floor.values());
  const floorName = (f: string) => (f === "G" ? "Ground" : f === "GD" ? "Godown" : f === "?" ? "Unplaced" : "Floor " + f);
  const pName = (id: string) => products.find(p => p.id === id);

  const chanRupees = (n: number) => rupees(n);
  const channels: DonutSlice[] = [
    { label: "Cash", value: d.chan.cash, color: "var(--ok)" },
    { label: "UPI", value: d.chan.upi, color: "var(--gold)" },
    { label: "Card", value: d.chan.card, color: "#5b7cc4" },
    { label: "Bank", value: d.chan.bank, color: "#8a6ac4" },
    { label: "Credit", value: d.chan.credit, color: "var(--bad)" },
  ];
  const chanTotal = channels.reduce((a, s) => a + s.value, 0);

  const urgent = [
    d.outOfStock ? { t: "Out of stock — reorder now", to: "products", n: d.outOfStock, kind: "bad" } : null,
    d.reorder.length ? { t: "Running low — order soon", to: "products", n: d.reorder.length, kind: "warn" } : null,
    money && d.debtors ? { t: `Payments to collect · ${rupees(d.creditTotal)}`, to: "customers", n: d.debtors, kind: "bad" } : null,
    held ? { t: "Bills on hold", to: "bill", n: held, kind: "warn" } : null,
    d.deadPcs ? { t: "Dead stock (TK)", to: "products", n: d.deadPcs, kind: "warn" } : null,
    d.noRate ? { t: "Products without a rate", to: "products", n: d.noRate, kind: "ok" } : null,
    d.noPhoto ? { t: "Products without a photo", to: "products", n: d.noPhoto, kind: "ok" } : null,
    d.flagged ? { t: "Damaged / missing pieces", to: "racks", n: d.flagged, kind: "bad" } : null,
  ].filter(Boolean) as { t: string; to: string; n: number; kind: string }[];

  return (
    <div className="dash">
      {/* greeting + period */}
      <div className="head" style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div>
          <div className="eyebrow">{new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</div>
          <h1 className="h1">{hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening"}, {me?.name}</h1>
        </div>
        <div className="seg-switch" role="group" aria-label="Period">
          {PERIODS.map(([k, lbl]) => <button key={k} aria-pressed={period === k} onClick={() => setPeriod(k)}>{lbl}</button>)}
        </div>
      </div>

      {/* KPI tiles */}
      {money && (
        <div className="kpis">
          <div className="kpi dark">
            <span className="accent" style={{ background: "var(--gold)" }} />
            <div className="kpi-top"><span className="lbl">Sales · {PERIODS.find(p => p[0] === period)![1]}</span><span className="kpi-ic"><Icon n="sell" size={16} /></span></div>
            <div className="kpi-val"><AnimatedNumber value={d.sales} format={chanRupees} /></div>
            <div className="kpi-sub">{d.n} bills · {d.sold} pieces</div>
          </div>
          <div className="kpi">
            <span className="accent" style={{ background: "var(--ok)" }} />
            <div className="kpi-top"><span className="lbl">Collected</span><span className="kpi-ic"><Icon n="cloud" size={16} /></span></div>
            <div className="kpi-val" style={{ color: "var(--ok)" }}><AnimatedNumber value={d.collected} format={chanRupees} /></div>
            <div className="kpi-sub">in hand + digital</div>
          </div>
          <div className="kpi">
            <span className="accent" style={{ background: d.profit >= 0 ? "var(--ok)" : "var(--bad)" }} />
            <div className="kpi-top"><span className="lbl">Profit (est.)</span><span className="kpi-ic"><Icon n="stock" size={16} /></span></div>
            <div className="kpi-val" style={{ color: d.profit >= 0 ? "var(--ink)" : "var(--bad)" }}>
              {d.haveCost ? <AnimatedNumber value={d.profit} format={chanRupees} /> : "—"}
            </div>
            <div className="kpi-sub">{d.haveCost ? `${d.margin.toFixed(0)}% margin` : "add cost prices to see profit"}</div>
          </div>
          <div className="kpi">
            <span className="accent" style={{ background: d.credit ? "var(--bad)" : "var(--line)" }} />
            <div className="kpi-top"><span className="lbl">On credit</span><span className="kpi-ic"><Icon n="user" size={16} /></span></div>
            <div className="kpi-val" style={{ color: d.credit ? "var(--bad)" : undefined }}><AnimatedNumber value={d.credit} format={chanRupees} /></div>
            <div className="kpi-sub">{d.debtors} customer{d.debtors === 1 ? "" : "s"} to follow up</div>
          </div>
        </div>
      )}

      {/* quick actions */}
      <div className="quick">
        {can(me, "bill") && <a href="#/bill" className="gold"><span className="i"><Icon n="plus" /></span>New bill</a>}
        <a href="#/stockin"><span className="i"><Icon n="scan" /></span>Stock in</a>
        <a href="#/move"><span className="i"><Icon n="stock" /></span>Move stock</a>
        {money && <a href="#/" onClick={e => { e.preventDefault(); setEod(true); }}><span className="i"><Icon n="print" /></span>End of day</a>}
        {can(me, "ai") ? <a href="#/ask"><span className="i"><Icon n="ask" /></span>Ask the shop</a> : <a href="#/labels"><span className="i"><Icon n="print" /></span>Print labels</a>}
      </div>

      {/* row: sales trend + payment channels */}
      {money && (
        <div className="dash-grid">
          <div className="panel">
            <header><Icon n="sell" size={16} /><h3>Sales · last 14 days</h3><span className="grow" /><span className="xs mut">{rupees(trend.reduce((a, t) => a + t.value, 0))} total</span></header>
            <div className="body">
              <BarChart data={trend} format={v => "₹" + Math.round(v / 100).toLocaleString("en-IN")} accent="var(--gold)" height={150} />
            </div>
          </div>
          <div className="panel">
            <header><Icon n="cloud" size={16} /><h3>How money came in</h3></header>
            <div className="body" style={{ display: "flex", gap: 18, alignItems: "center" }}>
              <Donut slices={channels} center={<><b>{chanTotal ? rupees(chanTotal) : "₹0"}</b><span>received</span></>} />
              <div className="legend" style={{ flex: 1 }}>
                {channels.map(s => (
                  <div className="row" key={s.label}><span className="dot" style={{ background: s.color }} /><span className="grow">{s.label}</span><b>{rupees(s.value)}</b></div>
                ))}
                {chanTotal === 0 && <div className="xs mut">No payments recorded in this period yet.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {eod && <EndOfDay onClose={() => setEod(false)} />}

      {/* row: urgent tasks + stock status */}
      <div className="dash-grid">
        <div className="panel urgent">
          <header><Icon n="lock" size={16} /><h3>Needs attention</h3>{urgent.length > 0 && <span className="pill bad" style={{ marginLeft: "auto" }}>{urgent.length}</span>}</header>
          <div className="list" style={{ border: 0, boxShadow: "none", borderRadius: 0 }}>
            {urgent.map(x => (
              <a key={x.t} href={"#/" + x.to}>
                <span className={"u-ic " + x.kind}><Icon n={x.kind === "ok" ? "camera" : "chev"} size={14} /></span>
                <span className="grow sm">{x.t}</span><b className="mono">{x.n}</b><Icon n="chev" size={16} />
              </a>
            ))}
            {!urgent.length && <div className="empty"><b>All clear</b>Nothing urgent right now.</div>}
          </div>
        </div>
        <div className="panel">
          <header><Icon n="stock" size={16} /><h3>Stock on racks</h3><span className="grow" /><span className="mono b xs">{d.pcs.toLocaleString("en-IN")} pcs{money ? " · " + rupees(d.value) : ""}</span></header>
          <div className="body stack" style={{ gap: 10 }}>
            {[...d.floor.entries()].sort().map(([f, n]) => (
              <div key={f} className="stack" style={{ gap: 6 }}>
                <div className="row between sm"><span>{floorName(f)}</span><span className="mono mut">{n.toLocaleString("en-IN")}</span></div>
                <div className="bar"><span style={{ width: (n / maxF) * 100 + "%" }} /></div>
              </div>))}
            {!d.floor.size && <div className="mut sm">Nothing on racks yet — create racks, then scan.</div>}
            {d.reorder.length > 0 && <a className="xs" href="#/products" style={{ color: "var(--bad)", fontWeight: 600 }}>{d.reorder.length} item{d.reorder.length === 1 ? "" : "s"} low or out of stock →</a>}
          </div>
        </div>
      </div>

      {/* row: salesman leaderboard + latest activity */}
      <div className="dash-grid">
        {money && (
          <div className="panel">
            <header><Icon n="user" size={16} /><h3>Top salesmen · {PERIODS.find(p => p[0] === period)![1].toLowerCase()}</h3></header>
            <div className="body">
              {d.leaders.length ? d.leaders.map((l, i) => {
                const max = d.leaders[0].amt || 1;
                return (
                  <div className="lead" key={l.name}>
                    <span className={"rank" + (i === 0 ? " g1" : "")}>{i + 1}</span>
                    <span className="grow sm b" style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
                    <span className="bar"><span style={{ width: (l.amt / max) * 100 + "%" }} /></span>
                    <b className="mono sm">{rupees(l.amt)}</b>
                  </div>
                );
              }) : <div className="mut sm">No salesman tagged on bills this period. Pick a salesman on the bill to see the leaderboard.</div>}
            </div>
          </div>
        )}
        <div className="panel">
          <header><Icon n="scan" size={16} /><h3>Latest activity</h3><span className="grow" /><a className="xs mut" href="#/activity">See all</a></header>
          <div className="list" style={{ border: 0, boxShadow: "none", borderRadius: 0 }}>
            {recent.map(m => { const p = pName(m.product_id); return (
              <a key={m.id} href={"#/product/" + m.product_id}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <div className="sm" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p ? label(p) : "…"}</div>
                  <div className="xs mut">{m.kind} · {when(m.at)}</div>
                </span><b className="mono">{["sale", "damage", "missing"].includes(m.kind) ? "−" : ""}{m.qty}</b></a>); })}
            {!recent.length && <div className="empty"><b>Quiet so far</b>Scans, moves and sales show up here.</div>}
          </div>
        </div>
      </div>

      {/* row: dealer orders + staff reviews (light up when those features ship) */}
      <div className="dash-grid">
        <div className="panel">
          <header><Icon n="sell" size={16} /><h3>Dealer orders</h3><span className="pill soon-tag" style={{ marginLeft: "auto" }}>Coming soon</span></header>
          <div className="soon">
            <span className="soon-ic"><Icon n="sell" size={20} /></span>
            <b>Online dealer portal</b>
            <span className="sm">When the shareable catalogue &amp; dealer portal go live, new wholesale orders will land here with one-tap accept — and notify you the moment they arrive.</span>
          </div>
        </div>
        <div className="panel">
          <header><Icon n="user" size={16} /><h3>Staff reviews &amp; ratings</h3><span className="pill soon-tag" style={{ marginLeft: "auto" }}>Coming soon</span></header>
          <div className="soon">
            <span className="soon-ic"><Icon n="user" size={20} /></span>
            <b>Team performance</b>
            <span className="sm">Customer ratings and staff reviews will show here once feedback capture is enabled, so you can see who delights customers at the counter.</span>
          </div>
        </div>
      </div>
    </div>
  );
}
