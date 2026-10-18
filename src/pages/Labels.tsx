import { useEffect, useMemo, useRef, useState } from "react";
import { usePrintJob } from "../lib/printing";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting, recordMovement, type Product } from "../lib/db";
import { blankProduct, saveProduct, findByScan, distinct, DEFAULT_ITEMS, DEFAULT_TYPES, label, itemCodeFor } from "../lib/products";
import { Head, LocationSelect } from "../components/common";
import { WedgeInput } from "../components/Scanner";
import { useApp, toast } from "../lib/app";
import { can } from "../lib/roles";
import { inStore } from "../lib/scope";
import { purchaseLabelJobs, productForLabel } from "../lib/purchase-labels";
import { toPaise } from "../lib/format";
import { getRule, priceFromCost, type PricingRule } from "../lib/pricing";
import { buildTSPL, labelFromProduct, printTSPL, directPrintSupported, connectSerial, connectUSB, serialSupported, usbSupported } from "../lib/tsc";
import { ownPayload } from "../lib/parse";
import { renderLabelSvg } from "../lib/label-artwork";
import { buildLabelBitmapJob } from "../lib/label-bitmap";
import { listQzPrinters, printQzTSPL } from "../lib/qz";

/* Label settings — every number is in millimetres so what you see is what the printer gets. */
export type LabelCfg = {
  output?: "browser" | "tspl" | "qz";
  qzPrinter?: string;
  checked?: string;
  preset: string; mode: "roll" | "sheet";
  w: number; h: number; cols: number; gapX: number; gapY: number;
  sheetW: number; sheetH: number; top: number; left: number; rows: number;
  qr: number; font: number; pad: number; offX: number; offY: number;
  shop: string; format: "shop" | "rungnna"; layout: "shop" | "stack"; show: { shop: boolean; item: boolean; style: boolean; color: boolean; rate: boolean; tk: boolean; code: boolean; qty: boolean; cost_code: boolean };
};

export const PRESETS: { key: string; name: string; cfg: Partial<LabelCfg> }[] = [
  { key: "rj3", name: "Shop roll — 3 across (33 × 15 mm)", cfg: { mode: "roll", w: 33, h: 15, cols: 3, gapX: 2.5, gapY: 2.6, qr: 9, font: 5.5, pad: 0.6 } },
  { key: "rj", name: "Rungnna current sticker (50 × 20 mm)", cfg: { mode: "roll", w: 50, h: 20, cols: 1, gapX: 0, gapY: 0, qr: 15, font: 7.5 } },
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
  preset: "rj3", mode: "roll", w: 33, h: 15, cols: 3, gapX: 2.5, gapY: 2.6, sheetW: 210, sheetH: 297, top: 0, left: 0, rows: 1,
  qr: 9, font: 5.5, pad: 0.6, offX: 0, offY: 0, shop: "RUNGNNA", format: "shop", layout: "shop",
  show: { shop: true, item: true, style: true, color: true, rate: true, tk: false, code: false, qty: true, cost_code: false },
};

type Job = { p: Product; qtyOnLabel: number; copies: number };

export function labelSetupKey(cfg: LabelCfg) {
  const { checked: _, ...settings } = cfg;
  return JSON.stringify(settings);
}

export function afterCheckRow(jobs: Job[], count: number): Job[] {
  return jobs.flatMap(j => {
    const used = Math.min(count, j.copies); count -= used;
    return j.copies > used ? [{ ...j, copies: j.copies - used }] : [];
  });
}

