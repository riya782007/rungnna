import { DeleteButton } from "./DeleteButton";
import { confirmDelete } from "../lib/confirm-delete";
import { useEffect, useState } from "react";
import { db, type Bill } from "../lib/db";
import { purgeEstimates, allEstimateDocs, removeCloudVoice, type PurgeResult } from "../lib/estimatePurge";
import { codeIs, getPrivate } from "../lib/privacy";
import { syncNow } from "../lib/sync";
import { rupees } from "../lib/format";
import { Modal, Switch } from "./common";
import { useApp, toast } from "../lib/app";

/* Deletes estimates for good: the chosen ones, or ALL of them (`all`). Two locks on a step that can't be undone:
   the owner types the words, and enters the estimate code again. */
export function DeleteEstimates({ bills, all = false, onClose }: { bills?: Bill[]; all?: boolean; onClose: () => void }) {
  const { me } = useApp();
  const [list, setList] = useState<Bill[] | null>(all ? null : bills || []);
  const [back, setBack] = useState(false);
  const [typed, setTyped] = useState(""), [code, setCode] = useState(""), [hasCode, setHasCode] = useState(true);
  const [busy, setBusy] = useState(false), [done, setDone] = useState<PurgeResult | null>(null);
  useEffect(() => { if (all) allEstimateDocs().then(setList); getPrivate().then(c => setHasCode(!!c)); }, [all]);
  if (!list) return <Modal title="Delete all estimates" onClose={onClose}><div role="status">Counting…</div></Modal>;

  const ests = list.filter(b => b.bill_type === "estimate"), ecns = list.filter(b => b.bill_type === "return");
  const held = ests.filter(b => b.status === "hold").length;
  const kept = ests.filter(b => b.status === "converted" || b.status === "merged").length;
  const total = ests.filter(b => b.status === "final").reduce((a, b) => a + b.net, 0);
  const paid = ests.filter(b => b.paid || b.advance).length;
  const word = all ? "DELETE ALL" : list.length > 1 ? "DELETE" : "YES";
  const title = all ? "Delete all estimates" : `Delete ${list.length} estimate${list.length > 1 ? "s" : ""}`;

  if (done) return (
    <Modal title={title} onClose={onClose}><div className="stack">
      <div className="note"><b>Deleted.</b> {done.estimates} estimate{done.estimates === 1 ? "" : "s"}{done.creditNotes ? `, ${done.creditNotes} estimate credit note${done.creditNotes === 1 ? "" : "s"}` : ""}.{done.movements ? ` ${done.movements} stock entr${done.movements === 1 ? "y" : "ies"} no longer name them.` : ""}{done.receipts ? ` ${done.receipts} receipt${done.receipts === 1 ? "" : "s"} corrected.` : ""}{done.invoicesKept ? ` ${done.invoicesKept} tax invoice${done.invoicesKept === 1 ? "" : "s"} made from them kept.` : ""}{done.backOnRacks ? ` ${done.backOnRacks} pieces back on the racks.` : ""}</div>
      <div className="sm mut">Other counters and the cloud drop them at their next sync. Not reachable from here: bills already sent on WhatsApp or printed, backup files saved to a disk, and anything half-typed on another counter.</div>
      <button className="btn p" onClick={onClose}>Done</button>
    </div></Modal>);

  if (!list.length) return <Modal title={title} onClose={onClose}><div className="stack"><div className="sm">There are no estimates to delete.</div><button className="btn" onClick={onClose}>Close</button></div></Modal>;

  return (
    <Modal title={title} onClose={onClose}>
      <div className="stack">
        <div className="sm">
          <b>{ests.length} estimate{ests.length === 1 ? "" : "s"}</b>{total ? <> worth <b>{rupees(total)}</b></> : null}
          {ecns.length ? <>, and <b>{ecns.length}</b> credit note{ecns.length === 1 ? "" : "s"} returning goods from them</> : null}
          {held ? <> ({held} on hold)</> : null} will be removed from this counter, every other counter and the cloud. <b>This cannot be undone.</b>
        </div>
        <ul className="sm" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Stock entries stay, so the racks stay right, but no longer show the estimate number or the customer.</li>
          {paid > 0 && <li>{paid} have payments recorded: those come off the receipts, so customers' balances change.</li>}
          {kept > 0 && <li>{kept} became tax invoices: the invoices stay exactly as they are.</li>}
        </ul>
        <Switch on={back} onChange={setBack} label="Put the pieces back on the racks" hint="Only if the goods never left the shop (quotations). Leave off if they were delivered." />
        <label className="f">Type {word} to confirm<input className="in mono" value={typed} onChange={e => setTyped(e.target.value.toUpperCase())} /></label>
        {hasCode && <label className="f">Estimate code<input className="in mono" type="password" autoComplete="off" value={code} onChange={e => setCode(e.target.value)} /></label>}
        <button className="btn" autoFocus disabled={busy} onClick={onClose}>No, keep estimates</button>
        <DeleteButton className="btn bad big" disabled={typed.trim() !== word || (hasCode && !code) || busy} onDelete={async () => {
          if (!await confirmDelete("Permanently delete " + list.length + " estimate document(s)?")) return;
          if (hasCode && !(await codeIs(code))) return toast("That is not the estimate code", true);
          setBusy(true);
          try {
            // re-read: something may have changed while the box was open
            const fresh = all ? await allEstimateDocs() : ((await db.bills.bulkGet(list.map(b => b.id))).filter(Boolean) as Bill[]);
            const r = await purgeEstimates(fresh, { returnStock: back, by: me?.name || "" });
            setDone(r);
            void syncNow();
            void removeCloudVoice(r.voiceFiles).catch(() => 0);
          } catch (e: any) { toast(e.message || "Could not delete", true); }
          finally { setBusy(false); }
        }}>{busy ? "Deleting…" : all ? "Delete all estimates permanently" : "Delete permanently"}</DeleteButton>
      </div>
    </Modal>
  );
}
