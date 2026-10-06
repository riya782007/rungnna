import type { ListingContent } from "./_listing.js";

/* ===========================================================================
   Server-rendered public pages (HTML strings). Pure: data in, HTML out — the
   handler in api/page.ts does the fetching. Rendering on the server (not in the
   app) is what makes these pages visible to Google and to WhatsApp link previews.

   Three surfaces, structured like the reference storefront:
     • Retail   /shop, /p/<slug>     indexable, JSON-LD Product/FAQ/Breadcrumb
     • Trade    /trade?k=<key>       wholesale line-sheet + WhatsApp order builder, noindex
     • Catalogue /c/<slug>[?k=<key>] a shared collection, retail or trade, noindex
=========================================================================== */

export type PubProduct = {
  id: string; code: string; slug: string; item: string; type: string; style: string; color: string; size?: string | null;
  category: string; pack?: number | null; mrp: number; image_url?: string | null; content?: ListingContent | null; updated_at: string; available: number;
};
export type Shop = { name?: string | null; tagline?: string | null; phone?: string | null; whatsapp?: string | null; address?: string | null; state?: string | null };
export type Catalogue = { slug: string; title: string; note?: string | null; audience: "retail" | "trade" | "preview"; product_ids: string[]; updated_at: string };
export type TradeRate = { id: string; rate: number; pack?: number | null };

