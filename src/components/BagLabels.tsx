import { useEffect, useState } from "react";
import type { Bill } from "../lib/db";
import { bagLabelJobs } from "../lib/bag-labels";
import { Modal } from "./common";
import { DEFAULT_CFG, LabelView, loadLabelCfg, useLabelPrint } from "../pages/Labels";
export function BagLabels({ bill, onClose }: { bill: Bill; onClose: () => void }) {
  const [cfg, setCfg] = useState(DEFAULT_CFG), [count, setCount] = useState(String(Math.max(1, bill.box_count || 1))), [error, setError] = useState("");
  const printer = useLabelPrint(cfg, setCfg);
  useEffect(() => { void loadLabelCfg().then(setCfg).catch(e => setError(e.message)); }, []);
  let jobs: ReturnType<typeof bagLabelJobs> = [];
  try { jobs = bagLabelJobs(bill, Number(count)); } catch {}
  return <Modal title="Customer bag labels" onClose={() => { if (!printer.busy) onClose(); }}>
    <div className="stack"><b>{bill.party_name}</b><span className="mono">{bill.no}</span>
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
