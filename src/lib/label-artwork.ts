import qrcode from "qrcode-generator";
import { parseLabel } from "./parse";
import { toPaise } from "./format";
import { printedCostCode } from "./label-cost-code";
import type { LabelCfg } from "../pages/Labels";
import type { Product } from "./db";
import { ownPayload } from "./parse";
import { productForLabel } from "./purchase-labels";
import { labelRate, rateMark } from "./label-tspl";
import { orderedLines } from "./label-order";

/** A 203 dpi TSC head has eight addressable dots per millimetre. */
export const LABEL_DOTS_PER_MM = 8;
export const QR_QUIET_MODULES = 4;
const dot = (mm: number) => Math.round(mm * LABEL_DOTS_PER_MM);
const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
const qrCache = new Map<string, { modules: number; moduleDots: number; sizeDots: number; path: string }>();

/** QR paths use integer printer dots, including the full four-module quiet zone. */
export function labelQr(text: string, requestedMm: number, roomMm = requestedMm) {
  const key = `${requestedMm}\u0000${roomMm}\u0000${text}`, hit = qrCache.get(key);
  if (hit) return hit;
  // The shop's short sticker QR (capitals, digits, "-") uses the QR's compact alphanumeric mode and its
  // strongest error correction (H: still read with ~30% of squares smudged). That makes it 25 × 25 squares,
  // 6.25 mm at 2 printer dots each: the size of the old software's QR, which the owner asked for (22 Oct),
  // and sturdier than it. Other QRs keep level M.
  const alnum = /^[0-9A-Z $%*+\-./:]+$/.test(text);
  let qr = qrcode(0, alnum ? "H" : "M");
  qr.addData(text, alnum ? "Alphanumeric" : "Byte"); qr.make();
  // the old software's own QR (ITEMCODE~RATE~…) is 25 × 25 at level L; ours for it is the same size when it fits
  if (!alnum && text.includes("~") && qr.getModuleCount() > 25) {
    const low = qrcode(0, "L"); low.addData(text, "Byte"); low.make();
    if (low.getModuleCount() < qr.getModuleCount()) qr = low;
  }
  const modules = qr.getModuleCount(), cells = modules + QR_QUIET_MODULES * 2;
  // 2 printer dots per square is the bare minimum, and a thermal head's heat spreads it: such QRs scanned only
  // sometimes (owner, 22 Oct). When a 3-dot QR still fits the sticker, use it, even a little past the set size.
  let moduleDots = Math.max(2, Math.floor(dot(requestedMm) / cells));
  if (moduleDots < 3 && cells * 3 <= dot(roomMm)) moduleDots = 3;
  const sizeDots = cells * moduleDots;
  let path = "";
  for (let r = 0; r < modules; r++) {
    let start = -1;
    for (let c = 0; c <= modules; c++) {
      const dark = c < modules && qr.isDark(r, c);
      if (dark && start < 0) start = c;
      if (!dark && start >= 0) {
        const x = (start + QR_QUIET_MODULES) * moduleDots, y = (r + QR_QUIET_MODULES) * moduleDots;
        const w = (c - start) * moduleDots;
        path += `M${x} ${y}h${w}v${moduleDots}h-${w}z`; start = -1;
      }
    }
  }
  const result = { modules, moduleDots, sizeDots, path };
  if (qrCache.size >= 3000) qrCache.delete(qrCache.keys().next().value!);
  qrCache.set(key, result);
  return result;
}

function textSvg(value: string, x: number, y: number, size: number, maxWidth: number, weight = 600) {
  const text = clean(value);
  if (!text || maxWidth <= 0) return "";
  // The explicit length makes long style/color names fit without clipping their ends.
  const width = Math.min(maxWidth, Math.max(size * 0.45, [...text].length * size * 0.56));
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" textLength="${+width.toFixed(2)}" lengthAdjust="spacingAndGlyphs">${escapeXml(text)}</text>`;
}

export function labelArtworkGeometry(cfg: LabelCfg, p: Product, qtyOnLabel: number, qrText?: string) {
  const width = dot(cfg.w), height = dot(cfg.h), pad = dot(cfg.pad);
  const pp = productForLabel(p, qtyOnLabel);
  // An exact old-label copy keeps its printed price as well as its QR, including odd rates.
  const copied = qrText ? parseLabel(qrText) : undefined;
  if (copied?.how === "shop label") pp.rate = toPaise(copied.rate || "0");
  const qr = labelQr(qrText ?? ownPayload(pp, cfg.format || "shop"), cfg.qr, Math.min(cfg.qr + 3, cfg.h - cfg.pad * 2));
  const font = cfg.font * 25.4 / 72 * LABEL_DOTS_PER_MM;
  const brand = cfg.layout !== "stack" && cfg.show.shop && cfg.shop.trim() ? Math.ceil(font * 1.1) : 0;
  if (qr.sizeDots > height - pad * 2 || qr.sizeDots + brand + pad * 4 + 8 > width) {
    throw new Error("QR details need more room. Increase the sticker size or use the shorter old-software QR content.");
  }
  return { width, height, pad, pp, qr, font, brand };
}