export function validateLabelPrint(cfg: LabelCfg, jobs: Job[]) {
  if (![cfg.w, cfg.h, cfg.qr, cfg.font].every(n => Number.isFinite(n) && n > 0) || cfg.w > 200 || cfg.h > 300 || ![cfg.gapX, cfg.gapY, cfg.pad].every(n => Number.isFinite(n) && n >= 0 && n <= 20) || ![cfg.offX, cfg.offY].every(Number.isFinite) || !Number.isSafeInteger(cfg.cols) || cfg.cols < 1 || cfg.cols > 20) throw new Error("Check label size, gaps and columns in printer settings");
  if (cfg.mode === "roll" && cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX > 200) throw new Error("Check the total roll width in printer settings");
  if (cfg.mode === "sheet" && (!Number.isSafeInteger(cfg.rows) || cfg.rows < 1 || cfg.rows > 100 || ![cfg.sheetW, cfg.sheetH].every(n => Number.isFinite(n) && n > 0) || ![cfg.top, cfg.left].every(n => Number.isFinite(n) && n >= 0) || cfg.left + cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX > cfg.sheetW || cfg.top + cfg.rows * cfg.h + (cfg.rows - 1) * cfg.gapY > cfg.sheetH)) throw new Error("Labels do not fit the selected sheet");
  if (cfg.pad * 2 >= Math.min(cfg.w, cfg.h) || cfg.qr + cfg.pad * 2 >= cfg.w) throw new Error("Leave room for the product name beside the QR");
  if (!jobs.length || jobs.some(j => !j.p.item.trim() || !Number.isSafeInteger(j.copies) || j.copies < 1 || !Number.isSafeInteger(j.qtyOnLabel) || j.qtyOnLabel < 1) || jobs.reduce((n, j) => n + j.copies, 0) > 5000) throw new Error("Review product names and print quantities (maximum 5000 labels)");
  // An invalid artwork must fail before opening print, never print an error label.
  for (const job of jobs) renderLabelSvg(cfg, job.p, job.qtyOnLabel);
}

