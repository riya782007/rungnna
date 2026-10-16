import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
const BillCamera = lazy(() => import("./CustomerCamera"));
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Plus, Trash2 } from "lucide-react";
import { db, put, getSetting, setSetting, type Product, type Purchase } from "../lib/db";
import { api, blobToB64 } from "../lib/ai";
import { compress, savePhoto } from "../lib/image";
import { getRule, type PricingRule } from "../lib/pricing";
import {
  savePhotoPurchase, validatePhotoRows, pricePhotoRows, applyVendorTerms,
  autoArticle, autoArticleCount, draftLabelProducts, type PhotoRow,
} from "../lib/purchase-photo";
import { purchaseLabelJobs } from "../lib/purchase-labels";
import { DEFAULT_CFG, LabelView, validateLabelPrint, loadLabelCfg, useLabelPrint, tscCommands, expandJobs, type LabelCfg, type Job } from "../pages/Labels";
import { directPrintSupported } from "../lib/tsc";
import { currentStore } from "../lib/scope";
import { toast } from "../lib/app";
import { LocationSelect } from "./common";
import { checkBill, checkSummary, matchSupplier, fallbackBillNo, type LineFix } from "../lib/billCheck";
import { newParty } from "../lib/billing";

const blank = (): PhotoRow => ({ item: "", style: "", color: "", unit: "PCS", hsn: "", qty: "", cost: "", rate: "" });
const captions: Record<string, string> = { item: "Item", style: "Style/article", color: "Colour", unit: "Unit", hsn: "HSN", qty: "Qty", cost: "Cost ₹", rate: "Rate ₹" };
const FIELDS = ["item", "style", "color", "unit", "hsn", "qty", "cost", "rate"] as const;
type Field = (typeof FIELDS)[number];

type Draft = { store: string; rows: PhotoRow[]; supplier: string; billNo: string; rack: string; photoId?: string; warnings: string; total: string;
  /* what the bill's own arithmetic said: shown so the owner checks only what is in doubt */
  check?: { summary: string; ok: boolean; fixes: LineFix[]; doubts: { line: number; why: string }[] };
  supplierName?: string;   // as read from the bill, for one-tap "add this supplier"
  autoBillNo?: boolean };  // the bill printed no number; one was made from its date and total

