import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting, recordMovement, type Product } from "../lib/db";
import { qrSvg } from "../lib/qr";
import { ownPayload } from "../lib/parse";
import { blankProduct, saveProduct, findByScan, distinct, DEFAULT_ITEMS, DEFAULT_TYPES, label, itemCodeFor } from "../lib/products";
import { Head, LocationSelect, DeadToggle } from "../components/common";
import { WedgeInput } from "../components/Scanner";
import { useApp, toast } from "../lib/app";
import { toPaise } from "../lib/format";

/* Label settings — every number is in millimetres so what you see is what the printer gets. */
export type LabelCfg = {
  preset: string; mode: "roll" | "sheet";
  w: number; h: number; cols: number; gapX: number; gapY: number;
  sheetW: number; sheetH: number; top: number; left: number; rows: number;
  qr: number; font: number; pad: number; offX: number; offY: number;
  shop: string; format: "shop" | "rungnna"; layout: "shop" | "stack"; show: { shop: boolean; item: boolean; style: boolean; color: boolean; rate: boolean; tk: boolean; code: boolean; qty: boolean };
};

export const PRESETS: { key: string; name: string; cfg: Partial<LabelCfg> }[] = [
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
  preset: "rj", mode: "roll", w: 50, h: 20, cols: 1, gapX: 0, gapY: 0, sheetW: 210, sheetH: 297, top: 0, left: 0, rows: 1,
  qr: 15, font: 7.5, pad: 1.2, offX: 0, offY: 0, shop: "RUNGNNA", format: "shop", layout: "shop",
  show: { shop: true, item: true, style: true, color: true, rate: true, tk: false, code: false, qty: true },
};

type Job = { p: Product; qtyOnLabel: number; copies: number };

export default function Labels({ args }: { args: string[] }) {
  const { me } = useApp();
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [form, setForm] = useState<Product>(() => blankProduct(""));
  const [qty, setQty] = useState("1");
  const [copies, setCopies] = useState("24");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [addStock, setAddStock] = useState(false);
  const [loc, setLoc] = useState("");
  const [printing, setPrinting] = useState(false);
  const items = useLiveQuery(() => distinct("item"), [], []);

  useEffect(() => { getSetting<LabelCfg>("label_cfg", DEFAULT_CFG).then(c => setCfg({ ...DEFAULT_CFG, ...c, show: { ...DEFAULT_CFG.show, ...c.show } })); }, []);
  useEffect(() => { if (args[0]) db.products.get(args[0]).then(p => { if (p) { setForm({ ...p }); setQty(String(p.pack || 1)); } }); }, [args[0]]);
  const upd = (patch: Partial<LabelCfg>) => { const c = { ...cfg, ...patch }; setCfg(c); setSetting("label_cfg", c); };
  const set = (k: keyof Product, v: any) => setForm(f => ({ ...f, [k]: v }));

  const addJob = async () => {
    if (!form.item && !form.style) { toast("Fill ITEM or STYLE first", true); return; }
    // make sure the product exists so a scan of the new QR always finds it
    const existing = form.style ? await findByScan(form.code, { raw: form.code, how: "x", tokens: [], style: form.style, color: form.color, item: form.item }) : undefined;
    const pack = Math.max(1, parseInt(qty) || 1);
    const item_code = form.item_code || (await itemCodeFor(form.item)) || undefined;
    const p = existing && existing.id !== form.id
      ? { ...existing, rate: form.rate || existing.rate, tk: form.tk || existing.tk, pack, item_code: existing.item_code || item_code }
      : { ...form, pack, item_code, created_by: form.created_by || me?.id || "" };
    const saved = await saveProduct(p);
    const n = Math.max(1, parseInt(copies) || 1);
    if (addStock) {
      if (!loc) { toast("Choose the rack the new stock goes to", true); return; }
      await recordMovement({ product_id: saved.id, kind: "intake", qty: n * Math.max(1, parseInt(qty) || 1), from_loc: null, to_loc: loc, person_type: "employee", person_name: me?.name || "", by_staff: me?.id || "", note: "labelled at print" });
    }
    setJobs(j => [...j, { p: saved, qtyOnLabel: Math.max(1, parseInt(qty) || 1), copies: n }]);
    toast(`${n} labels queued · ${label(saved)}`);
    setForm(blankProduct(me?.id || "")); setQty("1");
  };

  const flat = useMemo(() => jobs.flatMap(j => Array.from({ length: j.copies }, () => j)), [jobs]);
  const total = flat.length;

  const doPrint = () => { setPrinting(true); setTimeout(() => { window.print(); setPrinting(false); }, 150); };

  return (
    <div>
      <Head eyebrow="Barcode print" title="QR labels" sub="Same fields as the old BARCODE PRINT screen. Every label carries its own details inside the QR, so it scans even on a phone with no internet.">
        <button className="btn g" disabled={!total} onClick={doPrint}>Print {total || ""} labels</button>
      </Head>
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
                <div style={{ gridColumn: "1/-1" }}><DeadToggle value={form.tk} onChange={v => set("tk", v)} /></div>
                <label className="f">ITEM CODE (old software)<input className="in mono" inputMode="numeric" value={form.item_code || ""} placeholder="auto" onChange={e => set("item_code", e.target.value.replace(/\D/g, "") || undefined)} /></label>
                <label className="f">RATE ₹<input className="in hi mono" inputMode="decimal" value={form.rate ? String(form.rate / 100) : ""} onChange={e => set("rate", toPaise(e.target.value))} /></label>
                <label className="f">QTY (pieces per packet — prints as ₹RATE X QTY PCS)<input className="in mono" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ""))} /></label>
                <label className="f">PRINT QTY (labels)<input className="in mono" inputMode="numeric" value={copies} onChange={e => setCopies(e.target.value.replace(/\D/g, ""))}
                  onKeyDown={e => e.key === "Enter" && addJob()} /></label>
              </div>
              <label className="row sm"><input type="checkbox" checked={addStock} onChange={e => setAddStock(e.target.checked)} /> These are new packets — also add them to stock</label>
              {addStock && <LocationSelect value={loc} onChange={setLoc} label="Into rack" buckets={false} />}
              <button className="btn p big" onClick={addJob}>Add to print queue ↵</button>
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
        <LabelSettings cfg={cfg} upd={upd} sample={jobs[0]?.p || { ...form, code: form.code }} qty={parseInt(qty) || 1} />
      </div>
      {printing && createPortal(<PrintSheet cfg={cfg} jobs={flat} />, document.getElementById("printroot")!)}
    </div>
  );
}

