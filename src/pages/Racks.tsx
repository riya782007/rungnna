import { inStore, storeStock, currentStore, MAIN_STORE } from "../lib/stores";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, uid, now, getSetting, setSetting, type Location } from "../lib/db";
import { Head, useLocations, locName, Thumb, Modal, Switch } from "../components/common";
import { qrSvg } from "../lib/qr";
import { toast, go } from "../lib/app";
import { usePrintJob } from "../lib/printing";
import { label } from "../lib/products";
import {
  DEFAULT_RACK_CFG, RACK_PRESETS, FONTS, TEMPLATE_VARS, SHEETS, normalizeCfg, varsFor, renderTemplate, payloadFor,
  sortLocs, floorRank, floorLabel, perPage, sheetOverflow, toUnit, fromUnit, type RackLabelCfg, type Unit, type Weight,
} from "../lib/rackLabel";

const FLOORS = [["G", "Ground"], ["1", "Floor 1"], ["2", "Floor 2"], ["3", "Floor 3"], ["4", "Floor 4 (backend)"], ["GD", "Godown"]];
const CFG_KEY = "rack_label_cfg";

export const codeFor = (floor: string, rack: string, box: string) =>
  [floor === "G" ? "G" : floor === "GD" ? "GD" : "F" + floor, rack && "R" + rack.padStart(2, "0"), box && "B" + box.padStart(2, "0")].filter(Boolean).join("-");

export default function Racks({ args }: { args: string[] }) {
  if (args[0] === "print") return <RackStudio floor={args[1]} />;
  return <RackList args={args} />;
}

