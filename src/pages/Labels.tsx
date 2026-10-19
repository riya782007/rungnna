import { DeleteButton } from "../components/DeleteButton";
import { SelectAll } from "../components/SelectAll";
import { confirmDelete } from "../lib/confirm-delete";
import { useEffect, useMemo, useRef, useState } from "react";
import { usePrintJob } from "../lib/printing";
import { lazy, Suspense } from "react";
const PurchasePhoto = lazy(() => import("../components/PurchasePhoto"));
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting, recordMovement, type Product } from "../lib/db";
import { ownPayload, parseLabel } from "../lib/parse";
import { blankProduct, saveProduct, findByScan, fromParsed, fillFromItemCode, distinct, DEFAULT_ITEMS, DEFAULT_TYPES, label, itemCodeFor } from "../lib/products";
import { Head, DeadToggle , MoneyInput } from "../components/common";
import { RackPicker } from "../components/RackPicker";
import { SupplierNo } from "../components/SupplierNo";
import { WedgeInput } from "../components/Scanner";
import { useApp, toast } from "../lib/app";
import { can, roleName } from "../lib/roles";
import { inStore } from "../lib/scope";
import { purchaseLabelJobs, productForLabel } from "../lib/purchase-labels";
import { toPaise } from "../lib/format";
import { getRule, priceFromCost, evenRate, type PricingRule } from "../lib/pricing";
import { labelTSPL, rateMark } from "../lib/label-tspl";
import { labelBatches, runsOf, DEFAULT_BATCH, type LabelBatch } from "../lib/labelBatches";
import { printTSPL, directPrintSupported, connectSerial, connectUSB, serialSupported, usbSupported } from "../lib/tsc";
import { renderLabelSvg } from "../lib/label-artwork";
import { buildLabelBitmapJob, validateLabelBitmapJob } from "../lib/label-bitmap";
import { listQzPrinters, printQzTSPL } from "../lib/qz";
import { labelHeat, DEFAULT_LABEL_DENSITY, DEFAULT_LABEL_SPEED } from "../lib/label-darkness";
import { bagPayload, bagLabelCfg, type BagLabel } from "../lib/bag-labels";
import { legacyLabelCopy, validateLegacyCopy } from "../lib/legacy-label-copy";
import { fakeLetterPool, printedCostCode } from "../lib/label-cost-code";

/* Label settings — every number is in millimetres so what you see is what the printer gets. */
export type LabelCfg = {
  output?: "browser" | "tspl" | "qz";
  qzPrinter?: string;
  density?: number; speed?: number;
  compactCostCode?: boolean; fakeLetters?: string;
  preset: string; mode: "roll" | "sheet";
  w: number; h: number; cols: number; gapX: number; gapY: number;
  sheetW: number; sheetH: number; top: number; left: number; rows: number;
  qr: number; font: number; pad: number; offX: number; offY: number;
  shop: string; format: "shop" | "rungnna"; layout: "shop" | "stack"; show: { shop: boolean; item: boolean; style: boolean; color: boolean; rate: boolean; tk: boolean; code: boolean; qty: boolean; cost_code: boolean; line?: boolean };
  batch?: number;        // stickers handed to the printer at a time (0 = all at once) — see lib/labelBatches
  testFirst?: boolean;   // a long run starts with one test row
  edgeR?: number;        // sheet: page x (mm) where the printer stops printing; a sticker past it is laid out narrower
  cur?: string;          // printed before the rate: "9" on the shop's old stickers, or ₹ / Rs. / nothing
  driverPaper?: boolean; // roll: the page size comes from the printer's own stock (one row of stickers), not the page
  rateScale?: number;    // rate line size, × text size
};

/** Where one sticker goes on a sheet page, and how wide it can be before the printer's right edge. */
export function cellBox(cfg: LabelCfg, c: number, r: number) {
  const x = cfg.left + cfg.offX + c * (cfg.w + cfg.gapX), y = cfg.top + cfg.offY + r * (cfg.h + cfg.gapY);
  const limit = cfg.edgeR ?? cfg.sheetW;
  return { x, y, w: Math.min(cfg.w, Math.round((limit - x) * 100) / 100) };
}

export const PRESETS: { key: string; name: string; cfg: Partial<LabelCfg> }[] = [
  /* What his old software does (and why its stickers always land right): every printed "page" is ONE ROW of three
     stickers, and the printer's gap sensor lines up the top of every row by itself. A 4 × 6 in page of 9 rows can't:
     its rows are drawn 16.93 mm apart but the stickers are ~17.6 mm apart (15 mm + gap), so content drifts a little
     more each row, and a short print feeds out a whole page of blanks (both seen on 16 Oct).
     Measured from his roll: liner ~105 mm, three 33 mm stickers ~1 mm apart, first one ~2.5 mm in from the edge the
     print starts at. The page is the TSC driver's own stock "Rungnna row" (104 × 15 mm), so Chrome never rotates or
     shrinks it. Text sizes copied from his old stickers: 6 pt lines, rate twice that. QR 8 mm: the smallest that still gives every QR square 2 whole printer dots at 203 dpi. */
  { key: "rjrow", name: "Rungnna row: one row of 3 stickers per print (like the old software)", cfg: { mode: "roll", driverPaper: true, w: 33, h: 15, cols: 3, gapX: 1.3, gapY: 0, offX: 2.5, offY: 0, edgeR: 104, qr: 8, font: 6, rateScale: 1.8, pad: 1.4 } },
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
  compactCostCode: true, fakeLetters: "Z",
  density: DEFAULT_LABEL_DENSITY, speed: DEFAULT_LABEL_SPEED,
  preset: "rjrow", mode: "roll", driverPaper: true, w: 33, h: 15, cols: 3, gapX: 1.3, gapY: 0, sheetW: 101.6, sheetH: 152.4, top: 0, left: 0, edgeR: 104, rows: 9,
  qr: 8, font: 6, rateScale: 1.8, pad: 1.4, offX: 2.5, offY: 0, shop: "RUNGNNA", format: "shop", layout: "shop",
  show: { shop: true, item: true, style: true, color: true, rate: true, tk: false, code: false, qty: true, cost_code: true, line: true },
  cur: "9",
};

export type Job = { p: Product; qtyOnLabel: number; copies: number; line?: number; labelIndex?: number; bag?: BagLabel; sourceQr?: string };   // line: see lib/purchase-labels
export type PrintStartResult = { started: true } | { started: false; message: string; cancelled?: boolean };
/** One entry per sticker, in queue order (capped at 5000). */
export const expandJobs = (jobs: Job[]) => jobs.flatMap(j => Array.from({ length: Math.max(0, Math.min(5000, j.copies)) }, () => j)).slice(0, 5000);