export function LabelView({ cfg, p, qtyOnLabel = 1 }: { cfg: LabelCfg; p: Product; qtyOnLabel?: number }) {
  const pp = { ...p, pack: p.pack || qtyOnLabel };
  const { svg } = useMemo(() => qrSvg(ownPayload(pp, cfg.format || "shop")), [p.code, p.item, p.type, p.style, p.color, p.tk, p.rate, p.item_code, pp.pack, p.ref, cfg.format]);
  const s = cfg.show, fs = cfg.font;
  const q = Math.min(cfg.qr, cfg.h - cfg.pad * 2);
  if ((cfg.layout || "shop") === "shop") return (
    // same arrangement as the stickers already on his packets: text | QR | shop name standing up
    <div className="lbl" style={{ width: cfg.w + "mm", height: cfg.h + "mm", padding: cfg.pad + "mm", gap: cfg.pad + "mm", fontSize: fs + "pt", alignItems: "center" }}>
      <div className="t" style={{ fontWeight: 600 }}>
        {s.item && p.item && <div>{p.item}</div>}
        {s.style && p.style && <div>{p.style}</div>}
        {s.color && p.color && <div>{p.color}</div>}
        {s.tk && p.tk && <div>TK {p.tk}</div>}
        {s.rate && p.rate > 0 && <div style={{ fontWeight: 800, fontSize: fs * 1.35 + "pt" }}>₹{p.rate / 100}{s.qty ? `X${pp.pack}${p.type || "PCS"}` : ""}</div>}
        {s.code && <div style={{ fontFamily: "monospace", fontSize: fs * 0.8 + "pt" }}>{p.code}</div>}
      </div>
      <div className="q" style={{ width: q + "mm", height: q + "mm" }} dangerouslySetInnerHTML={{ __html: svg }} />
      {s.shop && cfg.shop && <div style={{ writingMode: "vertical-rl", fontWeight: 800, letterSpacing: ".12em", fontSize: fs * 0.95 + "pt", flex: "none" }}>{cfg.shop}</div>}
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
        {s.rate && p.rate > 0 && <div style={{ fontWeight: 800, fontSize: fs * 1.25 + "pt" }}>₹{p.rate / 100}</div>}
        {s.code && <div style={{ fontFamily: "monospace", fontSize: fs * 0.85 + "pt" }}>{p.code}</div>}
      </div>
    </div>
  );
}