export const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const ld = (o: unknown) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
export const inr = (paise: number) => "₹" + (Math.round(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
const shopName = (s: Shop) => (s.name || "Rungnna Jewellery & Co").trim();
export function waNumber(s: Shop): string { const d = String(s.whatsapp || s.phone || "").replace(/\D/g, ""); return d.length === 10 ? "91" + d : d; }
const waLink = (s: Shop, text: string) => { const n = waNumber(s); return n ? `https://wa.me/${n}?text=${encodeURIComponent(text)}` : ""; };

const titleOf = (p: PubProduct) => p.content?.title || [p.item, p.color].filter(Boolean).join(" ") || p.code;
const descOf = (p: PubProduct) => p.content?.seo?.metaDescription || p.content?.subtitle || `${titleOf(p)} — imitation jewellery`;

type Head = { title: string; description: string; canonical: string; image?: string | null; keywords?: string[]; robots: string; ogType?: string; extra?: string };

function page(h: Head, shop: Shop, body: string, base: string, opts: { nav?: "shop" | "trade" | "none"; script?: string } = {}): string {
  const name = shopName(shop);
  const wa = waLink(shop, `Hello ${name}`);
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(h.title)}</title><meta name="description" content="${esc(h.description)}">
${h.keywords?.length ? `<meta name="keywords" content="${esc(h.keywords.join(", "))}">` : ""}
<meta name="robots" content="${h.robots}"><link rel="canonical" href="${esc(h.canonical)}">
<meta property="og:site_name" content="${esc(name)}"><meta property="og:type" content="${h.ogType || "website"}"><meta property="og:title" content="${esc(h.title)}">
<meta property="og:description" content="${esc(h.description)}"><meta property="og:url" content="${esc(h.canonical)}">
${h.image ? `<meta property="og:image" content="${esc(h.image)}"><meta name="twitter:image" content="${esc(h.image)}">` : ""}
<meta name="twitter:card" content="${h.image ? "summary_large_image" : "summary"}"><meta name="theme-color" content="#241B2E">
<link rel="icon" href="/icon.svg">${h.extra || ""}<style>${CSS}</style></head><body>
<header class="top"><a class="brand" href="${opts.nav === "none" ? esc(h.canonical) : base + "/shop"}"><span class="mark">R</span><span>${esc(name)}<small>${esc(shop.tagline || "Fashion & imitation jewellery · Sadar Bazar, Delhi")}</small></span></a>
${opts.nav === "none" ? "" : `<nav><a href="${base}/shop"${opts.nav === "shop" ? ' aria-current="page"' : ""}>Shop</a><a href="${base}/trade"${opts.nav === "trade" ? ' aria-current="page"' : ""}>Trade portal</a>${wa ? `<a class="wa" href="${esc(wa)}" rel="noopener">WhatsApp</a>` : ""}</nav>`}</header>
<main>${body}</main>
<footer><b>${esc(name)}</b>${shop.address ? `<span>${esc(shop.address)}</span>` : ""}${shop.phone ? `<span>${esc(shop.phone)}</span>` : ""}<span>Retail &amp; wholesale imitation jewellery · Sadar Bazar, Delhi</span></footer>
${opts.script ? `<script>${opts.script}</script>` : ""}</body></html>`;
}

function card(p: PubProduct, base: string, price: string, extra = ""): string {
  return `<article class="card"><a href="${base}/p/${esc(p.slug)}">${img(p, "lazy")}<h3>${esc(titleOf(p))}</h3></a>
<div class="meta"><span class="code">${esc(p.code)}</span>${price}</div>${extra}</article>`;
}
function img(p: PubProduct, loading: "lazy" | "eager" = "lazy"): string {
  return p.image_url
    ? `<img src="${esc(p.image_url)}" alt="${esc(p.content?.alt || titleOf(p))}" loading="${loading}" width="800" height="1000">`
    : `<div class="noimg">${esc((p.item || "RJ").slice(0, 2))}</div>`;
}
const stockBadge = (p: PubProduct) => (p.available > 0 ? `<span class="ok">In stock</span>` : `<span class="soon">On order</span>`);
const retailPrice = (p: PubProduct) => (p.mrp > 0 ? `<b class="price">${inr(p.mrp)}</b>` : `<span class="ask">Price on request</span>`);

/* ---------------- retail: product page ---------------- */
export function renderProduct(p: PubProduct, shop: Shop, base: string): string {
  const c = p.content;
  const url = `${base}/p/${p.slug}`;
  const title = titleOf(p);
  const name = shopName(shop);
  const wa = waLink(shop, `Hi ${name}, I'm interested in ${title} (${p.code}) — ${url}`);
  const specs = Object.entries(c?.specs || {}).filter(([, v]) => v);
  if (p.size && !specs.some(([k]) => k === "Size")) specs.push(["Size", p.size]);
  specs.push(["Design no.", p.code]);
  const h2 = c?.seo?.h2 || [];
  const crumbs = [{ n: "Shop", u: `${base}/shop` }, ...(p.category ? [{ n: p.category, u: `${base}/shop?category=${encodeURIComponent(p.category)}` }] : []), { n: title, u: url }];
  const jsonld = [
    { "@context": "https://schema.org", "@type": "Product", name: title, sku: p.code, mpn: p.code, description: (c?.description || descOf(p)).replace(/\n+/g, " "),
      ...(p.image_url ? { image: [p.image_url] } : {}), brand: { "@type": "Brand", name }, category: p.category || p.item,
      ...(p.mrp > 0 ? { offers: { "@type": "Offer", url, priceCurrency: "INR", price: (p.mrp / 100).toFixed(2), availability: p.available > 0 ? "https://schema.org/InStock" : "https://schema.org/BackOrder", itemCondition: "https://schema.org/NewCondition", seller: { "@type": "Organization", name } } } : {}) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: crumbs.map((x, i) => ({ "@type": "ListItem", position: i + 1, name: x.n, item: x.u })) },
    ...(c?.faq?.length ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: c.faq.map(f => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })) }] : []),
  ];
  const body = `<nav class="crumbs" aria-label="Breadcrumb">${crumbs.map((x, i) => i < crumbs.length - 1 ? `<a href="${esc(x.u)}">${esc(x.n)}</a>` : `<span>${esc(x.n)}</span>`).join(" › ")}</nav>
<div class="pdp"><div class="gallery">${img(p, "eager")}</div><div class="info">
<h1>${esc(c?.seo?.h1 || title)}</h1>${c?.subtitle ? `<p class="sub">${esc(c.subtitle)}</p>` : ""}
<div class="buy">${retailPrice(p)}${stockBadge(p)}</div>
${wa ? `<a class="btn" href="${esc(wa)}" rel="noopener">Order on WhatsApp</a>` : ""}
${c?.highlights?.length ? `<ul class="hl">${c.highlights.map(x => `<li>${esc(x)}</li>`).join("")}</ul>` : ""}
</div></div>
${c?.description ? `<section><h2>${esc(h2[0] || "Design details")}</h2>${c.description.split(/\n{2,}/).map(x => `<p>${esc(x)}</p>`).join("")}</section>` : ""}
<section><h2>${esc(h2[1] || "Specifications")}</h2><table class="specs">${specs.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join("")}</table></section>
<section class="trade-cta"><h2>${esc(h2[2] || "Wholesale & trade")}</h2><p>${esc(c?.trade?.summary || "Retailers, boutiques and resellers can buy this design in wholesale quantity.")}</p>
${c?.trade?.moq ? `<p class="mut">${esc(c.trade.moq)}${c.trade.packing ? " · " + esc(c.trade.packing) : ""}</p>` : ""}<a class="btn ghost" href="${base}/trade">Trade portal</a></section>
${c?.faq?.length ? `<section><h2>Questions</h2>${c.faq.map(f => `<details><summary>${esc(f.q)}</summary><p>${esc(f.a)}</p></details>`).join("")}</section>` : ""}`;
  return page({ title: c?.seo?.metaTitle || `${title} | ${name}`, description: descOf(p), canonical: url, image: p.image_url, keywords: c?.seo?.keywords, robots: "index,follow,max-image-preview:large", ogType: "product", extra: ld(jsonld) }, shop, body, base, { nav: "shop" });
}

