import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Plus, Trash2 } from "lucide-react";
import { db, getSetting, setSetting, type Product, type Purchase } from "../lib/db";
import { api, blobToB64 } from "../lib/ai";
import { compress, savePhoto } from "../lib/image";
import { getRule, type PricingRule } from "../lib/pricing";
import {
  savePhotoPurchase, validatePhotoRows, pricePhotoRows, applyVendorTerms,
  autoArticle, autoArticleCount, draftLabelProducts, type PhotoRow,
} from "../lib/purchase-photo";
import { purchaseLabelJobs, productForLabel } from "../lib/purchase-labels";
import { DEFAULT_CFG, LabelView, PrintSheet, validateLabelPrint, type LabelCfg, type Job } from "../pages/Labels";
import { usePrintJob } from "../lib/printing";
import { labelTSPL } from "../lib/label-tspl";
import { printTSPL, directPrintSupported } from "../lib/tsc";
import { ownPayload } from "../lib/parse";
import { currentStore } from "../lib/scope";
import { toast } from "../lib/app";
import { LocationSelect } from "./common";

const blank = (): PhotoRow => ({ item: "", style: "", color: "", unit: "PCS", hsn: "", qty: "", cost: "", rate: "" });
const captions: Record<string, string> = { item: "Item", style: "Style/article", color: "Colour", unit: "Unit", hsn: "HSN", qty: "Qty", cost: "Cost ₹", rate: "Rate ₹" };
const FIELDS = ["item", "style", "color", "unit", "hsn", "qty", "cost", "rate"] as const;
type Field = (typeof FIELDS)[number];

type Draft = { store: string; rows: PhotoRow[]; supplier: string; billNo: string; rack: string; photoId?: string; warnings: string; total: string };