function LabelSettings({ cfg, upd, sample, qty }: { cfg: LabelCfg; upd: (p: Partial<LabelCfg>) => void; sample: Product; qty: number }) {
  const num = (k: keyof LabelCfg, lab: string, step = 0.5) => (
    <label className="f">{lab}
      <input className="in mono" type="number" step={step} value={cfg[k] as number} onChange={e => upd({ [k]: Number(e.target.value) } as any)} /></label>);
  const demo: Product = sample.item || sample.style ? sample : { ...sample, item: "F-RING", type: "PCS", style: "K5208/K-LT", color: "W/LP/B", rate: 2400, item_code: "202", pack: 12, ref: "183" };
  return (
    <div className="card" style={{ position: "sticky", top: 70 }}>
      <header><h3>Label size &amp; layout</h3><span className="xs mut">saved on this device</span></header>
      <div className="pad stack">
        <label className="f">Sticker
          <select className="in" value={cfg.preset} onChange={e => { const p = PRESETS.find(x => x.key === e.target.value); upd({ preset: e.target.value, ...(p?.cfg || {}) }); }}>
            {PRESETS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}
            <option value="custom">Custom size</option>
          </select></label>
        <div className="grid g3">
          {num("w", "Width mm")}{num("h", "Height mm")}{num("qr", "QR size mm")}
          {num("font", "Text size pt")}{num("offX", "Nudge right mm", 0.25)}{num("offY", "Nudge down mm", 0.25)}
          {cfg.mode === "roll" ? <>{num("cols", "Across (2-up)", 1)}{num("gapX", "Gap across mm")}{num("gapY", "Gap between mm")}</>
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
      <div className="pad xs mut">Tip: in the print window choose your label printer, set margins to “None” and scale to 100%. Use the nudge boxes if the print sits off-centre.</div>
    </div>
  );
}

function PrintSheet({ cfg, jobs }: { cfg: LabelCfg; jobs: Job[] }) {
  if (cfg.mode === "roll") {
    const pageW = cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
    const rows: Job[][] = []; for (let i = 0; i < jobs.length; i += cfg.cols) rows.push(jobs.slice(i, i + cfg.cols));
    return (<>
      <style>{`@page{size:${pageW}mm ${cfg.h + cfg.gapY}mm;margin:0}`}</style>
      {rows.map((r, i) => (
        <div key={i} style={{ display: "flex", gap: cfg.gapX + "mm", width: pageW + "mm", height: cfg.h + "mm", pageBreakAfter: "always", breakAfter: "page", transform: `translate(${cfg.offX}mm,${cfg.offY}mm)` }}>
          {r.map((j, k) => <LabelView key={k} cfg={cfg} p={j.p} qtyOnLabel={j.qtyOnLabel} />)}
        </div>))}
    </>);
  }
  const per = cfg.cols * cfg.rows;
  const pages: Job[][] = []; for (let i = 0; i < jobs.length; i += per) pages.push(jobs.slice(i, i + per));
  return (<>
    <style>{`@page{size:${cfg.sheetW}mm ${cfg.sheetH}mm;margin:0}`}</style>
    {pages.map((pg, i) => (
      <div key={i} style={{ width: cfg.sheetW + "mm", height: cfg.sheetH + "mm", position: "relative", pageBreakAfter: "always", breakAfter: "page", overflow: "hidden" }}>
        {pg.map((j, k) => {
          const c = k % cfg.cols, r = Math.floor(k / cfg.cols);
          return <div key={k} style={{ position: "absolute", left: cfg.left + cfg.offX + c * (cfg.w + cfg.gapX) + "mm", top: cfg.top + cfg.offY + r * (cfg.h + cfg.gapY) + "mm" }}>
            <LabelView cfg={cfg} p={j.p} qtyOnLabel={j.qtyOnLabel} /></div>;
        })}
      </div>))}
  </>);
}
