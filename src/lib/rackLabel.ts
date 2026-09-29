import type { Location } from "./db";

/* ===========================================================================
   Rack / box QR sticker engine.

   Everything the Rack Sticker Studio needs that isn't UI: the saved settings,
   the text templates ({floor_code}-{rack_number} …), what goes INSIDE the QR,
   and — just as important — reading every one of those QR formats back when a
   sticker is scanned on Scan & record, Stock in or Move. Pure functions only
   (no DOM, no database) so they are unit-tested in tests/rackLabel.test.ts.
=========================================================================== */

/* The original rack-sticker payload. Every sticker printed before this studio
   existed carries it, and it is still the recommended default. */
export const LOC_PREFIX = "RJLOC|";

export type PayloadMode = "classic" | "plain" | "json";
export type QrPos = "left" | "center" | "right";
export type Weight = 400 | 500 | 700 | 800;
export type Unit = "mm" | "in";

export interface RackLabelCfg {
  /* --- what the QR contains --- */
  payload: PayloadMode;      // classic = RJLOC|F1-R01, plain = prefix+code+suffix, json = structured
  prefix: string;            // e.g. "DELHI-WH1-"   (plain + json id)
  suffix: string;
  org: string;               // "org" field in the JSON payload
  /* --- printed text --- */
  showHeader: boolean;
  header: string;            // template, default "RUNGNNA · RACK"
  primary: string;           // template, default "{code}"
  showSecondary: boolean;
  secondary: string;         // template, default "{name}" — the line is dropped when it renders empty
  font: string;              // CSS font-family stack
  headerSize: number;        // pt
  headerWeight: Weight;
  primarySize: number;       // pt
  primaryWeight: Weight;
  secondarySize: number;     // pt
  /* --- sticker geometry (always stored in mm) --- */
  unit: Unit;                // how the size inputs are shown
  w: number; h: number;
  pad: number;               // inner padding
  qrPct: number;             // QR side as % of the usable height (after padding)
  qrPos: QrPos;
  /* --- page layout --- */
  mode: "roll" | "sheet";
  cols: number; rows: number;        // rows only used for sheets
  gapX: number; gapY: number;
  sheet: "a4" | "letter";
  marginTop: number; marginLeft: number;   // sheet page margins
  offX: number; offY: number;              // fine nudge for printer drift
  copies: number;                          // stickers per rack
}

export const DEFAULT_RACK_CFG: RackLabelCfg = {
  payload: "classic", prefix: "", suffix: "", org: "RUNGNNA",
  showHeader: true, header: "RUNGNNA · RACK", primary: "{code}", showSecondary: true, secondary: "{name}",
  font: "Arial, Helvetica, sans-serif", headerSize: 7, headerWeight: 500, primarySize: 15, primaryWeight: 800, secondarySize: 7,
  unit: "mm", w: 50, h: 25, pad: 1.5, qrPct: 100, qrPos: "left",
  mode: "roll", cols: 1, rows: 1, gapX: 2, gapY: 0, sheet: "a4", marginTop: 10, marginLeft: 8, offX: 0, offY: 0, copies: 1,
};