export default function PurchasePhoto({ by }: { by: string }) {
  const [d, setD] = useState<Draft>({ store: currentStore(), rows: [], supplier: "", billNo: "", rack: "", warnings: "", total: "" });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [error, setError] = useState("");
  const [connection, setConnection] = useState(""), [checking, setChecking] = useState(false);
  const [pricing, setPricing] = useState<PricingRule | null>(null);
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [jobs, setJobs] = useState<Job[]>([]);          // labels for the purchase just saved
  const [printing, setPrinting] = useState(false);
  const [saved, setSaved] = useState<Purchase | null>(null);
  const lock = useRef(false), file = useRef<HTMLInputElement>(null);
  const suppliers = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);

  useEffect(() => { getSetting<Draft | null>("purchase_photo_draft", null).then(old => { if (old?.store === currentStore()) setD(old); setReady(true); }); }, []);
  useEffect(() => { if (ready) setSetting("purchase_photo_draft", d); }, [d, ready]);
  // the same printer settings the Labels page uses, so a sticker printed here is that sticker
  useEffect(() => { getSetting<LabelCfg>("label_cfg", DEFAULT_CFG).then(c => setCfg({ ...DEFAULT_CFG, ...c, show: { ...DEFAULT_CFG.show, ...c.show } })); }, []);

  const set = (patch: Partial<Draft>) => { setReviewed(false); setD(x => ({ ...x, ...patch })); };
  const row = (i: number, key: Field, value: string) =>
    set({ rows: d.rows.map((r, k) => k === i ? { ...r, [key]: value, ...(key === "style" ? { autoStyle: false } : {}) } : r) });

  const check = async () => {
    setChecking(true);
    try { const r = await api<{ configured: boolean; model: string }>("purchase-photo"); setConnection(r.configured ? `Gemini configured · ${r.model}` : "Gemini needs GEMINI_API_KEY in Vercel Production environment variables, then redeploy."); }
    catch (e: any) { setConnection(e.message); } finally { setChecking(false); }
  };

  const read = async (files: File[]) => {
    if (!files.length || lock.current) return;
    if (files.length > 3) return setError("Choose up to three pages of one bill");
    if (!confirm("Send these purchase bill photos to the configured AI provider for reading?")) return;
    lock.current = true; setBusy(true); setError(""); setJobs([]); setSaved(null);
    try {
      const images = [];
      for (const f of files) { const { blob } = await compress(f, 2200, 800000); images.push({ data: await blobToB64(blob), mime: blob.type }); }
      const out = await api<any>("purchase-photo", { images });
      const rule = await getRule(); setPricing(rule);
      const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
      const read: PhotoRow[] = out.rows.map((r: any) => ({
        item: text(r.item), style: text(r.style), color: text(r.color), unit: text(r.unit) || "PCS",
        hsn: text(r.hsn), qty: text(r.qty), cost: text(r.cost), rate: text(r.rate),
      }));
      // bills that print no article get one built from item + rate, so the lines neither collide nor merge
      const rows = pricePhotoRows(autoArticle(read), rule);
      const boxes = out.rows.filter((r: any) => r?.box && String(r.box).trim() && String(r.box).trim() !== "0").length;
      const supplier = suppliers.find(s => s.name.toLowerCase() === String(out.supplier || "").toLowerCase())?.id || "";
      set({
        rows, supplier, billNo: String(out.bill_no || ""), total: String(out.invoice_total || ""),
        warnings: [
          ...(Array.isArray(out.warnings) ? out.warnings.map(String) : []),
          boxes ? `${boxes} line(s) showed a box/packet count. Labels print one per piece; set packet sizes on the product if you want packet stickers.` : "",
        ].filter(Boolean).join("\n"),
        photoId: await savePhoto(files[0]),
      });
    } catch (e: any) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  };

  const price = async () => {
    try {
      const rule = await getRule(); setPricing(rule);
      // fill any still-blank article the same way the bill reader does, so a hand-typed line
      // behaves exactly like a read one
      set({ rows: pricePhotoRows(autoArticle(d.rows), rule) });
    } catch (e: any) { setError(e.message); }
  };

  /* Build the labels for a purchase exactly as the Labels page would. */
  const jobsFor = async (p: Purchase) => {
    const products = await db.products.bulkGet(p.items.map(l => l.product_id));
    return purchaseLabelJobs(p, products.filter((x): x is Product => !!x));
  };

  const sendToPrinter = async (queue: Job[], prompt: boolean) => {
    validateLabelPrint(cfg, queue);
    const direct = cfg.output === "tspl" && directPrintSupported() && cfg.mode === "roll" && cfg.cols === 1;
    if (!direct) { setPrinting(true); return "browser"; }
    const commands = queue.map(j => {
      const product = productForLabel(j.p, j.qtyOnLabel);
      return labelTSPL(cfg, product, j.qtyOnLabel, j.copies, ownPayload(product, cfg.format || "shop"));
    }).join("");
    await printTSPL(commands, prompt);
    return "tsc";
  };

  /* THE one approval: drafts the products, records the purchase, and sends the labels — one press. */
  const approve = async () => {
    if (!reviewed || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const p = await savePhotoPurchase(d.rows, { by, rack: d.rack, supplierId: d.supplier, billNo: d.billNo, photoId: d.photoId, invoiceTotal: d.total, note: [d.warnings, d.total ? "Supplier invoice total (as printed): " + d.total : ""].filter(Boolean).join("\n") });
      setSaved(p);
      const queue = await jobsFor(p);
      setJobs(queue);
      const how = await sendToPrinter(queue, true);
      toast(how === "tsc" ? `Purchase ${p.no} saved · ${queue.reduce((n, j) => n + j.copies, 0)} labels sent to the TSC printer` : `Purchase ${p.no} saved · opening the label print sheet`);
      set({ rows: [], supplier: d.supplier, billNo: "", total: "", warnings: "", photoId: undefined });
      setReviewed(false);
    } catch (e: any) {
      // the purchase may already be saved; say so rather than inviting a second save
      setError(saved ? `${e.message} · The purchase was saved — reprint from Labels if needed.` : e.message);
    } finally { lock.current = false; setBusy(false); }
  };

  const reprint = async () => {
    if (!jobs.length) return;
    try { const how = await sendToPrinter(jobs, true); if (how === "tsc") toast("Labels sent to the TSC printer again"); }
    catch (e: any) { toast((e.message || "Print failed") + " · Check the printer before retrying to avoid duplicate labels.", true); }
  };

  usePrintJob(printing, () => setPrinting(false), "", message => toast(message, true));
  const flat = useMemo(() => jobs.flatMap(j => Array.from({ length: Math.max(0, Math.min(5000, j.copies)) }, () => j)).slice(0, 5000), [jobs]);

  const vendor = suppliers.find(s => s.id === d.supplier);
  const invented = autoArticleCount(d.rows);
  let total = "—", labelCount = 0, validation = "";
  try {
    const rows = validatePhotoRows(d.rows);
    total = (rows.reduce((n, r) => n + r.qty * r.cost, 0) / 100).toFixed(2);
    labelCount = rows.reduce((n, r) => n + r.qty, 0);
    if (labelCount > 5000) validation = "More than 5000 labels: split this purchase into smaller batches.";
  } catch (e: any) { validation = e.message; }

  const preview = useMemo(
    () => (pricing && d.rows.length ? draftLabelProducts(d.rows, by, pricing) : []),
    [d.rows, pricing, by]);

  const ready4 = !busy && reviewed && !validation && !!d.supplier && !!d.rack && !!d.billNo.trim();

  return <section className="purchase-photo stack">
    <div className="row"><b className="grow">Purchase bill photos</b>
      <button className="btn" disabled={checking || busy} onClick={check}>{checking ? "Checking…" : "Check Gemini"}</button>
      <button className="btn" disabled={busy} onClick={() => file.current?.click()}><Camera size={17} />Read bill</button>
      <button className="btn" disabled={busy} onClick={() => set({ rows: [...d.rows, blank()] })}><Plus size={17} />Line</button></div>
    {connection && <div role="status" className="note">{connection}</div>}
    <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp" multiple onChange={e => { void read(Array.from(e.target.files || [])); e.target.value = ""; }} />
    {busy && <div role="status">Processing…</div>}

    {saved && !d.rows.length && <div className="note" role="status">
      <b>Purchase {saved.no} saved.</b> {flat.length} label{flat.length === 1 ? "" : "s"} prepared.
      {!!jobs.length && <> <button className="linkbtn" onClick={reprint}>Print again</button></>}
    </div>}

    {!!d.rows.length && <>
      <div className="grid g3">
        <label className="f">Supplier<select className="in" value={d.supplier} onChange={e => set({ supplier: e.target.value })}><option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.vendor_code ? s.vendor_code + " · " : ""}{s.name}</option>)}</select></label>
        <label className="f">Supplier bill no.<input className="in" value={d.billNo} onChange={e => set({ billNo: e.target.value })} /></label>
        <LocationSelect value={d.rack} onChange={rack => set({ rack })} buckets={false} /></div>

      <div className="tw"><table className="pos-t"><thead><tr>{[...FIELDS.map(f => captions[f]), ""].map((x, i) => <th key={i}>{x}</th>)}</tr></thead><tbody>
        {d.rows.map((r, i) => <tr key={i}>
          {FIELDS.map(k => <td key={k} data-l={captions[k]}>
            <input className={"in" + (k === "style" && r.autoStyle ? " auto-filled" : "")} aria-label={`${k} line ${i + 1}`}
              title={k === "style" && r.autoStyle ? "The bill printed no article number — this was built from the item and its rate. Edit it if you have the supplier's own code." : undefined}
              value={r[k] ?? ""} onChange={e => row(i, k, e.target.value)}
              style={{ minWidth: k === "item" || k === "style" ? 110 : 65 }} /></td>)}
          <td><button className="iconbtn" title="Remove line" aria-label="Remove line" onClick={() => set({ rows: d.rows.filter((_, k) => k !== i) })}><Trash2 size={16} /></button></td>
        </tr>)}</tbody></table></div>

      {!!invented && <div className="note sm">{invented} line{invented === 1 ? "" : "s"} had no article number on the bill. An article was built from the item and its rate (e.g. CHOTI-273) so lines at different rates stay separate — and so buying the same thing again at the same rate matches the same product. Edit any of them if the supplier has a code.</div>}

      <div className="row">
        {vendor && (!!vendor.less_pct || (vendor.rate_divisor || 1) !== 1) && <button className="btn" disabled={busy} title="Printed cost ÷ rate divisor, then less %. Press once." onClick={() => set({ rows: applyVendorTerms(d.rows, vendor) })}>Apply vendor terms{vendor.less_pct ? ` (${vendor.less_pct}% less)` : ""}{(vendor.rate_divisor || 1) !== 1 ? ` (÷${vendor.rate_divisor})` : ""}</button>}
        <button className="btn" disabled={busy} onClick={price}>Apply shop pricing</button>
        <span>Goods cost ₹{total}</span>
        <label className="f">Supplier payable ₹<input className="in" inputMode="decimal" value={d.total} onChange={e => set({ total: e.target.value })} /></label></div>

      {pricing && <div className="row sm"><span>Pricing: {pricing.margin.mode === "percent" ? `+${pricing.margin.percent}%` : `${pricing.margin.mode === "divide" ? "÷" : "×"}${pricing.margin.factor}`} · round ₹{pricing.margin.round_to} {pricing.margin.round_dir}</span><a href="#/settings">Pricing settings</a></div>}

      {!!preview.length && <div className="stack">
        <div className="row"><b>{labelCount} labels</b><span className="xs mut">One per PCS / PAIR / SET · {cfg.w}×{cfg.h}mm · {cfg.output === "tspl" && directPrintSupported() ? "straight to the TSC printer" : "browser print sheet"}</span></div>
        <div className="label-preview">{preview.map((p, i) => <LabelView key={i} cfg={cfg} p={p} qtyOnLabel={1} />)}
          {d.rows.length > preview.length && <span className="xs mut">+{d.rows.length - preview.length} more designs</span>}</div>
      </div>}

      {validation && <div className="note warn" role="status">{validation}</div>}
      {d.warnings && <div className="note warn" style={{ whiteSpace: "pre-wrap" }}>{d.warnings}</div>}

      <label className="row"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />I checked quantities, units, costs, selling rates and tax/freight differences.</label>
      <button className="btn p" disabled={!ready4} onClick={approve}>
        {busy ? "Working…" : `Approve: draft ${d.rows.length} product${d.rows.length === 1 ? "" : "s"} & print ${labelCount || ""} label${labelCount === 1 ? "" : "s"}`}
      </button>
      <div className="xs mut">One press records the purchase, drafts the products onto {d.rack ? "the chosen rack" : "the rack"} and sends the labels. Nothing is printed before you press it.</div>
    </>}

    {error && <div className="note warn" role="alert">{error}</div>}
    {printing && createPortal(<PrintSheet cfg={cfg} jobs={flat} />, document.getElementById("printroot")!)}
    {printing && <button className="btn print-notice" onClick={() => setPrinting(false)}>Close print</button>}
  </section>;
}
