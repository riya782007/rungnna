import { env } from "./_lib.js";
import {
  renderProduct, renderShop, renderTrade, renderCatalogue, renderNotFound, renderSitemap, renderRobots,
  type PubProduct, type Shop, type Catalogue, type TradeRate,
} from "./_pages.js";

/* Public web pages, rendered on the server so Google and WhatsApp previews see real
   content. Reached through the rewrites in vercel.json:
     /shop  /p/<slug>  /trade?k=  /c/<slug>?k=  /sitemap.xml  /robots.txt
   Reads ONLY the customer-safe views from migration 0008 with the public anon key;
   trade rates come from trade_prices(), which returns nothing without a valid key. */

const PER_PAGE = 48;

async function rest<T>(path: string, init?: RequestInit): Promise<T> {
  const url = env("SUPABASE_URL"), key = env("SUPABASE_ANON_KEY");
  const r = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", ...(init?.headers || {}) },
    signal: AbortSignal.timeout(8_000),
  });
  if (!r.ok) throw new Error(`catalogue data ${r.status}: ${(await r.text().catch(() => "")).slice(0, 160)}`);
  return r.json() as Promise<T>;
}
const shopInfo = async (): Promise<Shop> => (await rest<Shop[]>("public_shop?select=*").catch(() => []))[0] || {};
const tradeRates = (key: string, slug: string | null) =>
  key ? rest<TradeRate[]>("rpc/trade_prices", { method: "POST", body: JSON.stringify({ p_key: key, p_slug: slug }) }).then(r => (r.length ? r : null)).catch(() => null) : Promise.resolve(null);
const inList = (ids: string[]) => `(${ids.map(i => `"${i.replace(/[^a-f0-9-]/gi, "")}"`).join(",")})`;

function out(body: string, status = 200, type = "text/html; charset=utf-8", cache = "public, s-maxage=300, stale-while-revalidate=86400") {
  return new Response(body, { status, headers: { "content-type": type, "cache-control": cache, "x-content-type-options": "nosniff" } });
}
const PRIVATE = "private, no-store";

export async function GET(req: Request) {
  const u = new URL(req.url);
  const view = u.searchParams.get("view") || "shop";
  const slug = (u.searchParams.get("slug") || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 80);
  const key = (u.searchParams.get("k") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  const host = req.headers.get("x-forwarded-host") || req.headers.get("host") || u.host;
  const base = (env("SITE_URL") || `https://${host}`).replace(/\/+$/, "");

  if (view === "robots") return out(renderRobots(base), 200, "text/plain; charset=utf-8");
  if (!env("SUPABASE_URL") || !env("SUPABASE_ANON_KEY"))
    return out("<!doctype html><title>Setting up</title><p>The online catalogue isn't connected yet (SUPABASE_URL / SUPABASE_ANON_KEY).</p>", 503, undefined, PRIVATE);

  try {
    if (view === "sitemap") {
      const list = await rest<PubProduct[]>("public_products?select=slug,updated_at&order=updated_at.desc&limit=5000");
      return out(renderSitemap(list, base), 200, "application/xml; charset=utf-8");
    }
    const shop = await shopInfo();

    if (view === "product") {
      const [p] = await rest<PubProduct[]>(`public_products?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`);
      return p ? out(renderProduct(p, shop, base)) : out(renderNotFound(shop, base, "design"), 404);
    }

    if (view === "shop") {
      const category = (u.searchParams.get("category") || "").slice(0, 60);
      const pg = Math.max(1, parseInt(u.searchParams.get("page") || "1") || 1);
      const all = await rest<Pick<PubProduct, "category">[]>("public_products?select=category");
      const categories = [...new Set(all.map(x => x.category).filter(Boolean))].sort();
      const filtered = category ? all.filter(x => x.category === category).length : all.length;
      const q = `public_products?select=*&order=updated_at.desc&limit=${PER_PAGE}&offset=${(pg - 1) * PER_PAGE}${category ? `&category=eq.${encodeURIComponent(category)}` : ""}`;
      const list = await rest<PubProduct[]>(q);
      return out(renderShop(list, shop, base, { category, categories, page: pg, pages: Math.max(1, Math.ceil(filtered / PER_PAGE)) }));
    }

    if (view === "trade") {
      const rates = await tradeRates(key, null);
      const list = rates ? await rest<PubProduct[]>("public_products?select=*&order=category.asc,updated_at.desc&limit=1000") : [];
      return out(renderTrade(list, rates, shop, base, { key, canonical: `${base}/trade` }), 200, undefined, PRIVATE);
    }

    if (view === "catalogue") {
      const [cat] = await rest<Catalogue[]>(`public_catalogues?select=*&slug=eq.${encodeURIComponent(slug)}&limit=1`);
      if (!cat) return out(renderNotFound(shop, base, "catalogue"), 404, undefined, PRIVATE);
      const ids = (Array.isArray(cat.product_ids) ? cat.product_ids : []).filter(x => typeof x === "string").slice(0, 500);
      const found = ids.length ? await rest<PubProduct[]>(`public_products?select=*&id=in.${encodeURIComponent(inList(ids))}`) : [];
      const order = new Map(ids.map((id, i) => [id, i]));
      found.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      const rates = cat.audience === "trade" ? await tradeRates(key, cat.slug) : null;
      return out(renderCatalogue(cat, found, rates, shop, base, key), 200, undefined, cat.audience === "trade" ? PRIVATE : undefined);
    }

    return out(renderNotFound(shop, base), 404);
  } catch (e: any) {
    console.error("[page]", view, e?.message || e);
    return out("<!doctype html><meta name=robots content=noindex><title>Try again</title><p style='font-family:sans-serif;padding:24px'>The catalogue is busy — please refresh in a moment.</p>", 503, undefined, PRIVATE);
  }
}