export default function PurchasePhoto({ by }: { by: string }) {
  const [d, setD] = useState<Draft>({ store: currentStore(), rows: [], supplier: "", billNo: "", rack: "", warnings: "", total: "" });
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [error, setError] = useState("");
  const [connection, setConnection] = useState(""), [checking, setChecking] = useState(false);
  const [probe, setProbe] = useState<{ provider: string; model: string; ok: boolean; plain: string }[] | null>(null), [probing, setProbing] = useState(false);
  /* Each AI on its own, on a tiny picture of a number: tells the owner exactly which account works */
  const testEach = async () => {
    setProbing(true); setProbe(null);
    try { setProbe((await api<{ results: any[] }>("purchase-photo", { probe: true })).results); }
    catch (e: any) { setConnection(e.message); }
    finally { setProbing(false); }
  };
  const [pricing, setPricing] = useState<PricingRule | null>(null);
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [jobs, setJobs] = useState<Job[]>([]);          // labels for the purchase just saved
  const printer = useLabelPrint(cfg);
  const [saved, setSaved] = useState<Purchase | null>(null);
  const lock = useRef(false), file = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState(false);
  const suppliers = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);

  useEffect(() => { getSetting<Draft | null>("purchase_photo_draft", null).then(old => { if (old?.store === currentStore()) setD(old); setReady(true); }); }, []);
  useEffect(() => { if (ready) setSetting("purchase_photo_draft", d); }, [d, ready]);
  // the same printer settings the Labels page uses, so a sticker printed here is that sticker
  useEffect(() => { loadLabelCfg().then(setCfg); }, []);

  const set = (patch: Partial<Draft>) => { setReviewed(false); setD(x => ({ ...x, ...patch })); };
  const row = (i: number, key: Field, value: string) =>
    set({ rows: d.rows.map((r, k) => k === i ? { ...r, [key]: value, ...(key === "style" ? { autoStyle: false } : {}) } : r) });

  useEffect(() => { void check(); }, []);
  const check = async () => {
    setChecking(true);
    try {
      const r = await api<{ configured: boolean; provider: string; model: string; keys: Record<string, boolean> }>("purchase-photo");
      setConnection(r.configured
        ? `Ready · tries ${r.provider}${r.model ? " (" + r.model + ")" : ""}`
        : "No AI key can read a bill yet. Add OPENAI_API_KEY or GEMINI_API_KEY in Vercel → Environment Variables, then redeploy.");
    }
    catch (e: any) { setConnection(e.message); } finally { setChecking(false); }
  };

  const read = async (files: File[]) => {
    if (!files.length || lock.current) return;
    if (files.length > 3) return setError("Choose up to three pages of one bill");
    if (!(await getSetting<boolean>("bill_ai_ok", false))) {
      if (!confirm("Bill photos are sent to the AI (OpenAI, then Gemini, then Groq) to be read. Nothing is saved until you approve.\n\nAllow this from now on, on this device?")) return;
      await setSetting("bill_ai_ok", true);
    }
    lock.current = true; setBusy(true); setError(""); setJobs([]); setSaved(null);
    try {
      const images = [];
      for (const f of files) { const { blob } = await compress(f, 2200, 800000); images.push({ data: await blobToB64(blob), mime: blob.type }); }
      const out = await api<any>("purchase-photo", { images });
      const rule = await getRule(); setPricing(rule);
      const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
      const raw = out.rows.map((r: any) => ({
        item: text(r.item), style: text(r.style), color: text(r.color), unit: text(r.unit) || "PCS",
        hsn: text(r.hsn), qty: text(r.qty), cost: text(r.cost), rate: text(r.rate), amount: text(r.amount), box: text(r.box),
      }));
      // the bill checked against itself: ditto marks written out, each line's amount, the Net
      const checked = checkBill(raw, text(out.invoice_total));
      const read: PhotoRow[] = checked.rows.map(({ amount: _a, box: _b, ...r }) => r);
      // bills that print no article get one built from item + rate, so the lines neither collide nor merge
      const rows = pricePhotoRows(autoArticle(read), rule);
      const boxes = out.rows.filter((r: any) => r?.box && String(r.box).trim() && String(r.box).trim() !== "0").length;
      const readBy = out.read_by ? String(out.read_by) : "";
      const fellBack = Array.isArray(out.attempts) && out.attempts.some((a: any) => a && a.ok === false && !a.skipped);
      const supplierName = text(out.supplier).trim();
      const supplier = matchSupplier(supplierName, suppliers)?.id || "";
      const printedNo = text(out.bill_no).trim();
      set({
        rows, supplier, supplierName, total: text(out.invoice_total),
        billNo: printedNo || fallbackBillNo(text(out.bill_date), checked.net),
        autoBillNo: !printedNo,
        check: { summary: checkSummary(checked), ok: checked.addsUp === true && !checked.doubts.length, fixes: checked.fixes, doubts: checked.doubts },
        warnings: [
          ...(Array.isArray(out.warnings) ? out.warnings.map(String) : []),
          boxes ? `${boxes} line(s) showed a box/packet count. Labels print one per piece; set packet sizes on the product if you want packet stickers.` : "",
          fellBack && readBy ? `Read by ${readBy} — an earlier provider was unavailable, so check these lines a little harder than usual.` : "",
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
    const list = expandJobs(queue);
    if (direct) tscCommands(cfg, list.slice(0, 1));     // refuse before anything is sent
    printer.start(list, direct, prompt);                 // in stoppable batches, either way
    return direct ? "tsc" : "browser";
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
  /* a grey button with no reason sends the owner hunting: say exactly what is still missing */
  const missing = [
    !d.supplier && (d.supplierName ? `add or choose the supplier (tap “+ Add ${d.supplierName.trim().toUpperCase()}”)` : "choose the supplier"),
    !d.rack && "choose the location",
    !d.billNo.trim() && "enter the supplier bill no.",
    validation && validation.replace(/\.$/, "").replace(/^./, c => c.toLowerCase()),
    !reviewed && "tick the box above",
  ].filter(Boolean) as string[];

  const notReady = !!connection && !connection.startsWith("Ready");
  return <section className="purchase-photo stack">
    {!d.rows.length && <div className="bill-drop stack">
      <button className="btn p bill-drop-btn" disabled={busy} onClick={() => setCam(true)}>
        <Camera size={22} />{busy ? "Reading the bill…" : "Take photo of the bill"}</button>
      <button className="linkbtn" disabled={busy} onClick={() => file.current?.click()}>or upload a photo already taken</button>
      <div className="xs mut">Up to 3 pages of one bill. Then check what is highlighted, and approve: the products are drafted and the labels print.</div>
      <div className="row xs" style={{ justifyContent: "center", gap: 14 }}>
        <span className={notReady ? "bad-text" : "mut"}>{checking ? "Checking the AI…" : connection || ""}</span>
        <button className="linkbtn" disabled={busy || probing} onClick={testEach}>{probing ? "Testing…" : "Test each AI"}</button>
        <button className="linkbtn" disabled={busy} onClick={() => set({ rows: [blank()] })}>Type the lines instead</button>
      </div>
      {probe && <div className="note sm ai-probe" role="status" style={{ textAlign: "left" }}>
        {probe.map(r => <div key={r.provider}><b className={r.ok ? "ok-text" : "bad-text"}>{r.ok ? "✓" : "✗"}</b> {r.plain} <span className="xs mut mono">{r.model}</span></div>)}
        <div className="xs mut">{probe.some(r => r.ok) ? "Bills are read by the first working AI, in this order." : "No AI can read a bill right now: fix one of the accounts above."}</div>
      </div>}
    </div>}
    {!!d.rows.length && <div className="row"><b className="grow">{d.supplierName || "Purchase bill"}{d.billNo ? <span className="xs mut"> · {d.billNo}</span> : null}</b>
      <button className="btn sm" disabled={busy} onClick={() => setCam(true)}><Camera size={15} />Photo of another page</button>
      <button className="btn sm" disabled={busy} onClick={() => set({ rows: [...d.rows, blank()] })}><Plus size={15} />Line</button>
      <button className="linkbtn" disabled={busy} onClick={() => { if (confirm("Clear this bill and start again? Nothing has been saved.")) set({ rows: [], billNo: "", total: "", warnings: "", check: undefined, supplierName: "", photoId: undefined }); }}>Start over</button></div>}
    <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp" multiple onChange={e => { void read(Array.from(e.target.files || [])); e.target.value = ""; }} />
    {busy && !!d.rows.length && <div role="status">Working…</div>}
    {cam && <Suspense fallback={<div role="status">Opening camera…</div>}>
      <BillCamera title="Photo of the purchase bill" facing="environment" settingKey="bill_camera" onClose={() => setCam(false)}
        onBlob={b => void read([new File([b], `bill-${Date.now()}.jpg`, { type: "image/jpeg" })])} />
    </Suspense>}

    {saved && !d.rows.length && <div className="note" role="status">
      <b>Purchase {saved.no} saved.</b> {expandJobs(jobs).length} label{expandJobs(jobs).length === 1 ? "" : "s"} prepared.
      {!!jobs.length && <> <button className="linkbtn" onClick={reprint}>Print again</button></>}
    </div>}

    {!!d.rows.length && <>
      {d.check && <div className={"note " + (d.check.ok ? "ok" : "warn")} role="status">
        <b>{d.check.ok ? "✓ " : ""}{d.check.summary}</b>
        {d.check.fixes.map(f => <div key={"f" + f.line} className="sm">Line {f.line}: {f.field === "qty" ? "quantity" : "cost"} read as {f.from}, set to <b>{f.to}</b>, because {f.why}.</div>)}
        {d.check.doubts.map(x => <div key={"d" + x.line} className="sm">Line {x.line}: {x.why}. Check it against the bill.</div>)}
      </div>}
      <div className="grid g3">
        <label className="f">Supplier<select className="in" value={d.supplier} onChange={e => set({ supplier: e.target.value })}><option value="">Select supplier</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.vendor_code ? s.vendor_code + " · " : ""}{s.name}</option>)}</select>
          {!d.supplier && !!d.supplierName && <button type="button" className="linkbtn xs" style={{ textAlign: "left" }} onClick={async () => {
            const name = d.supplierName!.trim().toUpperCase();
            const sup = { ...newParty(name), kind: "supplier" as const };
            await put("parties", sup); set({ supplier: sup.id }); toast(`${name} added as a supplier`);
          }}>+ Add “{d.supplierName.trim().toUpperCase()}” as a new supplier</button>}</label>
        <label className="f">Supplier bill no.<input className={"in" + (d.autoBillNo ? " auto-filled" : "")} value={d.billNo}
          title={d.autoBillNo ? "The bill printed no number, so its date and total stand in for one. That still stops the same bill being saved twice." : undefined}
          onChange={e => set({ billNo: e.target.value, autoBillNo: false })} /></label>
        <LocationSelect value={d.rack} onChange={rack => set({ rack })} buckets={false} /></div>

      <div className="tw"><table className="pos-t"><thead><tr>{[...FIELDS.map(f => captions[f]), ""].map((x, i) => <th key={i}>{x}</th>)}</tr></thead><tbody>
        {d.rows.map((r, i) => <tr key={i}>
          {FIELDS.map(k => <td key={k} data-l={captions[k]}>
            <input className={"in" + ((k === "style" && r.autoStyle) || d.check?.fixes.some(f => f.line === i + 1 && f.field === k) ? " auto-filled" : "")} aria-label={`${k} line ${i + 1}`}
              title={k === "style" && r.autoStyle ? "The bill printed no article number — this was built from the item and its rate. Edit it if you have the supplier's own code." : undefined}
              value={r[k] ?? ""} onChange={e => row(i, k, e.target.value)}
              style={{ minWidth: k === "item" ? 190 : k === "style" ? 140 : 65 }} /></td>)}
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

      <label className="row"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
        {d.check?.ok ? "The lines add up to the bill. I checked the highlighted cells and the selling rates." : "I checked quantities, units, costs, selling rates and tax/freight differences."}</label>
      <button className="btn p" disabled={!ready4} onClick={approve}>
        {busy ? "Working…" : `Approve: draft ${d.rows.length} product${d.rows.length === 1 ? "" : "s"} & print ${labelCount || ""} label${labelCount === 1 ? "" : "s"}`}
      </button>
      {!busy && !!missing.length && <div className="sm bad-text" role="status">To approve: {missing.join(" · ")}</div>}
      <div className="xs mut">One press records the purchase, drafts the products onto {d.rack ? "the chosen rack" : "the rack"} and sends the labels. Nothing is printed before you press it.</div>
    </>}

    {error && <div className="note warn" role="alert" style={{ whiteSpace: "pre-line" }}>{error}</div>}
    {printer.panel}
  </section>;
}