export const RACK_PRESETS: { key: string; name: string; cfg: Partial<RackLabelCfg> }[] = [
  { key: "50x25", name: "50 × 25 mm roll (current)", cfg: { mode: "roll", w: 50, h: 25, cols: 1, qrPct: 100, qrPos: "left", primarySize: 15 } },
  { key: "38x25", name: "38 × 25 mm roll", cfg: { mode: "roll", w: 38, h: 25, cols: 1, qrPct: 100, qrPos: "left", primarySize: 11 } },
  { key: "60x40", name: "60 × 40 mm roll", cfg: { mode: "roll", w: 60, h: 40, cols: 1, qrPct: 100, qrPos: "left", primarySize: 18 } },
  { key: "4x2", name: '4" × 2" roll (101.6 × 50.8 mm)', cfg: { mode: "roll", w: 101.6, h: 50.8, cols: 1, qrPct: 100, qrPos: "left", unit: "in", primarySize: 28, headerSize: 11, secondarySize: 11 } },
  { key: "100x50", name: "100 × 50 mm roll", cfg: { mode: "roll", w: 100, h: 50, cols: 1, qrPct: 100, qrPos: "left", primarySize: 28, headerSize: 11, secondarySize: 11 } },
  { key: "2up", name: "2-up 50 × 25 mm roll (104 mm wide)", cfg: { mode: "roll", w: 50, h: 25, cols: 2, gapX: 4, qrPct: 100, qrPos: "left", primarySize: 15 } },
  { key: "a4-3x8", name: "A4 sheet · 3 × 8 (70 × 37 mm)", cfg: { mode: "sheet", sheet: "a4", w: 70, h: 37, cols: 3, rows: 8, gapX: 0, gapY: 0, marginTop: 0.5, marginLeft: 0, primarySize: 18 } },
  { key: "a4-2x7", name: "A4 sheet · 2 × 7 (99 × 38 mm)", cfg: { mode: "sheet", sheet: "a4", w: 99.1, h: 38.1, cols: 2, rows: 7, gapX: 2.5, gapY: 0, marginTop: 15, marginLeft: 4.7, primarySize: 22 } },
  { key: "letter-2x5", name: 'Letter sheet · 2 × 5 (4" × 2")', cfg: { mode: "sheet", sheet: "letter", w: 101.6, h: 50.8, cols: 2, rows: 5, gapX: 4.8, gapY: 0, marginTop: 12.7, marginLeft: 4, unit: "in", primarySize: 28 } },
];

export const SHEETS = { a4: { w: 210, h: 297 }, letter: { w: 215.9, h: 279.4 } } as const;

export const FONTS: [string, string][] = [
  ["Arial, Helvetica, sans-serif", "Arial"],
  ["Helvetica, Arial, sans-serif", "Helvetica"],
  ["Verdana, Geneva, sans-serif", "Verdana"],
  ["Tahoma, Geneva, sans-serif", "Tahoma"],
  ["'Trebuchet MS', sans-serif", "Trebuchet"],
  ["Georgia, serif", "Georgia"],
  ["'Courier New', Courier, monospace", "Courier (mono)"],
  ["Impact, 'Arial Black', sans-serif", "Impact (heavy)"],
];

export const MM_PER_IN = 25.4;
export const toUnit = (mm: number, u: Unit) => (u === "in" ? +(mm / MM_PER_IN).toFixed(3) : +mm.toFixed(2));
export const fromUnit = (v: number, u: Unit) => (u === "in" ? v * MM_PER_IN : v);

/* Merge saved settings over the defaults and clamp anything that would make an
   unprintable sticker (a hand-edited or old saved value must never break print). */
export function normalizeCfg(c?: Partial<RackLabelCfg> | null): RackLabelCfg {
  const x = { ...DEFAULT_RACK_CFG, ...(c || {}) };
  const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  const D = DEFAULT_RACK_CFG;
  return {
    ...x,
    payload: (["classic", "plain", "json"] as const).includes(x.payload) ? x.payload : "classic",
    qrPos: (["left", "center", "right"] as const).includes(x.qrPos) ? x.qrPos : "left",
    mode: x.mode === "sheet" ? "sheet" : "roll",
    sheet: x.sheet === "letter" ? "letter" : "a4",
    unit: x.unit === "in" ? "in" : "mm",
    // ~ and | are the product-label separators; keeping them out of rack codes is
    // what lets a scan tell a rack sticker from a product label with certainty.
    prefix: String(x.prefix ?? "").replace(/[~|]/g, "-"), suffix: String(x.suffix ?? "").replace(/[~|]/g, "-"), org: String(x.org ?? "RUNGNNA"),
    w: num(x.w, D.w, 10, 300), h: num(x.h, D.h, 8, 300), pad: num(x.pad, D.pad, 0, 20),
    qrPct: num(x.qrPct, D.qrPct, 20, 100),
    headerSize: num(x.headerSize, D.headerSize, 3, 72), primarySize: num(x.primarySize, D.primarySize, 3, 120), secondarySize: num(x.secondarySize, D.secondarySize, 3, 72),
    cols: Math.round(num(x.cols, 1, 1, 10)), rows: Math.round(num(x.rows, 1, 1, 40)),
    gapX: num(x.gapX, 0, 0, 50), gapY: num(x.gapY, 0, 0, 50),
    marginTop: num(x.marginTop, 0, 0, 60), marginLeft: num(x.marginLeft, 0, 0, 60),
    offX: num(x.offX, 0, -20, 20), offY: num(x.offY, 0, -20, 20),
    copies: Math.round(num(x.copies, 1, 1, 20)),
  };
}

