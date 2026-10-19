import { DeleteButton } from "./DeleteButton";
import { SelectAll } from "./SelectAll";
import { confirmDelete } from "../lib/confirm-delete";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
const BillCamera = lazy(() => import("./CustomerCamera"));
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Plus, Trash2 } from "lucide-react";
import { db, put, uid, getSetting, setSetting, type Product, type Purchase } from "../lib/db";
import { api, blobToB64 } from "../lib/ai";
import { compress, savePhoto } from "../lib/image";
import { getRule, type PricingRule } from "../lib/pricing";
import {
  preparePhotoRows, savePhotoPurchase, validatePhotoRows, pricePhotoRows, applyVendorTerms, repricePhotoRows, suspiciousCosts, restoreBillCosts,
  autoArticle, autoArticleCount, draftLabelProducts, labelCountFor, type PhotoRow,
} from "../lib/purchase-photo";
import { applyPhotoQuantities, readCount, repeatPhotoCount, type RepeatedCountField } from "../lib/purchase-quantities";
import { purchaseLabelJobs } from "../lib/purchase-labels";
import { DEFAULT_CFG, LabelView, validateLabelPrint, loadLabelCfg, useLabelPrint, tscCommands, expandJobs, type LabelCfg, type Job } from "../pages/Labels";
import { directPrintSupported } from "../lib/tsc";
import { currentStore } from "../lib/scope";
import { toast } from "../lib/app";
import { RackPicker } from "./RackPicker";
import { SupplierNo } from "./SupplierNo";
import { checkBill, checkSummary, matchSupplier, fallbackBillNo, type LineFix } from "../lib/billCheck";
import { newParty } from "../lib/billing";

const blank = (pack = "1"): PhotoRow => ({ review_id: uid(), item: "", style: "", color: "", unit: "PCS", hsn: "", qty: "", pack, packSource: "default", stickers: "", cost: "", rate: "" });
const captions: Record<string, string> = { item: "Item", style: "Style/article", color: "Colour", unit: "Unit", hsn: "HSN", qty: "Total qty", pack: "Pieces per packet (X)", stickers: "Stickers", cost: "Cost ₹", rate: "Rate ₹" };
/* pack = the "X1" / "X3" after the rate on his stickers: pieces in one packet (his old software's QTY box) */
const FIELDS = ["item", "style", "unit", "rate", "stickers", "qty", "pack", "color", "cost"] as const;
type Field = (typeof FIELDS)[number];
const defaultStickers = (r: PhotoRow) => {
  const qty = Number(r.qty), pack = Number(r.pack || "1");
  return Number.isSafeInteger(qty) && qty > 0 && Number.isSafeInteger(pack) && pack > 0 ? String(Math.ceil(qty / pack)) : "";
};

type Draft = { store: string; rows: PhotoRow[]; supplier: string; billNo: string; rack: string; photoId?: string; warnings: string; total: string;
  /* what the bill's own arithmetic said: shown so the owner checks only what is in doubt */
  check?: { summary: string; ok: boolean; fixes: LineFix[]; doubts: { line: number; why: string }[] };
  supplierName?: string;   // as read from the bill, for one-tap "add this supplier"
  autoBillNo?: boolean };  // the bill printed no number; one was made from its date and total

/* "Take photo" from anywhere (the AI strip on every Stock tab) opens this reader's camera: directly when the reader
   is in a box of its own (`camera`), or by event when it is already on the page (Labels, Stock in). */
export const BILL_CAMERA = "rj-bill-camera";
export function askBillCamera() { (window as any).__rjBillCamera = true; window.dispatchEvent(new Event(BILL_CAMERA)); }

