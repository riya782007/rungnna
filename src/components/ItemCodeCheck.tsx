import { useEffect, useState } from "react";
import { auditItemCodes, fixProductCode, unshareLabel, type CodeAudit } from "../lib/products";
import { toast } from "../lib/app";

/* Item-code checkup: finds the saved data that makes a scan report a different item
   than the sticker shows, and fixes it in one tap. */
export function ItemCodeCheck() {
  const [audit, setAudit] = useState<CodeAudit | null>(null), [busy, setBusy] = useState(false);
  const run = async () => { setBusy(true); try { setAudit(await auditItemCodes()); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  useEffect(() => { void run(); }, []);
  const act = async (job: () => Promise<unknown>, done: string) => { setBusy(true); try { await job(); toast(done); setAudit(await auditItemCodes()); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  if (!audit) return <div className="sm mut">Checking item codes…</div>;
  const { wrongCode, ignoredNames, sharedLabels } = audit;
  const clean = !wrongCode.length && !ignoredNames.length && !sharedLabels.length;
  return <div className="stack" style={{ gap: 10 }}>
    {clean && <div className="note sm ok-text">All item codes agree with their names. Scans and new labels will report the right item.</div>}
    {!!wrongCode.length && <div className="stack" style={{ gap: 6 }}>
      <b className="bad-text">{wrongCode.length} product{wrongCode.length === 1 ? "" : "s"} carry another item's code</b>
      <span className="xs mut">Their labels print one name but the QR says another, so billing shows the wrong item. Fix the code, then reprint their labels.</span>
      {wrongCode.map(({ p, means, fixCode }) => <div key={p.id} className="item" style={{ flexWrap: "wrap" }}>
        <span className="grow"><b>{p.item}</b> <span className="mono xs">{p.style} · {p.color}</span><div className="xs">code {p.item_code} means <b>{means}</b></div></span>
        <button className="btn sm p" disabled={busy} onClick={() => act(() => fixProductCode(p, fixCode), fixCode ? `${p.item} now uses code ${fixCode}` : `Wrong code removed from ${p.item}`)}>{fixCode ? `Use code ${fixCode}` : "Remove wrong code"}</button>
      </div>)}
    </div>}
    {!!sharedLabels.length && <div className="stack" style={{ gap: 6 }}>
      <b className="bad-text">{sharedLabels.length} sticker{sharedLabels.length === 1 ? " is" : "s are"} linked to more than one product</b>
      {sharedLabels.map(({ raw, products }) => <div key={raw} className="item" style={{ flexWrap: "wrap" }}>
        <span className="grow"><code className="xs" style={{ overflowWrap: "anywhere" }}>{raw}</code><div className="xs">{products.map(p => p.item || "(no name)").join(" · ")}</div></span>
        <button className="btn sm p" disabled={busy} onClick={() => act(() => unshareLabel(raw), "Sticker kept only on the product it describes")}>Fix</button>
      </div>)}
    </div>}
    {!!ignoredNames.length && <div className="note sm">
      <b>Names ignored in favour of the old software's list:</b> {ignoredNames.map(n => `${n.code} was saved as ${n.learned}, the old software says ${n.means}`).join(" · ")}.
    </div>}
    <button className="btn sm" disabled={busy} onClick={run}>{busy ? "Checking…" : "Check again"}</button>
  </div>;
}