/* ---------------- templating ---------------- */

export const floorLabel = (f: string) => (f === "G" ? "Ground" : f === "GD" ? "Godown" : "Floor " + f);
const floorCode = (f: string) => (f === "G" ? "G" : f === "GD" ? "GD" : "F" + f);

export type RackVars = Record<string, string>;
export function varsFor(l: Pick<Location, "code" | "floor" | "rack" | "box" | "name">, cfg: Pick<RackLabelCfg, "org">): RackVars {
  return {
    code: l.code,
    floor: l.floor,
    floor_code: floorCode(l.floor),
    floor_name: floorLabel(l.floor),
    rack: l.rack || "",
    rack_number: l.rack ? "R" + l.rack.padStart(2, "0") : "",
    box: l.box || "",
    box_number: l.box ? "B" + l.box.padStart(2, "0") : "",
    name: l.name || "",
    org: cfg.org || "",
  };
}

/* The variables Karan can type into any text field, for the help list. */
export const TEMPLATE_VARS: [string, string][] = [
  ["{code}", "full code, e.g. F1-R01-B02"],
  ["{floor_code}", "F1 / G / GD"],
  ["{floor_name}", "Floor 1 / Ground"],
  ["{floor}", "1 / G"],
  ["{rack_number}", "R01"],
  ["{rack}", "1"],
  ["{box_number}", "B02"],
  ["{box}", "2"],
  ["{name}", "the rack's name (Bridal wall…)"],
  ["{org}", "organisation from the payload settings"],
];

/* Replace {vars}; unknown {things} are left as typed. Joiners (-, ·, /, |) left
   dangling by an empty variable are tidied, so "{floor_code}-{box_number}"
   on a rack with no box prints "F1", not "F1-". */
