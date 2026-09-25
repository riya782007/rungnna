/* Label decoder.
   Reads whatever an old or new label carries and turns it into product fields.
   Order of attempts:
     1. Our own QR  (RJ1|code|item|type|style|color|tk|rate)
     2. JSON        ({"item":"CHAIN","style":"K5209/59SH",…})
     3. URL         (…?style=K5209&rate=96)
     4. key:value   ("ITEM:CHAIN STYLE:K5209/59SH RATE:96" — any separator)
     5. a taught positional pattern (the owner maps the pieces once, saved)
     6. a single token → treated as a code to look up (and as the style guess)  */

export const FIELDS = ["item", "type", "style", "color", "tk", "rate", "mrp", "code", "qty", "icode", "ref"] as const;
export type Field = (typeof FIELDS)[number];
export type Parsed = Partial<Record<Field, string>> & { raw: string; how: string; tokens: string[] };

export interface Pattern {
  id: string;
  name: string;
  sep: string;                 // the separator, e.g. "|" "," ";" "\t" " " "~" "*" "#"
  count: number;               // how many pieces a matching label splits into
  prefix: string;              // optional literal the text must start with
  map: (Field | "")[];         // field for each position ("" = ignore)
  rateDiv: number;             // 1 if the label says rupees, 100 if it already says paise
}

export const OWN_PREFIX = "RJ1";

const ALIASES: Record<string, Field> = {
  item: "item", itm: "item", product: "item", name: "item", category: "item",
  type: "type", unit: "type", uom: "type",
  style: "style", sty: "style", design: "style", art: "style", artno: "style", "art no": "style", sku: "style", model: "style",
  color: "color", colour: "color", col: "color", clr: "color",
  tk: "tk", tkt: "tk", tag: "tk", tok: "tk",
  rate: "rate", price: "rate", rs: "rate", sp: "rate", "sale rate": "rate", srate: "rate",
  mrp: "mrp",
  code: "code", barcode: "code", id: "code", bc: "code",
  qty: "qty", quantity: "qty", pcs: "qty",
};

const SEPS = ["|", "\t", ";", ",", "~", "^", "*", "#", "\n"];

export function splitTokens(raw: string, sep?: string): string[] {
  const s = sep ?? guessSep(raw);
  if (!s) return [raw.trim()];
  return raw.split(s === "\\s" ? /\s+/ : s).map(t => t.trim());
}

export function guessSep(raw: string): string {
  let best = "", n = 0;
  for (const s of SEPS) { const c = raw.split(s).length - 1; if (c > n) { n = c; best = s; } }
  if (!best && /\s/.test(raw.trim())) return "\\s";
  return best;
}

const clean = (v: unknown) => String(v ?? "").trim();
const num = (v: string) => { const m = v.replace(/[, ₹]/g, "").match(/-?\d+(\.\d+)?/); return m ? m[0] : ""; };

