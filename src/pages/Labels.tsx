import { useEffect, useMemo, useRef, useState } from "react";
import { usePrintJob } from "../lib/printing";
import { lazy, Suspense } from "react";
const PurchasePhoto = lazy(() => import("../components/PurchasePhoto"));
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting, recordMovement, type Product } from "../lib/db";
import { qrSvg } from "../lib/qr";
import { ownPayload } from "../lib/parse";
import { blankProduct, saveProduct, findByScan, distinct, DEFAULT_ITEMS, DEFAULT_TYPES, label, itemCodeFor } from "../lib/products";
import { Head, LocationSelect, DeadToggle , MoneyInput } from "../components/common";
import { WedgeInput } from "../components/Scanner";
import { useApp, toast } from "../lib/app";
import { can, roleName } from "../lib/roles";
import { inStore } from "../lib/scope";
import { purchaseLabelJobs, productForLabel } from "../lib/purchase-labels";
import { toPaise } from "../lib/format";
import { getRule, priceFromCost, type PricingRule } from "../lib/pricing";
import { labelTSPL, labelRate, rateMark } from "../lib/label-tspl";
import { labelBatches, runsOf, DEFAULT_BATCH, type LabelBatch } from "../lib/labelBatches";
import { printTSPL, directPrintSupported, connectSerial, connectUSB, serialSupported, usbSupported } from "../lib/tsc";

/* Label settings — every number is in millimetres so what you see is what the printer gets. */
export type LabelCfg = {
  output?: "browser" | "tspl";
  preset: string; mode: "roll" | "sheet";
  w: number; h: number; cols: number; gapX: number; gapY: number;
  sheetW: number; sheetH: number; top: number; left: number; rows: number;
  qr: number; font: number; pad: number; offX: number; offY: number;
  shop: string; format: "shop" | "rungnna"; layout: "shop" | "stack"; show: { shop: boolean; item: boolean; style: boolean; color: boolean; rate: boolean; tk: boolean; code: boolean; qty: boolean; cost_code: boolean };
  batch?: number;        // stickers handed to the printer at a time (0 = all at once) — see lib/labelBatches
  testFirst?: boolean;   // a long run starts with one test row
  edgeR?: number;        // sheet: page x (mm) where the printer stops printing; a sticker past it is laid out narrower
  cur?: string;          // printed before the rate: "9" on the shop's old stickers, or ₹ / Rs. / nothing
};

/** Where one sticker goes on a sheet page, and how wide it can be before the printer's right edge. */
export function cellBox(cfg: LabelCfg, c: number, r: number) {
  const x = cfg.left + cfg.offX + c * (cfg.w + cfg.gapX), y = cfg.top + cfg.offY + r * (cfg.h + cfg.gapY);
  const limit = cfg.edgeR ?? cfg.sheetW;
  return { x, y, w: Math.min(cfg.w, Math.round((limit - x) * 100) / 100) };
}

export const PRESETS: { key: string; name: string; cfg: Partial<LabelCfg> }[] = [
  /* Fitted to the shop's printer exactly as it is already set up (screenshot, 15 Oct 2026): the TSC driver's
     paper is USER 101.6 × 152.4 mm (4 × 6 in). Nothing on that computer changes; the app lays its 33 × 15 mm
     stickers onto that page instead: 3 across × 9 down = 27 a page. 9 rows × 16.93 mm = 152.4 mm, so every
     page ends exactly where the next one starts and the rows stay on the stickers page after page. */
  /* First real print (photo, 15 Oct night): rows sat right vertically, but the stickers start ~3.5 mm right of the
     page's left edge (first letters cut off on the left column) and the head prints nothing past ~100 mm (shop name
     cut on the right column). So: left 3.5, and the third sticker's content stops at 100 mm. */
  { key: "rjpage", name: "Rungnna printer as set: 4 × 6 in page, 27 stickers of 33 × 15 mm", cfg: { mode: "sheet", sheetW: 101.6, sheetH: 152.4, w: 33, h: 15, cols: 3, rows: 9, gapX: 1.3, gapY: 1.93, top: 0, left: 3.5, edgeR: 100, qr: 8, font: 5, pad: 0.8 } },
  /* The shop's actual stock (photographed 15 Oct 2026): a TSC roll three stickers across, each 33 × 15 mm,
     ~2 mm apart. One printed "page" is one row of three: 103 × 15 mm. */
  { key: "rj3", name: "Rungnna roll: 3 across, 33 × 15 mm", cfg: { mode: "roll", w: 33, h: 15, cols: 3, gapX: 2, gapY: 0, qr: 11, font: 5, pad: 0.8 } },
  { key: "rj", name: "50 × 20 mm roll", cfg: { mode: "roll", w: 50, h: 20, cols: 1, gapX: 0, gapY: 0, qr: 15, font: 7.5, pad: 1.2 } },
  { key: "50x25", name: "50 × 25 mm roll (most common)", cfg: { mode: "roll", w: 50, h: 25, cols: 1, gapX: 0, gapY: 0, qr: 20, font: 6.5 } },
  { key: "38x25", name: "38 × 25 mm roll", cfg: { mode: "roll", w: 38, h: 25, cols: 1, gapX: 0, gapY: 0, qr: 18, font: 6 } },
  { key: "2up38", name: "2-up 38 × 25 mm roll (80 mm wide)", cfg: { mode: "roll", w: 38, h: 25, cols: 2, gapX: 2, gapY: 0, qr: 18, font: 6 } },
  { key: "40x30", name: "40 × 30 mm roll", cfg: { mode: "roll", w: 40, h: 30, cols: 1, gapX: 0, gapY: 0, qr: 22, font: 7 } },
  { key: "75x38", name: "75 × 38 mm roll", cfg: { mode: "roll", w: 75, h: 38, cols: 1, gapX: 0, gapY: 0, qr: 32, font: 9 } },
  { key: "tag", name: "Jewellery tail tag 65 × 13 mm", cfg: { mode: "roll", w: 65, h: 13, cols: 1, gapX: 0, gapY: 0, qr: 11, font: 5 } },
  { key: "a4-65", name: "A4 sheet, 65 labels (38.1 × 21.2)", cfg: { mode: "sheet", w: 38.1, h: 21.2, cols: 5, rows: 13, gapX: 2.5, gapY: 0, top: 10.7, left: 4.7, sheetW: 210, sheetH: 297, qr: 18, font: 5.5 } },
  { key: "a4-40", name: "A4 sheet, 40 labels (52.5 × 29.7)", cfg: { mode: "sheet", w: 52.5, h: 29.7, cols: 4, rows: 10, gapX: 0, gapY: 0, top: 0, left: 0, sheetW: 210, sheetH: 297, qr: 24, font: 7 } },
  { key: "a4-24", name: "A4 sheet, 24 labels (70 × 37)", cfg: { mode: "sheet", w: 70, h: 37, cols: 3, rows: 8, gapX: 0, gapY: 0, top: 0.5, left: 0, sheetW: 210, sheetH: 297, qr: 30, font: 9 } },
];

