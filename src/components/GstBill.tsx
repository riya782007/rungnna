import { useEffect, useState } from "react";
import { db, put, type Bill, type Transport } from "../lib/db";
import type { Shop } from "../lib/billing";
import { canCancel, ewbRequired, irnEligible, validateGst, type GstKind } from "../lib/gst";
import { downloadGst, gstRequest, submitGst } from "../lib/compliance";
import { assertUnlocked } from "../lib/finance";
import { toast, useApp } from "../lib/app";
import { Icon } from "./Icon";
export function GstBill({ b, shop }: { b: Bill; shop: Shop }) {
  const { me } = useApp();
  const [tr, setTr] = useState<Transport>(b.transport || { vehicle_no: "", transporter_id: "", transporter_name: "", distance: 1, mode: "1", from_city: "", from_pin: "", to_address: "", to_city: "", to_pin: "", to_state_code: b.party_gstin.slice(0, 2) });
  const [configured, setConfigured] = useState(false), [sandbox, setSandbox] = useState(true), [busy, setBusy] = useState(false);
  useEffect(() => { if (me?.role === "owner") gstRequest().then(j => { setConfigured(j.configured); setSandbox(j.sandbox); }).catch(() => {}); }, [me?.role]);
  useEffect(() => { if (!b.transport && b.party_id) db.parties.get(b.party_id).then(p => { if (p) setTr(t => ({ ...t, to_address: p.address, to_city: p.city, to_pin: p.pin })); }); }, [b.party_id]);
  if (b.status !== "final" || !["gst", "challan"].includes(b.bill_type)) return null;
  const draft = { ...b, transport: tr };
  const run = async (fn: () => Promise<void> | void) => { setBusy(true); try { await fn(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const save = async () => {
    await db.transaction("rw", [db.bills, db.config, db.outbox], async () => {
      await assertUnlocked(b.at);
      const current = await db.bills.get(b.id);
      if (!current || current.status !== "final") throw new Error("Document is no longer final");
      if (current.compliance?.irn || current.compliance?.ewb) {
        if (JSON.stringify(current.transport) !== JSON.stringify(tr)) throw new Error("Registered transport details cannot be edited");
        return;
      }
      await put("bills", { ...current, transport: tr });
    });
  };
  const field = (key: keyof Transport, label: string) => <label className="f">{label}<input className="in" value={String(tr[key] || "")} onChange={e => setTr({ ...tr, [key]: key === "distance" ? Number(e.target.value) : key === "vehicle_no" ? e.target.value.toUpperCase().replace(/\s/g, "") : e.target.value })} /></label>;
  return <section className="stack gst-panel">
    <h3>Government documents {ewbRequired(b) && <span className="pill warn">E-way bill required</span>}</h3>
    <div className="grid g2">{field("from_city", "Dispatch city")}{field("from_pin", "Dispatch PIN")}{field("to_address", "Delivery address")}{field("to_city", "Delivery city")}{field("to_pin", "Delivery PIN")}{field("to_state_code", "GST state code")}{field("vehicle_no", "Vehicle number")}{field("distance", "Distance (km)")}{field("transporter_name", "Transporter")}{field("transporter_id", "Transporter ID")}
      <label className="f">Transport mode<select className="in" value={tr.mode} onChange={e => setTr({ ...tr, mode: e.target.value as Transport["mode"] })}><option value="1">Road</option><option value="2">Rail</option><option value="3">Air</option><option value="4">Ship</option></select></label>
      {field("doc_no", "Transport document")}{field("doc_date", "Transport document date (YYYY-MM-DD)")}</div>
    {(["irn", "ewb"] as GstKind[]).filter(k => k !== "irn" || irnEligible(b)).map(kind => {
      const errors = validateGst(draft, shop, kind), record = b.compliance?.[kind];
      return <div className="stack" key={kind}>
        <b>{kind === "irn" ? "E-invoice" : "E-way bill"}</b>
        {record && <div className="note sm">{record.sandbox ? "SANDBOX · " : ""}{record.id}{record.cancelled_at ? " · Cancelled" : ""}</div>}
        {errors.length > 0 && <div className="note warn sm">{errors.join(" · ")}</div>}
        <div className="row"><button className="btn" disabled={busy || !!errors.length} onClick={() => run(async () => { await save(); downloadGst(draft, shop, kind); })}><Icon n="download" size={16} />Download JSON</button>
          {configured && me?.role === "owner" && !record && <button className="btn p" disabled={busy || !!errors.length} onClick={() => run(async () => { await save(); await submitGst(draft, kind, "generate"); toast("Acknowledgement saved"); })}>{sandbox ? "Submit to sandbox" : "Generate"}</button>}
          {configured && me?.role === "owner" && canCancel(record) && <button className="btn bad" disabled={busy} onClick={() => { const reason = prompt("Cancellation reason"); if (reason) run(() => submitGst(b, kind, "cancel", reason)); }}>Cancel within 24 hours</button>}</div>
      </div>;
    })}
  </section>;
}