/* Saved printer settings, brought up to date. Two earlier defaults were set before the shop's printer was
   seen: 50 × 20 mm one across, then 103 × 15 mm rows (which needed a new paper size in Windows). A device still
   on either, untouched, moves to the page the printer is already set to. Anything set by hand is left alone. */
export function upgradeLabelCfg(saved: Partial<LabelCfg> | null | undefined): LabelCfg {
  const c = { ...DEFAULT_CFG, ...(saved || {}), show: { ...DEFAULT_CFG.show, ...(saved?.show || {}) } };
  const old50 = c.preset === "rj" && c.w === 50 && c.h === 20 && c.cols === 1;
  const oldRow = c.preset === "rj3" && c.mode === "roll" && c.w === 33 && c.h === 15 && c.cols === 3;
  // the 4 × 6 in page layouts (any of its three versions) as set by the app, never nudged by hand
  const page = c.preset === "rjpage" && c.offX === 0 && c.offY === 0 && c.sheetH === 152.4 && c.rows === 9;
  const upgraded = old50 || oldRow || page ? { ...c, ...PRESETS.find(x => x.key === "rjrow")!.cfg, preset: "rjrow", show: { ...c.show, cost_code: true } } : c;
  // Earlier single-column USB settings can survive a move to the shop's roll.
  // That transport cannot print multiple columns; normal browser printing can.
  return upgraded.output === "tspl" && (upgraded.mode !== "roll" || upgraded.cols !== 1) ? { ...upgraded, output: "browser" } : upgraded;
}
export const loadLabelCfg = () => getSetting<Partial<LabelCfg> | null>("label_cfg", null).then(async saved => {
  const config = upgradeLabelCfg(saved);
  if (saved?.output === "tspl" && config.output === "browser") {
    await setSetting("label_cfg", config);
    toast("Your saved USB / serial setting cannot print this roll. Switched to Browser / Windows printer driver. Choose QZ Tray for direct three-across printing.");
  }
  return config;
});

export function validateLabelPrint(cfg: LabelCfg, jobs: Job[]) {
  labelHeat(cfg);
  if (![cfg.w, cfg.h, cfg.qr, cfg.font].every(n => Number.isFinite(n) && n > 0) || cfg.w > 200 || cfg.h > 300 || ![cfg.gapX, cfg.gapY, cfg.pad].every(n => Number.isFinite(n) && n >= 0) || ![cfg.offX, cfg.offY].every(Number.isFinite) || !Number.isSafeInteger(cfg.cols) || cfg.cols < 1 || cfg.cols > 20) throw new Error("Check label size, gaps and columns in printer settings");
  if (cfg.mode === "sheet" && (!Number.isSafeInteger(cfg.rows) || cfg.rows < 1 || cfg.rows > 100 || ![cfg.sheetW, cfg.sheetH].every(n => Number.isFinite(n) && n > 0) || ![cfg.top, cfg.left].every(n => Number.isFinite(n) && n >= 0) || cellBox(cfg, cfg.cols - 1, 0).w < cfg.qr + cfg.pad * 2 + 8 || (cfg.edgeR === undefined && cfg.left + cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX > cfg.sheetW + 0.01) || cfg.top + cfg.rows * cfg.h + (cfg.rows - 1) * cfg.gapY > cfg.sheetH + 0.01)) throw new Error("Labels do not fit the selected sheet");
  if (cfg.pad * 2 >= Math.min(cfg.w, cfg.h) || cfg.qr + cfg.pad * 2 >= cfg.w) throw new Error("Leave room for the product name beside the QR");
  if (!jobs.length || jobs.some(j => !j.p.item.trim() || !Number.isSafeInteger(j.copies) || j.copies < 1 || !Number.isSafeInteger(j.qtyOnLabel) || j.qtyOnLabel < 1) || jobs.reduce((n, j) => n + j.copies, 0) > 5000) throw new Error("Review product names and print quantities (maximum 5000 labels)");
  const lastX = cfg.offX + (cfg.cols - 1) * (cfg.w + cfg.gapX);
  const minWidth = cfg.mode === "sheet" ? cellBox(cfg, cfg.cols - 1, 0).w : Math.min(cfg.w, (cfg.edgeR ?? Infinity) - lastX);
  if (minWidth <= 0) throw new Error("Labels do not fit the printer's right edge");
  for (const j of jobs) { const look = j.bag ? bagLabelCfg(cfg) : cfg; renderLabelSvg(minWidth < cfg.w ? { ...look, w: minWidth } : look, j.p, j.qtyOnLabel, j.line, j.labelIndex, j.bag ? bagPayload(j.bag) : validateLegacyCopy(j)); }
}

