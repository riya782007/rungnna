import type { LabelCfg } from "../pages/Labels";
import type { PurchaseLabelJob } from "./purchase-labels";
import { LABEL_DOTS_PER_MM, labelArtworkGeometry, renderLabelSvg } from "./label-artwork";
import { bagLabelCfg, bagPayload } from "./bag-labels";
import { labelHeat } from "./label-darkness";
import { validateLegacyCopy } from "./legacy-label-copy";

const dots = (mm: number) => Math.round(mm * LABEL_DOTS_PER_MM);
const encoder = new TextEncoder();
const number = (n: number) => String(+n.toFixed(3));

export function labelRowWidth(cfg: LabelCfg) {
  return cfg.driverPaper && cfg.edgeR !== undefined ? cfg.edgeR : cfg.cols * cfg.w + (cfg.cols - 1) * cfg.gapX;
}

/** Match PrintSheet: position the whole sticker, then relayout its right edge. */
export function labelBitmapCell(cfg: LabelCfg, col: number) {
  const x = cfg.offX + col * (cfg.w + cfg.gapX);
  return { x, y: cfg.offY, w: Math.min(cfg.w, Math.round(((cfg.edgeR ?? 1e9) - x) * 100) / 100) };
}

/** Flatten only copies, preserving purchase line and partial-packet order across rows. */
export function labelBitmapRows(cfg: LabelCfg, jobs: PurchaseLabelJob[]): PurchaseLabelJob[][] {
  if (!Number.isSafeInteger(cfg.cols) || cfg.cols < 1 || cfg.cols > 20) throw new Error("Check the label columns");
  if (!jobs.length || jobs.some(j => !j.p.item.trim() || !Number.isSafeInteger(j.copies) || j.copies < 1 || !Number.isSafeInteger(j.qtyOnLabel) || j.qtyOnLabel < 1) || jobs.reduce((n, j) => n + j.copies, 0) > 5000) throw new Error("Review product names and print quantities (maximum 5000 labels)");
  const rows: PurchaseLabelJob[][] = [];
  for (const job of jobs) for (let i = 0; i < job.copies; i++) {
    if (!rows.length || rows[rows.length - 1].length === cfg.cols) rows.push([]);
    rows[rows.length - 1].push(job);
  }
  return rows;
}

export function validateLabelBitmapJob(cfg: LabelCfg, jobs: PurchaseLabelJob[]) {
  labelHeat(cfg);
  if (cfg.mode !== "roll") throw new Error("Direct TSC printing needs roll labels. Use browser printing for sheets.");
  if (![cfg.w, cfg.h, cfg.qr, cfg.font].every(n => Number.isFinite(n) && n > 0) || ![cfg.gapX, cfg.gapY, cfg.pad].every(n => Number.isFinite(n) && n >= 0) || ![cfg.offX, cfg.offY].every(Number.isFinite) || cfg.h > 300 || cfg.pad * 2 >= Math.min(cfg.w, cfg.h)) throw new Error("Check the sticker size, gaps and margins");
  const rows = labelBitmapRows(cfg, jobs);
  if (labelRowWidth(cfg) > 104 || labelRowWidth(cfg) <= 0) throw new Error("The full row must fit the TSC printer's 104 mm print width");
  if ((cfg.edgeR !== undefined && (!Number.isFinite(cfg.edgeR) || cfg.edgeR <= 0 || cfg.edgeR > 104)) || (cfg.rateScale !== undefined && (!Number.isFinite(cfg.rateScale) || cfg.rateScale <= 0))) throw new Error("Check the printer's right edge and rate text size");
  if (Math.abs(cfg.offX) >= cfg.w || Math.abs(cfg.offY) >= cfg.h) throw new Error("The print nudge is outside the sticker. Reset the nudge in printer settings.");
  for (const row of rows) row.forEach((j, col) => {
    const cell = labelBitmapCell(cfg, col);
    if (cell.w <= cfg.pad * 2) throw new Error("A sticker falls past the printer's right edge. Check columns, gaps and nudge.");
    labelArtworkGeometry({ ...(j.bag ? bagLabelCfg(cfg) : cfg), w: cell.w }, j.p, j.qtyOnLabel, j.bag ? bagPayload(j.bag) : validateLegacyCopy(j));
  });
}

