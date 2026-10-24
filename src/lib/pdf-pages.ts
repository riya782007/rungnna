/* Owner, 24 Oct: "it doesn't scan an uploaded PDF". Suppliers often send the bill as a PDF on WhatsApp. Each PDF
   page is drawn as a sharp picture here on the computer and read like a photo of that page. */
export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export async function pdfToImages(file: File, maxPages = 12): Promise<File[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: File[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 2600 / Math.max(base.width, base.height));   // ~2600 px on the long side
    const view = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: view }).promise;
    const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob(b => (b ? ok(b) : bad(new Error("Could not draw the PDF page"))), "image/jpeg", 0.92));
    out.push(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-page-${n}.jpg`, { type: "image/jpeg" }));
  }
  await doc.destroy();
  return out;
}

/** Photos stay as they are; every PDF becomes one picture per page. */
export async function expandPdfs(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) out.push(...(isPdf(f) ? await pdfToImages(f) : [f]));
  return out;
}

/** A page photo cut into n strips from top to bottom (each overlapping the next a little, so no line is cut in two). */
export async function splitPage(file: Blob, n = 2, overlap = 0.06): Promise<File[]> {
  const bmp = await createImageBitmap(file);
  const h = bmp.height, step = h / n, pad = Math.round(h * overlap);
  const parts: File[] = [];
  for (let i = 0; i < n; i++) {
    const y0 = Math.max(0, Math.round(i * step) - pad), y1 = Math.min(h, Math.round((i + 1) * step) + pad);
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = y1 - y0;
    c.getContext("2d")!.drawImage(bmp, 0, y0, bmp.width, y1 - y0, 0, 0, bmp.width, y1 - y0);
    const blob = await new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error("crop"))), "image/jpeg", 0.92));
    parts.push(new File([blob], `part-${i + 1}.jpg`, { type: "image/jpeg" }));
  }
  bmp.close?.();
  return parts;
}

type ReadRow = { sr?: unknown; style?: unknown; qty?: unknown; cost?: unknown; item?: unknown };
const key = (r: ReadRow) => [String(r.style ?? "").trim().toUpperCase(), String(r.qty ?? "").trim(), String(r.cost ?? "").trim()].join("|");
const srNum = (r: ReadRow) => { const m = /^(\d{1,4})$/.exec(String(r.sr ?? "").trim()); return m ? Number(m[1]) : NaN; };
/** How many lines the bill's own Sr. numbers say there are (28 … 58 = 31), or 0 when they don't run in order. */
export function srSpan(rows: ReadRow[]): number {
  const ns = rows.map(srNum).filter(Number.isFinite);
  if (ns.length < 3 || ns.length < rows.length * 0.8) return 0;
  const lo = Math.min(...ns), hi = Math.max(...ns);
  return hi - lo + 1 <= 300 ? hi - lo + 1 : 0;
}
/** Lines from several readings of one page, each line once, in the bill's own order. */
export function joinParts(parts: ReadRow[][]): ReadRow[] {
  const bySr = new Map<string, ReadRow>(), loose: ReadRow[] = [], seenKey = new Set<string>();
  for (const part of parts) for (const r of part || []) {
    const sr = String(r.sr ?? "").trim();
    if (sr) { if (!bySr.has(sr)) bySr.set(sr, r); continue; }
    const k = key(r); if (seenKey.has(k)) continue; seenKey.add(k); loose.push(r);
  }
  const numbered = [...bySr.values()];
  if (numbered.every(r => Number.isFinite(srNum(r)))) numbered.sort((a, b) => srNum(a) - srNum(b));
  // lines without an Sr. that match a numbered one (same article, qty and rate) are the same line
  const have = new Set(numbered.map(key));
  return [...numbered, ...loose.filter(r => !have.has(key(r)))];
}
/** @deprecated two parts only — kept for older callers */
export const joinHalves = ([top, bottom]: ReadRow[][]) => joinParts([top, bottom]);
