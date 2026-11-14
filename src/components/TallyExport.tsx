import { useEffect, useState } from "react";
import { getSetting, setSetting } from "../lib/db";
import { tallyFile, TALLY_DEFAULTS, type TallyNames } from "../lib/tally";
import { toast } from "../lib/app";
import { Modal } from "./common";

/* Reports › Tally: the dates shown → one .xml file → Tally Prime › Gateway › Import › Transactions. */
export function TallyButton({ from, to, store }: { from: string; to: string; store: string }) {
  const [open, setOpen] = useState(false);
  const [n, setN] = useState<TallyNames>(TALLY_DEFAULTS);
  useEffect(() => { getSetting("tally_names", TALLY_DEFAULTS).then(v => setN({ ...TALLY_DEFAULTS, ...(v || {}) })); }, []);
  const make = async () => {
    await setSetting("tally_names", n);
    const r = await tallyFile(from, to, store, n);
    if (!r.count) return toast("No GST invoices, payments, purchases or expenses in these dates", true);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([r.xml], { type: "application/xml" }));
    a.download = `tally-${from}-to-${to}.xml`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast(`${r.count} entries in the Tally file${r.skipped ? ` · ${r.skipped} estimates left out (private)` : ""}`); setOpen(false);
  };
  const f = (k: keyof TallyNames, label: string) => <label className="f">{label}<input className="in" value={n[k]} onChange={e => setN({ ...n, [k]: e.target.value })} /></label>;
  return <>
    <button className="btn" onClick={() => setOpen(true)}>Tally file</button>
    {open && <Modal title={`Tally file · ${from} to ${to}`} onClose={() => setOpen(false)}>
      <div className="stack">
        <div className="xs mut">GST invoices, credit notes, payments taken, purchases and expenses of these dates. Estimates never go in. Ledgers are made in Tally by themselves (a "ledger already exists" line in Tally's import log is fine). Write the names exactly as they are in your Tally.</div>
        <div className="grid g2">{f("company", "Company name in Tally (blank = the open one)")}{f("sales", "Sales ledger")}{f("purchase", "Purchase ledger")}{f("cash", "Cash ledger")}{f("bank", "Bank ledger (UPI / card / bank)")}{f("cgst", "CGST ledger")}{f("sgst", "SGST ledger")}{f("igst", "IGST ledger")}</div>
        <button className="btn p" onClick={make}>Download Tally file (.xml)</button>
        <div className="xs mut">In Tally Prime: Gateway of Tally › Import › Transactions → choose this file → Import.</div>
      </div>
    </Modal>}
  </>;
}