export default function Labels({ args }: { args: string[] }) {
  const { me, setMe } = useApp();
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [oldCopy, setOldCopy] = useState<Job | null>(null);
  const [queueSelection, setQueueSelection] = useState<Set<string>>(new Set());
  const [form, setForm] = useState<Product>(() => blankProduct(""));
  const [qty, setQty] = useState("1");
  const [copies, setCopies] = useState("1");
  const queueLock = useRef(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [printError, setPrintError] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [addStock, setAddStock] = useState(false);
  const [loc, setLoc] = useState("");
  const printer = useLabelPrint(cfg, setCfg);
  const showStart = (result: PrintStartResult) => { setPrintError(!result.started && !result.cancelled ? result.message : ""); return result; };
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
    if (queueLock.current || printer.busy) return;
    if (!form.item && !form.style) { toast("Fill ITEM or STYLE first", true); return; }
    if (addStock && !loc) return toast("Choose the rack the new stock goes to", true);
    const n = Number(copies), packet = Number(qty);
    if (!Number.isSafeInteger(n) || n < 1 || n > 5000 || !Number.isSafeInteger(packet) || packet < 1 || packet > 1000000) return toast("Check packet quantity and print quantity (1–5000)", true);
    if (jobs.reduce((sum, j) => sum + j.copies, 0) + n > 5000) return toast("Print this queue before adding more than 5000 labels", true);
    queueLock.current = true; setQueueBusy(true);
    try {
    const legacyCode = form.item_code || await itemCodeFor(form.item);
    if (print) validateLabelPrint(cfg, [...jobs, { p: { ...form, item_code: legacyCode || undefined, item: form.item || "Pending" }, qtyOnLabel: packet, copies: n }]);
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
    const saved = await saveProduct({ ...p, rate: evenRate(p.rate) });   // same even rate as the label it prints
    if (!saved.item.trim()) throw new Error("Enter the product name before printing labels");
    if (addStock) {
      if (!loc) { toast("Choose the rack the new stock goes to", true); return; }
      await recordMovement({ product_id: saved.id, kind: "intake", qty: n * Math.max(1, parseInt(qty) || 1), from_loc: null, to_loc: loc, person_type: "employee", person_name: me?.name || "", by_staff: me?.id || "", note: "labelled at print" });
    }
    return saved;
    });
    if (!saved) return;
    const job = { p: saved, qtyOnLabel: Math.max(1, parseInt(qty) || 1), copies: n, line: jobs.length + 1 };
    setJobs(j => [...j, job]);
    if (print) showStart(printer.start(expandJobs([...jobs, job])));
    toast(`${n} labels queued · ${label(saved)}`);
    setForm(blankProduct(me?.id || "")); setQty("1"); setCost("");
    } catch (e: any) { setPrintError(e.message || "Could not prepare labels"); toast(e.message || "Could not prepare labels", true); }
    finally { queueLock.current = false; setQueueBusy(false); }
  };

  useEffect(() => { setQueueSelection(new Set()); }, [jobs]);
  const removeJobs = async (indices: number[]) => {
    const snapshot = jobs, wanted = new Set(indices);
    if (await confirmDelete("Remove " + indices.length + " item(s) from the print queue?")) setJobs(latest => latest === snapshot ? latest.filter((_, index) => !wanted.has(index)) : latest);
  };
  const flat = useMemo(() => expandJobs(jobs), [jobs]);
  const total = flat.length;

  const doPrint = () => { showStart(printer.start(flat)); };

  /* Direct-to-TSC: TSPL straight to the printer, in the same stoppable batches. */
  const doPrintTSC = (prompt = true) => {
    showStart(printer.start(flat, true, prompt));
  };

  return (
    <div className="label-counter">
      <Head eyebrow="Barcode print" title="QR labels" sub="Same fields as the old BARCODE PRINT screen. Every label carries its own details inside the QR, so it scans even on a phone with no internet.">
        {cfg.output !== "qz" && cfg.mode === "roll" && cfg.cols === 1 && directPrintSupported() && <button className="btn dk" disabled={!total || printer.busy} onClick={() => doPrintTSC()} title="Send straight to a compatible TSC label printer">{`Print to TSC ${total || ""}`}</button>}
        <button className="btn g" disabled={!total || printer.busy} onClick={doPrint}>Print {total || ""} labels</button>
      </Head>
      {printError && <div className="note warn" role="alert">{printError}</div>}
      <div className="label-dock card" aria-label="Pinned sticker preview">
        <div className="labelprev"><LabelView cfg={cfg} p={oldCopy?.p || jobs[0]?.p || form} qtyOnLabel={oldCopy?.qtyOnLabel || jobs[0]?.qtyOnLabel || parseInt(qty) || 1} line={oldCopy ? undefined : jobs[0]?.line} sourceQr={oldCopy?.sourceQr || jobs[0]?.sourceQr} /></div>
        <div className="grow stack" style={{ gap: 3 }}><b>{oldCopy?.p.item || jobs[0]?.p.item || form.item || "Sticker preview"}</b><span className="sm">{oldCopy?.p.type || jobs[0]?.p.type || form.type} · {cfg.w} × {cfg.h} mm · all text bold</span><span className="xs">QR: {oldCopy || cfg.format === "shop" ? "Old software format" : "Rungnna only"}</span>{oldCopy && <span className="xs">Exact old QR copy — original price, packet and reference</span>}</div>
        <button className="btn" aria-pressed={settingsOpen} onClick={() => setSettingsOpen(open => !open)}>{settingsOpen ? "Back to label workspace" : "Printer settings"}</button>
      </div>
      {settingsOpen ? <LabelSettings cfg={cfg} upd={upd} onTest={cfg.output === "qz" ? undefined : () => { if (!printer.busy) setAligning(true); }} sample={jobs[0]?.p || form} qty={jobs[0]?.qtyOnLabel || parseInt(qty) || 1} /> : <>
      {cfg.format === "rungnna" && !oldCopy && <div className="note warn row" role="status"><span className="grow sm"><b>These new QR codes are for Rungnna billing only.</b> For billing in the older software, use its QR format with the original item code and reference, or scan a working old sticker for an exact copy.</span><button className="btn" onClick={() => upd({ format: "shop" })}>Use old-software QR format</button></div>}
      <div className="label-purchase">
          {can(me, "purchases.photo") ? <details className="card purchase-import" open={args[0] === "bill"}>
            <summary className="pad b">From a purchase bill — upload the photo, get the labels</summary>
            <div style={{ borderTop: "1px solid var(--line-2)" }} className="pad">
              <Suspense fallback={<div role="status">Loading bill reader…</div>}><PurchasePhoto by={me?.id || ""} /></Suspense>
            </div>
          </details>
          /* shown even when not allowed, so the owner can see it exists and how to reach it */
          : <div className="card pad row"><span className="grow sm"><b>From a purchase bill</b> — needs “Read purchase bill photos”, which {roleName(me) || "this person"} does not have.</span>
              <button className="btn sm" onClick={() => setMe(null)}>Switch person</button></div>}
      </div>
      <div className="label-workspace">
        <div className="stack">
          <div className="card">
            <header><h3>Barcode print</h3><span className="xs mut">scan an existing label to copy its details</span></header>
            <div className="pad stack">
              <WedgeInput autoFocus={false} placeholder="Scan an old label to pre-fill (optional)" onCode={async raw => {
                const parsed = parseLabel(raw);
                try {
                  const found = await findByScan(raw) || (parsed.how === "shop label" || parsed.how === "rungnna" ? await fillFromItemCode(fromParsed(parsed, me?.id || "")) : undefined);
                  const copy = found && parsed.how === "shop label" ? legacyLabelCopy(raw, found) : null;
                  const p = copy?.p || found; setOldCopy(copy);
                  if (p) { setForm({ ...p }); setQty(String(p.pack || 1)); if (copy) upd({ format: "shop" }); toast("Loaded " + label(p) + (p.item ? "" : " — enter the product name")); } else toast("Not in the system yet — fill it below", true);
                } catch (error: any) { setOldCopy(null); toast(error.message, true); }
              }} />
              {oldCopy && <div className="note stack" role="status"><b>Copy a working old sticker</b><span className="sm">This copy keeps the original QR exactly, including its old reference and price. Edits in the item form below apply only to newly generated labels.</span><code style={{ overflowWrap: "anywhere" }}>{oldCopy.sourceQr}</code><div className="row"><button className="btn p" disabled={printer.busy} onClick={() => { const n = Number(copies); if (!Number.isSafeInteger(n) || n < 1 || n > 5000) return toast("Check print quantity (1–5000)", true); showStart(printer.start(expandJobs([{ ...oldCopy, p: { ...oldCopy.p, item: oldCopy.p.item || form.item }, copies: n }]))); }}>Print exact old QR copy</button><button className="btn" onClick={() => setOldCopy(null)}>Use edited item instead</button></div></div>}
              <div className="grid g2">
                <label className="f">ITEM
                  <input className="in" list="litems" value={form.item} onChange={e => set("item", e.target.value.toUpperCase())} autoFocus />
                  <datalist id="litems">{[...new Set([...items, ...DEFAULT_ITEMS])].map(i => <option key={i} value={i} />)}</datalist></label>
                <label className="f">TYPE
                  <select className="in" value={form.type} onChange={e => set("type", e.target.value)}>{DEFAULT_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
                <label className="f">STYLE<input className="in mono" value={form.style} onChange={e => set("style", e.target.value.toUpperCase())} placeholder="K5209/59SH" /></label>
                <label className="f">COLOR<input className="in mono" value={form.color} onChange={e => set("color", e.target.value.toUpperCase())} placeholder="K/GBN" /></label>
                <label className="f">TK<input className="in mono" value={form.tk} onChange={e => set("tk", e.target.value.toUpperCase())} /></label>
                <details className="label-advanced" open={cfg.format === "shop"}><summary>More details</summary><div className="grid g2">
                <label className="f">MODEL / ARTICLE No.<input className="in mono" value={form.model || ""} onChange={e => set("model", e.target.value.toUpperCase() || undefined)} placeholder="vendor's article no" /></label>
                <SupplierNo suppliers={vendors} id={form.vendor_id} label="VENDOR roll no." onPick={v => { set("vendor_id", v?.id); set("vendor_name", v?.name); }} />
                <label className="f">ITEM CODE (old software)<input className="in mono" inputMode="numeric" value={form.item_code || ""} placeholder="Copy the old system’s numeric code" onChange={e => set("item_code", e.target.value.replace(/\D/g, "") || undefined)} /></label>
                <label className="f">REF / roll reference (old software)<input className="in mono" value={form.ref || ""} onChange={e => set("ref", e.target.value || undefined)} placeholder="Copy the working label’s reference" /></label>
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
              {addStock && <RackPicker value={loc} onChange={setLoc} label="Into rack" />}
              <div className="row"><button className="btn p" disabled={queueBusy} onClick={() => addJob(true)}>Print barcode</button><button className="btn" disabled={queueBusy} onClick={() => addJob()}>Add to queue</button></div>
            </div>
          </div>
          {jobs.length > 0 && (
            <div className="card">
              <header><h3>Print queue</h3><span className="pill">{total} labels</span><DeleteButton className="btn sm" style={{ marginLeft: "auto" }} disabled={printer.busy} onDelete={() => removeJobs(jobs.map((_, i) => i))}>Clear</DeleteButton></header>
              <div className="pad stack" style={{ gap: 6 }}><div className="selection-bar"><SelectAll ids={jobs.map((_, i) => String(i))} selected={queueSelection} onChange={setQueueSelection} label="Select all queued items" /><DeleteButton className="btn sm bad" disabled={printer.busy || !queueSelection.size} onDelete={() => removeJobs(jobs.map((_, i) => i).filter(i => queueSelection.has(String(i))))}>Delete selected</DeleteButton></div>
                {jobs.map((j, i) => (
                  <div key={i} className="row sm"><input type="checkbox" aria-label={"Select queued item " + (i + 1)} checked={queueSelection.has(String(i))} onChange={event => setQueueSelection(old => { const next = new Set(old); event.target.checked ? next.add(String(i)) : next.delete(String(i)); return next; })} />
                    <span className="grow">{label(j.p)} <span className="mono xs mut">{j.p.code}</span></span>
                    <input className="in mono" style={{ width: 80, minHeight: 34 }} value={j.copies} inputMode="numeric"
                      onChange={e => setJobs(js => js.map((x, k) => k === i ? { ...x, copies: parseInt(e.target.value) || 0 } : x))} />
                    <DeleteButton className="btn sm bad" aria-label="Remove queued item" disabled={printer.busy} onDelete={() => removeJobs([i])}>✕</DeleteButton>
                  </div>))}
              </div>
            </div>
          )}
        </div>

      </div>
      </>}
      {printer.panel}
      {aligning && createPortal(<AlignSheet cfg={cfg} />, document.getElementById("printroot")!)}
    </div>
  );
}

