import { useEffect, useState } from "react";
import { db } from "../lib/db";
import { ask, transcribe, health, type Health } from "../lib/ai";
import { due } from "../lib/billing";
import { Head } from "../components/common";
import { MicButton } from "../components/Voice";
import { toast } from "../lib/app";

/* "Ask the shop" — questions in Hindi or English, answered from this device's own records. */
async function shopContext() {
  const d30 = new Date(Date.now() - 30 * 864e5).toISOString();
  const [bills, products, stock, parties, locs] = await Promise.all([
    db.bills.where("at").aboveOrEqual(d30).filter(b => !b.deleted).toArray(),
    db.products.filter(p => !p.deleted).toArray(), db.stock.toArray(), db.parties.filter(p => !p.deleted).toArray(), db.locations.toArray()]);
  const fin = bills.filter(b => b.status === "final");
  const byDay: Record<string, { sales: number; bills: number; gst: number; estimate: number }> = {};
  const byItem: Record<string, { pcs: number; value: number }> = {};
  const byStyle: Record<string, number> = {};
  const byParty: Record<string, { sales: number; due: number }> = {};
  for (const b of fin) {
    const k = b.at.slice(0, 10); const x = byDay[k] || (byDay[k] = { sales: 0, bills: 0, gst: 0, estimate: 0 });
    x.sales += b.net / 100; x.bills++; x[b.bill_type === "gst" ? "gst" : "estimate"] += b.net / 100;
    const pn = b.party_name || "Walk-in"; const pp = byParty[pn] || (byParty[pn] = { sales: 0, due: 0 }); pp.sales += b.net / 100; pp.due += Math.max(0, due(b)) / 100;
    for (const l of b.items) { const it = byItem[l.item || "?"] || (byItem[l.item || "?"] = { pcs: 0, value: 0 }); it.pcs += l.qty; it.value += l.amount / 100; byStyle[l.style] = (byStyle[l.style] || 0) + l.qty; }
  }
  const bucket = new Set(locs.filter(l => l.kind === "bucket").map(l => l.id));
  const onHand: Record<string, number> = {};
  stock.forEach(c => { if (!bucket.has(c.loc_id)) onHand[c.product_id] = (onHand[c.product_id] || 0) + c.qty; });
  const stockByItem: Record<string, number> = {};
  products.forEach(p => { stockByItem[p.item || "?"] = (stockByItem[p.item || "?"] || 0) + (onHand[p.id] || 0); });
  const low = products.filter(p => (onHand[p.id] || 0) > 0 && (onHand[p.id] || 0) <= (p.pack || 1) * 2).slice(0, 40).map(p => ({ style: p.style, item: p.item, color: p.color, left: onHand[p.id] }));
  const floorOf = (id: string) => locs.find(l => l.id === id)?.floor || "?";
  const floors: Record<string, number> = {}; stock.forEach(c => { if (!bucket.has(c.loc_id)) floors[floorOf(c.loc_id)] = (floors[floorOf(c.loc_id)] || 0) + c.qty; });
  return {
    today: new Date().toISOString().slice(0, 10), sales_by_day_last_30: byDay, sales_by_item: byItem,
    top_styles_sold: Object.entries(byStyle).sort((a, z) => z[1] - a[1]).slice(0, 25),
    customers: Object.entries(byParty).sort((a, z) => z[1].sales - a[1].sales).slice(0, 40),
    stock_pieces_by_item: stockByItem, stock_pieces_by_floor: floors, running_low: low,
    products_recorded: products.length, customers_recorded: parties.length,
    bills_on_hold: bills.filter(b => b.status === "hold").length, cancelled_bills_30d: bills.filter(b => b.status === "void").length,
  };
}

const SAMPLES = ["Aaj kitni sale hui, GST aur estimate alag?", "Which items sold most this week?", "Kaunse customer ka paisa baaki hai?", "Which styles are running low?", "Floor wise kitna maal hai?"];

export default function Ask() {
  const [q, setQ] = useState("");
  const [log, setLog] = useState<{ q: string; a: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [h, setH] = useState<Health | null>(null);
  useEffect(() => { health().then(setH).catch(() => setH(null)); }, []);
  async function go(question: string) {
    if (!question.trim()) return;
    setBusy(true);
    try { const a = await ask(question, await shopContext()); setLog(l => [{ q: question, a }, ...l]); setQ(""); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }
  return (
    <div>
      <Head eyebrow="AI assistant" title="Ask the shop" sub="Ask in Hindi or English — by typing or speaking. Answers come from your own bills and stock." />
      {h && !h.ai && <div className="note warn" style={{ marginBottom: 12 }}>The AI key isn't added yet. Owner: Vercel → project <b>rungnna_shop_os</b> → Settings → Environment Variables → <b>GEMINI_API_KEY</b>. Everything else works without it.</div>}
      <div className="card pad stack" style={{ marginBottom: 12 }}>
        <div className="row" style={{ flexWrap: "nowrap" }}>
          <input className="in grow" placeholder="Ask anything… e.g. is hafte sabse zyada kya bika?" value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === "Enter" && go(q)} />
          <MicButton busy={busy} label="🎙" onAudio={async a => { setBusy(true); try { const t = (await transcribe(a)).split("\nSummary:")[0].trim(); setQ(t); await go(t); } catch (e: any) { toast(e.message, true); setBusy(false); } }} />
          <button className="btn p" disabled={busy} onClick={() => go(q)}>{busy ? "Thinking…" : "Ask"}</button>
        </div>
        <div className="chips">{SAMPLES.map(s => <button key={s} className="chip" onClick={() => go(s)}>{s}</button>)}</div>
      </div>
      <div className="stack">{log.map((x, i) => <div key={i} className="card pad"><div className="xs mut b">{x.q}</div><div style={{ whiteSpace: "pre-wrap", marginTop: 6 }}>{x.a}</div></div>)}</div>
    </div>
  );
}
