import type { Product } from "./db";
import { parseLabel } from "./parse";
import { fromParsed } from "./products";
import { toPaise } from "./format";

/** Preserve a working old sticker's complete identity; never substitute a saved article's reference. */
export function legacyLabelCopy(raw: string, display: Product) {
  const sourceQr = raw.trim(), parsed = parseLabel(sourceQr);
  if (parsed.how !== "shop label" || sourceQr.length > 512 || /[\u0000-\u001f\u007f]/.test(sourceQr) || !/^\d+(?:\.\d{1,2})?$/.test(parsed.tokens[1].trim()) || !/^\d+$/.test(parsed.tokens[2].trim()) || !Number.isSafeInteger(Number(parsed.qty)) || Number(parsed.qty) < 1 || Number(parsed.qty) > 1000000)
    throw new Error("Scan a working old-software QR with all seven ~ separated fields.");
  const decoded = fromParsed(parsed, display.created_by);
  if (!Number.isSafeInteger(decoded.rate) || decoded.rate < 0) throw new Error("The original sticker price is outside the supported range.");
  const p: Product = { ...display, style: decoded.style, color: decoded.color, tk: decoded.tk, rate: decoded.rate, item_code: decoded.item_code, ref: parsed.ref || "", pack: decoded.pack, raw_scan: sourceQr };
  return { p, sourceQr, qtyOnLabel: Number(parsed.qty), copies: 1 };
}
export function validateLegacyCopy(job: { p: Product; sourceQr?: string; qtyOnLabel: number; bag?: unknown }) {
  if (job.sourceQr === undefined) return undefined;
  if (job.bag) throw new Error("A bag label cannot also be an old product label.");
  const parsed = parseLabel(job.sourceQr), copy = legacyLabelCopy(job.sourceQr, job.p);
  if (job.sourceQr !== copy.sourceQr || job.qtyOnLabel !== copy.qtyOnLabel || job.p.rate !== toPaise(parsed.rate || "0") || ["style", "color", "tk", "item_code", "ref"].some(key => String(job.p[key as keyof Product] || "").trim().toUpperCase() !== String(copy.p[key as keyof Product] || "").trim().toUpperCase()))
    throw new Error("Exact-copy fields changed. Scan the working old sticker again, or generate a new label.");
  return job.sourceQr;
}