export default function Labels({ args }: { args: string[] }) {
  const { me } = useApp();
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [form, setForm] = useState<Product>(() => blankProduct(""));
  const [qty, setQty] = useState("1");
  const [copies, setCopies] = useState("1");
  const queueLock = useRef(false);
  const [queueBusy, setQueueBusy] = useState(false);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [addStock, setAddStock] = useState(false);
  const [loc, setLoc] = useState("");
  const [printing, setPrinting] = useState(false);
  const [printBatch, setPrintBatch] = useState<{ cfg: LabelCfg; jobs: Job[] } | null>(null);
  const [printRequested, setPrintRequested] = useState(false);
  const [check, setCheck] = useState<{ key: string; count: number; queue: string } | null>(null);
  const [problem, setProblem] = useState("");
  const directLock = useRef(false), [directBusy, setDirectBusy] = useState(false);
  const [printerReady, setPrinterReady] = useState(false), [loadedPurchase, setLoadedPurchase] = useState("");
  const autoPrinted = useRef("");
  const [rule, setRule] = useState<PricingRule | null>(null);
  const [cost, setCost] = useState("");          // ₹ cost entered by the operator
  const vendors = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);
  const items = useLiveQuery(() => distinct("item"), [], []);

  useEffect(() => { getSetting<LabelCfg>("label_cfg", DEFAULT_CFG).then(c => { setCfg({ ...DEFAULT_CFG, ...c, show: { ...DEFAULT_CFG.show, ...c.show } }); setPrinterReady(true); }); }, []);
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
      void doPrint();
    }
  }, [args[0], args[1], args[2], printerReady, loadedPurchase, jobs]);
  useEffect(() => {
    if (printRequested) { setPrintRequested(false); void doPrint(); }
  }, [printRequested]);
  const upd = (patch: Partial<LabelCfg>) => { const c = { ...cfg, ...patch }; setCfg(c); setSetting("label_cfg", c); };
  const set = (k: keyof Product, v: any) => setForm(f => ({ ...f, [k]: v }));

  const addJob = async (print = false) => {
    if (queueLock.current || check || directBusy || printing) return;
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
    setJobs(j => [...j, { p: saved, qtyOnLabel: Math.max(1, parseInt(qty) || 1), copies: n }]);
    if (print) setPrintRequested(true);
    toast(`${n} labels queued · ${label(saved)}`);
    setForm(blankProduct(me?.id || "")); setQty("1"); setCost("");
    } catch (e: any) { toast(e.message || "Could not prepare labels", true); }
    finally { queueLock.current = false; setQueueBusy(false); }
  };

  const flat = useMemo(() => jobs.flatMap(j => Array.from({ length: Math.max(0, Math.min(5000, j.copies)) }, () => j)).slice(0, 5000), [jobs]);
  const total = flat.length;

  usePrintJob(printing, () => setPrinting(false), "", message => { setCheck(null); toast(message, true); });

  const doPrint = async (forceCheck = false, config = cfg) => {
    if (directLock.current || printing) return;
    try {
      validateLabelPrint(config, jobs);
      const checking = forceCheck || config.checked !== labelSetupKey(config);
      const count = Math.min(total, config.mode === "roll" ? config.cols : 1);
      const batch = checking ? flat.slice(0, count).map(j => ({ ...j, copies: 1 })) : jobs;
      if (config.output === "qz") {
        directLock.current = true; setDirectBusy(true);
        const bytes = await buildLabelBitmapJob(config, batch);
        await printQzTSPL(config.qzPrinter || "", bytes);
        toast(`Sent ${checking ? count : total} labels to ${config.qzPrinter}`);
      } else if (config.output === "tspl") {
        await doPrintTSC(batch, config);
      } else {
        setPrintBatch({ cfg: config, jobs: checking ? flat.slice(0, count) : flat });
        setPrinting(true);
      }
      setProblem("");
      setCheck(checking ? { key: labelSetupKey(config), count, queue: JSON.stringify(jobs) } : null);
    } catch (e: any) {
      toast((e.message || "Could not print labels") + (config.output !== "browser" ? " Check the printer before retrying; a partial job may have printed." : ""), true);
    } finally { directLock.current = false; setDirectBusy(false); }
  };

  /* Legacy single-column transport. No automatic retries or browser fallback. */
  const doPrintTSC = async (batch: Job[], config: LabelCfg) => {
      directLock.current = true; setDirectBusy(true);
      validateLabelPrint(config, batch);
      if (config.mode !== "roll" || config.cols !== 1) throw new Error("USB / serial output supports single-column rolls. Choose QZ Tray for the three-across shop roll.");
      const commands = batch.map(j => {
        const product = productForLabel(j.p, j.qtyOnLabel);
        const qr = ownPayload(product, config.format || "shop");
        const lbl = labelFromProduct(product, {
          qr, costCode: config.show.cost_code ? j.p.cost_code : undefined,
          wmm: config.w, hmm: config.h, gapmm: config.gapY, copies: j.copies,
          offXmm: config.offX, offYmm: config.offY,
        });
        return buildTSPL(lbl);
      }).join("");
      await printTSPL(commands);
      toast(`Sent ${batch.reduce((n, j) => n + j.copies, 0)} labels to the TSC printer`);
  };

  const confirmCheck = () => {
    if (!check || check.key !== labelSetupKey(cfg) || check.queue !== JSON.stringify(jobs)) return toast("Settings or queue changed. Print a fresh check row first.", true);
    upd({ checked: check.key });
    setJobs(afterCheckRow(jobs, check.count)); setCheck(null); setProblem("");
    toast("Check row accepted. Those labels are counted; print the remaining queue.");
  };
  const nudge = (axis: "offX" | "offY", amount: number) => {
    const config = { ...cfg, [axis]: Math.round((cfg[axis] + amount) * 100) / 100 };
    upd(config); void doPrint(true, config);
  };

  return (
    <div className="label-counter">
      <Head eyebrow="Barcode print" title="QR labels" sub="ITEM · STYLE · COLOUR · RATE × QTY. Same layout as the stickers on your packets.">
        <button className="btn g" disabled={!printerReady || !total || directBusy || printing || !!check} onClick={() => void doPrint()}>{directBusy ? "Sending…" : cfg.checked !== labelSetupKey(cfg) ? `Print check row (${Math.min(total, cfg.mode === "roll" ? cfg.cols : 1)})` : `Print ${total || ""} labels`}</button>
      </Head>
      <div className="card pad stack" style={{ marginBottom: 16 }}>
        <div className="row"><b>{cfg.cols} across · {cfg.w} × {cfg.h} mm</b><span className="sm mut">{cfg.output === "qz" ? cfg.qzPrinter || "Choose your Windows printer below" : cfg.output === "tspl" ? "USB / serial" : "Browser print"}</span><button className="btn sm" disabled={directBusy || printing} onClick={() => upd({ preset: "rj3", ...PRESETS[0].cfg })}>Use 3-across shop roll</button></div>
        <div className="sm mut">Check these measurements against the roll: {cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX} mm across, {cfg.gapY} mm gap between rows.</div>
      </div>
      {check && <div className="card pad stack" style={{ marginBottom: 16 }} aria-label="Check printed row">
        <b>Did this row print clearly inside the stickers?</b>
        <div className="row"><button className="btn p" disabled={printing || directBusy} onClick={confirmCheck}>Yes, count these {check.count} labels</button><button className="btn" disabled={printing || directBusy} onClick={() => setProblem("choose")}>No, it’s wrong</button><button className="btn" disabled={printing || directBusy} onClick={() => void doPrint(true)}>Reprint check row</button><button className="btn" disabled={printing || directBusy} onClick={() => { setCheck(null); setProblem(""); }}>Cancel check</button></div>
        <div className="xs mut">Accepting this row removes its labels from the queue, so the remaining batch won’t repeat them. A cancelled print should not be accepted.</div>
        {problem && <><label className="f">What do you see?<select className="in" value={problem} onChange={e => setProblem(e.target.value)}><option value="choose">Choose the problem</option><option value="paper">Blank rows / print across a gap</option><option value="vertical">Print too high or too low</option><option value="horizontal">Print too far left or right</option><option value="tiny">Print is tiny</option><option value="headers">Date, title or link on stickers</option></select></label>
          {problem === "paper" && <div className="sm">{cfg.output === "qz" ? "Check label height and gap above against the actual roll, then run gap calibration using your printer’s manual." : <BrowserLabelSetup cfg={cfg} />}</div>}
          {(problem === "vertical" || problem === "horizontal") && <div className="row">{[-1, -0.5, 0.5, 1].map(amount => <button key={amount} className="btn sm" disabled={printing || directBusy} onClick={() => nudge(problem === "vertical" ? "offY" : "offX", amount)}>{amount > 0 ? "+" : ""}{amount} mm {problem === "vertical" ? amount > 0 ? "down" : "up" : amount > 0 ? "right" : "left"} &amp; reprint</button>)}</div>}
          {problem === "tiny" && <div className="sm">In Chrome’s print window set Scale to Default / 100%, Margins to None, and select the row’s paper size.</div>}
          {problem === "headers" && <div className="sm">In Chrome’s print window open More settings and turn off Headers and footers.</div>}
        </>}
      </div>}
      <div className="split">
        <div className="stack">
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
                  <input className="in hi mono" inputMode="decimal" value={form.rate ? String(form.rate / 100) : ""} onChange={e => { set("rate", toPaise(e.target.value)); set("price_locked", 1); }} /></label>
                <label className="f">QTY (pieces per packet — prints as ₹RATE X QTY PCS)<input className="in mono" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ""))} /></label>
                <label className="f">PRINT QTY (labels)<input className="in mono" inputMode="numeric" value={copies} onChange={e => setCopies(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && addJob()} /></label>
              </div>
              <label className="row sm"><input type="checkbox" checked={addStock} onChange={e => setAddStock(e.target.checked)} /> These are new packets — also add them to stock</label>
              {addStock && <LocationSelect value={loc} onChange={setLoc} label="Into rack" buckets={false} />}
              <div className="row"><button className="btn p" disabled={queueBusy || directBusy || printing || !!check} onClick={() => addJob(true)}>Print barcode</button><button className="btn" disabled={queueBusy || directBusy || printing || !!check} onClick={() => addJob()}>Add to queue</button></div>
            </div>
          </div>
          {jobs.length > 0 && (
            <div className="card">
              <header><h3>Print queue</h3><span className="pill">{total} labels</span><button className="btn sm" disabled={directBusy || printing || !!check} style={{ marginLeft: "auto" }} onClick={() => setJobs([])}>Clear</button></header>
              <div className="pad stack" style={{ gap: 6 }}>
                {jobs.map((j, i) => (
                  <div key={i} className="row sm">
                    <span className="grow">{label(j.p)} <span className="mono xs mut">{j.p.code}</span></span>
                    <input className="in mono" aria-label={`Stickers for ${label(j.p)}`} disabled={directBusy || printing || !!check} style={{ width: 80, minHeight: 34 }} value={j.copies} inputMode="numeric"
                      onChange={e => setJobs(js => js.map((x, k) => k === i ? { ...x, copies: parseInt(e.target.value) || 0 } : x))} />
                    <button className="btn sm bad" disabled={directBusy || printing || !!check} onClick={() => setJobs(js => js.filter((_, k) => k !== i))}>✕</button>
                  </div>))}
              </div>
            </div>
          )}
        </div>
        <div className="stack" style={{ minWidth: 0 }}><div className="labelprev" aria-label="Sticker row preview" style={{ flexWrap: "nowrap", overflowX: "auto", gap: cfg.gapX + "mm" }}>{(flat.length ? flat.slice(0, Math.max(1, Math.min(20, cfg.cols))) : Array.from({ length: Math.max(1, Math.min(20, cfg.cols || 1)) }, () => ({ p: form, qtyOnLabel: parseInt(qty) || 1 }))).map((j, i) => <LabelView key={i} cfg={cfg} p={j.p} qtyOnLabel={j.qtyOnLabel} />)}</div><details><summary>Printer settings</summary><LabelSettings cfg={cfg} upd={upd} sample={jobs[0]?.p || { ...form, code: form.code }} qty={jobs[0]?.qtyOnLabel || parseInt(qty) || 1} /></details></div>
      </div>
      {printing && printBatch && createPortal(<PrintSheet cfg={printBatch.cfg} jobs={printBatch.jobs} />, document.getElementById("printroot")!)}
      {printing && <button className="btn print-notice" onClick={() => setPrinting(false)}>Close print</button>}
    </div>
  );
}

