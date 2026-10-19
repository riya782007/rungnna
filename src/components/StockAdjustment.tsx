import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { useApp, toast } from "../lib/app";
import { can } from "../lib/roles";
import { inStore } from "../lib/scope";
import { setStockQuantity } from "../lib/stock-adjustment";

export function StockAdjustment({ productId }: { productId: string }) {
  const { me } = useApp();
  const current = useLiveQuery(async () => {
    const racks = new Set((await db.locations.filter(l => !l.deleted && inStore(l) && l.kind !== "bucket").toArray()).map(l => l.id));
    return (await db.stock.where("product_id").equals(productId).toArray()).filter(c => racks.has(c.loc_id)).reduce((n,c) => n+c.qty,0);
  }, [productId]);
  const [target, setTarget] = useState(""), [reason, setReason] = useState("");
  const [expected, setExpected] = useState<number>(), [busy, setBusy] = useState(false), [error, setError] = useState("");
  if (!can(me, "stock.move")) return null;
  return <section className="card"><header><h3>Set exact stock</h3><span className="pill">Available: {current ?? "…"}</span></header>
    <form className="pad stack" onSubmit={async event => {
      event.preventDefault(); if (busy || current === undefined) return;
      setBusy(true); setError("");
      try {
        if (!/^-?\d+$/.test(target.trim())) throw new Error("Enter a whole stock quantity");
        await setStockQuantity(productId, Number(target), reason, me?.id || "", expected ?? current);
        setTarget(""); setReason(""); setExpected(undefined); toast("Stock set to " + target);
      } catch (failure: any) { setError(failure.message || "Stock correction failed"); }
      finally { setBusy(false); }
    }}>
      <label className="f">Set total stock to<input className="in mono" type="number" step={1} value={target} onChange={event => { if (!target) setExpected(current); setTarget(event.target.value); setError(""); }} placeholder="For example 25, 0 or -5" /></label>
      <label className="f">Reason for stock correction<input className="in" value={reason} onChange={event => setReason(event.target.value)} required /></label>
      <div className="xs mut">Sets the available stock in this store to this exact number, including zero or negative stock. Quarantined stock stays separate. The correction is recorded in History.</div>
      {error && <div role="alert" className="note warn">{error}</div>}
      <button className="btn p" disabled={busy || !target.trim() || !reason.trim() || current === undefined}>{busy ? "Saving…" : "Set stock quantity"}</button>
    </form>
  </section>;
}
