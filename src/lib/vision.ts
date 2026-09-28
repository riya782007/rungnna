import { db, type Product } from "./db";
import { photoSrc } from "./image";
import { productKey } from "./products";

/* ===========================================================================
   Hybrid product matching = AI visual recognition + hard attribute rules.

   The shop's problem: many pieces look almost identical in a photo (same
   packaging, same finish) but are DIFFERENT products — different vendor, model,
   or price. Pure "it looks the same" matching would wrongly merge them and copy
   one item's price/barcode onto another.

   So matching here is deliberately two-layered:

     1. Visual recall  — a fast, on-device image embedding (no server, works
        offline) finds the products that LOOK like the new photo and ranks them
        by cosine similarity.

     2. Attribute guardrail — before anything is treated as "the same product",
        the Model/Article number + Vendor must agree. When two DIFFERENT products
        look very alike (similarity above the confidence threshold, 85–90%), the
        system does NOT auto-assign; it returns "verify" and asks the operator to
        confirm the Model Number. Visual similarity alone can never merge or
        price two distinct articles.

   The embedding is a small, unit-normalised feature vector built from a
   downscaled grayscale grid + an HSV colour histogram. It is stable for the same
   piece under normal counter lighting, needs no model download, and is tiny to
   store/sync (see Product.embedding).
=========================================================================== */

export const EMBED_DIM = 8 * 8 /* luma grid */ + 8 * 3 /* H,S,V histograms */; // = 88

/* Build a visual embedding from an image blob or element, fully on-device. */
export async function embedImage(src: Blob | HTMLImageElement | HTMLCanvasElement): Promise<number[]> {
  const bmp = await toBitmap(src);
  const S = 32;
  const c = document.createElement("canvas"); c.width = S; c.height = S;
  const g = c.getContext("2d", { willReadFrequently: true })!;
  g.drawImage(bmp as any, 0, 0, S, S);
  const { data } = g.getImageData(0, 0, S, S);

  // 8×8 luma grid (structure / shape), averaged from the 32×32 image
  const grid = new Array(64).fill(0);
  const hist = { h: new Array(8).fill(0), s: new Array(8).fill(0), v: new Array(8).fill(0) };
  const cell = S / 8;
  let counted = 0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4;
      const r = data[i], gg = data[i + 1], b = data[i + 2];
      const luma = (0.299 * r + 0.587 * gg + 0.114 * b) / 255;
      const gx = Math.min(7, Math.floor(x / cell)), gy = Math.min(7, Math.floor(y / cell));
      grid[gy * 8 + gx] += luma;
      const [h, s, v] = rgb2hsv(r, gg, b);
      hist.h[Math.min(7, Math.floor(h * 8))]++;
      hist.s[Math.min(7, Math.floor(s * 8))]++;
      hist.v[Math.min(7, Math.floor(v * 8))]++;
      counted++;
    }
  }
  for (let k = 0; k < 64; k++) grid[k] /= cell * cell; // average luma per cell
  const normHist = (a: number[]) => a.map(n => n / counted);

  const vec = [...grid, ...normHist(hist.h), ...normHist(hist.s), ...normHist(hist.v)];
  return l2normalize(vec);
}

/* cosine similarity of two unit vectors → 0..1 (they're already normalised). */
export function similarity(a?: number[], b?: number[]): number {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return Math.max(0, Math.min(1, dot));
}

export type VisualHit = { product: Product; score: number };

/* Rank existing products by how much they look like this embedding. */
export async function visualSearch(embedding: number[], opts: { vendor_id?: string; limit?: number; min?: number } = {}): Promise<VisualHit[]> {
  const limit = opts.limit ?? 8, min = opts.min ?? 0.6;
  const hits: VisualHit[] = [];
  await db.products.each(p => {
    if (p.deleted || !p.embedding) return;
    if (opts.vendor_id && p.vendor_id && p.vendor_id !== opts.vendor_id) return; // optional vendor scoping
    const score = similarity(embedding, p.embedding);
    if (score >= min) hits.push({ product: p, score });
  });
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

/* The confidence band that triggers the disambiguation guardrail. */
export const CONFIDENCE = { verify: 0.86, sure: 0.94 } as const;

export type MatchDecision =
  | { action: "new"; hits: VisualHit[] }                       // nothing close enough → make a new product
  | { action: "match"; product: Product; score: number; hits: VisualHit[] } // confident + attributes agree
  | { action: "verify"; reason: string; hits: VisualHit[]; top?: VisualHit }; // looks alike → confirm Model No.

/* The core hybrid decision. `candidate` carries whatever attributes the operator
   has typed so far (model/article, vendor, style, colour). */
export function decideMatch(
  candidate: Pick<Product, "model" | "style" | "color" | "vendor_id" | "item">,
  hits: VisualHit[],
): MatchDecision {
  const top = hits[0];
  if (!top || top.score < CONFIDENCE.verify) return { action: "new", hits };

  const wantKey = productKey(candidate);
  const topKey = productKey(top.product);
  const haveKey = !!(candidate.model || candidate.style);

  // Same Model+Vendor+Colour → genuinely the same product. Safe to match.
  if (haveKey && wantKey === topKey) return { action: "match", product: top.product, score: top.score, hits };

  // Looks the same (>= threshold) but the key differs, or no key typed yet.
  // This is exactly the case the guardrail exists for: DO NOT auto-assign.
  if (haveKey && wantKey !== topKey) {
    return {
      action: "verify",
      reason: `This looks ${(top.score * 100).toFixed(0)}% like ${describe(top.product)}, but the Model/Vendor differs. Confirm the Model Number so two different articles don't get merged.`,
      hits, top,
    };
  }
  // Very high similarity but the operator hasn't typed a model at all → force it.
  return {
    action: "verify",
    reason: `Strong visual match to ${describe(top.product)} (${(top.score * 100).toFixed(0)}%). Enter the Model/Article number to confirm it's the same product, or mark it as a new one.`,
    hits, top,
  };
}

function describe(p: Product) {
  return [p.model || p.style, p.color, p.vendor_name].filter(Boolean).join(" · ") || p.item || "an existing product";
}

/* Convenience: embed an existing product's stored photo (used to backfill the
   catalogue so older items become searchable). */
export async function embedProductPhoto(p: Product): Promise<number[] | null> {
  const url = await photoSrc(p.photo_id, p.photo_url);
  if (!url) return null;
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.src = url;
  try { await img.decode(); } catch { return null; }
  return embedImage(img);
}

// ---- small helpers ------------------------------------------------------
async function toBitmap(src: Blob | HTMLImageElement | HTMLCanvasElement): Promise<CanvasImageSource> {
  if (src instanceof Blob) return createImageBitmap(src);
  return src;
}
function l2normalize(v: number[]): number[] {
  let n = 0; for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return v.map(x => x / n);
}
function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6; if (h < 0) h += 1;
  }
  const s = max ? d / max : 0;
  return [h, s, max];
}