export function LabelView({ cfg, p, qtyOnLabel = 1 }: { cfg: LabelCfg; p: Product; qtyOnLabel?: number }) {
  try {
    const svg = renderLabelSvg(cfg, p, qtyOnLabel);
    return <div className="lbl" style={{ width: cfg.w + "mm", height: cfg.h + "mm", flex: "none" }} dangerouslySetInnerHTML={{ __html: svg }} />;
  } catch (e: any) {
    return <div role="alert" className="pad sm">{e.message || "Check the sticker size and QR content"}</div>;
  }
}

export function BrowserLabelSetup({ cfg }: { cfg: LabelCfg }) {
  const width = cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
  return <div className="stack" style={{ gap: 6 }}>
    <b>Set one row as the Windows paper size</b>
    <span>Windows → your TSC printer → Printing preferences → Page Setup → Stock → New. Create “Rungnna row”: {width} × {cfg.h} mm, Labels With Gaps, gap {cfg.gapY} mm. Driver wording can vary.</span>
    <span>Chrome print → Paper size “Rungnna row”, Margins None, Scale Default / 100%, Headers and footers off. A 4 × 6 inch page feeds many blank sticker rows.</span>
    <span>The old software can continue to send its own label size. For direct printing from this app, select QZ Tray below.</span>
  </div>;
}

