/* ===========================================================================
   Product-page content: the shape, the prompts, validation and a template
   fallback. Pure (no network, no env) so it is unit-tested in tests/listing.test.ts.

   One generated record feeds all three public surfaces:
     • retail page     — title, description, highlights, specs, FAQ, SEO
     • trade portal    — trade.summary / bullets / packing / moq note
     • catalogue share — title, subtitle, image alt, tags
=========================================================================== */

export interface VisualFacts {
  type?: string; pieces?: string[]; metal_tone?: string; finish?: string; work?: string;
  stones?: string[]; colours?: string[]; motifs?: string[]; occasion?: string[]; distinctive?: string[];
}

export interface ListingContent {
  title: string;
  subtitle: string;
  description: string;
  highlights: string[];
  specs: Record<string, string>;
  faq: { q: string; a: string }[];
  tags: string[];
  alt: string;
  seo: { metaTitle: string; metaDescription: string; keywords: string[]; h1: string; h2: string[] };
  trade: { summary: string; bullets: string[]; packing: string; moq: string };
  facts?: VisualFacts;
  provider?: string;
  generated_at?: string;
}

export interface ProductFacts {
  code: string; item: string; type?: string; style?: string; color?: string; category?: string;
  size?: string; pack?: number; keywords?: string;
}

export const BRAND = "Rungnna Jewellery & Co";

/* ---------------- prompts ---------------- */

export const VISION_PROMPT = `Look closely at this photo of ONE artificial / imitation jewellery product from a wholesaler in Sadar Bazar, Delhi.
Report only what is clearly VISIBLE. Do not guess brand, price or real gold/silver/diamond — this is fashion jewellery.
Return JSON exactly: {"type":"what the piece is (e.g. jhumka earrings, choker necklace set, kada, finger ring)","pieces":["each separate item visible, e.g. necklace, 2 earrings, maang tikka"],"metal_tone":"gold tone | rose gold tone | silver tone | oxidised | antique gold | two tone","finish":"high polish | matte | antique | textured | meenakari","work":"kundan | polki | American diamond (AD/CZ) | temple | pearl | stone | beaded | plain metal","stones":["stone types seen"],"colours":["colours of stones/enamel/beads"],"motifs":["peacock, floral, paisley, coin, geometric…"],"occasion":["bridal | festive | party | daily wear | office"],"distinctive":["short notes on what makes this design recognisable"]}
Use empty strings/arrays when unsure.`;

export function contentPrompt(p: ProductFacts, facts?: VisualFacts): string {
  const f = facts && Object.keys(facts).length ? JSON.stringify(facts) : "";
  return [
    `You write product pages for ${BRAND}, a wholesale + retail imitation (artificial / fashion) jewellery house in Sadar Bazar, Delhi.`,
    `Write ONE product record as STRICT JSON for three uses: a retail product page, a B2B trade portal, and a shareable catalogue.`,
    ``,
    `PRODUCT (ground truth — the ITEM decides what the piece is):`,
    `• Item: ${p.item || "jewellery"}${p.type ? ` · sold per ${p.type}` : ""}`,
    p.category ? `• Category: ${p.category}` : ``,
    p.style ? `• Our style / design no.: ${p.style}` : ``,
    p.color ? `• Colour code: ${p.color}` : ``,
    p.size ? `• Size: ${p.size}` : ``,
    p.pack ? `• Wholesale packing: ${p.pack} pieces per packet` : ``,
    p.keywords ? `• Owner's notes: ${p.keywords}` : ``,
    f ? `• What the photo shows (from image analysis): ${f}` : `• No photo analysis available — describe only what the fields above support.`,
    ``,
    `STRICT RULES:`,
    `• Never invent stones, motifs, pieces, metals or plating that aren't in the fields or photo facts. Never claim real gold, silver, diamond, hallmark or "22K".`,
    `• Say "imitation", "artificial" or "fashion" jewellery where natural. No prices, no discounts, no stock claims, no emojis, no HTML.`,
    `• Indian English, warm and specific. Good for Google: natural keywords, no keyword stuffing.`,
    ``,
    `JSON FIELDS:`,
    `title (Title Case, 45-65 chars, no design number), subtitle (≤90 chars),`,
    `description (retail, 110-150 words, 2 short paragraphs separated by \\n\\n, ends with a line inviting retail and wholesale buyers),`,
    `highlights (4-6 short bullets), specs (object with keys: Type, Pieces, Metal Tone, Finish, Work, Stone Colours, Occasion, Care — "" when unknown),`,
    `faq (3 items {q,a}, practical: care, occasion, wholesale ordering), tags (8-12 lowercase search tags), alt (image alt text ≤120 chars),`,
    `seo: {metaTitle (≤60 chars incl. "| Rungnna"), metaDescription (140-160 chars), keywords (8-12), h1, h2 (3 section headings)},`,
    `trade: {summary (40-70 words for shop owners/resellers: design appeal, sell-through, range fit), bullets (3-5), packing (one line), moq (one line on minimum order in packets)}.`,
    `Return ONLY the JSON object.`,
  ].filter(Boolean).join("\n");
}