/* ---------------- retail: shop listing ---------------- */
export function renderShop(list: PubProduct[], shop: Shop, base: string, opts: { category?: string; categories: string[]; page: number; pages: number }): string {
  const name = shopName(shop);
  const cat = opts.category || "";
  const h1 = cat ? `${cat} — imitation jewellery` : `Imitation jewellery by ${name}`;
  const url = `${base}/shop${cat ? `?category=${encodeURIComponent(cat)}` : ""}`;
  const body = `<section class="hero"><h1>${esc(h1)}</h1><p>${esc(shop.tagline || "Fashion & imitation jewellery, retail and wholesale, from Sadar Bazar, Delhi.")}</p></section>
${opts.categories.length ? `<nav class="chips" aria-label="Categories"><a href="${base}/shop"${cat ? "" : ' aria-current="page"'}>All</a>${opts.categories.map(x => `<a href="${base}/shop?category=${encodeURIComponent(x)}"${x === cat ? ' aria-current="page"' : ""}>${esc(x)}</a>`).join("")}</nav>` : ""}
<div class="grid">${list.map(p => card(p, base, retailPrice(p))).join("") || `<p class="mut">New designs are being added — check back soon.</p>`}</div>
${opts.pages > 1 ? `<nav class="pager">${opts.page > 1 ? `<a href="${esc(url + (cat ? "&" : "?") + "page=" + (opts.page - 1))}" rel="prev">← Newer</a>` : "<span></span>"}<span>Page ${opts.page} of ${opts.pages}</span>${opts.page < opts.pages ? `<a href="${esc(url + (cat ? "&" : "?") + "page=" + (opts.page + 1))}" rel="next">Older →</a>` : "<span></span>"}</nav>` : ""}`;
  const jsonld = { "@context": "https://schema.org", "@type": "ItemList", itemListElement: list.map((p, i) => ({ "@type": "ListItem", position: i + 1, url: `${base}/p/${p.slug}`, name: titleOf(p) })) };
  return page({ title: `${h1} | ${name}`, description: `Shop ${cat ? cat.toLowerCase() + " " : ""}imitation jewellery from ${name}, Sadar Bazar, Delhi — retail and wholesale, order on WhatsApp.`, canonical: url + (opts.page > 1 ? `${cat ? "&" : "?"}page=${opts.page}` : ""), image: list.find(p => p.image_url)?.image_url, robots: "index,follow", extra: ld(jsonld) }, shop, body, base, { nav: "shop" });
}

