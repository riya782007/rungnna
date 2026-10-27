import { useEffect, useMemo, useState } from "react";
import { reportData, exportExcel, type ReportRow } from "../lib/reports";
import { localDay } from "../lib/ledger";
import { useApp, toast } from "../lib/app";
import { can } from "../lib/roles";
import { billAmount } from "../lib/format";
import { Head } from "../components/common";
import { Icon } from "../components/Icon";
import { db, setSetting } from "../lib/db";
import { useLiveQuery } from "dexie-react-hooks";

/* Reports show figures without ₹, and every money figure can be divided by a factor the
   owner picks (÷5, ÷20 …) so the real values aren't on screen (counter request 21/10/2026).
   The factor is remembered on this device and applies to the table, totals, Excel and Share. */
const MONEY = /^(sales|amount|cost|rate|cost_value|rate_value|taxable|cgst|sgst|igst|gst|total|net|paid|due)$/i;
const HIDDEN = new Set(["rack"]);   // stock valuation: rack ids mean nothing to the reader
// screen: "2,250.00"; Excel: 2250 as a plain number so columns can still be summed
const shown = (rows: ReportRow[], divisor: number, excel = false): ReportRow[] => rows.map(r => {
  const out: ReportRow = {};
  for (const [k, v] of Object.entries(r)) if (!HIDDEN.has(k)) out[k] = typeof v === "number" && MONEY.test(k)
    ? (excel ? Math.round(v / divisor) / 100 : billAmount(Math.round(v / divisor))) : v;
  return out;
});

const tabs = [
  ["byDay", "Sales by day"],
  ["byMonth", "Sales by month"],
  ["byHour", "Sales by hour"],
  ["byItem", "Item-wise"],
  ["byParty", "Party-wise"],
  ["byArea", "Area / city"],
  ["bySalesman", "Salesman"],
  ["byHelper", "Helper"],
  ["valuation", "Stock valuation"],
  ["dead", "Dead stock"],
  ["pl", "P&L"],
  ["gstr", "GSTR-1"],
] as const;

export default function Reports() {
  const { me, store, master } = useApp();
  const stores = useLiveQuery(() => db.stores.filter(s => !s.deleted).toArray(), [], []);
  const [picked, setBranch] = useState(store);
  // companies (owner, 27 Oct): only the master view can report on other companies or all of them together
  const branch = master ? picked : store;
  const today = localDay(new Date().toISOString());
  const d = new Date();
  const start = localDay(new Date(d.getFullYear(), d.getMonth(), 1).toISOString());
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("byDay");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const savedDivisor = useLiveQuery(async () => Number((await db.settings.get("report_divisor"))?.value) || 1, [], 1);
  const [factor, setFactor] = useState("");
  const divisor = (() => { const n = Number(factor || savedDivisor); return Number.isFinite(n) && n > 0 ? n : 1; })();
  useEffect(() => { setBusy(true); reportData({ from, to, store: branch }).then(setData).catch(e => toast(e.message || "Report failed", true)).finally(() => setBusy(false)); }, [from, to, branch]);
  if (!can(me, "reports")) return <div className="card empty"><b>Owner only</b>Reports include cost, supplier and profit data.</div>;
  const rows: ReportRow[] = data?.[tab] || [];
  const total = useMemo(() => rows.reduce((a, r) => a + (Number(r.sales) || Number(r.amount) || Number(r.cost_value) || 0), 0), [rows]);
  const view = useMemo(() => shown(rows, divisor), [rows, divisor]);
  return <div>
    <Head title="Reports" sub={`${from} to ${to}${busy ? " · loading" : ""}`}>
      <button className="btn p" onClick={() => exportExcel(`${tab}-${from}-to-${to}`, shown(rows, divisor, true))}><Icon n="download" size={18} />Excel</button>
      <button className="btn g" onClick={async () => {
        const text = view.slice(0, 20).map(r => Object.values(r).join(" · ")).join("\n");
        try { await navigator.share?.({ title: "Rungnna report", text }); } catch { await navigator.clipboard?.writeText(text); toast("Copied report text"); }
      }}>Share</button>
    </Head>
    <div className="card pad stack" style={{ marginBottom: 12 }}>
      {master && <label className="f">Company<select className="in" value={branch} onChange={e => setBranch(e.target.value)}><option value="all">All companies</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
      <div className="grid g3">
        <label className="f" title="Every amount on this page is divided by this number. 1 shows the real figures.">Factor (÷)<input className="in mono" inputMode="decimal" placeholder="1" value={factor || String(savedDivisor)} onChange={e => setFactor(e.target.value)} onBlur={() => { const n = Number(factor); if (factor && Number.isFinite(n) && n > 0) void setSetting("report_divisor", n); setFactor(""); }} /></label>
        <label className="f">From<input className="in" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
        <label className="f">To<input className="in" type="date" value={to} min={from} max={today} onChange={e => e.target.value && setTo(e.target.value)} /></label>
      </div>
      <div className="tabs">{tabs.map(([k, l]) => <a key={k} href={"#/reports"} className={tab === k ? "on" : ""} onClick={e => { e.preventDefault(); setTab(k); }}>{l}</a>)}</div>
    </div>
    <div className="hero three">
      <div><span className="k">Rows</span><b>{rows.length}</b></div>
      <div><span className="k">Primary total</span><b>{billAmount(Math.round(total / divisor))}</b></div>
      <div><span className="k">Customer dues in range</span><b style={{ fontSize: 20 }}>{billAmount(Math.round((data?.dues || 0) / divisor))}</b></div>
    </div>
    <ReportTable rows={view} />
    {tab === "gstr" && <div className="note sm" style={{ marginTop: 12 }}>GSTR-1 summary groups GST invoices into B2B/B2C and HSN-wise taxable value. Estimates are excluded unless private estimates are unlocked.</div>}
  </div>;
}

function ReportTable({ rows }: { rows: ReportRow[] }) {
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  return <div className="card tw"><table><thead><tr>{cols.map(c => <th key={c} className={/(amount|sales|cost|value|gst|taxable|rate|pct|invoices|credit_notes|qty)$/i.test(c) ? "r" : ""}>{c.replace(/_/g, " ")}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(c => <td key={c} className={typeof r[c] === "number" || MONEY.test(c) ? "r mono" : ""}>{r[c]}</td>)}</tr>)}
      {!rows.length && <tr><td colSpan={Math.max(1, cols.length)} className="empty">No rows for this range.</td></tr>}</tbody></table></div>;
}
