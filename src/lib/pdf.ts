/* A small PDF writer (works offline): A4 pages.
   Words are set in embedded Noto Sans (Latin, ₹) and Noto Sans Devanagari (Hindi), shaped with fontkit so
   conjuncts and vowel signs come out right. Only the glyphs actually used are embedded, so files stay small.
   Courier (a built-in PDF font) is still used for figure columns.
   The fonts load once (loadPdfFonts) and are cached by the service worker. If they are not available the
   writer falls back to the built-in Helvetica with Latin-only text (₹ becomes "Rs.", other scripts "?"),
   which is always readable — never garbled bytes. */

const W = 595.28, H = 841.89;
type Font = "F1" | "F2" | "F3"; // regular, bold, Courier (figures)

export function pdfSafe(s: string) {
  return String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...");
}

/* ---------------------------------------------------------------- fonts */
type FK = {
  unitsPerEm: number; ascent: number; descent: number; capHeight: number;
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
  hasGlyphForCodePoint(cp: number): boolean;
  layout(s: string): { glyphs: any[]; positions: { xAdvance: number; xOffset: number; yOffset: number }[]; advanceWidth: number };
  createSubset(): { includeGlyph(g: any): number; encode(): Uint8Array };
};
type FontKey = "sans" | "sansBold" | "deva" | "devaBold";
type Fonts = Record<FontKey, FK>;
const FILES: Record<FontKey, string> = {
  sans: "NotoSans-Regular.subset.ttf", sansBold: "NotoSans-Bold.subset.ttf",
  deva: "NotoSansDevanagari-Regular.subset.ttf", devaBold: "NotoSansDevanagari-Bold.subset.ttf",
};
const TAG: Record<FontKey, string> = { sans: "AAAAAA", sansBold: "AAAAAB", deva: "AAAAAC", devaBold: "AAAAAD" };
const NAME: Record<FontKey, string> = { sans: "NotoSans", sansBold: "NotoSans-Bold", deva: "NotoSansDevanagari", devaBold: "NotoSansDevanagari-Bold" };
let fonts: Fonts | null = null;
let loading: Promise<boolean> | null = null;

export const pdfFontsLoaded = () => !!fonts;

/** Give the writer the four font files as bytes (tests, or anything that already has them). */
export async function setPdfFonts(d: Record<FontKey, Uint8Array>) {
  const fk: any = await import("fontkit");
  const create = fk.create ?? fk.default?.create;
  const next = {} as Fonts;
  (Object.keys(FILES) as FontKey[]).forEach(k => { next[k] = create(d[k]) as FK; });
  fonts = next;
}

/** Fetch the fonts shipped in /fonts once. Resolves false (and the writer uses its basic fonts) if they can't be loaded. */
export function loadPdfFonts(base = ((import.meta as any).env?.BASE_URL || "/") + "fonts/"): Promise<boolean> {
  if (fonts) return Promise.resolve(true);
  if (!loading) {
    loading = (async () => {
      try {
        const keys = Object.keys(FILES) as FontKey[];
        const bytes = await Promise.all(keys.map(async k => {
          const r = await fetch(base + FILES[k]);
          if (!r.ok) throw new Error(`font ${FILES[k]}: HTTP ${r.status}`);
          return new Uint8Array(await r.arrayBuffer());
        }));
        await setPdfFonts(Object.fromEntries(keys.map((k, i) => [k, bytes[i]])) as Record<FontKey, Uint8Array>);
        return true;
      } catch (e) { console.warn("PDF fonts unavailable, using basic fonts", e); return false; }
      finally { loading = null; }
    })();
  }
  return loading;
}

/* ---------------------------------------------------------------- text helpers */
const DEV = /[ऀ-ॿ᳐-᳹‌‍꣠-ꣿ]/;
const LAT = /[A-Za-z0-9À-ɏ₹]/;
/* Split into runs of one script. Spaces, punctuation and signs join the run before them. */
function scriptRuns(s: string) {
  const out: { dev: boolean; text: string }[] = [];
  let cur = null as boolean | null, buf = "";
  for (const ch of s) {
    const d: boolean = DEV.test(ch) ? true : LAT.test(ch) ? false : cur ?? false;
    if (cur !== null && d !== cur) { out.push({ dev: cur, text: buf }); buf = ""; }
    cur = d; buf += ch;
  }
  if (buf) out.push({ dev: cur ?? false, text: buf });
  return out;
}
/* A character the font cannot draw becomes "?" rather than an empty box. */
const drawable = (f: FK, text: string) => [...text].map(ch => (f.hasGlyphForCodePoint(ch.codePointAt(0)!) ? ch : "?")).join("");
/* Text for the built-in fonts: Latin-1 only. */
const basic = (s: string) => pdfSafe(s).replace(/₹/g, "Rs.").replace(/[^\u0000-ÿ]/g, "?");
const fontFor = (dev: boolean, bold: boolean): FontKey => (dev ? (bold ? "devaBold" : "deva") : bold ? "sansBold" : "sans");

