import qrcode from "qrcode-generator";
import type { LabelCfg } from "../pages/Labels";
import type { Product } from "./db";
import { ownPayload } from "./parse";
import { productForLabel } from "./purchase-labels";

/** A 203 dpi TSC head has eight addressable dots per millimetre. */
export const LABEL_DOTS_PER_MM = 8;
export const QR_QUIET_MODULES = 4;
const dot = (mm: number) => Math.round(mm * LABEL_DOTS_PER_MM);
const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!));
const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f]/g, " ").trim();

/** QR paths use integer printer dots, including the full four-module quiet zone. */
export function labelQr(text: string, requestedMm: number) {
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
  return { modules, moduleDots, sizeDots, path };
}

function textSvg(value: string, x: number, y: number, size: number, maxWidth: number, weight = 600) {
  const text = clean(value);
  if (!text || maxWidth <= 0) return "";
  // The explicit length makes long style/color names fit without clipping their ends.
  const width = Math.min(maxWidth, Math.max(size * 0.45, [...text].length * size * 0.56));
  return `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" textLength="${+width.toFixed(2)}" lengthAdjust="spacingAndGlyphs">${escapeXml(text)}</text>`;
}

export function labelArtworkGeometry(cfg: LabelCfg, p: Product, qtyOnLabel: number) {
  const width = dot(cfg.w), height = dot(cfg.h), pad = dot(cfg.pad);
  const pp = productForLabel(p, qtyOnLabel);
  const qr = labelQr(ownPayload(pp, cfg.format || "shop"), cfg.qr);
  const font = cfg.font * 25.4 / 72 * LABEL_DOTS_PER_MM;
  const brand = cfg.layout !== "stack" && cfg.show.shop && cfg.shop.trim() ? Math.ceil(font * 1.1) : 0;
  if (qr.sizeDots > height - pad * 2 || qr.sizeDots + brand + pad * 4 + 8 > width) {
    throw new Error("QR details need more room. Increase the sticker size or use the shorter old-software QR content.");
  }
  return { width, height, pad, pp, qr, font, brand };
}

/** One self-contained artwork is used by the screen, browser printing and TSPL raster. */
export function renderLabelSvg(cfg: LabelCfg, p: Product, qtyOnLabel = 1): string {
  const { width, height, pad, pp, qr, font, brand } = labelArtworkGeometry(cfg, p, qtyOnLabel);
  const s = cfg.show, stack = cfg.layout === "stack";
  const qx = stack ? pad : width - pad - brand - qr.sizeDots;
  const qy = pad;
  const tx = stack ? qx + qr.sizeDots + pad : pad;
  const textWidth = stack ? width - tx - pad : qx - pad * 2;
  const details: string[] = [];
  if (stack && s.shop && cfg.shop) details.push(cfg.shop);
  if (s.item && p.item) details.push(p.item);
  if (s.style && p.style) details.push(p.style);
  if (s.color && p.color) details.push(p.color);
  if (s.tk && p.tk) details.push(`TK ${p.tk}`);
  if (s.cost_code && pp.cost_code) details.push(pp.cost_code);
  if (s.code && p.code) details.push(p.code);
  const rate = s.rate && p.rate > 0 ? String(Math.round(p.rate) / 100) : "";
  const quantity = s.qty ? `${qtyOnLabel}${p.type || "PCS"}` : "";
  const bottom = rate ? `${rate}${quantity ? `X${quantity}` : ""}` : quantity;
  const bottomSize = Math.min(font * 1.35, height * 0.25);
  // Expanded QR symbols can reach the rate's band; never let their white quiet
  // zone cover the end of the price/quantity when a long payload needs more dots.
  const bottomWidth = stack || qy + qr.sizeDots > height - pad - bottomSize * 1.2
    ? textWidth : width - pad * 2 - brand;
  const detailsHeight = height - pad * 2 - (bottom ? bottomSize * 1.35 : 0);
  const lineSize = Math.min(font, detailsHeight / Math.max(1, details.length) / 1.13);
  let content = details.map((line, i) => textSvg(line, tx, pad + lineSize * 0.88 + i * lineSize * 1.13, lineSize, textWidth, i === 0 ? 700 : 600)).join("");
  if (bottom) content += textSvg(bottom, tx, height - pad - bottomSize * 0.12, bottomSize, bottomWidth, 800);
  content += `<g transform="translate(${qx} ${qy})" shape-rendering="crispEdges"><rect width="${qr.sizeDots}" height="${qr.sizeDots}" fill="#fff"/><path d="${qr.path}" fill="#000"/></g>`;
  if (brand) {
    const brandSize = Math.min(font * 0.95, (height - pad * 2) / Math.max(1, cfg.shop.length) / 0.68);
    content += `<g transform="translate(${width - pad - brandSize * 0.9} ${pad}) rotate(90)">${textSvg(cfg.shop, 0, 0, brandSize, height - pad * 2, 800)}</g>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cfg.w}mm" height="${cfg.h}mm" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(clean(`${p.item} ${p.style} ${p.color} ${bottom}`))}" style="display:block;width:100%;height:100%"><rect width="${width}" height="${height}" fill="#fff"/><g fill="#000" font-family="Arial,Helvetica,sans-serif">${content}</g></svg>`;
}
