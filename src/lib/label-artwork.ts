import qrcode from "qrcode-generator";
import { parseLabel } from "./parse";
import { toPaise } from "./format";
import { printedCostCode } from "./label-cost-code";
import type { LabelCfg } from "../pages/Labels";
import type { Product } from "./db";
import { ownPayload } from "./parse";
import { productForLabel } from "./purchase-labels";
import { labelRate, rateMark } from "./label-tspl";

/** A 203 dpi TSC head has eight addressable dots per millimetre. */
export const LABEL_DOTS_PER_MM = 8;
export const QR_QUIET_MODULES = 4;
const dot = (mm: number) => Math.round(mm * LABEL_DOTS_PER_MM);
const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
const qrCache = new Map<string, { modules: number; moduleDots: number; sizeDots: number; path: string }>();

/** QR paths use integer printer dots, including the full four-module quiet zone. */
export function labelQr(text: string, requestedMm: number) {
  const key = `${requestedMm}\u0000${text}`, hit = qrCache.get(key);
  if (hit) return hit;
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte"); qr.make();
  const modules = qr.getModuleCount(), cells = modules + QR_QUIET_MODULES * 2;
  const moduleDots = Math.max(2, Math.floor(dot(requestedMm) / cells));
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
  const qr = labelQr(qrText ?? ownPayload(pp, cfg.format || "shop"), cfg.qr);
  const font = cfg.font * 25.4 / 72 * LABEL_DOTS_PER_MM;
  const brand = cfg.layout !== "stack" && cfg.show.shop && cfg.shop.trim() ? Math.ceil(font * 1.1) : 0;
  if (qr.sizeDots > height - pad * 2 || qr.sizeDots + brand + pad * 4 + 8 > width) {
    throw new Error("QR details need more room. Increase the sticker size or use the shorter old-software QR content.");
  }
  return { width, height, pad, pp, qr, font, brand };
}

/** One self-contained artwork is used by the screen, browser printing and TSPL raster. */
export function renderLabelSvg(cfg: LabelCfg, p: Product & { entry_code?: string }, qtyOnLabel = 1, line?: number, labelIndex = 0, qrText?: string): string {
  const { width, height, pad, pp, qr, font, brand } = labelArtworkGeometry(cfg, p, qtyOnLabel, qrText);
  const s = cfg.show, stack = cfg.layout === "stack";
  const qx = stack ? pad : width - pad - brand - qr.sizeDots;
  const qy = pad;
  const tx = stack ? qx + qr.sizeDots + pad : pad;
  const textWidth = stack ? width - tx - pad : qx - pad * 2;
  type Detail = { text: string; scale?: number; weight?: number; line?: number; mono?: boolean };
  const details: Detail[] = [];
  if (stack && s.shop && cfg.shop) details.push({ text: cfg.shop, scale: 0.9, weight: 800 });
  if (s.item && p.item) details.push({ text: p.item, weight: stack ? 700 : 500 });
  // Preserve the shop's revised three-line layout: style/color share a line,
  // followed by the encrypted cost and the supplier bill's boxed line number.
  const referenceStyle = [p.entry_code, p.style].filter(Boolean).join(" ");
  if (stack) {
    if (s.style && referenceStyle) details.push({ text: referenceStyle });
    if (s.color && p.color) details.push({ text: p.color });
  } else {
    const styleColor = [s.style && referenceStyle, s.color && p.color].filter(Boolean).join(" ");
    if (styleColor) details.push({ text: styleColor });
  }
  if (s.tk && p.tk) details.push({ text: `TK ${p.tk}` });
  const rate = s.rate && pp.rate > 0 ? `${rateMark(cfg)}${labelRate(pp.rate)}` : "";
  const quantity = s.qty ? `${pp.pack}${p.type || "PCS"}` : "";
  if (stack && quantity) details.push({ text: `${pp.pack} ${p.type || "PCS"}` });
  if (stack && rate) details.push({ text: rate, scale: 1.25, weight: 800 });
  const billLine = (s.line ?? true) && line && Number.isSafeInteger(line) && line > 0 ? line : undefined;
  if ((s.cost_code && pp.cost_code) || billLine) details.push({ text: s.cost_code ? printedCostCode(pp.cost_code, cfg, labelIndex) : "", line: billLine, scale: stack ? 0.95 : 1, weight: stack ? 700 : 500, mono: stack });
  if (s.code && p.code) details.push({ text: p.code, scale: 0.85, mono: stack });
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