/** One self-contained artwork is used by the screen, browser printing and TSPL raster. */
export function renderLabelSvg(cfg: LabelCfg, p: Product & { entry_code?: string }, qtyOnLabel = 1, line?: number | string, labelIndex = 0, qrText?: string): string {
  const { width, height, pad, pp, qr, font, brand } = labelArtworkGeometry(cfg, p, qtyOnLabel, qrText);
  const s = cfg.show, stack = cfg.layout === "stack";
  const qx = stack ? pad : width - pad - brand - qr.sizeDots;
  const qy = pad;
  const tx = stack ? qx + qr.sizeDots + pad : pad;
  const textWidth = stack ? width - tx - pad : qx - pad * 2;
  type Detail = { text: string; scale?: number; weight?: number; line?: number | string; mono?: boolean };
  const details: Detail[] = [];
  if (stack && s.shop && cfg.shop) details.push({ text: cfg.shop, scale: 0.9, weight: 800 });
  const rate = s.rate && pp.rate > 0 ? `${rateMark(cfg)}${labelRate(pp.rate)}` : "";
  const quantity = s.qty ? `${pp.pack}${p.type || "PCS"}` : "";
  // the box: the supplier bill's own serial ("1-10", "4+13") when it was read, else the line's position
  const lineOk = typeof line === "string" ? /^[0-9A-Za-z+\-/]{1,9}$/.test(line.trim()) : !!line && Number.isSafeInteger(line) && line > 0;
  const billLine = (s.line ?? true) && lineOk ? (typeof line === "string" ? line.trim() : line) : undefined;
  const costText = s.cost_code && pp.cost_code ? printedCostCode(pp.cost_code, cfg, labelIndex) : "";
  const hasCost = !!costText || !!billLine;
  // the words in the owner's chosen order (Settings on the print screen); Reference / Style (/ Colour) share a line
  const lines = orderedLines(cfg.order, {
    item: s.item ? p.item : "", ref: (s.ref ?? s.style) ? p.entry_code : "", style: s.style ? p.style : "", color: s.color ? p.color : "",
    tk: s.tk && p.tk ? `TK ${p.tk}` : "", cost: hasCost ? " " : "", code: s.code ? p.code : "",
  }, !stack);
  let extrasDone = !stack;
  const extras = () => {          // the stacked sticker's quantity and price, just above the cost code / code
    if (extrasDone) return; extrasDone = true;
    if (quantity) details.push({ text: `${pp.pack} ${p.type || "PCS"}` });
    if (rate) details.push({ text: rate, scale: 1.25, weight: 800 });
  };
  for (const l of lines) {
    if (l.parts[0] === "cost") { extras(); details.push({ text: costText, line: billLine, scale: stack ? 0.95 : 1, weight: stack ? 700 : 500, mono: stack }); continue; }
    if (l.parts[0] === "code") { extras(); details.push({ text: l.text, scale: 0.85, mono: stack }); continue; }
    details.push({ text: l.text, weight: l.parts[0] === "item" ? (stack ? 700 : 500) : undefined });
  }
  extras();
  const bottom = stack ? "" : rate ? `${rate}${quantity ? `X${quantity}` : ""}` : quantity;
  const bottomSize = font * (cfg.rateScale ?? 1.75);
  // Expanded QR symbols can reach the rate's band; never let their white quiet
  // zone cover the end of the price/quantity when a long payload needs more dots.
  const bottomWidth = stack || qy + qr.sizeDots > height - pad - bottomSize * 1.2
    ? textWidth : width - pad * 2 - brand;
  const detailsHeight = height - pad * 2 - (bottom ? bottomSize * 1.05 : 0);
  const totalScale = details.reduce((n, d) => n + (d.scale ?? 1), 0);
  const lineSize = Math.min(font, detailsHeight / Math.max(1, totalScale) / 1.12);
  let y = pad, content = "";
  for (const detail of details) {
    const size = lineSize * (detail.scale ?? 1), baseline = y + size * 0.86;
    const lineText = detail.line ? String(detail.line) : "";
    const boxW = lineText ? Math.ceil(lineText.length * size * 0.9 * 0.56 + dot(0.7)) : 0;
    const gap = lineText && detail.text ? dot(1.2) : 0;
    const maxText = Math.max(0, textWidth - boxW - gap);
    const textW = detail.text ? Math.min(maxText, [...clean(detail.text)].length * size * 0.56) : 0;
    content += `<g${detail.mono ? ' font-family="monospace"' : ""}>${textSvg(detail.text, tx, baseline, size, maxText, Math.max(700, detail.weight ?? 700))}`;
    if (lineText) {
      const boxX = tx + textW + gap, boxY = y - size * 0.02, boxH = size * 1.05;
      content += `<rect x="${boxX}" y="${boxY}" width="${boxW}" height="${boxH}" rx="${dot(0.4)}" fill="none" stroke="#000" stroke-width="${dot(0.15)}"/>${textSvg(lineText, boxX + dot(0.35), baseline, size * 0.9, boxW - dot(0.7), 700)}`;
    }
    content += "</g>"; y += size * 1.12;
  }
  if (bottom) content += textSvg(bottom, tx, height - pad - bottomSize * 0.12, bottomSize, bottomWidth, 700);
  content += `<g transform="translate(${qx} ${qy})" shape-rendering="crispEdges"><rect width="${qr.sizeDots}" height="${qr.sizeDots}" fill="#fff"/><path d="${qr.path}" fill="#000"/></g>`;
  if (brand) {
    const brandSize = Math.min(font * 0.95, (height - pad * 2) / Math.max(1, cfg.shop.length) / 0.68);
    content += `<g transform="translate(${width - pad - brandSize * 0.9} ${pad}) rotate(90)">${textSvg(cfg.shop, 0, 0, brandSize, height - pad * 2, 700)}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.w}mm" height="${cfg.h}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(clean(`${p.item} ${p.style} ${p.color} ${bottom}`))}" style="display:block;width:100%;height:100%"><rect width="${width}" height="${height}" fill="#fff"/><g fill="#000" font-family="Arial,Helvetica,sans-serif">${content}</g></svg>`;
}