/* Helvetica advance widths (per 1000 em) for printable ASCII — used when the embedded fonts are not loaded */
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];

export function textWidth(s: string, size: number, font: Font = "F1") {
  if (font === "F3") return basic(s).length * 0.6 * size;
  if (fonts) {
    let w = 0;
    for (const r of scriptRuns(pdfSafe(s))) {
      const f = fonts[fontFor(r.dev, font === "F2")];
      w += (f.layout(drawable(f, r.text)).advanceWidth * size) / f.unitsPerEm;
    }
    return w;
  }
  const t = basic(s);
  let w = 0; for (const ch of t) w += HW[ch.charCodeAt(0) - 32] ?? 556;
  return (w / 1000) * size * (font === "F2" ? 1.05 : 1);
}
const graphemes = (t: string): string[] => {
  const Seg = (Intl as any).Segmenter;
  return Seg ? Array.from(new Seg(undefined, { granularity: "grapheme" }).segment(t), (x: any) => x.segment as string) : Array.from(t);
};
export function fit(s: string, max: number, size: number, font: Font = "F1") {
  let t = pdfSafe(s);
  if (textWidth(t, size, font) <= max) return t;
  const g = graphemes(t);
  while (g.length > 1 && textWidth(g.join("") + "...", size, font) > max) g.pop();
  return g.join("") + "...";
}

/* ---------------------------------------------------------------- writer */
const hex2 = (n: number) => n.toString(16).padStart(4, "0");
const utf16 = (cps: number[]) => cps.map(cp => {
  if (cp > 0xffff) { const u = cp - 0x10000; return hex2(0xd800 + (u >> 10)) + hex2(0xdc00 + (u & 1023)); }
  return hex2(cp);
}).join("");
const enc = new TextEncoder();

type Used = { key: FontKey; res: string; font: FK; subset: ReturnType<FK["createSubset"]>; uni: Map<number, number[]>; adv: Map<number, number> };

export class Pdf {
  readonly width = W; readonly height = H;
  private pages: string[] = [];
  private cur: string[] = [];
  private used = new Map<FontKey, Used>();
  constructor() { this.addPage(); }
  addPage() { if (this.cur.length || this.pages.length) this.pages.push(this.cur.join("\n")); this.cur = []; return this; }

  private use(key: FontKey): Used {
    let u = this.used.get(key);
    if (!u) {
      const font = fonts![key];
      u = { key, res: "E" + (this.used.size + 1), font, subset: font.createSubset(), uni: new Map(), adv: new Map() };
      this.used.set(key, u);
    }
    return u;
  }

  /** y is measured from the TOP of the page (like the screen), in points */
  text(x: number, y: number, s: string, o: { size?: number; font?: Font; align?: "left" | "right" | "center"; gray?: number } = {}) {
    const size = o.size ?? 10, font = o.font ?? "F1";
    const w = o.align && o.align !== "left" ? textWidth(s, size, font) : 0;
    const x0 = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    const by = H - y;
    const gray = o.gray !== undefined ? o.gray.toFixed(2) + " g " : "";
    const reset = o.gray !== undefined ? " 0 g" : "";
    if (font === "F3" || !fonts) {
      const t = basic(s);
      const hex = "<" + [...t].map(ch => ch.charCodeAt(0).toString(16).padStart(2, "0")).join("") + ">";
      this.cur.push(`${gray}BT /${font} ${size} Tf ${x0.toFixed(2)} ${by.toFixed(2)} Td ${hex} Tj ET${reset}`);
      return this;
    }
    const ops: string[] = [];
    let pen = 0;
    for (const r of scriptRuns(pdfSafe(s))) {
      const u = this.use(fontFor(r.dev, font === "F2"));
      const run = u.font.layout(drawable(u.font, r.text));
      const sc = size / u.font.unitsPerEm;
      ops.push(`/${u.res} ${size} Tf`);
      run.glyphs.forEach((g, i) => {
        const p = run.positions[i];
        const gid = u.subset.includeGlyph(g);
        if (!u.uni.has(gid)) { u.uni.set(gid, g.codePoints || []); u.adv.set(gid, g.advanceWidth); }
        ops.push(`1 0 0 1 ${(x0 + pen + p.xOffset * sc).toFixed(2)} ${(by + p.yOffset * sc).toFixed(2)} Tm <${hex2(gid)}> Tj`);
        pen += p.xAdvance * sc;
      });
    }
    this.cur.push(`${gray}BT ${ops.join(" ")} ET${reset}`);
    return this;
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5, gray = 0.75) {
    this.cur.push(`${gray.toFixed(2)} G ${width} w ${x1.toFixed(2)} ${(H - y1).toFixed(2)} m ${x2.toFixed(2)} ${(H - y2).toFixed(2)} l S 0 G`);
    return this;
  }
  rect(x: number, y: number, w: number, h: number, gray = 0.95) {
    this.cur.push(`${gray.toFixed(2)} g ${x.toFixed(2)} ${(H - y - h).toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re f 0 g`);
    return this;
  }
  get pageCount() { return this.pages.length + 1; }