/* ---------------- validation / clean-up ---------------- */

const clean = (v: unknown, max = 400) => String(v ?? "").replace(/<[^>]*>/g, "").replace(/[ \t]+/g, " ").trim().slice(0, max);
const list = (v: unknown, maxItems: number, maxLen = 120) =>
  (Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\n]/) : []).map(x => clean(x, maxLen)).filter(Boolean).slice(0, maxItems);
const dedupe = (a: string[]) => { const s = new Set<string>(); return a.filter(x => { const k = x.toLowerCase(); if (s.has(k)) return false; s.add(k); return true; }); };

/* Cut at a word boundary so meta tags never end mid-word. */
export function clip(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max + 1);
  const i = cut.lastIndexOf(" ");
  return (i > max * 0.6 ? cut.slice(0, i) : t.slice(0, max)).replace(/[\s,;:–-]+$/, "");
}

const SPEC_KEYS = ["Type", "Pieces", "Metal Tone", "Finish", "Work", "Stone Colours", "Occasion", "Care"];

/* Accepts whatever the model returned; throws when it's unusable so the caller
   can try the next provider. Always returns a complete, length-safe record. */
export function normalizeListing(raw: any, p: ProductFacts): ListingContent {
  if (!raw || typeof raw !== "object") throw new Error("No JSON object");
  const title = clean(raw.title, 90).replace(new RegExp(`\\b${escapeRe(p.style || "\u0000")}\\b`, "gi"), "").replace(/\s{2,}/g, " ").trim();
  const description = String(raw.description ?? "").replace(/<[^>]*>/g, "").split(/\n{2,}/).map(x => clean(x, 1200)).filter(Boolean).join("\n\n").slice(0, 2000);
  if (title.length < 8 || description.split(/\s+/).length < 40) throw new Error("Answer too thin (title/description)");
  const specsIn = raw.specs && typeof raw.specs === "object" ? raw.specs : {};
  const specs: Record<string, string> = {};
  for (const k of SPEC_KEYS) { const v = clean(specsIn[k] ?? specsIn[k.toLowerCase()] ?? "", 120); if (v) specs[k] = v; }
  if (!specs.Type && p.item) specs.Type = titleCase(p.item);
  const seoIn = raw.seo || {};
  const keywords = dedupe(list(seoIn.keywords, 12, 60).map(k => k.toLowerCase()));
  const metaTitle = clip(clean(seoIn.metaTitle, 120) || `${title} | Rungnna`, 60);
  const metaDescription = clip(clean(seoIn.metaDescription, 300) || description.replace(/\n+/g, " "), 160);
  return {
    title: clip(title, 70),
    subtitle: clip(clean(raw.subtitle, 160), 90),
    description,
    highlights: list(raw.highlights, 6, 140),
    specs,
    faq: (Array.isArray(raw.faq) ? raw.faq : []).map((x: any) => ({ q: clean(x?.q, 160), a: clean(x?.a, 500) })).filter((x: any) => x.q && x.a).slice(0, 4),
    tags: dedupe(list(raw.tags, 12, 40).map(t => t.toLowerCase())),
    alt: clip(clean(raw.alt, 200) || title, 120),
    seo: { metaTitle, metaDescription, keywords: keywords.length ? keywords : dedupe([p.item, p.category, "imitation jewellery", "artificial jewellery", "wholesale jewellery delhi"].filter(Boolean).map(x => String(x).toLowerCase())), h1: clip(clean(seoIn.h1, 120) || title, 90), h2: list(seoIn.h2, 4, 80) },
    trade: {
      summary: clean(raw.trade?.summary, 600),
      bullets: list(raw.trade?.bullets, 5, 140),
      packing: clean(raw.trade?.packing, 160) || (p.pack ? `Packed ${p.pack} pieces per packet` : ""),
      moq: clean(raw.trade?.moq, 160) || (p.pack ? `Minimum order: 1 packet (${p.pack} pcs)` : "Minimum order on request"),
    },
  };
}

