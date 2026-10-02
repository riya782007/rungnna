/* A tiny PDF writer (no library, works offline): A4 pages, Helvetica for words, Courier for figures so
   amounts line up and right-align exactly. Text is emitted as UTF-16BE PDF strings, so ₹ and Hindi names
   are preserved instead of being rewritten to "Rs." or "?". */

const W = 595.28, H = 841.89;
type Font = "F1" | "F2" | "F3"; // Helvetica, Helvetica-Bold, Courier

export function pdfSafe(s: string) {
  return String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, "...");
}
const hexText = (s: string) => {
  const bytes = [0xfe, 0xff];
  for (const ch of pdfSafe(s)) {
    const cp = ch.codePointAt(0)!;
    if (cp > 0xffff) { const u = cp - 0x10000; const hi = 0xd800 + (u >> 10), lo = 0xdc00 + (u & 1023); bytes.push(hi >> 8, hi & 255, lo >> 8, lo & 255); }
    else bytes.push(cp >> 8, cp & 255);
  }
  return "<" + bytes.map(b => b.toString(16).padStart(2, "0")).join("") + ">";
};

/* Helvetica advance widths (per 1000 em) for printable ASCII, so text can be measured and truncated */
const HW = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
export function textWidth(s: string, size: number, font: Font = "F1") {
  const t = pdfSafe(s);
  if (font === "F3") return t.length * 0.6 * size;
  let w = 0; for (const ch of t) w += HW[ch.charCodeAt(0) - 32] ?? 556;
  return (w / 1000) * size * (font === "F2" ? 1.05 : 1);
}
export function fit(s: string, max: number, size: number, font: Font = "F1") {
  let t = pdfSafe(s);
  if (textWidth(t, size, font) <= max) return t;
  while (t.length > 1 && textWidth(t + "...", size, font) > max) t = t.slice(0, -1);
  return t + "...";
}

export class Pdf {
  readonly width = W; readonly height = H;
  private pages: string[] = [];
  private cur: string[] = [];
  constructor() { this.addPage(); }
  addPage() { if (this.cur.length || this.pages.length) this.pages.push(this.cur.join("\n")); this.cur = []; return this; }
  /** y is measured from the TOP of the page (like the screen), in points */
  text(x: number, y: number, s: string, o: { size?: number; font?: Font; align?: "left" | "right" | "center"; gray?: number } = {}) {
    const size = o.size ?? 10, font = o.font ?? "F1";
    const w = o.align && o.align !== "left" ? textWidth(s, size, font) : 0;
    const x0 = o.align === "right" ? x - w : o.align === "center" ? x - w / 2 : x;
    this.cur.push(`${o.gray !== undefined ? o.gray.toFixed(2) + " g " : ""}BT /${font} ${size} Tf ${x0.toFixed(2)} ${(H - y).toFixed(2)} Td ${hexText(s)} Tj ET${o.gray !== undefined ? " 0 g" : ""}`);
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
    const objs: string[] = [];
    const add = (s: string) => { objs.push(s); return objs.length; };
    const catalog = add(""), pagesId = add("");
    const f1 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
    const f2 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
    const f3 = add("<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>");
    const kids: number[] = [];
    for (const content of pages) {
      const c = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      kids.push(add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 ${f1} 0 R /F2 ${f2} 0 R /F3 ${f3} 0 R >> >> /Contents ${c} 0 R >>`));
    }
    objs[catalog - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
    objs[pagesId - 1] = `<< /Type /Pages /Kids [${kids.map(k => k + " 0 R").join(" ")}] /Count ${kids.length} >>`;
    let out = "%PDF-1.4\n";
    const offs: number[] = [];
    objs.forEach((o, i) => { offs.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const b = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) b[i] = out.charCodeAt(i) & 0xff; // content is ASCII after pdfSafe
    return b;
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