export default function PurchasePhoto({ by, camera = false }: { by: string; camera?: boolean }) {
  const [d, setD] = useState<Draft>({ store: currentStore(), rows: [], supplier: "", billNo: "", rack: "", warnings: "", total: "" });
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const countFocus = useRef<HTMLInputElement | null>(null);
  useLayoutEffect(() => {
    const next = countFocus.current; countFocus.current = null;
    if (next?.isConnected) { next.focus(); next.select(); }
  }, [d.rows]);
  const draftRef = useRef(d); draftRef.current = d;
  const removeRows = async (ids: string[]) => {
    if (busy || lock.current) return;
    const wanted = new Set(ids), rows = draftRef.current.rows.filter(r => wanted.has(r.review_id || ""));
    if (!rows.length || !await confirmDelete("Remove " + rows.length + " purchase line(s) from this draft?")) return;
    setReviewed(false); setD(latest => ({ ...latest, rows: latest.rows.filter(r => !wanted.has(r.review_id || "")), check: undefined })); setSelection(new Set());
  };
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
  const [packetDefault, setPacketDefault] = useState("1"), [bulkPack, setBulkPack] = useState("1"), [bulkQty, setBulkQty] = useState(""), [bulkRef, setBulkRef] = useState("");
  const [rememberPack, setRememberPack] = useState(true), [quantityNote, setQuantityNote] = useState("");
  const [pricing, setPricing] = useState<PricingRule | null>(null);
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [jobs, setJobs] = useState<Job[]>([]);          // labels for the purchase just saved
  const printer = useLabelPrint(cfg, setCfg);
  const [saved, setSaved] = useState<Purchase | null>(null);
  const lock = useRef(false), file = useRef<HTMLInputElement>(null);
  const [cam, setCam] = useState(camera);
  useEffect(() => {
    const open = () => { (window as any).__rjBillCamera = false; setCam(true); };
    if ((window as any).__rjBillCamera) open();          // asked for before this reader had loaded
    window.addEventListener(BILL_CAMERA, open);
    return () => window.removeEventListener(BILL_CAMERA, open);
  }, []);
  const suppliers = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);

  useEffect(() => { void Promise.all([getSetting<Draft | null>("purchase_photo_draft", null), getSetting<string>("purchase_label_pack", "1"), getRule()]).then(async ([old, pack, rule]) => {
    const value = /^\d+$/.test(String(pack)) && Number(pack) > 0 && Number(pack) <= 10000 ? String(pack) : "1";
    setPacketDefault(value); setBulkPack(value); setPricing(rule);
    if (old?.store === currentStore()) setD({ ...old, rows: await preparePhotoRows(old.rows, old.supplier, value) });
    setReady(true);
  }).catch(e => { setError(e.message || "Could not restore the purchase draft"); setReady(true); }); }, []);
  useEffect(() => { if (ready) setSetting("purchase_photo_draft", d); }, [d, ready]);
  // the same printer settings the Labels page uses, so a sticker printed here is that sticker
  const deviceCfg = useLiveQuery(() => loadLabelCfg(), []);
  useEffect(() => { if (deviceCfg) setCfg(deviceCfg); }, [deviceCfg]);

  /* the two "apply" buttons confirm in green that they did something (owner, 18 Oct) */
  const [done, setDone] = useState<{ pricing?: string; pricingSig?: string; terms?: string }>({});
  const set = (patch: Partial<Draft>) => { setReviewed(false); setD(x => ({ ...x, ...patch, ...(patch.rows && !("check" in patch) ? { check: undefined } : {}) })); };
  const row = (i: number, key: Field, value: string) =>
    set({ rows: d.rows.map((r, k) => k === i ? { ...r, [key]: value, ...(key === "style" ? { autoStyle: false } : {}), ...(key === "pack" ? { packSource: "manual" as const } : {}), ...(["item", "unit"].includes(key) ? { item_code: undefined } : {}) } : r) });

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
    lock.current = true; setBusy(true); setError(""); setJobs([]); setSaved(null); setBulkQty(""); setBulkRef(""); setQuantityNote("");
    try {
      const images = [];
      for (const f of files) { const { blob } = await compress(f, 2200, 800000); images.push({ data: await blobToB64(blob), mime: blob.type }); }
      const out = await api<any>("purchase-photo", { images });
      const rule = await getRule(); setPricing(rule);
      const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
      const raw = out.rows.map((r: any) => ({
        item: text(r.item), style: text(r.style), color: text(r.color), unit: text(r.unit) || "PCS",
        hsn: text(r.hsn), qty: readCount(r.qty), pack: text(r.pack),
        cost: text(r.cost), rate: text(r.rate), amount: text(r.amount), box: text(r.box),
      }));
      // the bill checked against itself: ditto marks written out, each line's amount, the Net
      const checked = checkBill(raw, text(out.invoice_total));
      // keep the bill's own cost on each line; a "selling rate" equal to the cost is just the supplier's price
      // read twice (owner's bill, 18 Oct: rate 170 = cost 170), so it is left for shop pricing to fill
      const read: PhotoRow[] = checked.rows.map(({ amount: _a, box: _b, ...r }) => ({ ...r, stickers: "", billCost: r.cost, rate: r.rate && Number(r.rate) === Number(r.cost) ? "" : r.rate }));
      // bills that print no article get one built from item + rate, so the lines neither collide nor merge
      const supplier = matchSupplier(text(out.supplier).trim(), suppliers)?.id || "";
      const rows = await preparePhotoRows(pricePhotoRows(autoArticle(read), rule), supplier, packetDefault);
      const boxes = out.rows.filter((r: any) => r?.box && String(r.box).trim() && String(r.box).trim() !== "0").length;
      const readBy = out.read_by ? String(out.read_by) : "";
      const fellBack = Array.isArray(out.attempts) && out.attempts.some((a: any) => a && a.ok === false && !a.skipped);
      const supplierName = text(out.supplier).trim();
      const printedNo = text(out.bill_no).trim();
      set({
        rows, supplier, supplierName, total: text(out.invoice_total),
        billNo: printedNo || fallbackBillNo(text(out.bill_date), checked.net),
        autoBillNo: !printedNo,
        check: { summary: checkSummary(checked), ok: checked.addsUp === true && !checked.doubts.length, fixes: checked.fixes, doubts: checked.doubts },
        warnings: [
          ...(Array.isArray(out.warnings) ? out.warnings.map(String) : []),
          boxes ? `${boxes} line(s) showed a box/packet count. Printed packet sizes, known articles, or your saved packet default fill X automatically; check the quantities below.` : "",
          fellBack && readBy ? `Read by ${readBy} — an earlier provider was unavailable, so check these lines a little harder than usual.` : "",
        ].filter(Boolean).join("\n"),
        photoId: await savePhoto(files[0]),
      });
      setDone({});   // a new bill: nothing has been applied to it yet
    } catch (e: any) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  };

  /* the two "apply" buttons say plainly, in green, that they did something (owner, 18 Oct) */
  const costSig = (rows: PhotoRow[]) => rows.map(r => r.cost + "|" + r.unit).join(";");
  const price = async (rowsIn = d.rows, note = "") => {
    try {
      const rule = await getRule(); setPricing(rule);
      // fill any still-blank article the same way the bill reader does, so a hand-typed line
      // behaves exactly like a read one
      const { rows, priced } = repricePhotoRows(autoArticle(rowsIn), rule);
      set({ rows });
      const how = rule.margin.mode === "percent" ? `+${rule.margin.percent}%` : `${rule.margin.mode === "divide" ? "÷" : "×"}${rule.margin.factor}`;
      setDone(x => ({ ...x, pricing: `${note}Shop pricing applied: ${priced} line${priced === 1 ? "" : "s"} priced (${how}, even rates)`, pricingSig: costSig(rows) }));
    } catch (e: any) { setError(e.message); }
  };
  const applyTerms = (v: NonNullable<typeof vendor>) => {
    const todo = d.rows.filter(r => !r.termsDone).length;
    const terms = [(v.rate_divisor || 1) !== 1 ? `cost ÷ ${v.rate_divisor}` : "", v.less_pct ? `${v.less_pct}% less` : ""].filter(Boolean).join(", ");
    setDone(x => ({ ...x, terms: `Vendor terms applied: ${terms} on ${todo} line${todo === 1 ? "" : "s"}` }));
    // the rates were worked out from the old cost: work them out again from the new one
    void price(applyVendorTerms(d.rows, v), `${terms} done · `);
  };

  /* Build the labels for a purchase exactly as the Labels page would. */
  const jobsFor = async (p: Purchase) => {
    const products = await db.products.bulkGet(p.items.map(l => l.product_id));
    return purchaseLabelJobs(p, products.filter((x): x is Product => !!x));
  };

  const sendToPrinter = async (queue: Job[], prompt: boolean) => {
    if (!queue.length) return "none";
    // Printer settings can change while this embedded reader remains mounted.
    // Always snapshot the latest device setup at the actual print click.
    const current = await loadLabelCfg();
    setCfg(current);
    validateLabelPrint(current, queue);
    const direct = current.output === "tspl" && directPrintSupported() && current.mode === "roll" && current.cols === 1;
    const list = expandJobs(queue);
    if (direct) tscCommands(current, list.slice(0, 1));
    const result = printer.start(list, direct, prompt, current);
    if (!result.started) throw new Error(result.message);
    return current.output === "qz" ? "qz" : direct ? "tsc" : "browser";
  };

  /* THE one approval: drafts the products, records the purchase, and sends the labels — one press. */
  const approve = async () => {
    if (!reviewed || lock.current) return;
    lock.current = true; setBusy(true); setError("");
    let savedPurchase: Purchase | null = null;
    try {
      const rows = await preparePhotoRows(d.rows, d.supplier, packetDefault);
      const rule = await getRule(), current = await loadLabelCfg();
      const checked = validatePhotoRows(rows), products = draftLabelProducts(rows, by, rule, rows.length);
      const preflight = checked.flatMap((r, i) => {
        const copies = r.print_qty ?? Math.ceil(r.qty / r.pack);
        return copies ? [{ p: products[i], qtyOnLabel: r.pack, copies, line: i + 1 }] : [];
      });
      if (preflight.length) validateLabelPrint(current, preflight);
      const p = await savePhotoPurchase(rows, { by, rack: d.rack, supplierId: d.supplier, billNo: d.billNo, photoId: d.photoId, invoiceTotal: d.total, note: [d.warnings, d.total ? "Supplier invoice total (as printed): " + d.total : ""].filter(Boolean).join("\n") });
      savedPurchase = p;
      setSaved(p); setBulkQty(""); setBulkRef(""); setQuantityNote("");
      // Financial saving succeeded. Any subsequent print failure is recovered
      // by printing this saved purchase, never by approving it a second time.
      set({ rows: [], supplier: d.supplier, billNo: "", total: "", warnings: "", photoId: undefined });
      setReviewed(false);
      const queue = await jobsFor(p);
      setJobs(queue);
      const how = await sendToPrinter(queue, true);
      toast(how === "none" ? `Purchase ${p.no} saved · no stickers requested` : how === "browser" ? `Purchase ${p.no} saved · opening the label print window` : `Purchase ${p.no} saved · starting label printing`);
    } catch (e: any) {
      // the purchase may already be saved; say so rather than inviting a second save
      setError(savedPurchase ? `${e.message}\nPurchase ${savedPurchase.no} is saved. Use “Print saved labels” after fixing the printer setting; do not approve the bill again.` : e.message);
    } finally { lock.current = false; setBusy(false); }
  };

  const reprint = async () => {
    if (!jobs.length) return;
    setError("");
    try { await sendToPrinter(jobs, true); }
    catch (e: any) { setError(e.message || "Printing did not start. Check the printer settings."); }
  };


  const applyQuantities = async () => {
    try {
      const rows = applyPhotoQuantities(d.rows, bulkQty, bulkPack);
      if (rememberPack && bulkPack.trim()) {
        const value = rows[0].pack!;
        await setSetting("purchase_label_pack", value); setPacketDefault(value);
      }
      set({ rows }); setError("");
      setQuantityNote(rows.length + " lines updated" + (bulkQty.trim() ? " · total quantity " + rows[0].qty + " each" : " · bill quantities kept") + (bulkPack.trim() ? " · X" + rows[0].pack + " per packet" : "") + (rememberPack && bulkPack.trim() ? " · packet default saved" : ""));
    } catch (e: any) { setError(e.message); }
  };
  const legacyGroups = [...new Map(d.rows.filter(r => r.item.trim()).map(r => [r.item.trim().toUpperCase() + "|" + r.unit.trim().toUpperCase(), r])).values()];
  const legacyMissing = cfg.format === "shop" && d.rows.some(r => r.stickers?.trim() !== "0" && !r.item_code?.trim());

  const vendor = suppliers.find(s => s.id === d.supplier);
  const lowCost = suspiciousCosts(d.rows);
  const invented = autoArticleCount(d.rows);
  let total = "—", labelCount = 0, validation = "";
  try {
    const rows = validatePhotoRows(d.rows);
    total = (rows.reduce((n, r) => n + r.qty * r.cost, 0) / 100).toFixed(2);
    labelCount = labelCountFor(rows);
    if (labelCount > 5000) validation = "More than 5000 labels: reduce stickers or split this purchase into smaller batches.";
  } catch (e: any) { validation = e.message; }

  const preview = useMemo(
    () => (pricing && d.rows.length ? draftLabelProducts(d.rows, by, pricing) : []),
    [d.rows, pricing, by]);

  const ready4 = !busy && reviewed && !validation && !!d.supplier && !!d.rack && !!d.billNo.trim() && !legacyMissing;
  /* a grey button with no reason sends the owner hunting: say exactly what is still missing */
  const missing = [
    !d.supplier && (d.supplierName ? `type the supplier's roll number, or tap “+ Add ${d.supplierName.trim().toUpperCase()}”` : "type the supplier's roll number"),
    !d.rack && "choose the location",
    !d.billNo.trim() && "enter the supplier bill no.",
    validation && validation.replace(/\.$/, "").replace(/^./, c => c.toLowerCase()),
    legacyMissing && "set the old-software item code below, or choose Rungnna-only QR in Printer settings",
    !reviewed && "tick the box above",
  ].filter(Boolean) as string[];

  const notReady = !!connection && !connection.startsWith("Ready");
  return <section className="purchase-photo stack" aria-busy={!ready || busy}>
    {!d.rows.length && <div className="bill-drop stack">
      <button className="btn p bill-drop-btn" disabled={busy} onClick={() => setCam(true)}>
        <Camera size={22} />{busy ? "Reading the bill…" : "Take photo of the bill"}</button>
      <button className="linkbtn" disabled={busy} onClick={() => file.current?.click()}>or upload a photo already taken</button>
      <div className="xs mut">Up to 3 pages of one bill. Then check what is highlighted, and approve: the products are drafted and the labels print.</div>
      <div className="row xs" style={{ justifyContent: "center", gap: 14 }}>
        <span className={notReady ? "bad-text" : "mut"}>{checking ? "Checking the AI…" : connection || ""}</span>
        <button className="linkbtn" disabled={busy || probing} onClick={testEach}>{probing ? "Testing…" : "Test each AI"}</button>
        <button className="linkbtn" disabled={busy} onClick={() => set({ rows: [blank(packetDefault)] })}>Type the lines instead</button>
      </div>
      {probe && <div className="note sm ai-probe" role="status" style={{ textAlign: "left" }}>
        {probe.map(r => <div key={r.provider}><b className={r.ok ? "ok-text" : "bad-text"}>{r.ok ? "✓" : "✗"}</b> {r.plain} <span className="xs mut mono">{r.model}</span></div>)}
        <div className="xs mut">{probe.some(r => r.ok) ? "Bills are read by the first working AI, in this order." : "No AI can read a bill right now: fix one of the accounts above."}</div>
      </div>}
    </div>}
    {!!d.rows.length && <div className="row"><b className="grow">{d.supplierName || "Purchase bill"}{d.billNo ? <span className="xs mut"> · {d.billNo}</span> : null}</b>
      <button className="btn sm" disabled={busy} onClick={() => setCam(true)}><Camera size={15} />Photo of another page</button>
      <button className="btn sm" disabled={busy} title="Adds a blank line at the top" onClick={() => {
        set({ rows: [blank(packetDefault), ...d.rows] });
        setTimeout(() => (document.querySelector('input[aria-label="item line 1"]') as HTMLInputElement | null)?.focus(), 50);
      }}><Plus size={15} />Line</button>
      <button type="button" className="linkbtn" disabled={busy} onClick={async () => {
        if (busy || lock.current || !await confirmDelete("Clear this bill and start again? Nothing has been saved.")) return;
        set({ rows: [], supplier: "", billNo: "", total: "", warnings: "", check: undefined, supplierName: "", photoId: undefined, autoBillNo: undefined });
        setDone({}); setSelection(new Set()); setError(""); setJobs([]); setSaved(null);
        setBulkQty(""); setBulkPack(packetDefault); setBulkRef(""); setQuantityNote("");
      }}>Start over</button></div>}
    <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp" multiple onChange={e => { void read(Array.from(e.target.files || [])); e.target.value = ""; }} />
    {busy && !!d.rows.length && <div role="status">Working…</div>}
    {cam && <Suspense fallback={<div role="status">Opening camera…</div>}>
      <BillCamera title="Photo of the purchase bill" facing="environment" settingKey="bill_camera" onClose={() => setCam(false)}
        onBlob={b => void read([new File([b], `bill-${Date.now()}.jpg`, { type: "image/jpeg" })])} />
    </Suspense>}

    {saved && !d.rows.length && <div className="note" role="status">
      <b>Purchase {saved.no} saved.</b> {expandJobs(jobs).length} label{expandJobs(jobs).length === 1 ? "" : "s"} prepared.
      {!!jobs.length && <> <button className="btn" disabled={printer.busy} onClick={reprint}>Print saved labels</button></>}
      {" "}<a className="linkbtn" href={"#/labels/purchase/" + saved.id}>Open saved labels &amp; printer settings</a>
    </div>}

    {!!d.rows.length && <>
      {d.check && <div className={"note " + (d.check.ok ? "ok" : "warn")} role="status">
        <b>{d.check.ok ? "✓ " : ""}{d.check.summary}</b>
        {d.check.fixes.map(f => <div key={"f" + f.line} className="sm">Line {f.line}: {f.field === "qty" ? "quantity" : "cost"} read as {f.from}, set to <b>{f.to}</b>, because {f.why}.</div>)}
        {d.check.doubts.map(x => <div key={"d" + x.line} className="sm">Line {x.line}: {x.why}. Check it against the bill.</div>)}
      </div>}
      <div className="grid g3">
        <div className="f"><SupplierNo suppliers={suppliers} id={d.supplier} onPick={s => set({ supplier: s?.id || "" })} />
          {!d.supplier && !!d.supplierName && <button type="button" className="linkbtn xs" style={{ textAlign: "left" }} onClick={async () => {
            const name = d.supplierName!.trim().toUpperCase();
            const sup = { ...newParty(name), kind: "supplier" as const };
            await put("parties", sup); set({ supplier: sup.id }); toast(`${name} added as a supplier`);
          }}>+ Add “{d.supplierName.trim().toUpperCase()}” as a new supplier</button>}</div>
        <label className="f">Supplier bill no.<input className={"in" + (d.autoBillNo ? " auto-filled" : "")} value={d.billNo}
          title={d.autoBillNo ? "The bill printed no number, so its date and total stand in for one. That still stops the same bill being saved twice." : undefined}
          onChange={e => set({ billNo: e.target.value, autoBillNo: false })} /></label>
        <RackPicker value={d.rack} onChange={rack => set({ rack })} /></div>

      <fieldset className="purchase-quantity-tools" disabled={busy}>
        <legend>Set quantities for all {d.rows.length} lines</legend>
        <div className="row">
          <label className="f">Total quantity per line (optional)<input className="in mono" inputMode="numeric" value={bulkQty} onChange={e => setBulkQty(e.target.value)} placeholder="Blank keeps each bill quantity" /></label>
          <label className="f">Pieces per packet for all lines<input className="in mono" inputMode="numeric" value={bulkPack} onChange={e => setBulkPack(e.target.value)} /></label>
          <button className="btn" type="button" onClick={() => void applyQuantities()}>Apply to all {d.rows.length} lines</button>
        </div>
        <label className="row sm"><input type="checkbox" checked={rememberPack} onChange={e => setRememberPack(e.target.checked)} /> Remember this packet size for future bills</label>
        <div className="xs mut">Bill quantities are kept unless you enter a replacement total above. A new bill uses its printed packet size first, then a matching saved article, then the saved default X{packetDefault}. Sticker counts calculate automatically; individual lines stay editable.</div>
        {quantityNote && <div className="sm ok-text" role="status">✓ {quantityNote}</div>}
      </fieldset>

      {cfg.format === "shop" && <details className="note" open={legacyMissing}>
        <summary>Old-software QR item codes{legacyMissing ? " — needed before printing" : ""}</summary>
        <div className="xs mut">Use that application's real numeric item code. Set it once per item category here; all matching lines use it. Saved articles retain their original reference. Unknown codes are never invented.</div>
        <button type="button" className="btn sm" disabled={busy} onClick={async () => { try { set({ rows: await preparePhotoRows(d.rows, d.supplier, packetDefault) }); } catch (e: any) { setError(e.message); } }}>Use saved old item codes</button>
        <div className="row">
          <label className="f grow">Old-system reference for these labels (optional)<input className="in mono" value={bulkRef} onChange={event => setBulkRef(event.target.value)} placeholder="Copy the reference from the old system" /></label>
          <button type="button" className="btn sm" disabled={busy || !bulkRef.trim()} onClick={() => {
            if (/[~\u0000-\u001f\u007f]/.test(bulkRef)) return setError("Reference cannot contain ~ or control characters");
            set({ rows: d.rows.map(r => ({ ...r, ref: bulkRef.trim() })) }); setError("");
          }}>Apply reference to all lines</button>
        </div>
        <div className="grid g3">{legacyGroups.map(group => <label className="f" key={group.item + "|" + group.unit}>{group.item} ({group.unit})
          <input className="in mono" inputMode="numeric" aria-label={"Old software code for " + group.item + " (" + group.unit + ")"} value={group.item_code || ""} onChange={event => {
            const value = event.target.value.replace(/\D/g, "");
            set({ rows: d.rows.map(r => r.item.trim().toUpperCase() === group.item.trim().toUpperCase() && r.unit.trim().toUpperCase() === group.unit.trim().toUpperCase() ? { ...r, item_code: value || undefined } : r) });
          }} />
        </label>)}</div>
      </details>}

      <div className="selection-bar"><SelectAll ids={d.rows.map(r => r.review_id!)} selected={selection} onChange={setSelection} label="Select all purchase lines" /><span className="sm">{d.rows.filter(r => selection.has(r.review_id!)).length} selected</span><DeleteButton className="btn sm bad" disabled={busy || !d.rows.some(r => selection.has(r.review_id!))} onDelete={() => removeRows(d.rows.filter(r => selection.has(r.review_id!)).map(r => r.review_id!))}>Delete selected</DeleteButton></div>
      <div className="tw purchase-lines"><table className="pos-t"><thead><tr>{["No.", "Supplier S.No.", ...FIELDS.map(f => captions[f]), ""].map((x, i) => <th key={i}>{x}</th>)}</tr></thead><tbody>
        {d.rows.map((r, i) => <tr key={r.review_id || i}>
          <td className="line-no" data-l="Line" title="Line number: the same small boxed number printed on this line's stickers"><input type="checkbox" aria-label={"Select purchase line " + (i + 1)} checked={selection.has(r.review_id!)} onChange={event => setSelection(old => { const next = new Set(old); event.target.checked ? next.add(r.review_id!) : next.delete(r.review_id!); return next; })} />{i + 1}</td>
          <td data-l="Supplier S.No." className="supplier-number mono" title="Saved supplier roll number">{vendor?.vendor_code || "—"}</td>
          {FIELDS.map(k => <td key={k} data-l={captions[k]}>
            <input className={"in" + ((k === "style" && r.autoStyle) || d.check?.fixes.some(f => f.line === i + 1 && f.field === k) ? " auto-filled" : "") + (k === "cost" && lowCost.includes(i + 1) ? " cost-low" : "")} aria-label={`${k} line ${i + 1}`}
              title={["qty", "pack", "stickers"].includes(k) ? `Enter copies this ${captions[k].toLowerCase()} to the next line. Type a new number to change it.${k === "stickers" ? " Blank means one per packet; 0 prints none." : ""}` : k === "style" && r.autoStyle ? "The bill printed no article number — this was built from the item and its rate. Edit it if you have the supplier's own code." : undefined}
              inputMode={k === "cost" || k === "rate" ? "decimal" : ["qty", "pack", "stickers"].includes(k) ? "numeric" : undefined}
              placeholder={k === "stickers" ? defaultStickers(r) : undefined}
              value={r[k] ?? ""} onChange={e => row(i, k, e.target.value)}
              onKeyDown={["qty", "pack", "stickers"].includes(k) ? e => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault(); e.stopPropagation();
                if (e.repeat || busy || lock.current) return;
                try {
                  const rows = repeatPhotoCount(d.rows, i, k as RepeatedCountField, e.currentTarget.value);
                  countFocus.current = e.currentTarget.closest("tbody")?.querySelector<HTMLInputElement>(`input[aria-label="${k} line ${i + 2}"]`) ?? null;
                  set({ rows });
                  setError("");
                } catch (error: any) { setError(error.message); }
              } : undefined}
              style={{ minWidth: k === "item" ? 130 : k === "style" ? 110 : 56 }} /></td>)}
          <td><DeleteButton className="iconbtn" aria-label="Remove line" disabled={busy} onDelete={() => removeRows([r.review_id!])}><Trash2 size={16} /></DeleteButton></td>
        </tr>)}</tbody></table></div>

      {!!invented && <div className="note sm">{invented} line{invented === 1 ? "" : "s"} had no article number on the bill. An article was built from the item and its rate (e.g. CHOTI-273) so lines at different rates stay separate — and so buying the same thing again at the same rate matches the same product. Edit any of them if the supplier has a code.</div>}

      <div className="row">
        {vendor && (!!vendor.less_pct || (vendor.rate_divisor || 1) !== 1) && (d.rows.length && d.rows.every(r => r.termsDone)
          ? <span className="pill ok applied" role="status">✓ Vendor terms applied{(vendor.rate_divisor || 1) !== 1 ? ` (÷${vendor.rate_divisor})` : ""}{vendor.less_pct ? ` (${vendor.less_pct}% less)` : ""}{d.rows.some(r => r.billCost) && <button className="linkbtn" style={{ marginLeft: 8 }} onClick={() => { set({ rows: restoreBillCosts(d.rows) }); setDone({}); }}>Undo</button>}</span>
          : <button className="btn" disabled={busy} title="Printed cost ÷ rate divisor, then less %. Each line only once." onClick={() => applyTerms(vendor)}>
              Apply vendor terms{vendor.less_pct ? ` (${vendor.less_pct}% less)` : ""}{(vendor.rate_divisor || 1) !== 1 ? ` (÷${vendor.rate_divisor})` : ""}{d.rows.some(r => r.termsDone) ? ` to ${d.rows.filter(r => !r.termsDone).length} new lines` : ""}</button>)}
        <button className="btn" disabled={busy} onClick={() => void price()}>{done.pricing && done.pricingSig === costSig(d.rows) ? "Apply shop pricing again" : "Apply shop pricing"}</button>
        <span>Goods cost ₹{total}</span>
        <label className="f">Supplier payable ₹<input className="in" inputMode="decimal" value={d.total} onChange={e => set({ total: e.target.value })} /></label></div>

      {!!lowCost.length && <div className="note bad sm" role="alert">
        <b>Check the cost on line{lowCost.length === 1 ? "" : "s"} {lowCost.join(", ")}:</b> it is less than a tenth of the selling rate. A cost like ₹1.03 against a rate of ₹170 usually means the vendor terms (÷) were applied again and again, or the cost was misread.
        {d.rows.some(r => r.billCost && r.billCost !== r.cost) && <> <button className="linkbtn" onClick={() => { set({ rows: restoreBillCosts(d.rows) }); setDone({}); }}>Put the bill's costs back</button></>}
      </div>}
      {done.pricing && done.pricingSig === costSig(d.rows) && <div className="note ok applied-note sm" role="status">✓ {done.pricing}</div>}
      {pricing && <div className="row sm"><span>Pricing: {pricing.margin.mode === "percent" ? `+${pricing.margin.percent}%` : `${pricing.margin.mode === "divide" ? "÷" : "×"}${pricing.margin.factor}`} · round ₹{pricing.margin.round_to} {pricing.margin.round_dir}</span><a href="#/settings">Pricing settings</a></div>}

      {!!preview.length && <div className="stack">
        <div className="row"><b>{labelCount} labels</b><span className="xs mut">Stickers: grey means one per packet; enter an exact count, or 0 for none. X is the quantity in each packet. · {cfg.w}×{cfg.h}mm · {cfg.output === "tspl" && directPrintSupported() ? "straight to the TSC printer" : "browser print sheet"}</span></div>
        <div className="label-preview">{preview.map((p, i) => <LabelView key={i} cfg={cfg} p={p} qtyOnLabel={p.pack || 1} line={i + 1} />)}
          {d.rows.length > preview.length && <span className="xs mut">+{d.rows.length - preview.length} more designs</span>}</div>
      </div>}

      {validation && <div className="note warn" role="status">{validation}</div>}
      {d.warnings && <div className="note warn" style={{ whiteSpace: "pre-wrap" }}>{d.warnings}</div>}

      {/* stays in view at the bottom of the full-window review, so approving needs no scrolling */}
      <div className="approve-bar stack">
      <label className="row"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
        {d.check?.ok ? "The lines add up to the bill. I checked the highlighted cells and the selling rates." : "I checked quantities, units, costs, selling rates and tax/freight differences."}</label>
      <button className="btn p" disabled={!ready4} onClick={approve}>
        {busy ? "Working…" : `Approve: draft ${d.rows.length} product${d.rows.length === 1 ? "" : "s"}${labelCount ? ` & print ${labelCount} label${labelCount === 1 ? "" : "s"}` : " & save purchase"}`}
      </button>
      {!busy && !!missing.length && <div className="sm bad-text" role="status">To approve: {missing.join(" · ")}</div>}
      <div className="xs mut">One press records the purchase, drafts the products onto {d.rack ? "the chosen rack" : "the rack"} and sends the labels. Nothing is printed before you press it.</div>
      </div>
    </>}

    {error && <div className="note warn" role="alert" style={{ whiteSpace: "pre-line" }}>{error}</div>}
    {printer.panel}
  </section>;
}