export function normalizeFacts(raw: any): VisualFacts {
  if (!raw || typeof raw !== "object") return {};
  const s = (v: unknown) => clean(v, 80);
  return {
    type: s(raw.type), pieces: list(raw.pieces, 8, 60), metal_tone: s(raw.metal_tone), finish: s(raw.finish), work: s(raw.work),
    stones: list(raw.stones, 6, 40), colours: list(raw.colours ?? raw.colors, 8, 30), motifs: list(raw.motifs, 6, 40),
    occasion: list(raw.occasion, 5, 30), distinctive: list(raw.distinctive, 4, 100),
  };
}

/* Deterministic fallback so "Write with AI" always produces a usable page even
   when every provider is down or out of credits. Plain, factual, SEO-safe. */
export function templateListing(p: ProductFacts, facts: VisualFacts = {}): ListingContent {
  const item = titleCase(p.item || "Jewellery");
  const bits = [facts.work, facts.metal_tone].filter(Boolean).map(x => titleCase(String(x)));
  const colour = facts.colours?.length ? titleCase(facts.colours.slice(0, 2).join(" & ")) : "";
  let title = clip([colour, ...bits, item].filter(Boolean).join(" ") || item, 70);
  if (title.length < 16) title = clip(`${title} – Imitation Jewellery`, 70); // "Jhumki" alone is too thin for a page title
  const occ = facts.occasion?.length ? facts.occasion.join(", ") : "festive, party and everyday";
  const description =
    `This ${[colour, ...bits].filter(Boolean).join(" ").toLowerCase() || "stylish"} ${item.toLowerCase()} from ${BRAND} is an imitation jewellery piece made for ${occ} wear.` +
    `${facts.pieces?.length ? ` The set includes ${facts.pieces.join(", ")}.` : ""}${facts.finish ? ` It has a ${facts.finish} finish.` : ""} Light to wear and easy to style with sarees, lehengas and suits.` +
    `\n\nWe are a wholesale jewellery house in Sadar Bazar, Delhi, supplying retailers, resellers and boutiques across India. Retail buyers and trade customers are both welcome — message us on WhatsApp to order or ask for the full catalogue.`;
  return normalizeListing({
    title, subtitle: `${item} · ${BRAND}`, description,
    highlights: [facts.work && `${titleCase(facts.work)} work`, facts.metal_tone && titleCase(facts.metal_tone), colour && `${colour} colour`, "Lightweight, skin-friendly imitation jewellery", "Wholesale and retail orders accepted"].filter(Boolean),
    specs: { Type: facts.type ? titleCase(facts.type) : item, Pieces: facts.pieces?.join(", ") || "", "Metal Tone": facts.metal_tone || "", Finish: facts.finish || "", Work: facts.work || "", "Stone Colours": facts.colours?.join(", ") || "", Occasion: facts.occasion?.join(", ") || "", Care: "Keep away from water, perfume and sweat; store in an air-tight pouch." },
    faq: [
      { q: `How should I care for this ${item.toLowerCase()}?`, a: "Wipe with a soft dry cloth after use, avoid water and perfume, and store it in an air-tight pouch to keep the polish bright." },
      { q: "Can I buy in wholesale quantity?", a: `Yes. ${BRAND} supplies retailers and resellers across India. Ask on WhatsApp for trade rates and packing.` },
      { q: "Is this real gold?", a: "No — this is imitation (artificial) fashion jewellery, designed to look rich at an affordable price." },
    ],
    tags: [item, p.category, facts.work, facts.metal_tone, "imitation jewellery", "artificial jewellery", "fashion jewellery", "sadar bazar jewellery", "wholesale jewellery"].filter(Boolean),
    alt: `${title} by ${BRAND}`,
    seo: { metaTitle: `${title} | Rungnna`, metaDescription: `Shop ${title.toLowerCase()} — imitation jewellery from ${BRAND}, Sadar Bazar, Delhi. Retail and wholesale orders on WhatsApp.`, keywords: [item.toLowerCase(), `${item.toLowerCase()} online`, "imitation jewellery", "artificial jewellery", "fashion jewellery", "wholesale jewellery delhi", "sadar bazar jewellery", facts.work || ""].filter(Boolean), h1: title, h2: ["Design details", "Specifications", "Wholesale & trade"] },
    trade: { summary: `${item} with ${[facts.work, facts.metal_tone].filter(Boolean).join(", ") || "a popular design"} — an easy-selling line for jewellery counters, boutiques and online resellers. Consistent finish and ready stock from Sadar Bazar, Delhi.`, bullets: ["Ready stock, packed for resale", "Consistent finish batch to batch", "Mix designs within an order"] },
  }, p);
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/, "");
}

function titleCase(s: string) { return s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase()); }
function escapeRe(s: string) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