export function renderTemplate(tpl: string, vars: RackVars): string {
  const out = (tpl || "").replace(/\{([a-z_]+)\}/gi, (m, k: string) => (k.toLowerCase() in vars ? vars[k.toLowerCase()] : m));
  return out
    .replace(/\s*([-·/|])\s*(?=[-·/|]|$)/g, "")
    .replace(/^\s*[-·/|]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/* ---------------- QR payload ---------------- */

export function payloadFor(l: Pick<Location, "code" | "floor" | "rack" | "box" | "name">, cfg: Pick<RackLabelCfg, "payload" | "prefix" | "suffix" | "org">): string {
  const id = `${cfg.prefix || ""}${l.code}${cfg.suffix || ""}`;
  if (cfg.payload === "classic") return LOC_PREFIX + l.code;
  if (cfg.payload === "plain") return id;
  const floor = /^\d+$/.test(l.floor) ? Number(l.floor) : l.floor;
  const obj: Record<string, unknown> = { org: cfg.org || "RUNGNNA", type: l.box ? "BOX" : "RACK", floor };
  if (l.rack) obj.rack = "R" + l.rack.padStart(2, "0");
  if (l.box) obj.box = "B" + l.box.padStart(2, "0");
  obj.id = id;
  return JSON.stringify(obj);
}

/* ---------------- reading a scanned sticker back ---------------- */

type Loc = Pick<Location, "id" | "code" | "kind">;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/* Given whatever a scanner read, return the rack/box it points at — or null if
   it isn't a rack sticker (then the caller treats it as a product label).
   Recognises every format the studio can print, on any device, without needing
   this device's saved settings:
     • classic   RJLOC|F1-R01
     • json      {"type":"RACK",…,"id":"DELHI-WH1-F1-R01"}
     • plain     F1-R01, or with any prefix/suffix: DELHI-WH1-F1-R01-A
   The loose (prefix/suffix) match only accepts real rack-shaped codes and never
   fires on product labels (which carry ~ or | separators), so a product scan can
   never be mistaken for a rack. */
export function parseRackScan<T extends Loc>(raw: string, locs: T[]): T | null {
  const r = (raw || "").trim();
  if (!r) return null;
  const byCode = (c: string) => locs.find(l => l.code.toUpperCase() === c.toUpperCase()) || null;

  if (r.startsWith(LOC_PREFIX)) return byCode(r.slice(LOC_PREFIX.length));

  if (r.startsWith("{")) {
    try {
      const j = JSON.parse(r);
      const t = String(j?.type || "").toUpperCase();
      if (j && (t === "RACK" || t === "BOX" || t === "LOCATION")) {
        const id = String(j.id ?? j.code ?? "");
        return byCode(id) || looseMatch(id, locs);
      }
    } catch { /* not JSON — fall through */ }
    return null;
  }

  if (r.includes("~") || r.includes("|")) return null; // product-label formats
  return byCode(r) || looseMatch(r, locs);
}

function looseMatch<T extends Loc>(s: string, locs: T[]): T | null {
  const up = s.toUpperCase();
  let best: T | null = null;
  for (const l of locs) {
    if (l.kind === "bucket") continue;
    const code = l.code.toUpperCase();
    if (!/^(G|GD|F\d+)-R\d+/.test(code)) continue; // only real rack/box codes
    // code must stand as its own token: not glued to letters/digits on either side
    const re = new RegExp(`(^|[^A-Z0-9])${esc(code)}($|[^A-Z0-9])`);
    if (re.test(up) && (!best || code.length > best.code.length)) best = l; // longest wins: F1-R01-B02 over F1-R01
  }
  return best;
}

/* ---------------- selection helpers ---------------- */

export const FLOOR_ORDER = ["G", "1", "2", "3", "4", "5", "GD"];
export const floorRank = (f: string) => { const i = FLOOR_ORDER.indexOf(f); return i < 0 ? 50 + (parseInt(f) || 0) : i; };

export function sortLocs<T extends Pick<Location, "floor" | "rack" | "box" | "code">>(list: T[]): T[] {
  return [...list].sort((a, b) =>
    floorRank(a.floor) - floorRank(b.floor) ||
    (parseInt(a.rack) || 0) - (parseInt(b.rack) || 0) ||
    (parseInt(a.box) || 0) - (parseInt(b.box) || 0) ||
    a.code.localeCompare(b.code));
}

/* Stickers per printed page, for the "N stickers → M pages" summary. */
export function perPage(cfg: Pick<RackLabelCfg, "mode" | "cols" | "rows">): number {
  return cfg.mode === "roll" ? cfg.cols : cfg.cols * cfg.rows;
}

/* Warn when a sheet layout physically overflows its paper. */
export function sheetOverflow(cfg: RackLabelCfg): string | null {
  if (cfg.mode !== "sheet") return null;
  const s = SHEETS[cfg.sheet];
  const needW = cfg.marginLeft + cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
  const needH = cfg.marginTop + cfg.rows * cfg.h + (cfg.rows - 1) * cfg.gapY;
  const over: string[] = [];
  if (needW > s.w + 0.01) over.push(`width needs ${needW.toFixed(1)} mm of ${s.w} mm`);
  if (needH > s.h + 0.01) over.push(`height needs ${needH.toFixed(1)} mm of ${s.h} mm`);
  return over.length ? "Doesn't fit the page — " + over.join(", ") + ". Reduce columns/rows, size or margins." : null;
}