/** TSPL BITMAP mode 0: 0 prints black, 1 leaves white; rows are MSB first.
 * TSC programming manual v3 pp67–69 (PDF84–86):
 * https://fs.tscprinters.com/system/files/31-0000001-00_tspl_tspl2_programming_3_0.pdf
 */
export function rgbaToTsplBitmap(rgba: ArrayLike<number>, width: number, height: number): Uint8Array {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1 || rgba.length !== width * height * 4) throw new Error("Invalid label bitmap dimensions");
  const stride = Math.ceil(width / 8), out = new Uint8Array(stride * height).fill(255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4, alpha = rgba[i + 3] / 255;
    const brightness = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
    if (brightness < 160) out[y * stride + (x >> 3)] &= ~(128 >> (x & 7));
  }
  return out;
}

function concat(chunks: Uint8Array[]) {
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let offset = 0; for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out;
}

/** Every row is one physical page. GAP is separate from SIZE, so it never feeds blank rows. */
export function encodeLabelBitmapRow(cfg: LabelCfg, bitmap: Uint8Array): Uint8Array {
  const heat = labelHeat(cfg);
  const width = dots(labelRowWidth(cfg)), height = dots(cfg.h), stride = Math.ceil(width / 8);
  if (bitmap.length !== stride * height) throw new Error("Label bitmap does not match the sticker row");
  return concat([
    encoder.encode(`SIZE ${number(labelRowWidth(cfg))} mm,${number(cfg.h)} mm\r\nGAP ${number(cfg.gapY)} mm,0 mm\r\nREFERENCE 0,0\r\nSHIFT 0\r\nOFFSET 0 mm\r\nDIRECTION 1\r\nDENSITY ${heat.density}\r\nSPEED ${heat.speed}\r\nCLS\r\nBITMAP 0,0,${stride},${height},0,`),
    bitmap, encoder.encode("\r\nPRINT 1,1\r\n"),
  ]);
}

async function imageFromSvg(svg: string) {
  const url = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml;charset=utf-8" }));
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("Could not draw the label. Try the browser print option.")); img.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export async function buildLabelBitmapJob(cfg: LabelCfg, jobs: PurchaseLabelJob[]): Promise<Uint8Array> {
  validateLabelBitmapJob(cfg, jobs);
  let labelIndex = 0;
  const rows = labelBitmapRows(cfg, jobs).map(row => row.map(job => { const index = labelIndex++; return { ...job, copies: 1, labelIndex: job.labelIndex ?? index }; }));
  const width = dots(labelRowWidth(cfg)), height = dots(cfg.h);
  const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot prepare label images. Use browser printing.");
  if (document.fonts?.ready) await document.fonts.ready;
  const pictures = new Map<PurchaseLabelJob, Map<number, HTMLImageElement>>();
  const sameArtwork = new Map<string, HTMLImageElement>();
  // Validate and decode everything before producing a printable byte stream.
  for (const row of rows) for (let col = 0; col < row.length; col++) {
    const job = row[col], w = labelBitmapCell(cfg, col).w;
    let sizes = pictures.get(job);
    if (!sizes) { sizes = new Map(); pictures.set(job, sizes); }
    if (!sizes.has(w)) {
      const svg = renderLabelSvg({ ...(job.bag ? bagLabelCfg(cfg) : cfg), w }, job.p, job.qtyOnLabel, job.line, job.labelIndex, job.bag ? bagPayload(job.bag) : validateLegacyCopy(job));
      let picture = sameArtwork.get(svg);
      if (!picture) { picture = await imageFromSvg(svg); sameArtwork.set(svg, picture); }
      sizes.set(w, picture);
    }
  }
  const chunks: Uint8Array[] = [];
  for (const row of rows) {
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, width, height); ctx.imageSmoothingEnabled = false;
    row.forEach((job, col) => {
      const cell = labelBitmapCell(cfg, col), cellX = dots(cell.x), cellWidth = dots(cell.w);
      ctx.save(); ctx.beginPath(); ctx.rect(cellX, 0, cellWidth, height); ctx.clip();
      ctx.drawImage(pictures.get(job)!.get(cell.w)!, cellX, dots(cell.y), cellWidth, height); ctx.restore();
    });
    chunks.push(encodeLabelBitmapRow(cfg, rgbaToTsplBitmap(ctx.getImageData(0, 0, width, height).data, width, height)));
  }
  return concat(chunks);
}
