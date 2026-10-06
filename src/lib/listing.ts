import { db, put, now, type Product, type Config } from "./db";
import { api, blobToB64 } from "./ai";
import { slugify } from "../../api/_listing";
import type { ListingContent } from "../../api/_listing";

/* Client side of the online catalogue: write a product page with AI, publish it,
   and manage the trade portal + shareable catalogues. The pages themselves are
   rendered on the server (api/page.ts) from what this saves. */

export type { ListingContent };
export type Attempt = { provider: string; ok: boolean; kind?: string; message?: string };
export type ListingResult = { content: ListingContent; provider: string; vision: boolean; attempts: Attempt[] };

/* Best image for the page: the polished catalogue photo, else the raw one. */
export const cloudImage = (p: Pick<Product, "pro_photo_url" | "photo_url">) => p.pro_photo_url || p.photo_url || "";

export async function generateListing(p: Product, keywords = ""): Promise<ListingResult> {
  // send the photo itself when it's on this device (no need to wait for upload); else its cloud URL
  const localId = p.pro_photo_id || p.photo_id;
  const blob = localId ? (await db.photos.get(localId))?.blob : undefined;
  const body: any = {
    task: "listing", keywords,
    product: { code: p.code, item: p.item, type: p.type, style: p.style, color: p.color, category: p.category, size: p.size, pack: p.pack },
  };
  if (blob) { body.image = await blobToB64(blob); body.mime = blob.type || "image/jpeg"; }
  else if (cloudImage(p)) body.image_url = cloudImage(p);
  return api<ListingResult>("ai", body);
}

/* Stable, readable, unique URL: the title words + our design code. */
export const slugFor = (p: Pick<Product, "code">, title: string) => slugify(`${title} ${p.code}`);

/* What still stops a product from going live, in plain words. */
export function publishBlockers(p: Product): string[] {
  const out: string[] = [];
  if (!p.content?.title) out.push("Write the product page first");
  if (!cloudImage(p)) out.push(p.photo_id || p.pro_photo_id ? "Photo is still uploading to the cloud (needs internet + R2)" : "Add a photo");
  return out;
}

export const humanAttempt = (a: Attempt) => {
  const who = a.provider === "openai" ? "OpenAI" : a.provider === "groq" ? "Groq" : a.provider === "gemini" ? "Gemini (photo)" : a.provider;
  if (a.ok) return `${who} ✓`;
  const why = a.kind === "quota" ? "out of credits" : a.kind === "rate_limit" ? "busy (rate limit)" : a.kind === "no_key" ? "key not added" : a.kind === "timeout" ? "timed out" : "failed";
  return `${who}: ${why}`;
};

/* ---------------- trade portal + catalogues (synced config rows) ---------------- */

export type TradePortal = { token: string; enabled: boolean; created_at: string };
export type CatalogueRow = { slug: string; title: string; note: string; audience: "retail" | "trade" | "preview"; product_ids: string[]; key?: string; active: boolean; created_at: string };

export function randomKey(n = 24): string {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  const abc = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  return [...a].map(x => abc[x % abc.length]).join("");
}

export async function getTradePortal(): Promise<TradePortal | null> {
  const c = await db.config.get("trade_portal");
  return c && !c.deleted ? (c.value as TradePortal) : null;
}
export async function saveTradePortal(v: TradePortal) {
  await put("config", { id: "trade_portal", value: v, updated_at: now() } as Config);
}

export async function listCatalogues(): Promise<CatalogueRow[]> {
  const rows = await db.config.filter(c => c.id.startsWith("catalogue:") && !c.deleted).toArray();
  return rows.map(r => ({ ...(r.value as CatalogueRow), slug: r.id.slice(10) })).sort((a, b) => b.created_at.localeCompare(a.created_at));
}
export async function saveCatalogue(c: CatalogueRow) {
  const v = { ...c, key: c.audience === "trade" ? c.key || randomKey() : undefined };
  await put("config", { id: "catalogue:" + c.slug, value: v, updated_at: now() } as Config);
  return v;
}
export async function deleteCatalogue(slug: string) {
  const r = await db.config.get("catalogue:" + slug);
  if (r) await put("config", { ...r, deleted: 1 });
}

/* Public links. Pages live on the same site as the app. */
export const siteBase = () => location.origin;
export const productUrl = (slug: string) => `${siteBase()}/p/${slug}`;
export const shopUrl = () => `${siteBase()}/shop`;
export const tradeUrl = (t: TradePortal) => `${siteBase()}/trade?k=${t.token}`;
export const catalogueUrl = (c: Pick<CatalogueRow, "slug" | "audience" | "key">) => `${siteBase()}/c/${c.slug}${c.audience === "trade" && c.key ? `?k=${c.key}` : ""}`;
export const waShare = (text: string) => `https://wa.me/?text=${encodeURIComponent(text)}`;

export async function copy(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}