export function parseLabel(rawIn: string, patterns: Pattern[] = []): Parsed {
  const raw = rawIn.replace(/\r/g, "").replace(/[\u0000-\u0008\u000b\u001d\u001e]/g, "").trim();
  const base: Parsed = { raw, how: "code", tokens: [raw] };
  if (!raw) return base;

  // 1. our own QR
  if (raw.startsWith(OWN_PREFIX + "|")) {
    const t = raw.split("|");
    const [, code, item, type, style, color, tk, rate] = t;
    return { raw, how: "rungnna", tokens: t, code, item, type, style, color, tk, rate: num(rate || "") };
  }

  // 1b. the shop's existing labels (old billing software):
  //     ITEMCODE~RATE~PACKQTY~REF~TK~STYLE~COLOR   e.g. 202~24~12~183~~K5208/K-LT~W/LP/B
  //     printed as  F-RING / K5208/K-LT / W/LP/B / ₹24X12PCS
  const tl = raw.split("~");
  if (tl.length === 7 && /^\d+$/.test(tl[0].trim()) && tl[5].trim()) {
    const [icode, rate, qty, ref, tk, style, color] = tl.map(t => t.trim());
    return { raw, how: "shop label", tokens: tl, icode, rate: num(rate), qty: num(qty), ref, tk, style, color };
  }

  // 2. JSON
  if (/^[\[{]/.test(raw)) {
    try {
      const j = JSON.parse(raw);
      const o = Array.isArray(j) ? j[0] : j;
      if (o && typeof o === "object") {
        const out: Parsed = { raw, how: "json", tokens: Object.values(o).map(clean) };
        for (const [k, v] of Object.entries(o)) {
          const f = ALIASES[k.toLowerCase().trim()]; if (f) out[f] = clean(v);
        }
        if (out.rate) out.rate = num(out.rate);
        return out;
      }
    } catch { /* not JSON */ }
  }

  // 3. URL with query
  if (/^https?:\/\//i.test(raw)) {
    try {
      const u = new URL(raw); const out: Parsed = { raw, how: "url", tokens: [] };
      u.searchParams.forEach((v, k) => { out.tokens.push(v); const f = ALIASES[k.toLowerCase()]; if (f) out[f] = v; });
      if (!out.style && !out.code) out.code = u.pathname.split("/").filter(Boolean).pop() || "";
      if (out.rate) out.rate = num(out.rate);
      return out;
    } catch { /* not a URL */ }
  }

  // 4. key:value / key=value pairs (keys we recognise)
  const kv = [...raw.matchAll(/([A-Za-z][A-Za-z .]{0,11}?)\s*[:=]\s*([^|;,\n\t:=]+?)(?=\s+[A-Za-z][A-Za-z .]{0,11}?\s*[:=]|[|;,\n\t]|$)/g)];
  const hits = kv.filter(m => ALIASES[m[1].toLowerCase().trim()]);
  if (hits.length >= 2) {
    const out: Parsed = { raw, how: "keys", tokens: hits.map(m => m[2].trim()) };
    for (const m of hits) out[ALIASES[m[1].toLowerCase().trim()]] = m[2].trim();
    if (out.rate) out.rate = num(out.rate);
    if (out.mrp) out.mrp = num(out.mrp);
    return out;
  }

  // 5. taught patterns
  for (const p of patterns) {
    if (p.prefix && !raw.startsWith(p.prefix)) continue;
    const body = p.prefix ? raw.slice(p.prefix.length) : raw;
    const t = splitTokens(body, p.sep);
    if (t.length !== p.count) continue;
    const out: Parsed = { raw, how: "pattern:" + p.name, tokens: t };
    p.map.forEach((f, i) => { if (f) out[f] = t[i]; });
    if (out.rate) { const r = Number(num(out.rate)); out.rate = r ? String(r / (p.rateDiv || 1)) : ""; }
    if (out.mrp) { const r = Number(num(out.mrp)); out.mrp = r ? String(r / (p.rateDiv || 1)) : ""; }
    return out;
  }

  // 6. multi-piece but unknown → hand back pieces so the owner can teach it once
  const toks = splitTokens(raw);
  if (toks.length > 1) return { raw, how: "unknown", tokens: toks };

  // single token: a plain code (old 1D barcodes usually carry just an item number)
  return { raw, how: "code", tokens: [raw], code: raw };
}

/* What our new labels encode. Short on purpose so the QR stays small and scans fast. */
export function ownPayload(p: { code: string; item: string; type: string; style: string; color: string; tk: string; rate: number; item_code?: string; pack?: number; ref?: string }, format: "shop" | "rungnna" = "shop") {
  // Same layout as the old software whenever we know the item code, so both systems can read new labels.
  if (format === "shop" && p.item_code && p.style) {
    const c = (v: string) => (v || "").replace(/~/g, "-").trim();
    return [c(p.item_code), p.rate ? String(Math.round(p.rate) / 100) : "0", String(p.pack || 1), c(p.ref || ""), c(p.tk), c(p.style), c(p.color)].join("~");
  }
  const s = (v: string) => (v || "").replace(/\|/g, "/").trim();
  return [OWN_PREFIX, s(p.code), s(p.item), s(p.type), s(p.style), s(p.color), s(p.tk), p.rate ? String(Math.round(p.rate) / 100) : ""].join("|");
}

/* A short, unique, human-typeable code. Device letter + time base36 keeps it collision-free offline. */
export function newCode(device: string) {
  const t = Date.now().toString(36).toUpperCase().slice(-6);
  const r = Math.floor(Math.random() * 36).toString(36).toUpperCase();
  return "R" + device.slice(1, 3) + t + r;
}
