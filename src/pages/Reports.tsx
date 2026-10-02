import { useEffect, useMemo, useState } from "react";
import { reportData, exportExcel, type ReportRow } from "../lib/reports";
import { localDay } from "../lib/ledger";
import { useApp, toast } from "../lib/app";
import { can } from "../lib/roles";
import { rupees } from "../lib/format";
import { Head } from "../components/common";
import { Icon } from "../components/Icon";
import { db } from "../lib/db";
import { useLiveQuery } from "dexie-react-hooks";

const tabs = [
  ["byDay", "Sales by day"],
  ["byMonth", "Sales by month"],
  ["byItem", "Item-wise"],
  ["byParty", "Party-wise"],
  ["byArea", "Area / city"],
  ["bySalesman", "Salesman"],
  ["valuation", "Stock valuation"],
  ["dead", "Dead stock"],
  ["pl", "P&L"],
  ["gstr", "GSTR-1"],
] as const;

export default function Reports() {
  const { me, store } = useApp();
  const stores = useLiveQuery(() => db.stores.filter(s => !s.deleted).toArray(), [], []);
  const [branch, setBranch] = useState(store);
  const today = localDay(new Date().toISOString());
  const d = new Date();
  const start = localDay(new Date(d.getFullYear(), d.getMonth(), 1).toISOString());
  const [from, setFrom] = useState(start);
  const [to, setTo] = useState(today);
  const [tab, setTab] = useState<(typeof tabs)[number][0]>("byDay");
  const [data, setData] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { setBusy(true); reportData({ from, to, store: branch }).then(setData).catch(e => toast(e.message || "Report failed", true)).finally(() => setBusy(false)); }, [from, to, branch]);
  if (!can(me, "reports")) return <div className="card empty"><b>Owner only</b>Reports include cost, supplier and profit data.</div>;
  const rows: ReportRow[] = data?.[tab] || [];
  const total = useMemo(() => rows.reduce((a, r) => a + (Number(r.sales) || Number(r.amount) || Number(r.cost_value) || 0), 0), [rows]);
  return <div>
    <Head title="Reports" sub={`${from} to ${to}${busy ? " · loading" : ""}`}>
      <button className="btn p" onClick={() => exportExcel(`${tab}-${from}-to-${to}`, rows)}><Icon n="download" size={18} />Excel</button>
      <button className="btn g" onClick={async () => {
        const text = rows.slice(0, 20).map(r => Object.values(r).join(" · ")).join("\n");
        try { await navigator.share?.({ title: "Rungnna report", text }); } catch { await navigator.clipboard?.writeText(text); toast("Copied report text"); }
      }}>Share</button>
    </Head>
    <div className="card pad stack" style={{ marginBottom: 12 }}>
      <label className="f">Store<select className="in" value={branch} onChange={e => setBranch(e.target.value)}><option value="all">All stores</option>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <div className="grid g2">
        <label className="f">From<input className="in" type="date" value={from} max={to} onChange={e => e.target.value && setFrom(e.target.value)} /></label>
        <label className="f">To<input className="in" type="date" value={to} min={from} max={today} onChange={e => e.target.value && setTo(e.target.value)} /></label>
      </div>
      <div className="tabs">{tabs.map(([k, l]) => <a key={k} href={"#/reports"} className={tab === k ? "on" : ""} onClick={e => { e.preventDefault(); setTab(k); }}>{l}</a>)}</div>
    </div>
    <div className="hero three">
      <div><span className="k">Rows</span><b>{rows.length}</b></div>
      <div><span className="k">Primary total</span><b>{rupees(total)}</b></div>
      <div><span className="k">Customer dues in range</span><b style={{ fontSize: 20 }}>{rupees(data?.dues || 0)}</b></div>
    </div>
    <ReportTable rows={rows} />
    {tab === "gstr" && <div className="note sm" style={{ marginTop: 12 }}>GSTR-1 summary groups GST invoices into B2B/B2C and HSN-wise taxable value. Estimates are excluded unless private estimates are unlocked.</div>}
  </div>;
}

function ReportTable({ rows }: { rows: ReportRow[] }) {
  const cols = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const val = (v: string | number) => typeof v === "number" && Math.abs(v) >= 1000 ? rupees(v) : v;
  return <div className="card tw"><table><thead><tr>{cols.map(c => <th key={c} className={/(amount|sales|cost|value|gst|taxable|rate)$/i.test(c) ? "r" : ""}>{c.replace(/_/g, " ")}</th>)}</tr></thead>
    <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(c => <td key={c} className={typeof r[c] === "number" ? "r mono" : ""}>{val(r[c])}</td>)}</tr>)}
      {!rows.length && <tr><td colSpan={Math.max(1, cols.length)} className="empty">No rows for this range.</td></tr>}</tbody></table></div>;
}