export const DEFAULT_CFG: LabelCfg = {
  output: "browser",
  preset: "rjpage", mode: "sheet", w: 33, h: 15, cols: 3, gapX: 1.3, gapY: 1.93, sheetW: 101.6, sheetH: 152.4, top: 0, left: 3.5, edgeR: 100, rows: 9,
  qr: 8, font: 5, pad: 0.8, offX: 0, offY: 0, shop: "RUNGNNA", format: "shop", layout: "shop",
  show: { shop: true, item: true, style: true, color: true, rate: true, tk: false, code: false, qty: true, cost_code: true },
  cur: "9",
};

export type Job = { p: Product; qtyOnLabel: number; copies: number };
/** One entry per sticker, in queue order (capped at 5000). */
export const expandJobs = (jobs: Job[]) => jobs.flatMap(j => Array.from({ length: Math.max(0, Math.min(5000, j.copies)) }, () => j)).slice(0, 5000);

/* Saved printer settings, brought up to date. Two earlier defaults were set before the shop's printer was
   seen: 50 × 20 mm one across, then 103 × 15 mm rows (which needed a new paper size in Windows). A device still
   on either, untouched, moves to the page the printer is already set to. Anything set by hand is left alone. */
export function upgradeLabelCfg(saved: Partial<LabelCfg> | null | undefined): LabelCfg {
  const c = { ...DEFAULT_CFG, ...(saved || {}), show: { ...DEFAULT_CFG.show, ...(saved?.show || {}) } };
  const old50 = c.preset === "rj" && c.w === 50 && c.h === 20 && c.cols === 1;
  const oldRow = c.preset === "rj3" && c.mode === "roll" && c.w === 33 && c.h === 15 && c.cols === 3;
  // the first version of the page layout (left 0, no right edge), untouched: take the measured one
  const firstPage = c.preset === "rjpage" && c.left === 0 && c.edgeR === undefined && c.offX === 0;
  if (old50 || oldRow || firstPage) return { ...c, ...PRESETS.find(x => x.key === "rjpage")!.cfg, preset: "rjpage", show: { ...c.show, cost_code: true } };
  // the measured page before it matched his old stickers (QR 11): same look as his now
  if (c.preset === "rjpage" && c.qr === 11 && c.left === 3.5) return { ...c, qr: 8, show: { ...c.show, cost_code: true } };
  return c;
}
export const loadLabelCfg = () => getSetting<Partial<LabelCfg> | null>("label_cfg", null).then(upgradeLabelCfg);

export function validateLabelPrint(cfg: LabelCfg, jobs: Job[]) {
  if (![cfg.w, cfg.h, cfg.qr, cfg.font].every(n => Number.isFinite(n) && n > 0) || cfg.w > 200 || cfg.h > 300 || ![cfg.gapX, cfg.gapY, cfg.pad].every(n => Number.isFinite(n) && n >= 0) || ![cfg.offX, cfg.offY].every(Number.isFinite) || !Number.isSafeInteger(cfg.cols) || cfg.cols < 1 || cfg.cols > 20) throw new Error("Check label size, gaps and columns in printer settings");
  if (cfg.mode === "sheet" && (!Number.isSafeInteger(cfg.rows) || cfg.rows < 1 || cfg.rows > 100 || ![cfg.sheetW, cfg.sheetH].every(n => Number.isFinite(n) && n > 0) || ![cfg.top, cfg.left].every(n => Number.isFinite(n) && n >= 0) || cellBox(cfg, cfg.cols - 1, 0).w < cfg.qr + cfg.pad * 2 + 8 || (cfg.edgeR === undefined && cfg.left + cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX > cfg.sheetW + 0.01) || cfg.top + cfg.rows * cfg.h + (cfg.rows - 1) * cfg.gapY > cfg.sheetH + 0.01)) throw new Error("Labels do not fit the selected sheet");
  if (cfg.pad * 2 >= Math.min(cfg.w, cfg.h) || cfg.qr + cfg.pad * 2 >= cfg.w) throw new Error("Leave room for the product name beside the QR");
  if (!jobs.length || jobs.some(j => !j.p.item.trim() || !Number.isSafeInteger(j.copies) || j.copies < 1 || !Number.isSafeInteger(j.qtyOnLabel) || j.qtyOnLabel < 1) || jobs.reduce((n, j) => n + j.copies, 0) > 5000) throw new Error("Review product names and print quantities (maximum 5000 labels)");
}

