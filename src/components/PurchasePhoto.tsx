import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Plus, Trash2 } from "lucide-react";
import { db, getSetting, setSetting } from "../lib/db";
import { api, blobToB64 } from "../lib/ai";
import { compress, savePhoto } from "../lib/image";
import { getRule, type PricingRule } from "../lib/pricing";
import { savePhotoPurchase, validatePhotoRows, pricePhotoRows, type PhotoRow } from "../lib/purchase-photo";
import { currentStore } from "../lib/scope";
import { go, toast } from "../lib/app";
import { LocationSelect } from "./common";

const blank = (): PhotoRow => ({ item: "", style: "", color: "", unit: "PCS", hsn: "", qty: "", cost: "", rate: "" });
const captions: Record<keyof PhotoRow, string> = { item: "Item", style: "Style/article", color: "Colour", unit: "Unit", hsn: "HSN", qty: "Qty", cost: "Cost ₹", rate: "Rate ₹" };
type Draft = { store: string; rows: PhotoRow[]; supplier: string; billNo: string; rack: string; photoId?: string; warnings: string; total: string };
export default function PurchasePhoto({ by }: { by: string }) {
  const [d, setD] = useState<Draft>({ store: currentStore(), rows: [], supplier: "", billNo: "", rack: "", warnings: "", total: "" });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [error, setError] = useState("");
  const [connection, setConnection] = useState(""), [checking, setChecking] = useState(false);
  const [pricing, setPricing] = useState<PricingRule | null>(null);
  const lock = useRef(false), file = useRef<HTMLInputElement>(null);
  const suppliers = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);
  useEffect(() => { getSetting<Draft | null>("purchase_photo_draft", null).then(old => { if (old?.store === currentStore()) setD(old); setReady(true); }); }, []);
  useEffect(() => { if (ready) setSetting("purchase_photo_draft", d); }, [d, ready]);
  const set = (patch: Partial<Draft>) => { setReviewed(false); setD(x => ({ ...x, ...patch })); };
  const row = (i: number, key: keyof PhotoRow, value: string) => set({ rows: d.rows.map((r, k) => k === i ? { ...r, [key]: value } : r) });
  const check = async () => {
    setChecking(true);
    try { const r = await api<{ configured: boolean; model: string }>("purchase-photo"); setConnection(r.configured ? `Gemini configured · ${r.model}` : "Gemini needs GEMINI_API_KEY in Vercel Production environment variables, then redeploy."); }
    catch (e: any) { setConnection(e.message); } finally { setChecking(false); }
  };
  const read = async (files: File[]) => {
    if (!files.length || lock.current) return;
    if (files.length > 3) return setError("Choose up to three pages of one bill");
    if (!confirm("Send these purchase bill photos to the configured AI provider for reading?")) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const images = [];
      for (const f of files) { const { blob } = await compress(f, 2200, 800000); images.push({ data: await blobToB64(blob), mime: blob.type }); }
      const out = await api<any>("purchase-photo", { images });
      const rule = await getRule(); setPricing(rule);
      const rows: PhotoRow[] = pricePhotoRows(out.rows.map((r: any) => Object.fromEntries(Object.keys(blank()).map(k => [k, typeof r[k] === "string" || typeof r[k] === "number" ? String(r[k]) : ""])) as PhotoRow), rule);
      const supplier = suppliers.find(s => s.name.toLowerCase() === String(out.supplier || "").toLowerCase())?.id || "";
      set({ rows, supplier, billNo: String(out.bill_no || ""), total: String(out.invoice_total || ""), warnings: Array.isArray(out.warnings) ? out.warnings.map(String).join("\n") : "", photoId: await savePhoto(files[0]) });
    } catch (e: any) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  };
  const price = async () => {
    try { const rule = await getRule(); setPricing(rule); set({ rows: pricePhotoRows(d.rows, rule) }); } catch (e: any) { setError(e.message); }
  };
  const save = async () => {
    if (!reviewed || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const p = await savePhotoPurchase(d.rows, { by, rack: d.rack, supplierId: d.supplier, billNo: d.billNo, photoId: d.photoId, invoiceTotal: d.total, note: [d.warnings, d.total ? "Supplier invoice total (as printed): " + d.total : ""].filter(Boolean).join("\n") });
      toast("Purchase saved · " + p.no); go("labels/purchase/" + p.id + "/print");
    } catch (e: any) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  };
  let total = "—", labelCount = 0, validation = "";
  try { const rows = validatePhotoRows(d.rows); total = (rows.reduce((n, r) => n + r.qty * r.cost, 0) / 100).toFixed(2); labelCount = rows.reduce((n, r) => n + r.qty, 0); if (labelCount > 5000) validation = "More than 5000 labels: split this purchase into smaller batches."; } catch (e: any) { validation = e.message; }
  return <section className="purchase-photo stack">
    <div className="row"><b className="grow">Purchase bill photos</b><button className="btn" disabled={checking || busy} onClick={check}>{checking ? "Checking…" : "Check Gemini"}</button><button className="btn" disabled={busy} onClick={() => file.current?.click()}><Camera size={17} />Read bill</button><button className="btn" disabled={busy} onClick={() => set({ rows: [...d.rows, blank()] })}><Plus size={17} />Line</button></div>
    {connection && <div role="status" className="note">{connection}</div>}
    <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp" multiple onChange={e => { void read(Array.from(e.target.files || [])); e.target.value = ""; }} />
    {busy && <div role="status">Processing…</div>}
    {!!d.rows.length && <>
      <div className="grid g3"><label className="f">Supplier<select className="in" value={d.supplier} onChange={e => set({ supplier: e.target.value })}><option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label className="f">Supplier bill no.<input className="in" value={d.billNo} onChange={e => set({ billNo: e.target.value })} /></label><LocationSelect value={d.rack} onChange={rack => set({ rack })} buckets={false} /></div>
      <div className="tw"><table className="pos-t"><thead><tr>{[...Object.values(captions), ""].map((x, i) => <th key={i}>{x}</th>)}</tr></thead><tbody>{d.rows.map((r, i) => <tr key={i}>{(Object.keys(blank()) as (keyof PhotoRow)[]).map(k => <td key={k} data-l={captions[k]}><input className="in" aria-label={`${k} line ${i + 1}`} value={r[k]} onChange={e => row(i, k, e.target.value)} style={{ minWidth: k === "item" || k === "style" ? 110 : 65 }} /></td>)}<td><button className="iconbtn" title="Remove line" aria-label="Remove line" onClick={() => set({ rows: d.rows.filter((_, k) => k !== i) })}><Trash2 size={16} /></button></td></tr>)}</tbody></table></div>
      <div className="row"><button className="btn" disabled={busy} onClick={price}>Apply shop pricing</button><span>Goods cost ₹{total}</span><label className="f">Supplier payable ₹<input className="in" inputMode="decimal" value={d.total} onChange={e => set({ total: e.target.value })} /></label></div>
      {pricing && <div className="row sm"><span>Pricing: {pricing.margin.mode === "percent" ? `+${pricing.margin.percent}%` : `${pricing.margin.mode === "divide" ? "÷" : "×"}${pricing.margin.factor}`} · round ₹{pricing.margin.round_to} {pricing.margin.round_dir}</span><a href="#/settings">Pricing settings</a></div>}
      <div className="row"><b>{labelCount} labels</b><span>One label per PCS / PAIR / SET</span></div>
      {validation && <div className="note warn" role="status">{validation}</div>}
      {d.warnings && <div className="note warn" style={{ whiteSpace: "pre-wrap" }}>{d.warnings}</div>}
      <label className="row"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked quantities, units, costs, selling rates and tax/freight differences.</label>
      <button className="btn p" disabled={busy || !reviewed || !!validation || !d.supplier || !d.rack || !d.billNo.trim()} onClick={save}>Save purchase & print {labelCount || ""} labels</button>
    </>}
    {error && <div className="note warn" role="alert">{error}</div>}
  </section>;
}
