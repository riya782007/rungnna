import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Plus, Trash2 } from "lucide-react";
import { db, getSetting, setSetting } from "../lib/db";
import { api, blobToB64 } from "../lib/ai";
import { compress, savePhoto } from "../lib/image";
import { getRule, priceFromCost } from "../lib/pricing";
import { moneyInput } from "../lib/pos";
import { savePhotoPurchase, validatePhotoRows, type PhotoRow } from "../lib/purchase-photo";
import { currentStore } from "../lib/scope";
import { go, toast } from "../lib/app";
import { LocationSelect } from "./common";

const blank = (): PhotoRow => ({ item: "", style: "", color: "", unit: "PCS", hsn: "", qty: "", cost: "", rate: "" });
type Draft = { store: string; rows: PhotoRow[]; supplier: string; billNo: string; rack: string; photoId?: string; warnings: string; total: string };
export default function PurchasePhoto({ by }: { by: string }) {
  const [d, setD] = useState<Draft>({ store: currentStore(), rows: [], supplier: "", billNo: "", rack: "", warnings: "", total: "" });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [error, setError] = useState("");
  const lock = useRef(false), file = useRef<HTMLInputElement>(null);
  const suppliers = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);
  useEffect(() => { getSetting<Draft | null>("purchase_photo_draft", null).then(old => { if (old?.store === currentStore()) setD(old); setReady(true); }); }, []);
  useEffect(() => { if (ready) setSetting("purchase_photo_draft", d); }, [d, ready]);
  const set = (patch: Partial<Draft>) => { setReviewed(false); setD(x => ({ ...x, ...patch })); };
  const row = (i: number, key: keyof PhotoRow, value: string) => set({ rows: d.rows.map((r, k) => k === i ? { ...r, [key]: value } : r) });
  const read = async (files: File[]) => {
    if (!files.length || lock.current) return;
    if (files.length > 3) return setError("Choose up to three pages of one bill");
    if (!confirm("Send these purchase bill photos to the configured AI provider for reading?")) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const images = [];
      for (const f of files) { const { blob } = await compress(f, 2200, 800000); images.push({ data: await blobToB64(blob), mime: blob.type }); }
      const out = await api<any>("purchase-photo", { images });
      const rows: PhotoRow[] = out.rows.map((r: any) => Object.fromEntries(Object.keys(blank()).map(k => [k, typeof r[k] === "string" || typeof r[k] === "number" ? String(r[k]) : ""])) as PhotoRow);
      const supplier = suppliers.find(s => s.name.toLowerCase() === String(out.supplier || "").toLowerCase())?.id || "";
      set({ rows, supplier, billNo: String(out.bill_no || ""), total: String(out.invoice_total || ""), warnings: Array.isArray(out.warnings) ? out.warnings.map(String).join("\n") : "", photoId: await savePhoto(files[0]) });
    } catch (e: any) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  };
  const price = async () => {
    try { const rule = await getRule(); set({ rows: d.rows.map(r => r.rate || !r.cost ? r : { ...r, rate: String(priceFromCost(moneyInput(r.cost), rule, 1, r.unit).rate / 100) }) }); } catch (e: any) { setError(e.message); }
  };
  const save = async () => {
    if (!reviewed || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const p = await savePhotoPurchase(d.rows, { by, rack: d.rack, supplierId: d.supplier, billNo: d.billNo, photoId: d.photoId, invoiceTotal: d.total, note: [d.warnings, d.total ? "Supplier invoice total (as printed): " + d.total : ""].filter(Boolean).join("\n") });
      await setSetting("purchase_photo_draft", null); toast("Purchase saved · " + p.no); go("labels/purchase/" + p.id);
    } catch (e: any) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  };
  let total = "—";
  try { total = (validatePhotoRows(d.rows).reduce((n, r) => n + r.qty * r.cost, 0) / 100).toFixed(2); } catch { /* incomplete review */ }
  return <section className="purchase-photo stack">
    <div className="row"><b className="grow">Purchase bill photos</b><button className="btn" disabled={busy} onClick={() => file.current?.click()}><Camera size={17} />Read bill</button><button className="btn" disabled={busy} onClick={() => set({ rows: [...d.rows, blank()] })}><Plus size={17} />Line</button></div>
    <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp" multiple onChange={e => { void read(Array.from(e.target.files || [])); e.target.value = ""; }} />
    {busy && <div role="status">Processing…</div>}
    {!!d.rows.length && <>
      <div className="grid g3"><label className="f">Supplier<select className="in" value={d.supplier} onChange={e => set({ supplier: e.target.value })}><option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="f">Supplier bill no.<input className="in" value={d.billNo} onChange={e => set({ billNo: e.target.value })} /></label><LocationSelect value={d.rack} onChange={rack => set({ rack })} buckets={false} /></div>
      <div className="tw"><table className="pos-t"><thead><tr>{["Item", "Style/article", "Colour", "Unit", "HSN", "Qty", "Cost ₹", "Rate ₹", ""].map((x, i) => <th key={i}>{x}</th>)}</tr></thead><tbody>{d.rows.map((r, i) => <tr key={i}>{(Object.keys(blank()) as (keyof PhotoRow)[]).map(k => <td key={k}><input className="in" aria-label={`${k} line ${i + 1}`} value={r[k]} onChange={e => row(i, k, e.target.value)} style={{ minWidth: k === "item" || k === "style" ? 110 : 65 }} /></td>)}<td><button className="iconbtn" title="Remove line" aria-label="Remove line" onClick={() => set({ rows: d.rows.filter((_, k) => k !== i) })}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
      <div className="row"><button className="btn" disabled={busy} onClick={price}>Apply shop pricing</button><span>Goods cost ₹{total}</span><label className="f">Supplier payable ₹<input className="in" inputMode="decimal" value={d.total} onChange={e => set({ total: e.target.value })} /></label></div>
      {d.warnings && <div className="note warn" style={{ whiteSpace: "pre-wrap" }}>{d.warnings}</div>}
      <label className="row"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked quantities, units, costs, selling rates and tax/freight differences.</label>
      <button className="btn p" disabled={busy || !reviewed} onClick={save}>Save purchase & prepare labels</button>
    </>}
    {error && <div className="note warn" role="alert">{error}</div>}
  </section>;
}