  bytes(): Uint8Array {
    const pages = [...this.pages, this.cur.join("\n")];
    const bodies: (string | { dict: string; data: Uint8Array })[] = [];
    const add = (b: string | { dict: string; data: Uint8Array }) => { bodies.push(b); return bodies.length; };
    const catalog = add(""), pagesId = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
    const fontRes = [`/F1 ${f1} 0 R`, `/F2 ${f2} 0 R`, `/F3 ${f3} 0 R`];

    for (const u of this.used.values()) {
      const upem = u.font.unitsPerEm, k = (v: number) => Math.round((v * 1000) / upem);
      const gids = [...u.adv.keys()].sort((a, b) => a - b);
      const ttf = u.subset.encode();                       // after every glyph has been included
      const file = add({ dict: `/Length1 ${ttf.length}`, data: ttf });
      const base = `${TAG[u.key]}+${NAME[u.key]}`;
      const bb = u.font.bbox;
      const desc = add(`<< /Type /FontDescriptor /FontName /${base} /Flags 4 /FontBBox [${k(bb.minX)} ${k(bb.minY)} ${k(bb.maxX)} ${k(bb.maxY)}] /ItalicAngle 0 /Ascent ${k(u.font.ascent)} /Descent ${k(u.font.descent)} /CapHeight ${k(u.font.capHeight || u.font.ascent * 0.7)} /StemV ${u.key.endsWith("Bold") ? 140 : 80} /FontFile2 ${file} 0 R >>`);
      const widths = gids.map(g => `${g} [${k(u.adv.get(g)!)}]`).join(" ");
      const cid = add(`<< /Type /Font /Subtype /CIDFontType2 /BaseFont /${base} /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${desc} 0 R /CIDToGIDMap /Identity /DW 1000 /W [${widths}] >>`);
      const entries = gids.filter(g => u.uni.get(g)?.length).map(g => `<${hex2(g)}> <${utf16(u.uni.get(g)!)}>`);
      let cmap = "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<0000> <FFFF>\nendcodespacerange\n";
      for (let i = 0; i < entries.length; i += 100) { const part = entries.slice(i, i + 100); cmap += `${part.length} beginbfchar\n${part.join("\n")}\nendbfchar\n`; }
      cmap += "endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend";
      const tou = add({ dict: "", data: enc.encode(cmap) });
      const t0 = add(`<< /Type /Font /Subtype /Type0 /BaseFont /${base} /Encoding /Identity-H /DescendantFonts [${cid} 0 R] /ToUnicode ${tou} 0 R >>`);
      fontRes.push(`/${u.res} ${t0} 0 R`);
    }

    const kids: number[] = [];
    for (const content of pages) {
      const c = add({ dict: "", data: enc.encode(content) });
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << ${fontRes.join(" ")} >> >> /Contents ${c} 0 R >>`));
    }
    bodies[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    bodies[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(x => x + " 0 R").join(" ")}] /Count ${kids.length} >>`;

    const chunks: Uint8Array[] = []; let len = 0;
    const put = (b: string | Uint8Array) => { const u8 = typeof b === "string" ? enc.encode(b) : b; chunks.push(u8); len += u8.length; };
    put("%PDF-1.4\n");
    const offs: number[] = [];
    bodies.forEach((b, i) => {
      offs.push(len);
      if (typeof b === "string") put(`${i + 1} 0 obj\n${b}\nendobj\n`);
      else { put(`${i + 1} 0 obj\n<< /Length ${b.data.length} ${b.dict} >>\nstream\n`); put(b.data); put("\nendstream\nendobj\n"); }
    });
    const xref = len;
    put(`xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join(""));
    put(`trailer\n<< /Size ${bodies.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
    const out = new Uint8Array(len); let p = 0;
    for (const c of chunks) { out.set(c, p); p += c.length; }
    return out;
  }
}

/* Share a PDF: the phone's share sheet (pick WhatsApp) when it can take files, otherwise download it. */
export async function sharePdf(bytes: Uint8Array, name: string, text = ""): Promise<"shared" | "downloaded" | "cancelled"> {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const file = new File([blob], name, { type: "application/pdf" });
  const nav = navigator as any;
  try { if (nav.canShare?.({ files: [file] })) { await nav.share({ files: [file], text }); return "shared"; } }
  catch (e: any) { if (e?.name === "AbortError") return "cancelled"; }
  downloadPdf(bytes, name);
  return "downloaded";
}
export function downloadPdf(bytes: Uint8Array, name: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/** Tests only: forget the loaded fonts so the next document uses the basic fallback. */
export async function resetPdfFontsForTest() { fonts = null; loading = null; }