function RackList({ args }: { args: string[] }) {
  const locs = useLocations();
  const cells = useLiveQuery(() => storeStock(), [], []);
  const [floor, setFloor] = useState("1");
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("12");
  const [boxes, setBoxes] = useState("0");
  const [name, setName] = useState("");
  const open = args[0] ? locs.find(l => l.id === args[0]) : undefined;

  const qtyAt = useMemo(() => { const m = new Map<string, number>(); cells.forEach(c => m.set(c.loc_id, (m.get(c.loc_id) || 0) + c.qty)); return m; }, [cells]);

  const create = async () => {
    const a = Number(from), b = Number(to), nb = Number(boxes);
    if (![a, b, nb].every(Number.isSafeInteger) || a < 1 || b < a || nb < 0) return toast("Enter a valid rack range and whole box count", true);
    if (b - a > 60 || nb > 40) { toast("That is a lot of racks — create them in smaller groups", true); return; }
    let made = 0;
    await db.transaction("rw", [db.locations, db.outbox], async () => {
    for (let r = a; r <= b; r++) {
      const list = nb ? Array.from({ length: nb }, (_, i) => String(i + 1)) : [""];
      for (const bx of list) {
        const code = (currentStore() === MAIN_STORE ? "" : currentStore().slice(-6) + "/") + codeFor(floor, String(r), bx);
        if (await db.locations.where("code").equals(code).first()) continue;
        await put("locations", { id: uid(), code, floor, rack: String(r), box: bx, name, kind: floor === "GD" ? "godown" : "rack", updated_at: now() } as Location);
        made++;
      }
    }
    });
    toast(made ? `${made} locations created` : "They already exist");
  };

  const byFloor = FLOORS.map(([f, n]) => ({ f, n, list: locs.filter(l => l.floor === f && l.kind !== "bucket") })).filter(x => x.list.length);
  const buckets = locs.filter(l => l.kind === "bucket");
  const anyRacks = locs.some(l => l.kind !== "bucket");

  return (
    <div>
      <Head eyebrow="Shop floor" title="Floors & racks" sub="Every rack and box gets a code and its own QR sticker. Scan the rack sticker first, then the products — the app knows exactly where each piece sits.">
        {anyRacks && <button className="btn" onClick={() => go("racks/print")}>Print rack stickers</button>}
      </Head>
      <div className="split">
        <div className="stack">
          {byFloor.length === 0 && <div className="card pad mut">No racks yet. Create them on the right — e.g. Floor 1, racks 1 to 12.</div>}
          {byFloor.map(g => (
            <div key={g.f} className="card">
              <header><h3>{g.n}</h3><span className="pill">{g.list.length} places</span>
                <span className="pill ok">{g.list.reduce((a, l) => a + (qtyAt.get(l.id) || 0), 0)} pcs</span>
                <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => go("racks/print/" + g.f)}>Print stickers</button></header>
              <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(104px,1fr))", gap: 8 }}>
                {g.list.map(l => (
                  <button key={l.id} className="item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }} onClick={() => go("racks/" + l.id)}>
                    <span className="mono b">{l.code}</span>
                    <span className="xs mut">{qtyAt.get(l.id) || 0} pcs{l.name ? " · " + l.name : ""}</span>
                  </button>))}
              </div>
            </div>))}
          <div className="card">
            <header><h3>Status buckets</h3></header>
            <div className="pad stack" style={{ gap: 6 }}>
              {buckets.map(l => <button key={l.id} className="item" onClick={() => go("racks/" + l.id)}><span className="grow">{l.name}</span><span className="mono b">{qtyAt.get(l.id) || 0}</span></button>)}
            </div>
          </div>
        </div>
        <div className="card">
          <header><h3>Add racks / boxes</h3></header>
          <div className="pad stack">
            <label className="f">Floor<select className="in" value={floor} onChange={e => setFloor(e.target.value)}>{FLOORS.map(([f, n]) => <option key={f} value={f}>{n}</option>)}</select></label>
            <div className="grid g3">
              <label className="f">Rack from<input className="in mono" value={from} inputMode="numeric" onChange={e => setFrom(e.target.value)} /></label>
              <label className="f">Rack to<input className="in mono" value={to} inputMode="numeric" onChange={e => setTo(e.target.value)} /></label>
              <label className="f">Boxes per rack<input className="in mono" value={boxes} inputMode="numeric" onChange={e => setBoxes(e.target.value)} /></label>
            </div>
            <label className="f">Name (optional)<input className="in" value={name} placeholder="Bridal wall, bangle wall…" onChange={e => setName(e.target.value)} /></label>
            <div className="note">Will create codes like <b className="mono">{codeFor(floor, from || "1", parseInt(boxes) ? "1" : "")}</b> … <b className="mono">{codeFor(floor, to || "1", parseInt(boxes) ? boxes : "")}</b></div>
            <button className="btn p" onClick={create}>Create</button>
          </div>
        </div>
      </div>
      {open && <LocationDetail loc={open} onClose={() => go("racks")} />}
    </div>
  );
}

function LocationDetail({ loc, onClose }: { loc: Location; onClose: () => void }) {
  const rows = useLiveQuery(async () => {
    const cells = (await db.stock.where("loc_id").equals(loc.id).toArray()).filter(c => c.qty !== 0);
    const prods = await db.products.bulkGet(cells.map(c => c.product_id));
    return cells.map((c, i) => ({ c, p: prods[i] })).filter(x => x.p);
  }, [loc.id], []);
  const [nm, setNm] = useState(loc.name);
  return (
    <Modal title={locName(loc)} onClose={onClose}>
      <div className="stack">
        <div className="row"><input className="in grow" value={nm} onChange={e => setNm(e.target.value)} placeholder="Name this place" />
          <button className="btn sm" onClick={async () => { await put("locations", { ...loc, name: nm }); toast("Saved"); }}>Save name</button></div>
        <div className="xs mut">{rows.length} products · {rows.reduce((a, r) => a + r.c.qty, 0)} pieces</div>
        {rows.map(({ c, p }) => (
          <button key={c.key} className="item" onClick={() => go("product/" + p!.id)}>
            <Thumb photo_id={p!.photo_id} url={p!.photo_url} text={p!.item} size={40} />
            <span className="grow sm">{label(p!)}</span><span className="mono b">{c.qty}</span>
          </button>))}
      </div>
    </Modal>
  );
}