/* ---------------- trade: line-sheet with a WhatsApp order builder ---------------- */
export function renderTrade(list: PubProduct[], rates: TradeRate[] | null, shop: Shop, base: string, opts: { key?: string; title?: string; note?: string | null; canonical: string; audienceLabel?: string }): string {
  const name = shopName(shop);
  const robots = "noindex,nofollow";
  if (!rates) {
    const wa = waLink(shop, `Hi ${name}, I'm a retailer/reseller and would like access to your trade portal.`);
    const body = `<section class="hero"><h1>${esc(opts.title || "Trade portal")}</h1><p>Wholesale rates, packing and minimum orders for retailers, boutiques and resellers.</p>
${opts.key ? `<p class="warn">That access link isn't valid any more. Ask us for a new one.</p>` : ""}
${wa ? `<a class="btn" href="${esc(wa)}" rel="noopener">Request trade access on WhatsApp</a>` : ""}<p class="mut">Already a customer? Open the trade link we sent you on WhatsApp.</p></section>`;
    return page({ title: `Trade portal | ${name}`, description: `Wholesale imitation jewellery for retailers and resellers — ${name}, Sadar Bazar, Delhi.`, canonical: opts.canonical, robots }, shop, body, base, { nav: "trade" });
  }
  const byId = new Map(rates.map(r => [r.id, r]));
  const rows = list.filter(p => byId.has(p.id));
  const items = rows.map(p => ({ code: p.code, title: titleOf(p), rate: byId.get(p.id)!.rate, pack: p.pack || byId.get(p.id)!.pack || 1 }));
  const body = `<section class="hero"><h1>${esc(opts.title || "Wholesale line-sheet")}</h1><p>${esc(opts.note || "Trade rates per piece. Enter packets and send your order on WhatsApp — we confirm stock and dispatch.")}</p><p class="mut">${rows.length} designs · rates exclusive of GST</p></section>
<div class="grid trade">${rows.map((p, i) => {
    const r = byId.get(p.id)!, pack = p.pack || r.pack || 1;
    return card(p, base, `<b class="price">${inr(r.rate)}<small>/pc</small></b>`,
      `<div class="tmeta">${stockBadge(p)}<span>${pack} pcs / packet</span></div>${p.content?.trade?.bullets?.length ? `<ul class="tb">${p.content.trade.bullets.slice(0, 3).map(b => `<li>${esc(b)}</li>`).join("")}</ul>` : ""}
<label class="qty">Packets <input type="number" min="0" step="1" inputmode="numeric" data-i="${i}" value=""></label>`);
  }).join("") || `<p class="mut">No designs in this list yet.</p>`}</div>
${rows.length && waNumber(shop) ? `<div class="orderbar"><span id="sum">Add packets to build your order</span><button class="btn" id="send" disabled>Send order on WhatsApp</button></div>` : ""}`;
  const script = rows.length && waNumber(shop) ? `(function(){var I=${JSON.stringify(items).replace(/</g, "\\u003c")},N=${JSON.stringify(waNumber(shop))},T=${JSON.stringify(opts.title || "line-sheet").replace(/</g, "\\u003c")},S=document.getElementById("sum"),B=document.getElementById("send");
function f(p){return"\\u20b9"+(p/100).toLocaleString("en-IN",{maximumFractionDigits:2})}
function c(){var l=[],t=0,q=0;document.querySelectorAll("input[data-i]").forEach(function(e){var n=parseInt(e.value,10)||0;if(n>0){var x=I[+e.dataset.i],pcs=n*x.pack;t+=pcs*x.rate;q+=pcs;l.push(x.code+" "+x.title+" — "+n+" pkt ("+pcs+" pcs) @ "+f(x.rate))}});S.textContent=l.length?l.length+" designs · "+q+" pcs · "+f(t)+" + GST":"Add packets to build your order";B.disabled=!l.length;return{l:l,t:t,q:q}}
document.addEventListener("input",function(e){if(e.target.matches&&e.target.matches("input[data-i]"))c()});
B.onclick=function(){var o=c();if(!o.l.length)return;var m="Trade order — "+T+"\\n\\n"+o.l.join("\\n")+"\\n\\nTotal: "+o.q+" pcs · "+f(o.t)+" + GST";window.open("https://wa.me/"+N+"?text="+encodeURIComponent(m),"_blank")};})();` : "";
  return page({ title: `${opts.title || "Trade portal"} | ${name}`, description: `Wholesale line-sheet — ${name}`, canonical: opts.canonical, robots }, shop, body, base, { nav: "trade", script });
}

/* ---------------- catalogue: a shared collection ---------------- */
export function renderCatalogue(cat: Catalogue, list: PubProduct[], rates: TradeRate[] | null, shop: Shop, base: string, key?: string): string {
  const canonical = `${base}/c/${cat.slug}`;
  if (cat.audience === "trade") return renderTrade(list, rates, shop, base, { key, title: cat.title, note: cat.note, canonical });
  const name = shopName(shop);
  const wa = waLink(shop, `Hi ${name}, I saw your catalogue "${cat.title}" — ${canonical}`);
  if (cat.audience === "preview") {
    const body = `<section class="hero"><h1>${esc(cat.title)}</h1>${cat.note ? `<p>${esc(cat.note)}</p>` : ""}${wa ? `<a class="btn" href="${esc(wa)}" rel="noopener">Enquire on WhatsApp</a>` : ""}</section><div class="grid">${list.map(p => `<article class="card">${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(titleOf(p))}" loading="lazy">` : ""}<h2>${esc(titleOf(p))}</h2><p>${esc(p.style)} · ${esc(p.color)}</p><p>${esc(p.code)}</p></article>`).join("")}</div>`;
    return page({ title: `${cat.title} | ${name}`, description: cat.note || cat.title, canonical, image: list.find(p => p.image_url)?.image_url, robots: "noindex,nofollow" }, shop, body, base, { nav: "none" });
  }
  const body = `<section class="hero"><h1>${esc(cat.title)}</h1>${cat.note ? `<p>${esc(cat.note)}</p>` : ""}<p class="mut">${list.length} designs</p>${wa ? `<a class="btn" href="${esc(wa)}" rel="noopener">Enquire on WhatsApp</a>` : ""}</section>
<div class="grid">${list.map(p => card(p, base, retailPrice(p), stockBadge(p))).join("") || `<p class="mut">This catalogue is empty.</p>`}</div>`;
  return page({ title: `${cat.title} | ${name}`, description: cat.note || `${list.length} imitation jewellery designs from ${name}`, canonical, image: list.find(p => p.image_url)?.image_url, robots: "noindex,follow" }, shop, body, base, { nav: "shop" });
}

export function renderNotFound(shop: Shop, base: string, what = "page"): string {
  return page({ title: `Not found | ${shopName(shop)}`, description: "This page is not available.", canonical: `${base}/shop`, robots: "noindex,follow" }, shop,
    `<section class="hero"><h1>This ${esc(what)} isn't available</h1><p>It may have sold out or been removed.</p><a class="btn" href="${base}/shop">See all designs</a></section>`, base, { nav: "shop" });
}

export function renderSitemap(list: Pick<PubProduct, "slug" | "updated_at">[], base: string): string {
  const u = (loc: string, lastmod?: string) => `<url><loc>${esc(loc)}</loc>${lastmod ? `<lastmod>${esc(lastmod.slice(0, 10))}</lastmod>` : ""}</url>`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${u(`${base}/shop`)}${list.map(p => u(`${base}/p/${p.slug}`, p.updated_at)).join("")}</urlset>`;
}

export const renderRobots = (base: string) => `User-agent: *\nAllow: /shop\nAllow: /p/\nDisallow: /trade\nDisallow: /c/\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`;

const CSS = `:root{--ink:#17161B;--mut:#7A7580;--line:#E7E3DC;--bg:#FAF7F1;--gold:#B8903F;--gold-d:#8C6A26;--ok:#1F7A5C;--card:#fff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Noto Sans",sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}img{max-width:100%;display:block}
.top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:14px clamp(14px,4vw,40px);background:#fff;border-bottom:1px solid var(--line);position:sticky;top:0;z-index:5}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;font-weight:700}.brand small{display:block;font-weight:400;font-size:12px;color:var(--mut)}
.mark{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:linear-gradient(145deg,#D9B869,#9C7630);color:#2A1E05;font-weight:800}
nav a{text-decoration:none;margin-left:14px;font-size:14px;color:var(--mut)}nav a[aria-current]{color:var(--ink);font-weight:600}nav a.wa{color:var(--ok);font-weight:600}
main{max-width:1180px;margin:0 auto;padding:clamp(14px,3vw,32px)}
.hero{padding:10px 0 18px}.hero h1,h1{font:600 clamp(26px,4vw,40px)/1.15 Georgia,"Times New Roman",serif;margin:0 0 8px;letter-spacing:-.01em}
h2{font:600 22px/1.2 Georgia,serif;margin:0 0 10px}section{margin:28px 0}
.mut{color:var(--mut)}.warn{color:#9A6A00}
.btn{display:inline-block;background:var(--ink);color:#fff;text-decoration:none;border:0;border-radius:999px;padding:12px 22px;font-weight:600;font-size:15px;cursor:pointer}
.btn.ghost{background:transparent;color:var(--ink);border:1px solid var(--ink)}.btn:disabled{opacity:.4;cursor:default}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}.chips a{margin:0;padding:6px 14px;border:1px solid var(--line);border-radius:999px;background:#fff;color:var(--ink)}.chips a[aria-current]{background:var(--ink);color:#fff}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:16px;overflow:hidden;display:flex;flex-direction:column}
.card>a{text-decoration:none}.card img,.noimg{aspect-ratio:4/5;width:100%;height:auto;object-fit:cover;background:#F2EEE6}
.noimg{display:grid;place-items:center;font:700 28px Georgia,serif;color:var(--gold-d)}
.card h3{font-size:15px;font-weight:600;margin:10px 12px 4px;line-height:1.3}
.meta,.tmeta{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:0 12px 10px;font-size:13px}.tmeta{color:var(--mut)}
.code{font-family:ui-monospace,Menlo,monospace;color:var(--mut);font-size:12px}.price{font-size:16px}.price small{font-weight:400;color:var(--mut)}.ask{color:var(--mut)}
.ok{color:var(--ok);font-size:12px;font-weight:600}.soon{color:#9A6A00;font-size:12px;font-weight:600}
.crumbs{font-size:13px;color:var(--mut);margin-bottom:14px}.crumbs a{text-decoration:none}
.pdp{display:grid;grid-template-columns:minmax(0,1.1fr) minmax(0,1fr);gap:clamp(18px,4vw,48px);align-items:start}
@media(max-width:760px){.pdp{grid-template-columns:1fr}}
.gallery img,.gallery .noimg{border-radius:18px;aspect-ratio:4/5;object-fit:cover;width:100%;height:auto}
.sub{color:var(--mut);margin:0 0 16px}.buy{display:flex;align-items:center;gap:14px;margin:0 0 16px}.buy .price{font-size:26px}
.hl{padding-left:18px;margin:20px 0 0}.hl li{margin:6px 0}
.specs{border-collapse:collapse;width:100%;max-width:720px;background:#fff;border:1px solid var(--line);border-radius:12px;overflow:hidden}
.specs th,.specs td{text-align:left;padding:10px 14px;border-bottom:1px solid var(--line);font-size:14px;vertical-align:top}.specs th{width:38%;color:var(--mut);font-weight:500}
.trade-cta{background:#fff;border:1px solid var(--line);border-radius:16px;padding:20px}
details{background:#fff;border:1px solid var(--line);border-radius:12px;padding:12px 16px;margin:8px 0}summary{cursor:pointer;font-weight:600}
.tb{margin:0;padding:0 12px 8px 28px;font-size:13px;color:var(--mut)}
.qty{display:flex;justify-content:space-between;align-items:center;padding:8px 12px 12px;margin-top:auto;font-size:13px}.qty input{width:84px;padding:8px;border:1px solid var(--line);border-radius:10px;font:inherit}
.orderbar{position:sticky;bottom:12px;margin-top:20px;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;background:#fff;border:1px solid var(--line);border-radius:999px;padding:8px 8px 8px 20px;box-shadow:0 10px 30px -12px rgba(0,0,0,.25)}
.pager{display:flex;justify-content:space-between;margin:24px 0;font-size:14px}
footer{max-width:1180px;margin:30px auto 0;padding:24px clamp(14px,3vw,32px) 40px;border-top:1px solid var(--line);display:flex;flex-wrap:wrap;gap:6px 18px;font-size:13px;color:var(--mut)}footer b{color:var(--ink)}`;
