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

/** The top and bottom part of a page photo (overlapping a little, so no line is cut in two). */
export async function splitPage(file: Blob, overlap = 0.12): Promise<File[]> {
  const bmp = await createImageBitmap(file);
  const h = bmp.height, cut = Math.round(h / 2), pad = Math.round(h * overlap / 2);
  const parts: File[] = [];
  for (const [y0, y1] of [[0, cut + pad], [cut - pad, h]]) {
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = y1 - y0;
    c.getContext("2d")!.drawImage(bmp, 0, y0, bmp.width, y1 - y0, 0, 0, bmp.width, y1 - y0);
    const blob = await new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error("crop"))), "image/jpeg", 0.92));
    parts.push(new File([blob], `half-${y0}.jpg`, { type: "image/jpeg" }));
  }
  bmp.close?.();
  return parts;
}

type ReadRow = { sr?: unknown; style?: unknown; qty?: unknown; cost?: unknown; item?: unknown };
const key = (r: ReadRow) => [String(r.style ?? "").trim().toUpperCase(), String(r.qty ?? "").trim(), String(r.cost ?? "").trim()].join("|");
/** Lines from the two halves, in page order, without the lines both halves saw in the overlap. */
export function joinHalves([top, bottom]: ReadRow[][]): ReadRow[] {
  const out = [...(top || [])];
  const seenSr = new Set(out.map(r => String(r.sr ?? "").trim()).filter(Boolean)), seenKey = new Set(out.map(key));
  for (const r of bottom || []) {
    const sr = String(r.sr ?? "").trim();
    if (sr ? seenSr.has(sr) : seenKey.has(key(r))) continue;
    out.push(r);
  }
  return out;
}