/* ===========================================================================
   Rack Sticker Studio (#/racks/print[/<floor>])

   Settings on the left, a live preview on the right that renders the SAME
   markup the printer gets (just scaled), so what Karan sees is what prints.
   Settings are saved on this device, like the product label settings.
=========================================================================== */

const SAMPLE: Location = { id: "sample", code: "F1-R01", floor: "1", rack: "1", box: "", name: "Main aisle", kind: "rack", updated_at: "" };
const MM_PX = 96 / 25.4;
const PREVIEW_PAGES = 3;
const WEIGHTS: [Weight, string][] = [[400, "Regular"], [500, "Medium"], [700, "Bold"], [800, "Extra bold"]];
type TplField = "header" | "primary" | "secondary";

function pageSize(c: RackLabelCfg) {
  if (c.mode === "sheet") return { pw: SHEETS[c.sheet].w, ph: SHEETS[c.sheet].h };
  return { pw: c.cols * c.w + (c.cols - 1) * c.gapX, ph: c.h };
}

function RackStudio({ floor }: { floor?: string }) {
  const locs = useLocations();
  const racks = useMemo(() => sortLocs(locs.filter(l => l.kind !== "bucket")), [locs]);
  const floors = useMemo(() => [...new Set(racks.map(l => l.floor))].sort((a, b) => floorRank(a) - floorRank(b)), [racks]);

  /* settings: raw values while typing, a normalised copy for render/print */
  const [raw, setRaw] = useState<RackLabelCfg>(DEFAULT_RACK_CFG);
  useEffect(() => { getSetting<Partial<RackLabelCfg> | null>(CFG_KEY, null).then(c => setRaw(normalizeCfg(c))); }, []);
  const cfg = useMemo(() => normalizeCfg(raw), [raw]);
  const upd = (p: Partial<RackLabelCfg>) => setRaw(c => { const n = { ...c, ...p }; setSetting(CFG_KEY, normalizeCfg(n)); return n; });
  const [lastTpl, setLastTpl] = useState<TplField>("primary");

  /* selection: floor range → rack range → tick boxes */
  const [fFrom, setFFrom] = useState(""), [fTo, setFTo] = useState("");
  const [rFrom, setRFrom] = useState(""), [rTo, setRTo] = useState("");
  const [withBoxes, setWithBoxes] = useState(true);
  const [picked, setPicked] = useState<Set<string> | null>(null); // null = everything in range
  useEffect(() => {
    if (!floors.length || fFrom) return;
    const f = floor && floors.includes(floor) ? floor : "";
    setFFrom(f || floors[0]); setFTo(f || floors[floors.length - 1]);
  }, [floors, floor, fFrom]);

  const candidates = useMemo(() => {
    const lo = fFrom ? floorRank(fFrom) : -Infinity, hi = fTo ? floorRank(fTo) : Infinity;
    const [a, b] = [Math.min(lo, hi), Math.max(lo, hi)];
    const r1 = parseInt(rFrom), r2 = parseInt(rTo);
    return racks.filter(l => {
      const fr = floorRank(l.floor), rn = parseInt(l.rack) || 0;
      return fr >= a && fr <= b && (isNaN(r1) || rn >= r1) && (isNaN(r2) || rn <= r2) && (withBoxes || !l.box);
    });
  }, [racks, fFrom, fTo, rFrom, rTo, withBoxes]);
  const selected = useMemo(() => candidates.filter(l => !picked || picked.has(l.id)), [candidates, picked]);
  const items = useMemo(() => selected.flatMap(l => Array.from({ length: cfg.copies }, () => l)), [selected, cfg.copies]);

  const toggle = (id: string) => setPicked(p => { const s = new Set(p ?? candidates.map(l => l.id)); s.has(id) ? s.delete(id) : s.add(id); return s; });
  const recent = () => { const cut = Date.now() - 7 * 864e5; setPicked(new Set(candidates.filter(l => new Date(l.updated_at).getTime() > cut).map(l => l.id))); };

  /* live preview geometry */
  const { pw, ph } = pageSize(cfg);
  const pp = perPage(cfg);
  const pages = Math.ceil(items.length / pp);
  const previewItems = items.length ? items.slice(0, pp * PREVIEW_PAGES) : Array.from({ length: Math.min(pp, 4) }, () => SAMPLE);
  const previewPages = Math.max(1, Math.ceil(previewItems.length / pp));
  const fit = Math.min(2.5, 460 / (pw * MM_PX));
  const [zoom, setZoom] = useState<number | null>(null);
  const z = zoom ?? fit;
  const overflow = sheetOverflow(cfg);

  /* scan-quality check on the first sticker: how big is one QR module on paper? */
  const first = selected[0] || SAMPLE;
  const payload = payloadFor(first, cfg);
  const qrSide = qrSideMm(cfg);
  const modules = useMemo(() => qrSvg(payload, "Q").modules, [payload]);
  const moduleMm = qrSide / (modules + 2);

  /* print */
  const [printing, setPrinting] = useState(false);
  usePrintJob(printing, () => setPrinting(false));
  const print = () => {
    if (!items.length) return toast("Pick at least one rack", true);
    if (overflow) toast(overflow, true);
    setPrinting(true);
  };

  const insertVar = (v: string) => { const cur = cfg[lastTpl]; upd({ [lastTpl]: cur + v } as Partial<RackLabelCfg>); };
  const unit = cfg.unit;

  return (
    <div>
      <Head eyebrow="Racks" title="Print rack QR stickers" sub="Choose the racks, set what the QR holds and how the sticker looks. The preview is exactly what prints.">
        <button className="btn" onClick={() => go("racks")}>← Racks</button>
        <button className="btn g" disabled={!items.length} onClick={print}>Generate &amp; print {items.length || ""}</button>
      </Head>

      <div className="rk-studio">
        {/* ---------------- controls ---------------- */}
        <div className="stack">
          <div className="card">
            <header><h3>1 · Racks to print</h3><span className="pill">{selected.length} of {candidates.length}</span></header>
            <div className="pad stack">
              {!racks.length && <div className="note warn sm">No racks yet — create them on the Racks page first.</div>}
              <div className="grid g2">
                <label className="f">Floor from<select className="in" value={fFrom} onChange={e => { setFFrom(e.target.value); setPicked(null); }}>{floors.map(f => <option key={f} value={f}>{floorLabel(f)}</option>)}</select></label>
                <label className="f">Floor to<select className="in" value={fTo} onChange={e => { setFTo(e.target.value); setPicked(null); }}>{floors.map(f => <option key={f} value={f}>{floorLabel(f)}</option>)}</select></label>
                <label className="f">Rack from<input className="in mono" inputMode="numeric" placeholder="first" value={rFrom} onChange={e => { setRFrom(e.target.value.replace(/\D/g, "")); setPicked(null); }} /></label>
                <label className="f">Rack to<input className="in mono" inputMode="numeric" placeholder="last" value={rTo} onChange={e => { setRTo(e.target.value.replace(/\D/g, "")); setPicked(null); }} /></label>
              </div>
              <label className="row sm"><input type="checkbox" checked={withBoxes} onChange={e => { setWithBoxes(e.target.checked); setPicked(null); }} /> Include box stickers (F1-R01-B01…)</label>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn sm" onClick={() => setPicked(null)}>All</button>
                <button className="btn sm" onClick={() => setPicked(new Set())}>None</button>
                <button className="btn sm" onClick={recent} title="Racks added or renamed in the last 7 days">New / changed (7 days)</button>
              </div>
              <div className="rk-checks">
                {candidates.map(l => (
                  <label key={l.id} className="rk-check" title={l.name || l.code}>
                    <input type="checkbox" checked={!picked || picked.has(l.id)} onChange={() => toggle(l.id)} />
                    <span className="mono">{l.code}</span>
                  </label>))}
                {!candidates.length && racks.length > 0 && <span className="xs mut">Nothing in that range.</span>}
              </div>
              <Num label="Copies per rack" value={cfg.copies} onChange={v => upd({ copies: v })} hint="2 = front and back" />
            </div>
          </div>

          <div className="card">
            <header><h3>2 · What the QR contains</h3></header>
            <div className="pad stack">
              <label className="f">QR payload
                <select className="in" value={cfg.payload} onChange={e => upd({ payload: e.target.value as RackLabelCfg["payload"] })}>
                  <option value="classic">Standard — RJLOC|F1-R01 (recommended, matches old stickers)</option>
                  <option value="plain">Plain text — prefix + code + suffix</option>
                  <option value="json">Advanced — structured JSON</option>
                </select></label>
              {cfg.payload !== "classic" && <div className="grid g2">
                <label className="f">Custom prefix<input className="in mono" placeholder="DELHI-WH1-" value={cfg.prefix} onChange={e => upd({ prefix: e.target.value })} /></label>
                <label className="f">Custom suffix<input className="in mono" placeholder="(optional)" value={cfg.suffix} onChange={e => upd({ suffix: e.target.value })} /></label>
                {cfg.payload === "json" && <label className="f" style={{ gridColumn: "1/-1" }}>Organisation ("org")<input className="in mono" value={cfg.org} onChange={e => upd({ org: e.target.value })} /></label>}
              </div>}
              <div className="rk-payload"><span className="xs mut">Scans as ({payload.length} characters):</span><code className="mono">{payload}</code></div>
              <div className="xs mut">Scan &amp; record, Stock in and Move read all three formats, with or without a prefix — so switching format never breaks scanning.</div>
            </div>
          </div>

          <div className="card">
            <header><h3>3 · Text on the sticker</h3></header>
            <div className="pad stack">
              <Switch on={cfg.showHeader} onChange={v => upd({ showHeader: v })} label="Header line" hint="e.g. RUNGNNA · RACK" />
              {cfg.showHeader && <input className="in" value={cfg.header} onFocus={() => setLastTpl("header")} onChange={e => upd({ header: e.target.value })} />}
              <label className="f">Location code (main text)
                <input className="in mono" value={cfg.primary} onFocus={() => setLastTpl("primary")} onChange={e => upd({ primary: e.target.value })} placeholder="{code}" /></label>
              <Switch on={cfg.showSecondary} onChange={v => upd({ showSecondary: v })} label="Second info line" hint="zone, category, or the rack's name" />
              {cfg.showSecondary && <input className="in" value={cfg.secondary} onFocus={() => setLastTpl("secondary")} onChange={e => upd({ secondary: e.target.value })} placeholder="{floor_name} · Main aisle" />}
              <details className="sm">
                <summary className="mut">Fields you can use — tap to add to the {lastTpl === "primary" ? "location code" : lastTpl + " line"}</summary>
                <div className="rk-vars">{TEMPLATE_VARS.map(([k, d]) => <button key={k} type="button" className="chip" onClick={() => insertVar(k)} title={d}><span className="mono">{k}</span></button>)}</div>
              </details>
              <label className="f">Font
                <select className="in" value={cfg.font} onChange={e => upd({ font: e.target.value })}>{FONTS.map(([v, n]) => <option key={v} value={v}>{n}</option>)}</select></label>
              <div className="grid g3">
                <Num label="Header size (pt)" value={raw.headerSize} onChange={v => upd({ headerSize: v })} />
                <Num label="Code size (pt)" value={raw.primarySize} onChange={v => upd({ primarySize: v })} />
                <Num label="Info size (pt)" value={raw.secondarySize} onChange={v => upd({ secondarySize: v })} />
                <label className="f">Header weight<select className="in" value={cfg.headerWeight} onChange={e => upd({ headerWeight: Number(e.target.value) as Weight })}>{WEIGHTS.map(([w, n]) => <option key={w} value={w}>{n}</option>)}</select></label>
                <label className="f">Code weight<select className="in" value={cfg.primaryWeight} onChange={e => upd({ primaryWeight: Number(e.target.value) as Weight })}>{WEIGHTS.map(([w, n]) => <option key={w} value={w}>{n}</option>)}</select></label>
              </div>
            </div>
          </div>

          <div className="card">
            <header><h3>4 · Size &amp; QR</h3>
              <div className="seg" role="group" aria-label="Units" style={{ marginLeft: "auto" }}>
                {(["mm", "in"] as Unit[]).map(u => <button key={u} aria-pressed={unit === u} onClick={() => upd({ unit: u })}>{u}</button>)}
              </div></header>
            <div className="pad stack">
              <label className="f">Sticker preset
                <select className="in" value="" onChange={e => { const p = RACK_PRESETS.find(x => x.key === e.target.value); if (p) { upd(p.cfg); setZoom(null); } }}>
                  <option value="">Choose a size…</option>{RACK_PRESETS.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
              <div className="grid g3">
                <Num label="Width" unit={unit} value={raw.w} onChange={v => upd({ w: v })} />
                <Num label="Height" unit={unit} value={raw.h} onChange={v => upd({ h: v })} />
                <Num label="Inner padding" unit={unit} value={raw.pad} onChange={v => upd({ pad: v })} />
              </div>
              <label className="f">QR size — {cfg.qrPct}% of the sticker height
                <input type="range" min={20} max={100} step={1} value={cfg.qrPct} onChange={e => upd({ qrPct: Number(e.target.value) })} /></label>
              <div className="f"><span>QR position</span>
                <div className="seg" role="group" aria-label="QR position">
                  {(["left", "center", "right"] as const).map(p => <button key={p} aria-pressed={cfg.qrPos === p} onClick={() => upd({ qrPos: p, ...(p === "center" && cfg.qrPct > 70 ? { qrPct: 60 } : {}) })}>{p[0].toUpperCase() + p.slice(1)}</button>)}
                </div></div>
              <div className={"note sm" + (moduleMm < 0.3 ? " warn" : "")}>
                QR prints {qrSide.toFixed(1)} mm wide · {modules}×{modules} dots · each dot {moduleMm.toFixed(2)} mm.
                {moduleMm < 0.3 ? " That's very fine — a handheld may struggle. Make the QR bigger or use the Standard payload (shorter = fewer dots)." : " Comfortable for phones and handheld scanners."}
              </div>
            </div>
          </div>

          <div className="card">
            <header><h3>5 · Page layout</h3>
              <div className="seg" role="group" aria-label="Media" style={{ marginLeft: "auto" }}>
                <button aria-pressed={cfg.mode === "roll"} onClick={() => { upd({ mode: "roll" }); setZoom(null); }}>Thermal roll</button>
                <button aria-pressed={cfg.mode === "sheet"} onClick={() => { upd({ mode: "sheet", rows: Math.max(cfg.rows, 2) }); setZoom(null); }}>Sticker sheet</button>
              </div></header>
            <div className="pad stack">
              {cfg.mode === "sheet" && <label className="f">Paper
                <select className="in" value={cfg.sheet} onChange={e => upd({ sheet: e.target.value as RackLabelCfg["sheet"] })}>
                  <option value="a4">A4 (210 × 297 mm)</option><option value="letter">Letter (8.5 × 11 in)</option></select></label>}
              <div className="grid g3">
                <Num label={cfg.mode === "roll" ? "Stickers across" : "Columns"} value={raw.cols} onChange={v => upd({ cols: v })} />
                {cfg.mode === "sheet" && <Num label="Rows" value={raw.rows} onChange={v => upd({ rows: v })} />}
                <Num label="Gap across" unit={unit} value={raw.gapX} onChange={v => upd({ gapX: v })} />
                {cfg.mode === "sheet" && <Num label="Gap down" unit={unit} value={raw.gapY} onChange={v => upd({ gapY: v })} />}
                {cfg.mode === "sheet" && <Num label="Top margin" unit={unit} value={raw.marginTop} onChange={v => upd({ marginTop: v })} />}
                {cfg.mode === "sheet" && <Num label="Left margin" unit={unit} value={raw.marginLeft} onChange={v => upd({ marginLeft: v })} />}
                <Num label="Nudge right" unit={unit} value={raw.offX} onChange={v => upd({ offX: v })} />
                <Num label="Nudge down" unit={unit} value={raw.offY} onChange={v => upd({ offY: v })} />
              </div>
              {overflow && <div className="note warn sm">{overflow}</div>}
              <button className="btn sm" onClick={() => { const n = { ...DEFAULT_RACK_CFG }; setRaw(n); setSetting(CFG_KEY, n); setZoom(null); }}>Reset all settings to default</button>
            </div>
          </div>
        </div>

        {/* ---------------- live preview ---------------- */}
        <div className="rk-pv-col">
          <div className="card">
            <header><h3>Live preview</h3>
              <span className="pill">{items.length} sticker{items.length === 1 ? "" : "s"} · {pages} page{pages === 1 ? "" : "s"}</span>
              <span className="grow" />
              <label className="row xs mut" style={{ gap: 6 }}>Zoom
                <input type="range" min={0.25} max={3} step={0.05} value={z} onChange={e => setZoom(Number(e.target.value))} style={{ width: 90 }} />
                <span className="mono">{Math.round(z * 100)}%</span></label>
            </header>
            <div className="rk-preview">
              <div style={{ width: pw * MM_PX * z, height: (previewPages * ph * MM_PX + (previewPages - 1) * 12) * z, margin: "0 auto" }}>
                <div style={{ width: pw + "mm", transform: `scale(${z})`, transformOrigin: "top left" }}>
                  <PrintPages cfg={cfg} items={previewItems} />
                </div>
              </div>
            </div>
            <div className="pad stack" style={{ gap: 6 }}>
              {!items.length && <div className="xs mut">Showing a sample sticker — tick some racks to preview the real ones.</div>}
              {pages > PREVIEW_PAGES && <div className="xs mut">Previewing the first {PREVIEW_PAGES} of {pages} pages.</div>}
              <div className="xs mut">Page {pw.toFixed(1)} × {ph.toFixed(1)} mm ({toUnit(pw, "in")} × {toUnit(ph, "in")} in). In the print window pick your label printer (or <b>Save as PDF</b>), margins <b>None</b>, scale <b>100%</b>. Chrome and Edge honour the exact size; in Safari set the paper size to match.</div>
              <div className="row">
                <button className="btn g grow" disabled={!items.length} onClick={print}>Generate &amp; print</button>
                <button className="btn" disabled={!items.length} onClick={print} title="Choose 'Save as PDF' as the destination">Save as PDF</button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {printing && createPortal(<>
        <style>{`@page{size:${pw}mm ${ph}mm;margin:0}html,body{margin:0!important;padding:0!important}`}</style>
        <PrintPages cfg={cfg} items={items} />
      </>, document.getElementById("printroot")!)}
    </div>
  );
}

/* Side length of the QR on paper, in mm. */
function qrSideMm(c: RackLabelCfg) {
  const uw = Math.max(1, c.w - 2 * c.pad), uh = Math.max(1, c.h - 2 * c.pad);
  return c.qrPos === "center" ? Math.min(uw, uh * c.qrPct / 100) : Math.min(uh * c.qrPct / 100, uw * 0.7);
}

/* One or more physical pages of stickers — used both for the preview and for print. */
function PrintPages({ cfg, items }: { cfg: RackLabelCfg; items: Location[] }) {
  const pp = perPage(cfg);
  const { pw, ph } = pageSize(cfg);
  const pages: Location[][] = [];
  for (let i = 0; i < items.length; i += pp) pages.push(items.slice(i, i + pp));
  const baseX = cfg.mode === "sheet" ? cfg.marginLeft : 0, baseY = cfg.mode === "sheet" ? cfg.marginTop : 0;
  return <>{pages.map((pg, i) => (
    <div key={i} className="rk-page" style={{ width: pw + "mm", height: ph + "mm" }}>
      {pg.map((l, k) => {
        const c = k % cfg.cols, r = Math.floor(k / cfg.cols);
        return (
          <div key={k} style={{ position: "absolute", left: baseX + cfg.offX + c * (cfg.w + cfg.gapX) + "mm", top: baseY + cfg.offY + r * (cfg.h + cfg.gapY) + "mm" }}>
            <Sticker cfg={cfg} loc={l} />
          </div>);
      })}
    </div>))}</>;
}

function Sticker({ cfg, loc }: { cfg: RackLabelCfg; loc: Location }) {
  const payload = payloadFor(loc, cfg);
  const svg = useMemo(() => qrSvg(payload, "Q").svg.replace("<svg ", '<svg width="100%" height="100%" '), [payload]);
  const v = varsFor(loc, cfg);
  const header = cfg.showHeader ? renderTemplate(cfg.header, v) : "";
  const primary = renderTemplate(cfg.primary, v);
  const secondary = cfg.showSecondary ? renderTemplate(cfg.secondary, v) : "";
  const q = qrSideMm(cfg);
  const center = cfg.qrPos === "center";
  return (
    <div className="rk-sticker" style={{
      width: cfg.w + "mm", height: cfg.h + "mm", padding: cfg.pad + "mm", gap: cfg.pad + "mm", fontFamily: cfg.font,
      flexDirection: center ? "column" : cfg.qrPos === "right" ? "row-reverse" : "row", textAlign: center ? "center" : "left",
    }}>
      <div className="rk-qr" style={{ width: q + "mm", height: q + "mm" }} dangerouslySetInnerHTML={{ __html: svg }} />
      <div className="rk-text" style={{ alignItems: center ? "center" : "flex-start" }}>
        {header && <div style={{ fontSize: cfg.headerSize + "pt", fontWeight: cfg.headerWeight, letterSpacing: ".08em" }}>{header}</div>}
        {primary && <div style={{ fontSize: cfg.primarySize + "pt", fontWeight: cfg.primaryWeight, letterSpacing: "-.01em" }}>{primary}</div>}
        {secondary && <div style={{ fontSize: cfg.secondarySize + "pt" }}>{secondary}</div>}
      </div>
    </div>
  );
}

/* Number input that lets you type freely ("4.", "-0.5") and shows mm or inches. */
function Num({ label, value, onChange, unit, hint }: { label: string; value: number; onChange: (v: number) => void; unit?: Unit; hint?: string }) {
  const shown = unit ? toUnit(value, unit) : value;
  const [txt, setTxt] = useState(String(shown));
  const [focus, setFocus] = useState(false);
  useEffect(() => { if (!focus) setTxt(String(shown)); }, [shown, focus]);
  return (
    <label className="f">{label}{unit ? ` (${unit})` : ""}
      <input className="in mono" inputMode="decimal" value={txt} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        onChange={e => { setTxt(e.target.value); const n = parseFloat(e.target.value); if (Number.isFinite(n)) onChange(unit ? fromUnit(n, unit) : n); }} />
      {hint && <span className="xs mut">{hint}</span>}
    </label>
  );
}