export function LabelView({ cfg, p, qtyOnLabel = 1, line, labelIndex = 0, bag, sourceQr }: { cfg: LabelCfg; p: Product; qtyOnLabel?: number; line?: number; labelIndex?: number; bag?: BagLabel; sourceQr?: string }) {
  let artwork: string;
  try { artwork = renderLabelSvg(bag ? bagLabelCfg(cfg) : cfg, p, qtyOnLabel, line, labelIndex, bag ? bagPayload(bag) : sourceQr); }
  catch (e: any) { return <div className="sm mut" role="status">{e.message || "Review the sticker settings"}</div>; }
  return <div className="lbl" style={{ width: cfg.w + "mm", height: cfg.h + "mm", padding: 0, display: "block", overflow: "hidden" }} dangerouslySetInnerHTML={{ __html: artwork }} />;
}

function LabelSettings({ cfg, upd, sample, qty, onTest }: { cfg: LabelCfg; upd: (p: Partial<LabelCfg>) => void; sample: Product; qty: number; onTest?: () => void }) {
  const [printers, setPrinters] = useState<string[]>([]), [finding, setFinding] = useState(false), [printerError, setPrinterError] = useState("");
  const findPrinters = async () => {
    if (finding) return;
    setFinding(true); setPrinterError("");
    try { const names = await listQzPrinters(); setPrinters(names); if (!names.length) setPrinterError("No Windows printers were found. Install the TSC printer in Windows first."); }
    catch (e: any) { setPrinterError(e.message || "Could not read Windows printers"); }
    finally { setFinding(false); }
  };
  const num = (k: keyof LabelCfg, lab: string, step = 0.5) => (
    <label className="f">{lab}
      <input className="in mono" type="number" step={step} value={cfg[k] as number} onChange={e => upd({ [k]: Number(e.target.value) } as any)} /></label>);
  const demo: Product = sample.item || sample.style ? sample : { ...sample, item: "F-RING", type: "PCS", style: "K5208/K-LT", color: "W/LP/B", rate: 2400, item_code: "202", pack: 12, ref: "183" };
  return (
    <div className="card label-settings">
      <header><h3>Label size &amp; layout</h3><span className="xs mut">saved on this device</span></header>
      <div className="pad stack">
        <label className="f">Print labels using<select className="in" value={cfg.output || "browser"} onChange={e => upd({ output: e.target.value as LabelCfg["output"], ...(e.target.value === "qz" && cfg.gapY === 0 ? { gapY: 2.6 } : {}) })}><option value="browser">Browser / Windows printer driver</option><option value="qz">QZ Tray → Windows TSC printer</option><option value="tspl" disabled={!directPrintSupported()}>Direct TSC USB / serial (203 dpi only)</option></select></label>
        {cfg.output === "qz" && <div className="stack">
          <div className="sm">Install and open <a href="https://qz.io/download/" target="_blank" rel="noreferrer">QZ Tray</a> on the printer computer. Allow its connection and print requests.</div>
          <button className="btn" disabled={finding} onClick={() => void findPrinters()}>{finding ? "Finding…" : "Find Windows printers"}</button>
          <label className="f">TSC printer<select className="in" value={cfg.qzPrinter || ""} onChange={e => upd({ qzPrinter: e.target.value })}>
            <option value="">Choose the label printer</option>
            {[...new Set([...(cfg.qzPrinter ? [cfg.qzPrinter] : []), ...printers])].map(name => <option key={name} value={name}>{name}</option>)}
          </select></label>
          {printerError && <div className="sm" role="alert">{printerError}</div>}
          <div className="xs mut">TSPL / TSPL2 printers at 203 dpi. Rows go directly with their size and gap; Chrome’s paper size is bypassed. Measure the row gap (2.6 mm is a starting value) and accept one check row before the rest.</div>
        </div>}
        {cfg.output === "tspl" && serialSupported() && <button className="btn" onClick={() => connectSerial().then(() => toast("Serial printer connected")).catch(e => toast(e.message, true))}>Connect serial printer</button>}
        {cfg.output === "tspl" && usbSupported() && <button className="btn" onClick={() => connectUSB().then(() => toast("USB printer connected")).catch(e => toast(e.message, true))}>Connect TSC USB printer</button>}
        <div className="grid g2">
          <label className="f">Print darkness (0–15)<input className="in mono" type="number" min={0} max={15} step={1} disabled={!cfg.output || cfg.output === "browser"} value={cfg.density ?? DEFAULT_LABEL_DENSITY} onChange={e => upd({ density: Number(e.target.value) })} /></label>
          <label className="f">Print speed (1–6)<input className="in mono" type="number" min={1} max={6} step={1} disabled={!cfg.output || cfg.output === "browser"} value={cfg.speed ?? DEFAULT_LABEL_SPEED} onChange={e => upd({ speed: Number(e.target.value) })} /></label>
        </div>
        {(!cfg.output || cfg.output === "browser") ? <div className="note warn" role="status"><b>Browser darkness is set in Windows.</b><div className="sm">On the printer computer open Windows Settings → Printers &amp; scanners → your label printer → Printing preferences. Set Darkness / Density to 10 and Speed to 2, then print one check row. If it is still pale, increase darkness a step and check the QR. These app controls are enabled with QZ Tray or Direct TSC, which send heat settings to the printer.</div></div> : <div className="xs mut">These darkness and speed values are sent to the TSC printer with every job. Print one check row after a change; too much heat can blur the QR.</div>}
        <label className="row sm"><input type="checkbox" checked={!!cfg.compactCostCode} onChange={e => upd({ compactCostCode: e.target.checked })} /> Compact repeated letters in cost code</label>
        <label className="f">Fake letter pool<input className="in mono" value={cfg.fakeLetters ?? "Z"} onChange={e => upd({ fakeLetters: e.target.value.toUpperCase().replace(/[^A-Z]/g, "") })} placeholder="e.g. ZYAB" /></label>
        <div className="xs mut">Enter any letters A–Z, with no length limit. One fake letter is shuffled across stickers; repeated letters in the pool count once. Leave empty for no fake letter. Repeated code letters become dashes; price, quantity, reference and QR data stay the same.</div>
        <div className="sm mono" aria-label="Cost code examples">{[0, 1, 2].map(i => printedCostCode("RPPX1PCS", cfg, i)).join(" · ")}</div>
        <label className="f">Sticker
          <select className="in" value={cfg.preset} onChange={e => { const p = PRESETS.find(x => x.key === e.target.value);
            // a preset is a whole sticker: settings only one preset uses (printer's own paper, right edge, rate size) go back to plain
            upd({ preset: e.target.value, ...(p ? { driverPaper: undefined, edgeR: undefined, rateScale: undefined, offX: 0, offY: 0, left: 0, top: 0 } : {}), ...(p?.cfg || {}) }); }}>
            {PRESETS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            <option value="custom">Custom size</option>
          </select></label>
        <div className="grid g3">
          {num("w", "Width mm")}{num("h", "Height mm")}{num("qr", "QR size mm")}
          {num("font", "Text size pt")}{num("offX", "Nudge right mm", 0.25)}{num("offY", "Nudge down mm", 0.25)}
          {cfg.mode === "roll" ? <>{num("cols", "Stickers across", 1)}{num("gapX", "Gap across mm")}{num("gapY", "Gap between rows mm")}</>
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
              <option value="shop">Old software format — matching item code required</option>
              <option value="rungnna">Rungnna only — includes product name</option>
            </select></label>
          <div className="xs mut">Old-software labels need the item code from that software, not a new code invented here. Copy a working old label to retain its reference. Rungnna-only labels work in this app even with zero stock.</div>
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
      <div className="labelprev"><LabelView cfg={cfg} p={demo} qtyOnLabel={qty} line={5} /></div>
      <PrinterSetup cfg={cfg} onTest={onTest} />
    </div>
  );
}

/* TSPL for a run of stickers (the direct-to-TSC path). Identical neighbours go as one PRINT n. */
export function tscCommands(cfg: LabelCfg, list: Job[]) {
  if (cfg.mode !== "roll" || cfg.cols !== 1) throw new Error(`USB / serial TSC printing supports one sticker across. This setup is ${cfg.cols} across: choose "QZ Tray → Windows TSC printer" for direct roll printing or "Browser / Windows printer driver" in Printer settings.`);
  const runs = cfg.compactCostCode && fakeLetterPool(cfg.fakeLetters).length > 1
    ? list.map((j, index) => ({ item: { ...j, labelIndex: j.labelIndex ?? index }, n: 1 })) : runsOf(list);
  return runs.map(({ item: j, n }) => {
    const product = j.sourceQr ? { ...j.p, pack: j.qtyOnLabel } : productForLabel(j.p, j.qtyOnLabel);
    return labelTSPL({ ...(j.bag ? bagLabelCfg(cfg) : cfg), labelIndex: j.labelIndex }, product, j.qtyOnLabel, n, j.bag ? bagPayload(j.bag) : validateLegacyCopy(j) || ownPayload(product, cfg.format || "shop"));
  }).join("");
}

type Run = {
  list: Job[]; batches: LabelBatch[]; i: number; phase: "print" | "wait"; direct: boolean;
  prompt: boolean; n: number; verify?: boolean; cfg: LabelCfg; error?: string;
};

/* A printer or geometry change requires one fresh, accepted check row. */
export const printerSig = (c: LabelCfg) => [c.output || "browser", c.qzPrinter || "", c.preset, c.mode, c.w, c.h, c.cols, c.gapX, c.gapY, c.offX, c.offY, c.driverPaper ? 1 : 0, c.edgeR ?? "", c.sheetW, c.sheetH, c.rows, c.left, c.top, c.qr, c.font, c.pad, c.rateScale ?? "", c.layout, c.format, c.density ?? DEFAULT_LABEL_DENSITY, c.speed ?? DEFAULT_LABEL_SPEED, c.compactCostCode ? 1 : 0, c.fakeLetters ?? "Z"].join("|");

export function runBatches(total: number, unit: number, perBatch: number, testFirst: boolean, verified: boolean): LabelBatch[] {
  if (verified || total <= unit) return labelBatches(total, unit, perBatch, testFirst);
  return [{ from: 0, to: unit }, ...labelBatches(total - unit, unit, perBatch, false).map(b => ({ from: b.from + unit, to: b.to + unit }))];
}

/* Shared by the bill reader and Labels. Each run owns its settings and queue, so
   edits cannot alter a job already approved. QZ sends one spool job per batch. */
export function useLabelPrint(cfg: LabelCfg, onConfig?: (config: LabelCfg) => void) {
  const [run, setRunState] = useState<Run | null>(null);
  const ref = useRef<Run | null>(null), failed = useRef(false);
  const [okSig, setOkSig] = useState<string | null>(null), [problem, setProblem] = useState("");
  useEffect(() => { getSetting<string>("label_printer_ok", "").then(setOkSig).catch(() => setOkSig("")); }, []);
  const markOk = (config: LabelCfg) => { const s = printerSig(config); setOkSig(s); void setSetting("label_printer_ok", s); };
  const setRun = (r: Run | null) => { ref.current = r; setRunState(r); };
  const slice = (r: Run) => r.list.slice(r.batches[r.i].from, r.batches[r.i].to);
  const finished = (r: Run) => {
    if (ref.current !== r) return;
    if (r.verify && r.i === 0 || r.i + 1 < r.batches.length) return setRun({ ...r, phase: "wait" });
    setRun(null);
    toast(`All ${r.list.length} sticker${r.list.length === 1 ? "" : "s"} sent to the printer`);
  };
  const go = async (r: Run) => {
    const sending = { ...r, phase: "print" as const, error: undefined };
    setRun(sending);
    if (!sending.direct) return;
    try {
      if (sending.cfg.output === "qz") {
        const bytes = await buildLabelBitmapJob(sending.cfg, slice(sending));
        if (ref.current !== sending) return;
        await printQzTSPL(sending.cfg.qzPrinter || "", bytes);
      } else await printTSPL(tscCommands(sending.cfg, slice(sending)), sending.prompt);
      finished(sending);
    } catch (e: any) {
      if (ref.current !== sending) return;
      const message = (e?.message || "Direct print failed") + " · Check the printer and Windows queue before trying again; part of the job may have printed.";
      toast(message, true); setRun({ ...sending, phase: "wait", error: message });
    }
  };
  const printing = !!run && run.phase === "print" && !run.direct;
  usePrintJob(printing, () => {
    const r = ref.current; if (!r) return;
    if (failed.current) { failed.current = false; setRun({ ...r, phase: "wait", error: "The browser did not complete print preparation. Check what printed before trying again." }); }
    else finished(r);
  }, run ? `${run.i}.${run.n}` : "", m => { failed.current = true; toast(m, true); });

  const start = (list: Job[], direct = false, prompt = true, configOverride?: LabelCfg): PrintStartResult => {
    const rejectStart = (message: string, cancelled = false): PrintStartResult => {
      if (!cancelled) toast(message, true);
      return { started: false, message, ...(cancelled ? { cancelled: true } : {}) };
    };
    if (ref.current) return rejectStart("Finish or stop the print already running first");
    // start receives an expanded queue: every entry represents ONE sticker,
    // even when it originated in a purchase job with copies greater than one.
    const queue = list.map((j, index) => ({ ...j, p: { ...j.p }, copies: 1, labelIndex: j.labelIndex ?? index }));
    const selected = configOverride || cfg;
    const config: LabelCfg = { ...selected, output: selected.output === "qz" ? "qz" : direct ? "tspl" : selected.output || "browser", show: { ...selected.show } };
    const verified = okSig === printerSig(config);
    const raw = config.output === "qz" || config.output === "tspl" || direct;
    try {
      validateLabelPrint(config, queue);
      if (config.output === "qz") {
        if (!config.qzPrinter?.trim()) throw new Error("Choose the TSC label printer in Printer settings first.");
        validateLabelBitmapJob(config, queue);
      } else if (raw) tscCommands(config, queue.slice(0, 1));
    } catch (e: any) { return rejectStart(e.message || "Review printer settings and sticker quantities"); }
    const unit = config.mode === "roll" ? config.cols : config.cols * config.rows;
    const blank = config.mode === "sheet" && queue.length % unit ? unit - queue.length % unit : 0;
    if (blank && !confirm(`The printer feeds a whole page of ${unit} stickers at a time.\n\n${queue.length} labels leave ${blank} stickers blank on the last page.\n\nPrint anyway?`)) return rejectStart("Printing was cancelled. The labels remain ready to print.", true);
    if (!verified && config.mode === "roll" && config.driverPaper && !raw && !confirm(`First label print on this computer with these settings.\n\nOnly ONE row (${Math.min(unit, queue.length)} stickers) will print. Check it before accepting the rest.\n\nIn Chrome choose Paper size "Rungnna row", Margins "None", Scale "Default", Headers and footers off.`)) return rejectStart("Printing was cancelled. The labels remain ready to print.", true);
    const batches = runBatches(queue.length, unit, config.batch ?? DEFAULT_BATCH, config.testFirst ?? true, verified);
    setProblem("");
    if (!batches.length) return rejectStart("There are no labels to print.");
    void go({ list: queue, batches, i: 0, phase: "print", direct: raw, prompt, n: 0, verify: !verified, cfg: config });
    return { started: true };
  };
  const stop = () => {
    const r = ref.current; if (!r) return;
    const sent = r.phase === "wait" ? r.batches[r.i].to : r.batches[r.i].from;
    setRun(null); setProblem("");
    toast(`Stopped. ${sent} of ${r.list.length} stickers were sent; the rest will not print.`);
  };
  const nudge = (r: Run, axis: "offX" | "offY", amount: number) => {
    if (r.phase !== "wait") return;
    const config = { ...r.cfg, [axis]: Math.round((r.cfg[axis] + amount) * 100) / 100 };
    try { validateLabelPrint(config, slice(r)); if (config.output === "qz") validateLabelBitmapJob(config, slice(r)); }
    catch (e: any) { toast(e.message, true); return; }
    void setSetting("label_cfg", config); onConfig?.(config);
    void go({ ...r, cfg: config, n: r.n + 1, verify: true });
  };

  const r = run, b = r?.batches[r.i];
  const nextB = r && r.batches[r.i + 1];
  const panel = r && b ? <>
    {printing && createPortal(<PrintSheet cfg={r.cfg} jobs={slice(r)} />, document.getElementById("printroot")!)}
    <div className="print-notice batch-panel" role="status">
      {r.phase === "print" ? <>
        <div><b>{r.batches.length > 1 ? `Batch ${r.i + 1} of ${r.batches.length}` : "Printing"}</b> · stickers {b.from + 1}–{b.to} of {r.list.length}{r.direct ? " · sending…" : ""}</div>
        <button className="btn" onClick={stop}>{r.direct ? "Stop after this" : "Close print"}</button>
      </> : <>
        {r.error && <div className="note warn" role="alert">{r.error}</div>}
        {r.verify && r.i === 0 ? <>
          <div><b>Check the {b.to - b.from} sticker{b.to - b.from === 1 ? "" : "s"} that just printed.</b> Accept only if they physically printed on one row, nothing is cut off, and no blank rows fed out. A cancelled print dialog does not count.</div>
          <div className="row">
            <button className="btn p" disabled={!!r.error} onClick={() => { markOk(r.cfg); setProblem(""); if (nextB) void go({ ...r, i: 1, phase: "print", n: r.n + 1, verify: false }); else { setRun(null); toast("This computer is set: labels will now print straight away"); } }}>{nextB ? `Yes, right: print the other ${r.list.length - b.to}` : "Yes, it came out right"}</button>
            <button className="btn" onClick={() => void go({ ...r, n: r.n + 1 })}>Print this row again</button>
            <button className="btn bad" onClick={() => setProblem(problem ? "" : "choose")}>No, it’s wrong</button>
            <button className="btn" onClick={stop}>Stop</button>
          </div>
          {!!problem && <div className="stack">
            <label className="f">What came out wrong?<select className="in" value={problem} onChange={e => setProblem(e.target.value)}>
              <option value="choose">Choose what you see</option><option value="gap">Blank rows, or print across the gap</option><option value="position">Too high / low or left / right</option><option value="tiny">Print is tiny</option><option value="headers">Date or website link on stickers</option>
            </select></label>
            {problem === "gap" && <div className="sm">{r.cfg.output === "qz" ? `Check the measured sticker height (${r.cfg.h} mm) and gap (${r.cfg.gapY} mm) in Printer settings. Load the roll straight and calibrate the TSC gap sensor. Chrome’s paper size is bypassed.` : `Windows → TSC → Printing preferences → Page Setup → Stock → New: “Rungnna row”, ${r.cfg.edgeR ?? (r.cfg.cols * r.cfg.w + (r.cfg.cols - 1) * r.cfg.gapX)} × ${r.cfg.h} mm, Labels With Gaps, measured gap (start with 2.6 mm). In Chrome select that stock, Margins None, Scale Default. A 4 × 6 inch page can feed blank rows. Applications that send their own size can continue doing so; verify the old software after changing shared preferences.`}</div>}
            {problem === "position" && <div className="stack sm">Move the print and reprint only this check row. Measurements stay saved on this computer.
              {(["offX", "offY"] as const).map(axis => <div className="row" key={axis}><b>{axis === "offX" ? "Right" : "Down"} {r.cfg[axis]} mm</b>{[-1, -0.5, 0.5, 1].map(amount => <button className="btn sm" key={amount} onClick={() => nudge(r, axis, amount)}>{amount > 0 ? "+" : ""}{amount} mm</button>)}</div>)}
            </div>}
            {problem === "tiny" && <div className="sm">{r.cfg.output === "qz" ? "QZ output uses the configured size at 203 dpi. Check the printer resolution and sticker measurements." : "In Chrome’s print window set Scale to Default / 100%, Margins None and the correct one-row stock. Turn off Fit to page."}</div>}
            {problem === "headers" && <div className="sm">Untick Headers and footers in Chrome’s More settings, then print this row again. QZ output sends only the sticker artwork.</div>}
          </div>}
        </> : <>
          <div><b>{b.to} of {r.list.length} sent.</b> Check them before going on.</div>
          <div className="row">
            {nextB && <button className="btn p" disabled={!!r.error} onClick={() => void go({ ...r, i: r.i + 1, phase: "print", n: r.n + 1 })}>Print next {nextB.to - nextB.from} ({nextB.from + 1}–{nextB.to})</button>}
            <button className="btn" onClick={() => void go({ ...r, n: r.n + 1 })}>Print these {b.to - b.from} again</button>
            <button className="btn bad" onClick={stop}>Stop: don’t print the rest</button>
          </div>
        </>}
      </>}
      <div className="xs mut">Wrong print already coming out? Switch the printer off, cancel its Windows print queue, then switch it back on. Check the queue before retrying an unconfirmed job to avoid duplicate stickers.</div>
    </div>
  </> : null;
  return { start, stop, busy: !!run, panel };
}

/* What this computer must be told once, so the sticker on screen is the sticker on the roll. */
export function PrinterSetup({ cfg, onTest }: { cfg: LabelCfg; onTest?: () => void }) {
  const pageW = cfg.mode === "roll" ? cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX : cfg.sheetW;
  const pageH = cfg.mode === "roll" ? cfg.h : cfg.sheetH;
  if (cfg.output === "qz") return <details className="pad sm"><summary><b>Set up QZ Tray on this computer</b></summary>
    <ol className="stack" style={{ paddingLeft: 18, margin: "8px 0" }}>
      <li>Install and open <a href="https://qz.io/download/" target="_blank" rel="noreferrer">QZ Tray</a>, then use <b>Find Windows printers</b> and choose the TSC printer. Allow the connection and print requests.</li>
      <li>Use a TSPL / TSPL2 printer at 203 dpi. Measure each sticker, the gap across, and the gap between rows. The current row is <b>{cfg.driverPaper && cfg.edgeR ? cfg.edgeR : pageW} × {cfg.h} mm</b>, with a <b>{cfg.gapY} mm</b> gap between rows.</li>
      <li>The first run with a new setup sends only one check row. Accept it only after it physically prints correctly; those stickers count toward the total. Use <b>No, it’s wrong</b> for alignment adjustments and the matching fix.</li>
      <li>Chrome’s print dialog is bypassed. After any error, inspect the printer and Windows queue before trying again so an already submitted job is not printed twice.</li>
    </ol>
  </details>;
  // the page his TSC driver is already set to: nothing to change on that computer
  const asSet = cfg.mode === "sheet" && Math.abs(cfg.sheetW - 101.6) < 0.05 && Math.abs(cfg.sheetH - 152.4) < 0.05;
  const row = cfg.mode === "roll" && !!cfg.driverPaper;
  const paper = asSet ? "USER (101.6 mm × 152.4 mm)" : row ? "Rungnna row" : `Rungnna ${pageW}×${pageH}`;
  const per = cfg.mode === "roll" ? cfg.cols : cfg.cols * cfg.rows;
  return (
    <details className="pad sm">
      <summary><b>Set up this computer once</b> (date, link or wrong size on stickers?)</summary>
      <ol className="stack" style={{ paddingLeft: 18, margin: "8px 0" }}>
        {row ? <li>Once, in Windows: <b>Settings › Printers &amp; scanners › TSC › Printing preferences</b> › Page Setup › Stock › <b>New…</b>: name <b>Rungnna row</b>, width <b>{cfg.edgeR ?? 104} mm</b>, height <b>{cfg.h} mm</b>. Stock tab: <b>Labels With Gaps</b>. OK. (Leave USER 4 × 6 as it is for anything else.) This is one row of {cfg.cols} stickers: the printer finds the gap before every row, exactly as with the old software.</li>
        : asSet
          ? <li>The TSC driver stays exactly as it is: <b>USER (101.6 mm × 152.4 mm)</b>, the page the shop already uses. Nothing to change in Windows.</li>
          : <li>Windows: <b>Settings › Printers &amp; scanners › TSC › Printing preferences</b> › Page Setup › Stock › <b>New</b>: name it “{paper}”, width <b>{pageW} mm</b>, height <b>{pageH} mm</b>, portrait. Stock tab: <b>Labels with gaps</b>. Apply.</li>}
        <li>Print once from here. In Chrome's print window open <b>More settings</b>: Paper size <b>{paper}</b>, Margins <b>None</b>, Scale <b>Default/100</b>, and <b>untick “Headers and footers”</b> (that is what prints the date and the link). Chrome remembers these.</li>
        {asSet && <li><b>Plain white stickers, or tiny print?</b> Chrome's Paper size must be <b>USER (101.6 mm × 152.4 mm)</b> and Scale <b>Default</b>. If a “Rungnna 103×15” paper size was made earlier, don't pick it: the page gets shrunk onto one row.</li>}
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
  const W = cfg.mode === "sheet" ? cfg.sheetW : cfg.driverPaper && cfg.edgeR ? cfg.edgeR : cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
  const H = cfg.mode === "sheet" ? cfg.sheetH : cfg.driverPaper ? cfg.h - 0.6 : cfg.h;   // same as a printed row
  const rows = cfg.mode === "sheet" ? cfg.rows : 1;
  const boxes = Array.from({ length: rows * cfg.cols }, (_, k) => {
    const c = k % cfg.cols, r = Math.floor(k / cfg.cols);
    const x = cfg.offX + c * (cfg.w + cfg.gapX);
    return cfg.mode === "sheet" ? { ...cellBox(cfg, c, r), c, r } : { x, y: cfg.offY, w: Math.min(cfg.w, W - x), c, r };
  });
  const ticks = (n: number) => Array.from({ length: Math.floor(n) + 1 }, (_, i) => i);
  const across = (y: number) => <g key={"a" + y}>{ticks(W).map(i => <line key={i} x1={i} x2={i} y1={y} y2={y + (i % 10 ? i % 5 ? 0.8 : 1.4 : 2.2)} stroke="#000" strokeWidth={0.15} />)}
    {ticks(W).filter(i => i % 10 === 0).map(i => <text key={"t" + i} x={i + 0.3} y={y + 4.2} fontSize={2.4} fontWeight={700}>{i}</text>)}</g>;
  // the up-and-down ruler runs in the gap after the first column, so it never covers a box's label
  const midX = cfg.mode === "sheet" && cfg.cols > 1 ? cellBox(cfg, 0, 0).x + cfg.w + cfg.gapX / 2 : W / 2;
  return (<>
    <style>{cfg.mode === "roll" && cfg.driverPaper ? "@page{margin:0}" : `@page{size:${W}mm ${H}mm;margin:0}`}</style>
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
    const pageW = cfg.driverPaper && cfg.edgeR ? cfg.edgeR : cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
    const rows: Job[][] = []; for (let i = 0; i < jobs.length; i += cfg.cols) rows.push(jobs.slice(i, i + cfg.cols));
    return (<>
      {/* driverPaper: no page size from here. Chrome then uses the printer's own one-row stock as it is, so it never
          turns a wide, short page sideways (the rotated stickers of 15 Oct) or shrinks a bigger one onto it. */}
      <style>{cfg.driverPaper ? "@page{margin:0}" : `@page{size:${pageW}mm ${cfg.h}mm;margin:0}`}</style>
      {rows.map((r, i) => (
        // on the printer's own paper a row is drawn a hair shorter than the sticker: if it were even 0.1 mm taller
        // than what the driver can print, every row would spill onto a second, blank sticker row
        <div key={i} style={{ position: "relative", width: pageW + "mm", height: (cfg.driverPaper ? cfg.h - 0.6 : cfg.h) + "mm", overflow: "hidden", pageBreakAfter: i === rows.length - 1 ? "auto" : "always", breakAfter: i === rows.length - 1 ? "auto" : "page" }}>
          {r.map((j, k) => {
            const x = cfg.offX + k * (cfg.w + cfg.gapX), w = Math.min(cfg.w, (cfg.edgeR ?? 1e9) - x);
            return <div key={k} style={{ position: "absolute", left: x + "mm", top: cfg.offY + "mm" }}>
              <LabelView cfg={w < cfg.w ? { ...cfg, w } : cfg} p={j.p} qtyOnLabel={j.qtyOnLabel} line={j.line} bag={j.bag} sourceQr={j.sourceQr} labelIndex={j.labelIndex ?? i * cfg.cols + k} /></div>;
          })}
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
            <LabelView cfg={b.w < cfg.w ? { ...cfg, w: b.w } : cfg} p={j.p} qtyOnLabel={j.qtyOnLabel} line={j.line} bag={j.bag} sourceQr={j.sourceQr} labelIndex={j.labelIndex ?? i * per + k} /></div>;
        })}
      </div>))}
  </>);
}
