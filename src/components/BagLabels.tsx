import { useEffect, useState } from "react";
import type { Bill } from "../lib/db";
import { bagLabelJobs, carryBags } from "../lib/bag-labels";
import { Modal } from "./common";
import { DEFAULT_CFG, LabelView, loadLabelCfg, useLabelPrint } from "../pages/Labels";
/* Owner, 6 Nov 23:11 (voice): "we give the print command and then wait — five, six parcels: take out their slips first
   and give one command". Several saved bills at once: every bill's bag stickers in ONE print run, in bill order. */
export function ManyBagLabels({ bills, onClose }: { bills: Bill[]; onClose: () => void }) {
  const [cfg, setCfg] = useState(DEFAULT_CFG), [error, setError] = useState("");
  const [counts, setCounts] = useState<Record<string, string>>(() => Object.fromEntries(bills.map(b => [b.id, String(carryBags(b))])));
  const printer = useLabelPrint(cfg, setCfg);
  useEffect(() => { void loadLabelCfg().then(setCfg).catch(e => setError(e.message)); }, []);
  const jobsOf = () => bills.flatMap(b => bagLabelJobs(b, Number(counts[b.id])));
  let jobs: ReturnType<typeof bagLabelJobs> = [], bad = "";
  try { jobs = jobsOf(); } catch (e: any) { bad = e.message; }
  return <Modal title={`Parcel slips · ${bills.length} bill${bills.length > 1 ? "s" : ""}`} onClose={() => { if (!printer.busy) onClose(); }}>
    <div className="stack">
      <div className="sm">Bag stickers of every bill below in one print. Change a bill's number of bags if needed.</div>
      <div className="stack" style={{ gap: 6, maxHeight: 300, overflow: "auto" }}>{bills.map(b => <div key={b.id} className="row" style={{ gap: 8 }}>
        <span className="grow"><b>{b.party_name}</b> <span className="mono xs">{b.no}</span></span>
        <label className="row xs" style={{ gap: 4 }}>Bags<input className="in mono" style={{ width: 70 }} type="number" min={1} max={500} step={1} value={counts[b.id]} disabled={printer.busy}
          onChange={e => setCounts(c => ({ ...c, [b.id]: e.target.value }))} /></label></div>)}</div>
      {jobs[0] && <div className="labelprev"><LabelView cfg={cfg} p={jobs[0].p} bag={jobs[0].bag} /></div>}
      <button className="btn p" disabled={printer.busy || !jobs.length} onClick={async () => {
        try { const current = await loadLabelCfg(); setCfg(current); const result = printer.start(jobsOf(), current.output === "tspl", true, current); if (!result.started) setError(result.message); else setError(""); } catch (e: any) { setError(e.message); }
      }}>Print all {jobs.length || ""} slips</button>
      {(error || bad) && <div role="alert" className="note warn">{error || bad}</div>}
      {printer.panel}
    </div>
  </Modal>;
}

export function BagLabels({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const [cfg, setCfg] = useState(DEFAULT_CFG), [count, setCount] = useState(String(carryBags(bill))), [error, setError] = useState("");
  const printer = useLabelPrint(cfg, setCfg);
  useEffect(() => { void loadLabelCfg().then(setCfg).catch(e => setError(e.message)); }, []);
  let jobs: ReturnType<typeof bagLabelJobs> = [];
  try { jobs = bagLabelJobs(bill, Number(count)); } catch {}
  return <Modal title="Print customer bag stickers (optional)" onClose={() => { if (!printer.busy) onClose(); }}>
    <div className="stack"><div className="note sm">This {bill.bill_type === "estimate" ? "estimate" : bill.bill_type === "gst" ? "tax invoice" : "challan"} is already saved. Print bag stickers if needed, or close this window.</div><b>{bill.party_name}</b><span className="mono">{bill.no}</span>
      <label className="f">Number of bags<input className="in mono" type="number" min={1} max={5000} step={1} value={count} disabled={printer.busy} onChange={e => setCount(e.target.value)} /></label>
      <div className="sm">Each sticker shows this customer's bill name, bill number and its own bag number. Reprinting keeps the same bag barcode.</div>
      {jobs[0] && <div className="labelprev"><LabelView cfg={cfg} p={jobs[0].p} bag={jobs[0].bag} /></div>}
      <button className="btn p" disabled={printer.busy || !jobs.length} onClick={async () => {
        try { const current = await loadLabelCfg(); setCfg(current); const result = printer.start(bagLabelJobs(bill, Number(count)), current.output === "tspl", true, current); if (!result.started) setError(result.message); else setError(""); } catch (e: any) { setError(e.message); }
      }}>Print {jobs.length || ""} bag labels</button>
      {error && <div role="alert" className="note warn">{error}</div>}
      {!jobs.length && <div role="status" className="note warn">Save a named customer bill and enter 1–5000 bags.</div>}
      {printer.panel}
    </div>
  </Modal>;
}