function LabelSettings({ cfg, upd, sample, qty }: { cfg: LabelCfg; upd: (p: Partial<LabelCfg>) => void; sample: Product; qty: number }) {
  const [printers, setPrinters] = useState<string[]>([]), [finding, setFinding] = useState(false), [error, setError] = useState("");
  const findPrinters = async () => {
    if (finding) return;
    setFinding(true); setError("");
    try { setPrinters(await listQzPrinters()); } catch (e: any) { setError(e.message || "Could not connect to QZ Tray"); }
    finally { setFinding(false); }
  };
  const num = (k: keyof LabelCfg, lab: string, step = 0.5) => (
    <label className="f">{lab}
      <input className="in mono" type="number" step={step} value={cfg[k] as number} onChange={e => upd({ [k]: Number(e.target.value) } as any)} /></label>);
  const demo: Product = sample.item || sample.style ? sample : { ...sample, item: "F-RING", type: "PCS", style: "K5208/K-LT", color: "W/LP/B", rate: 2400, item_code: "202", pack: 12, ref: "183" };
  return (
    <div className="card" style={{ position: "sticky", top: 70 }}>
      <header><h3>Label size &amp; layout</h3><span className="xs mut">saved on this device</span></header>
      <div className="pad stack">
        <label className="f">Print labels using<select className="in" value={cfg.output || "browser"} onChange={e => upd({ output: e.target.value as LabelCfg["output"] })}><option value="browser">Browser / Windows printer driver</option><option value="qz">QZ Tray → Windows TSC printer (203 dpi)</option><option value="tspl" disabled={!directPrintSupported()}>USB / serial TSC (single column, 203 dpi)</option></select></label>
        {cfg.output === "qz" && <div className="stack">
          <div className="sm">Install and open <a href="https://qz.io/download/" target="_blank" rel="noreferrer">QZ Tray</a> on this Windows counter, then allow this app’s connection and print requests. Without a signing certificate, QZ may ask for permission each time.</div>
          <button className="btn" disabled={finding} onClick={() => void findPrinters()}>{finding ? "Finding printers…" : "Find Windows printers"}</button>
          <label className="f">TSC printer<select className="in" value={cfg.qzPrinter || ""} onChange={e => upd({ qzPrinter: e.target.value })}><option value="">Choose the label printer</option>{[...new Set([...(cfg.qzPrinter ? [cfg.qzPrinter] : []), ...printers])].map(p => <option key={p} value={p}>{p}</option>)}</select></label>
          {error && <div className="sm" role="alert">{error}</div>}
          <div className="xs mut">For TSPL / TSPL2 printers at 203 dpi only. Each row is sent with its actual size and gap; Chrome’s paper size is bypassed. Check one row before the batch.</div>
        </div>}
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
          {cfg.mode === "roll" ? <>{num("cols", "Stickers across", 1)}{num("gapX", "Gap across mm")}{num("gapY", "Gap between rows mm")}</>
            : <>{num("cols", "Columns", 1)}{num("rows", "Rows", 1)}{num("top", "Top margin mm")}{num("left", "Left margin mm")}{num("gapX", "Gap across mm")}{num("gapY", "Gap down mm")}</>}
        </div>
        <label className="f">Shop name on label<input className="in" value={cfg.shop} onChange={e => upd({ shop: e.target.value })} /></label>
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
      {cfg.output !== "qz" && cfg.mode === "roll" && <div className="pad xs mut"><BrowserLabelSetup cfg={cfg} /></div>}
    </div>
  );
}

export function PrintSheet({ cfg, jobs }: { cfg: LabelCfg; jobs: Job[] }) {
  if (cfg.mode === "roll") {
    const pageW = cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
    const rows: Job[][] = []; for (let i = 0; i < jobs.length; i += cfg.cols) rows.push(jobs.slice(i, i + cfg.cols));
    return (<>
      <style>{`@page{size:${pageW}mm ${cfg.h}mm;margin:0}`}</style>
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
          const c = k % cfg.cols, r = Math.floor(k / cfg.cols);
          return <div key={k} style={{ position: "absolute", left: cfg.left + cfg.offX + c * (cfg.w + cfg.gapX) + "mm", top: cfg.top + cfg.offY + r * (cfg.h + cfg.gapY) + "mm" }}>
            <LabelView cfg={cfg} p={j.p} qtyOnLabel={j.qtyOnLabel} /></div>;
        })}
      </div>))}
  </>);
}