export default function Labels({ args }: { args: string[] }) {
  const { me, setMe } = useApp();
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [form, setForm] = useState<Product>(() => blankProduct(""));
  const [qty, setQty] = useState("1");
  const [copies, setCopies] = useState("1");
  const queueLock = useRef(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [addStock, setAddStock] = useState(false);
  const [loc, setLoc] = useState("");
  const printer = useLabelPrint(cfg);
  const [aligning, setAligning] = useState(false);
  usePrintJob(aligning, () => setAligning(false), "align", m => toast(m, true));
  const [printerReady, setPrinterReady] = useState(false), [loadedPurchase, setLoadedPurchase] = useState("");
  const autoPrinted = useRef("");
  const [rule, setRule] = useState<PricingRule | null>(null);
  const [cost, setCost] = useState("");          // ₹ cost entered by the operator
  const vendors = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);
  const items = useLiveQuery(() => distinct("item"), [], []);

  useEffect(() => { loadLabelCfg().then(c => { setCfg(c); setPrinterReady(true); }); }, []);
  useEffect(() => { getRule().then(setRule); }, []);

  /* Consistent pricing: the moment a cost is entered, the sell RATE and the
     encrypted COST CODE are computed by the shop-wide rule — the same cost always
     gives the same rate + code, on every device. The operator can still override
     the rate by hand (that sets price_locked so the rule won't stomp it). */
  const applyCost = (rupees: string) => {
    setCost(rupees);
    const r = rule; if (!r) return;
    const paise = toPaise(rupees);
    if (!paise) return;
    const pack = Math.max(1, parseInt(qty) || 1);
    const { rate, cost_code } = priceFromCost(paise, r, pack, form.type || "PCS");
    setForm(f => ({ ...f, cost: paise, rate: f.price_locked ? f.rate : rate, cost_code }));
  };
  useEffect(() => {
    let dead = false;
    if (args[0] === "purchase" && args[1]) {
      (async () => {
        const purchase = await db.purchases.get(args[1]);
        if (!purchase || purchase.deleted || !inStore(purchase)) return;
        const products = await db.products.bulkGet(purchase.items.map(l => l.product_id));
        const queue = purchaseLabelJobs(purchase, products.filter((p): p is Product => !!p));
        if (!dead) { setJobs(queue); setLoadedPurchase(purchase.id); }
      })().catch(e => { if (!dead) toast(e.message || "Could not prepare purchase labels", true); });
    } else if (args[0]) db.products.get(args[0]).then(p => { if (p) { setForm({ ...p }); setQty(String(p.pack || 1)); } });
    return () => { dead = true; };
  }, [args[0], args[1]]);
  useEffect(() => {
    if (args[0] === "purchase" && args[2] === "print" && printerReady && loadedPurchase === args[1] && jobs.length && autoPrinted.current !== loadedPurchase) {
      autoPrinted.current = loadedPurchase;
      if (cfg.output === "tspl") doPrintTSC(false); else doPrint();
    }
  }, [args[0], args[1], args[2], printerReady, loadedPurchase, jobs]);
  const upd = (patch: Partial<LabelCfg>) => { const c = { ...cfg, ...patch }; setCfg(c); setSetting("label_cfg", c); };
  const set = (k: keyof Product, v: any) => setForm(f => ({ ...f, [k]: v }));

  const addJob = async (print = false) => {
    if (queueLock.current) return;
    if (!form.item && !form.style) { toast("Fill ITEM or STYLE first", true); return; }
    if (addStock && !loc) return toast("Choose the rack the new stock goes to", true);
    const n = Number(copies), packet = Number(qty);
    if (!Number.isSafeInteger(n) || n < 1 || n > 5000 || !Number.isSafeInteger(packet) || packet < 1 || packet > 1000000) return toast("Check packet quantity and print quantity (1–5000)", true);
    if (jobs.reduce((sum, j) => sum + j.copies, 0) + n > 5000) return toast("Print this queue before adding more than 5000 labels", true);
    if (print) { try { validateLabelPrint(cfg, [...jobs, { p: { ...form, item: form.item || "Pending" }, qtyOnLabel: packet, copies: n }]); } catch (e: any) { return toast(e.message, true); } }
    queueLock.current = true; setQueueBusy(true);
    try {
    const saved = await db.transaction("rw", [db.products, db.config, db.settings, db.stock, db.locations, db.movements, db.outbox], async () => {
    // make sure the product exists so a scan of the new QR always finds it
    const existing = form.style ? await findByScan(form.code, { raw: form.code, how: "x", tokens: [], style: form.style, color: form.color, item: form.item }) : undefined;
    const pack = Math.max(1, parseInt(qty) || 1);
    const item_code = form.item_code || (await itemCodeFor(form.item)) || undefined;
    const p = existing && existing.id !== form.id
      ? { ...existing, rate: form.rate || existing.rate, tk: form.tk || existing.tk, pack, item_code: existing.item_code || item_code,
          // carry the new pricing / vendor / keying fields onto the matched product
          cost: form.cost || existing.cost, cost_code: form.cost_code || existing.cost_code, price_locked: form.price_locked ?? existing.price_locked,
          model: form.model || existing.model, vendor_id: form.vendor_id || existing.vendor_id, vendor_name: form.vendor_name || existing.vendor_name }
      : { ...form, pack, item_code, created_by: form.created_by || me?.id || "" };
    const saved = await saveProduct(p);
    if (!saved.item.trim()) throw new Error("Enter the product name before printing labels");
    if (addStock) {
      if (!loc) { toast("Choose the rack the new stock goes to", true); return; }
      await recordMovement({ product_id: saved.id, kind: "intake", qty: n * Math.max(1, parseInt(qty) || 1), from_loc: null, to_loc: loc, person_type: "employee", person_name: me?.name || "", by_staff: me?.id || "", note: "labelled at print" });
    }
    return saved;
    });
    if (!saved) return;
    const job = { p: saved, qtyOnLabel: Math.max(1, parseInt(qty) || 1), copies: n };
    setJobs(j => [...j, job]);
    if (print) printer.start(expandJobs([...jobs, job]));
    toast(`${n} labels queued · ${label(saved)}`);
    setForm(blankProduct(me?.id || "")); setQty("1"); setCost("");
    } catch (e: any) { toast(e.message || "Could not prepare labels", true); }
    finally { queueLock.current = false; setQueueBusy(false); }
  };

  const flat = useMemo(() => expandJobs(jobs), [jobs]);
  const total = flat.length;

  const doPrint = () => { try { validateLabelPrint(cfg, jobs); printer.start(flat); } catch (e: any) { toast(e.message, true); } };

  /* Direct-to-TSC: TSPL straight to the printer, in the same stoppable batches. */
  const doPrintTSC = (prompt = true) => {
    try { validateLabelPrint(cfg, jobs); tscCommands(cfg, flat.slice(0, 1)); printer.start(flat, true, prompt); }
    catch (e: any) { toast(e.message, true); }
  };

  return (
    <div className="label-counter">
      <Head eyebrow="Barcode print" title="QR labels" sub="Same fields as the old BARCODE PRINT screen. Every label carries its own details inside the QR, so it scans even on a phone with no internet.">
        {directPrintSupported() && <button className="btn dk" disabled={!total || printer.busy} onClick={() => doPrintTSC()} title="Send straight to a compatible TSC label printer">{`Print to TSC ${total || ""}`}</button>}
        <button className="btn g" disabled={!total || printer.busy} onClick={doPrint}>Print {total || ""} labels</button>
      </Head>
      <div className="split">
        <div className="stack">
          {can(me, "purchases.photo") ? <details className="card purchase-import" open={args[0] === "bill"}>
            <summary className="pad b">From a purchase bill — upload the photo, get the labels</summary>
            <div style={{ borderTop: "1px solid var(--line-2)" }} className="pad">
              <Suspense fallback={<div role="status">Loading bill reader…</div>}><PurchasePhoto by={me?.id || ""} /></Suspense>
            </div>
          </details>
          /* shown even when not allowed, so the owner can see it exists and how to reach it */
          : <div className="card pad row"><span className="grow sm"><b>From a purchase bill</b> — needs “Read purchase bill photos”, which {roleName(me) || "this person"} does not have.</span>
              <button className="btn sm" onClick={() => setMe(null)}>Switch person</button></div>}
          <div className="card">
            <header><h3>Barcode print</h3><span className="xs mut">scan an existing label to copy its details</span></header>
            <div className="pad stack">
              <WedgeInput autoFocus={false} placeholder="Scan an old label to pre-fill (optional)" onCode={async raw => {
                const p = await findByScan(raw); if (p) { setForm({ ...p }); setQty(String(p.pack || 1)); toast("Loaded " + label(p)); } else toast("Not in the system yet — fill it below", true);
              }} />
              <div className="grid g2">
                <label className="f">ITEM
                  <input className="in" list="litems" value={form.item} onChange={e => set("item", e.target.value.toUpperCase())} autoFocus />
                  <datalist id="litems">{[...new Set([...items, ...DEFAULT_ITEMS])].map(i => <option key={i} value={i} />)}</datalist></label>
                <label className="f">TYPE
                  <select className="in" value={form.type} onChange={e => set("type", e.target.value)}>{DEFAULT_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
                <label className="f">STYLE<input className="in mono" value={form.style} onChange={e => set("style", e.target.value.toUpperCase())} placeholder="K5209/59SH" /></label>
                <label className="f">COLOR<input className="in mono" value={form.color} onChange={e => set("color", e.target.value.toUpperCase())} placeholder="K/GBN" /></label>
                <label className="f">TK<input className="in mono" value={form.tk} onChange={e => set("tk", e.target.value.toUpperCase())} /></label>
                <details className="label-advanced"><summary>More details</summary><div className="grid g2">
                <label className="f">MODEL / ARTICLE No.<input className="in mono" value={form.model || ""} onChange={e => set("model", e.target.value.toUpperCase() || undefined)} placeholder="vendor's article no" /></label>
                <label className="f">VENDOR
                  <select className="in" value={form.vendor_id || ""} onChange={e => { const v = vendors.find(x => x.id === e.target.value); set("vendor_id", e.target.value || undefined); set("vendor_name", v?.name || undefined); }}>
                    <option value="">—</option>{vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}</select></label>
                <label className="f">ITEM CODE (old software)<input className="in mono" inputMode="numeric" value={form.item_code || ""} placeholder="auto" onChange={e => set("item_code", e.target.value.replace(/\D/g, "") || undefined)} /></label>
                {can(me, "rates") && <label className="f">COST ₹
                  <input className="in mono" inputMode="decimal" value={cost} placeholder="enter cost" onChange={e => applyCost(e.target.value)} /></label>}
                </div></details>
                <label className="f">RATE ₹ {can(me, "rates") && form.cost_code && <span className="xs mut">code {form.cost_code}</span>}
                  <MoneyInput className="in hi mono" paise={form.rate} onPaise={v => { set("rate", v); set("price_locked", 1); }} /></label>
                <label className="f">QTY (pieces per packet — prints as ₹RATE X QTY PCS)<input className="in mono" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ""))} /></label>
                <label className="f">PRINT QTY (labels)<input className="in mono" inputMode="numeric" value={copies} onChange={e => setCopies(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && addJob()} /></label>
              </div>
              <label className="row sm"><input type="checkbox" checked={addStock} onChange={e => setAddStock(e.target.checked)} /> These are new packets — also add them to stock</label>
              {addStock && <LocationSelect value={loc} onChange={setLoc} label="Into rack" buckets={false} />}
              <div className="row"><button className="btn p" disabled={queueBusy} onClick={() => addJob(true)}>Print barcode</button><button className="btn" disabled={queueBusy} onClick={() => addJob()}>Add to queue</button></div>
            </div>
          </div>
          {jobs.length > 0 && (
            <div className="card">
              <header><h3>Print queue</h3><span className="pill">{total} labels</span><button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setJobs([])}>Clear</button></header>
              <div className="pad stack" style={{ gap: 6 }}>
                {jobs.map((j, i) => (
                  <div key={i} className="row sm">
                    <span className="grow">{label(j.p)} <span className="mono xs mut">{j.p.code}</span></span>
                    <input className="in mono" style={{ width: 80, minHeight: 34 }} value={j.copies} inputMode="numeric"
                      onChange={e => setJobs(js => js.map((x, k) => k === i ? { ...x, copies: parseInt(e.target.value) || 0 } : x))} />
                    <button className="btn sm bad" onClick={() => setJobs(js => js.filter((_, k) => k !== i))}>✕</button>
                  </div>))}
              </div>
            </div>
          )}
        </div>
        <div className="stack"><div className="labelprev"><LabelView cfg={cfg} p={jobs[0]?.p || form} qtyOnLabel={jobs[0]?.qtyOnLabel || parseInt(qty) || 1} /></div><details><summary>Printer settings</summary><LabelSettings cfg={cfg} upd={upd} onTest={() => { if (!printer.busy) setAligning(true); }} sample={jobs[0]?.p || { ...form, code: form.code }} qty={jobs[0]?.qtyOnLabel || parseInt(qty) || 1} /></details></div>
      </div>
      {printer.panel}
      {aligning && createPortal(<AlignSheet cfg={cfg} />, document.getElementById("printroot")!)}
    </div>
  );
}

export function LabelView({ cfg, p, qtyOnLabel = 1 }: { cfg: LabelCfg; p: Product; qtyOnLabel?: number }) {
  const pp = productForLabel(p, qtyOnLabel);
  const { svg } = useMemo(() => qrSvg(ownPayload(pp, cfg.format || "shop")), [p.code, p.item, p.type, p.style, p.color, p.tk, p.rate, p.item_code, pp.pack, p.ref, cfg.format]);
  const s = cfg.show, fs = cfg.font;
  const q = Math.min(cfg.qr, cfg.h - cfg.pad * 2);
  const cur = rateMark(cfg);
  if ((cfg.layout || "shop") === "shop") return (
    /* As the stickers on his packets (photo, 15 Oct): item, style and cost code small on the left, the QR beside
       them at the top, the rate big along the bottom ("9320X1PCS"), and RUNGNNA standing up at the right edge. */
    <div className="lbl lbl-shop" style={{ width: cfg.w + "mm", height: cfg.h + "mm", padding: cfg.pad + "mm", columnGap: cfg.pad + "mm", fontSize: fs + "pt" }}>
      <div className="t">
        {s.item && p.item && <div>{p.item}</div>}
        {s.style && p.style && <div>{p.style}</div>}
        {s.color && p.color && <div>{p.color}</div>}
        {s.tk && p.tk && <div>TK {p.tk}</div>}
        {s.cost_code && pp.cost_code && <div>{pp.cost_code}</div>}
        {s.code && <div style={{ fontSize: fs * 0.85 + "pt" }}>{p.code}</div>}
      </div>
      <div className="q" style={{ width: q + "mm", height: q + "mm" }} dangerouslySetInnerHTML={{ __html: svg }} />
      {s.rate && p.rate > 0 && <div className="r" style={{ fontSize: fs * 1.75 + "pt" }}>{cur}{labelRate(p.rate)}{s.qty ? `X${pp.pack}${p.type || "PCS"}` : ""}</div>}
      {s.shop && cfg.shop && <div className="n" style={{ fontSize: fs * 0.95 + "pt" }}>{cfg.shop}</div>}
    </div>
  );
  return (
    <div className="lbl" style={{ width: cfg.w + "mm", height: cfg.h + "mm", padding: cfg.pad + "mm", gap: cfg.pad + "mm", fontSize: fs + "pt" }}>
      <div className="q" style={{ width: q + "mm", height: q + "mm" }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="t">
        {s.shop && cfg.shop && <div style={{ fontWeight: 800, letterSpacing: ".08em", fontSize: fs * 0.9 + "pt" }}>{cfg.shop}</div>}
        {s.item && p.item && <div style={{ fontWeight: 700 }}>{p.item}</div>}
        {s.style && p.style && <div>{p.style}</div>}
        {s.color && p.color && <div>{p.color}</div>}
        {s.tk && p.tk && <div>TK {p.tk}</div>}
        {s.qty && <div>{qtyOnLabel} {p.type || "PCS"}</div>}
        {s.rate && p.rate > 0 && <div style={{ fontWeight: 800, fontSize: fs * 1.25 + "pt" }}>{cur}{labelRate(p.rate)}</div>}
        {s.cost_code && pp.cost_code && <div style={{ fontFamily: "monospace", fontWeight: 700, fontSize: fs * 0.95 + "pt" }}>{pp.cost_code}</div>}
        {s.code && <div style={{ fontFamily: "monospace", fontSize: fs * 0.85 + "pt" }}>{p.code}</div>}
      </div>
    </div>
  );
}

function LabelSettings({ cfg, upd, sample, qty, onTest }: { cfg: LabelCfg; upd: (p: Partial<LabelCfg>) => void; sample: Product; qty: number; onTest?: () => void }) {
  const num = (k: keyof LabelCfg, lab: string, step = 0.5) => (
    <label className="f">{lab}
      <input className="in mono" type="number" step={step} value={cfg[k] as number} onChange={e => upd({ [k]: Number(e.target.value) } as any)} /></label>);
  const demo: Product = sample.item || sample.style ? sample : { ...sample, item: "F-RING", type: "PCS", style: "K5208/K-LT", color: "W/LP/B", rate: 2400, item_code: "202", pack: 12, ref: "183" };
  return (
    <div className="card" style={{ position: "sticky", top: 70 }}>
      <header><h3>Label size &amp; layout</h3><span className="xs mut">saved on this device</span></header>
      <div className="pad stack">
        <label className="f">Purchase label output<select className="in" value={cfg.output || "browser"} onChange={e => upd({ output: e.target.value as "browser" | "tspl" })}><option value="browser">Browser / Windows printer driver</option><option value="tspl" disabled={!directPrintSupported()}>Direct TSC (TSPL, 203 dpi only)</option></select></label>
        {cfg.output === "tspl" && serialSupported() && <button className="btn" onClick={() => connectSerial().then(() => toast("Serial printer connected")).catch(e => toast(e.message, true))}>Connect serial printer</button>}
        {cfg.output === "tspl" && usbSupported() && <button className="btn" onClick={() => connectUSB().then(() => toast("USB printer connected")).catch(e => toast(e.message, true))}>Connect TSC USB printer</button>}
        <label className="f">Sticker
          <select className="in" value={cfg.preset} onChange={e => { const p = PRESETS.find(x => x.key === e.target.value); upd({ preset: e.target.value, ...(p?.cfg || {}) }); }}>
            {PRESETS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            <option value="custom">Custom size</option>
          </select></label>
        <div className="grid g3">
          {num("w", "Width mm")}{num("h", "Height mm")}{num("qr", "QR size mm")}
          {num("font", "Text size pt")}{num("offX", "Nudge right mm", 0.25)}{num("offY", "Nudge down mm", 0.25)}
          {cfg.mode === "roll" ? <>{num("cols", "Stickers across", 1)}{num("gapX", "Gap across mm")}{num("gapY", "Gap between mm")}</>
            : <>{num("sheetW", "Page width mm", 0.1)}{num("sheetH", "Page height mm", 0.1)}{num("cols", "Across", 1)}{num("rows", "Down", 1)}{num("top", "Top margin mm")}{num("left", "Left margin mm")}{num("gapX", "Gap across mm")}{num("gapY", "Gap down mm")}
              <label className="f">Printer stops at mm<input className="in mono" type="number" step={0.5} value={cfg.edgeR ?? cfg.sheetW} onChange={e => upd({ edgeR: Number(e.target.value) || undefined })} /></label></>}
        </div>
        <div className="grid g2">
          <label className="f">Stickers per batch (0 = all at once)
            <input className="in mono" type="number" min={0} step={cfg.mode === "roll" ? cfg.cols : 1} value={cfg.batch ?? DEFAULT_BATCH} onChange={e => upd({ batch: Math.max(0, Math.floor(Number(e.target.value) || 0)) })} /></label>
          <label className="row sm"><input type="checkbox" checked={cfg.testFirst ?? true} onChange={e => upd({ testFirst: e.target.checked })} /> Long runs start with one test row</label>
        </div>
        <div className="xs mut">The app waits after each batch: <b>Print next</b> or <b>Stop</b>. Windows only ever holds one batch, so switching the printer off never brings back hundreds of stickers.</div>
        <div className="grid g2">
          <label className="f">Shop name on label<input className="in" value={cfg.shop} onChange={e => upd({ shop: e.target.value })} /></label>
          <label className="f">Before the rate
            <select className="in" value={rateMark(cfg)} onChange={e => upd({ cur: e.target.value })}>
              <option value="9">9 — like the old stickers (9320X1PCS)</option>
              <option value="₹">₹ (₹320X1PCS)</option>
              <option value="Rs.">Rs. (Rs.320X1PCS)</option>
              <option value="">Nothing (320X1PCS)</option>
            </select></label>
        </div>
        <div className="grid g2">
          <label className="f">QR content
            <select className="in" value={cfg.format || "shop"} onChange={e => upd({ format: e.target.value as any })}>
              <option value="shop">Same as old software (both systems can scan)</option>
              <option value="rungnna">Rungnna only</option>
            </select></label>
          <label className="f">Arrangement
            <select className="in" value={cfg.layout || "shop"} onChange={e => upd({ layout: e.target.value as any })}>
              <option value="shop">Like current sticker (text · QR · name)</option>
              <option value="stack">QR left, text right</option>
            </select></label>
        </div>
        <div className="chips">
          {(Object.keys(cfg.show) as (keyof LabelCfg["show"])[]).map(k => (
            <button key={k} className="chip" aria-pressed={cfg.show[k]} onClick={() => upd({ show: { ...cfg.show, [k]: !cfg.show[k] } })}>{k.toUpperCase()}</button>))}
        </div>
      </div>
      <div className="labelprev"><LabelView cfg={cfg} p={demo} qtyOnLabel={qty} /></div>
      <PrinterSetup cfg={cfg} onTest={onTest} />
    </div>
  );
}

/* TSPL for a run of stickers (the direct-to-TSC path). Identical neighbours go as one PRINT n. */
export function tscCommands(cfg: LabelCfg, list: Job[]) {
  if (cfg.mode !== "roll" || cfg.cols !== 1) throw new Error(`Direct TSC printing does one sticker across. This roll is ${cfg.cols} across: choose "Browser / Windows printer driver" in Printer settings.`);
  return runsOf(list).map(({ item: j, n }) => {
    const product = productForLabel(j.p, j.qtyOnLabel);
    return labelTSPL(cfg, product, j.qtyOnLabel, n, ownPayload(product, cfg.format || "shop"));
  }).join("");
}

type Run = { list: Job[]; batches: LabelBatch[]; i: number; phase: "print" | "wait"; direct: boolean; prompt: boolean; n: number };

/* Prints stickers a batch at a time and waits between batches, so a wrong print can be stopped.
   Windows resumes a queued job after the printer is switched back on; a batch is all it ever holds. */
export function useLabelPrint(cfg: LabelCfg) {
  const [run, setRunState] = useState<Run | null>(null);
  const ref = useRef<Run | null>(null), failed = useRef(false);
  const setRun = (r: Run | null) => { ref.current = r; setRunState(r); };
  const slice = (r: Run) => r.list.slice(r.batches[r.i].from, r.batches[r.i].to);
  const finished = (r: Run) => {
    if (r.i + 1 < r.batches.length) return setRun({ ...r, phase: "wait" });
    setRun(null);
    toast(`All ${r.list.length} sticker${r.list.length === 1 ? "" : "s"} sent to the printer`);
  };
  const go = async (r: Run) => {
    setRun(r);
    if (!r.direct) return;                             // browser: the print effect below takes it
    try { await printTSPL(tscCommands(cfg, slice(r)), r.prompt); finished(r); }
    catch (e: any) { toast((e?.message || "Direct print failed") + " · Check what came out before printing again.", true); setRun({ ...r, phase: "wait" }); }
  };
  const printing = !!run && run.phase === "print" && !run.direct;
  usePrintJob(printing, () => {
    const r = ref.current; if (!r) return;
    if (failed.current) { failed.current = false; setRun({ ...r, phase: "wait" }); } else finished(r);
  }, run ? `${run.i}.${run.n}` : "", m => { failed.current = true; toast(m, true); });

  const start = (list: Job[], direct = false, prompt = true) => {
    if (ref.current) return toast("Finish or stop the print already running first", true);
    const unit = cfg.mode === "roll" ? cfg.cols : cfg.cols * cfg.rows;
    const batches = labelBatches(list.length, unit, cfg.batch ?? DEFAULT_BATCH, cfg.testFirst ?? true);
    if (batches.length) void go({ list, batches, i: 0, phase: "print", direct, prompt, n: 0 });
  };
  const stop = () => {
    const r = ref.current; if (!r) return;
    const sent = r.phase === "wait" ? r.batches[r.i].to : r.batches[r.i].from;
    setRun(null);
    if (r.batches.length > 1 || r.phase === "wait") toast(`Stopped. ${sent} of ${r.list.length} stickers were sent; the rest will not print.`);
  };

  const r = run, b = r?.batches[r.i];
  const nextB = r && r.batches[r.i + 1];
  const panel = r && b ? <>
    {printing && createPortal(<PrintSheet cfg={cfg} jobs={slice(r)} />, document.getElementById("printroot")!)}
    <div className="print-notice batch-panel" role="status">
      {r.phase === "print" ? <>
        <div><b>{r.batches.length > 1 ? `Batch ${r.i + 1} of ${r.batches.length}` : "Printing"}</b> · stickers {b.from + 1}–{b.to} of {r.list.length}{r.direct ? " · sending…" : ""}</div>
        <button className="btn" onClick={stop}>{r.direct ? "Stop after this" : "Close print"}</button>
      </> : <>
        <div><b>{b.to} of {r.list.length} sent.</b> {r.i === 0 && r.batches.length > 2 ? `That was one test ${cfg.mode === "roll" ? "row" : "page"}: check size, position and the count before the rest.` : "Check them before going on."}</div>
        <div className="row">
          {nextB && <button className="btn p" onClick={() => void go({ ...r, i: r.i + 1, phase: "print", n: r.n + 1 })}>Print next {nextB.to - nextB.from} ({nextB.from + 1}–{nextB.to})</button>}
          <button className="btn" onClick={() => void go({ ...r, phase: "print", n: r.n + 1 })}>Print these {b.to - b.from} again</button>
          <button className="btn bad" onClick={stop}>Stop: don't print the rest</button>
        </div>
      </>}
      <div className="xs mut">Wrong print already coming out? Switch the printer off, then cancel the job in Windows (Settings › Printers › TSC › Open print queue › Cancel) before switching it on, or Windows sends it again.</div>
    </div>
  </> : null;
  return { start, stop, busy: !!run, panel };
}

/* What this computer must be told once, so the sticker on screen is the sticker on the roll. */
export function PrinterSetup({ cfg, onTest }: { cfg: LabelCfg; onTest?: () => void }) {
  const pageW = cfg.mode === "roll" ? cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX : cfg.sheetW;
  const pageH = cfg.mode === "roll" ? cfg.h : cfg.sheetH;
  // the page his TSC driver is already set to: nothing to change on that computer
  const asSet = cfg.mode === "sheet" && Math.abs(cfg.sheetW - 101.6) < 0.05 && Math.abs(cfg.sheetH - 152.4) < 0.05;
  const paper = asSet ? "USER (101.6 mm × 152.4 mm)" : `Rungnna ${pageW}×${pageH}`;
  const per = cfg.mode === "roll" ? cfg.cols : cfg.cols * cfg.rows;
  return (
    <details className="pad sm">
      <summary><b>Set up this computer once</b> (date, link or wrong size on stickers?)</summary>
      <ol className="stack" style={{ paddingLeft: 18, margin: "8px 0" }}>
        {asSet
          ? <li>The TSC driver stays exactly as it is: <b>USER (101.6 mm × 152.4 mm)</b>, the page the shop already uses. Nothing to change in Windows.</li>
          : <li>Windows: <b>Settings › Printers &amp; scanners › TSC › Printing preferences</b> › Page Setup › Stock › <b>New</b>: name it “{paper}”, width <b>{pageW} mm</b>, height <b>{pageH} mm</b>, portrait. Stock tab: <b>Labels with gaps</b>. Apply.</li>}
        <li>Print once from here. In Chrome's print window open <b>More settings</b>: Paper size <b>{paper}</b>, Margins <b>None</b>, Scale <b>Default/100</b>, and <b>untick “Headers and footers”</b> (that is what prints the date and the link). Chrome remembers these.</li>
        <li>Each printed page is {per} sticker{per === 1 ? "" : "s"}{cfg.mode === "sheet" ? ` (${cfg.cols} across × ${cfg.rows} down)` : ""}. If the print sits off the stickers, use <b>Nudge right / Nudge down</b>; if it drifts further down the page, change <b>Gap down</b>; across, <b>Gap across</b>. Not the printer's settings.</li>
        {onTest && <li><button className="btn" onClick={onTest}>Print alignment test (1 page)</button> Prints a box where the app puts each sticker, with a millimetre ruler. Send a photo of it: the ruler shows exactly which number to change.</li>}
        <li>Stuck or wrong print: switch the printer off, then <b>Printers &amp; scanners › TSC › Open print queue › Cancel all documents</b> before switching it on again. If a job will not go, restart the <b>Print Spooler</b> service.</li>
      </ol>
    </details>
  );
}

/* One page that shows where the app thinks every sticker is, against a millimetre ruler. A photo of it says
   exactly which number to change: the ruler reading at a sticker's left edge is its "Left margin", and so on. */
export function AlignSheet({ cfg }: { cfg: LabelCfg }) {
  const W = cfg.mode === "sheet" ? cfg.sheetW : cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
  const H = cfg.mode === "sheet" ? cfg.sheetH : cfg.h;
  const rows = cfg.mode === "sheet" ? cfg.rows : 1;
  const boxes = Array.from({ length: rows * cfg.cols }, (_, k) => {
    const c = k % cfg.cols, r = Math.floor(k / cfg.cols);
    return cfg.mode === "sheet" ? { ...cellBox(cfg, c, r), c, r } : { x: cfg.offX + c * (cfg.w + cfg.gapX), y: cfg.offY, w: cfg.w, c, r };
  });
  const ticks = (n: number) => Array.from({ length: Math.floor(n) + 1 }, (_, i) => i);
  const across = (y: number) => <g key={"a" + y}>{ticks(W).map(i => <line key={i} x1={i} x2={i} y1={y} y2={y + (i % 10 ? i % 5 ? 0.8 : 1.4 : 2.2)} stroke="#000" strokeWidth={0.15} />)}
    {ticks(W).filter(i => i % 10 === 0).map(i => <text key={"t" + i} x={i + 0.3} y={y + 4.2} fontSize={2.4} fontWeight={700}>{i}</text>)}</g>;
  // the up-and-down ruler runs in the gap after the first column, so it never covers a box's label
  const midX = cfg.mode === "sheet" && cfg.cols > 1 ? cellBox(cfg, 0, 0).x + cfg.w + cfg.gapX / 2 : W / 2;
  return (<>
    <style>{`@page{size:${W}mm ${H}mm;margin:0}`}</style>
    <svg width={W + "mm"} height={H + "mm"} viewBox={`0 0 ${W} ${H}`} style={{ display: "block" }} fontFamily="Arial, sans-serif">
      {boxes.map((b, i) => <g key={i}>
        <rect x={b.x} y={b.y} width={b.w} height={cfg.h} fill="none" stroke="#000" strokeWidth={0.25} />
        <text x={b.x + b.w / 2} y={b.y + cfg.h - 1.5} fontSize={2.2} textAnchor="middle">{`row ${b.r + 1} · col ${b.c + 1}`}</text>
      </g>)}
      {across(cfg.mode === "sheet" ? cellBox(cfg, 0, 0).y + 2 : cfg.offY + 2)}
      {rows > 4 && across(cellBox(cfg, 0, 4).y + 2)}
      {ticks(H).map(i => <line key={"v" + i} y1={i} y2={i} x1={midX} x2={midX + (i % 10 ? i % 5 ? 0.8 : 1.4 : 2.2)} stroke="#000" strokeWidth={0.15} />)}
      {ticks(H).filter(i => i % 10 === 0 && i > 0).map(i => <text key={"vt" + i} x={midX + 2.6} y={i + 0.8} fontSize={2.4} fontWeight={700}>{i}</text>)}
    </svg>
  </>);
}

/* Exported so the Stock-in bill reader prints through exactly this renderer.
   Two code paths for one sticker is how label geometry drifts. */
export function PrintSheet({ cfg, jobs }: { cfg: LabelCfg; jobs: Job[] }) {
  if (cfg.mode === "roll") {
    const pageW = cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
    const rows: Job[][] = []; for (let i = 0; i < jobs.length; i += cfg.cols) rows.push(jobs.slice(i, i + cfg.cols));
    return (<>
      <style>{`@page{size:${pageW}mm ${cfg.h + cfg.gapY}mm;margin:0}`}</style>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: cfg.gapX + "mm", width: pageW + "mm", height: cfg.h + "mm", pageBreakAfter: i === rows.length - 1 ? "auto" : "always", breakAfter: i === rows.length - 1 ? "auto" : "page", transform: `translate(${cfg.offX}mm,${cfg.offY}mm)` }}>
          {r.map((j, k) => <LabelView key={k} cfg={cfg} p={j.p} qtyOnLabel={j.qtyOnLabel} />)}
        </div>))}
    </>);
  }
  const per = cfg.cols * cfg.rows;
  const pages: Job[][] = []; for (let i = 0; i < jobs.length; i += per) pages.push(jobs.slice(i, i + per));
  return (<>
    <style>{`@page{size:${cfg.sheetW}mm ${cfg.sheetH}mm;margin:0}`}</style>
    {pages.map((pg, i) => (
      <div key={i} style={{ width: cfg.sheetW + "mm", height: cfg.sheetH + "mm", position: "relative", pageBreakAfter: i === pages.length - 1 ? "auto" : "always", breakAfter: i === pages.length - 1 ? "auto" : "page", overflow: "hidden" }}>
        {pg.map((j, k) => {
          const b = cellBox(cfg, k % cfg.cols, Math.floor(k / cfg.cols));
          return <div key={k} style={{ position: "absolute", left: b.x + "mm", top: b.y + "mm" }}>
            <LabelView cfg={b.w < cfg.w ? { ...cfg, w: b.w } : cfg} p={j.p} qtyOnLabel={j.qtyOnLabel} /></div>;
        })}
      </div>))}
  </>);
}
