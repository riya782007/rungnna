import { describe, it, expect } from "vitest";
import { normalizeListing, templateListing, normalizeFacts, clip, slugify, contentPrompt, type ProductFacts } from "../api/_listing";
import { renderProduct, renderTrade, renderShop, renderCatalogue, renderSitemap, renderRobots, esc, type PubProduct } from "../api/_pages";

const facts: ProductFacts = { code: "RAB12X4", item: "JHUMKI", type: "PAIR", style: "K5208/K-LT", color: "W/LP/B", category: "Earrings", pack: 12 };
const long = "word ".repeat(60).trim();

describe("listing content", () => {
  it("normalises a model answer into a complete, length-safe record", () => {
    const c = normalizeListing({
      title: "Kundan Pearl Jhumki Earrings K5208/K-LT in Gold Tone <b>New</b>", description: long,
      highlights: ["a", "b"], specs: { Type: "Jhumki", Work: "Kundan", Junk: "x" }, tags: ["Jhumki", "jhumki", "Kundan"],
      seo: { metaTitle: "Kundan Pearl Jhumki Earrings in Gold Tone for Weddings and Festivals | Rungnna", metaDescription: "x ".repeat(120), keywords: ["Jhumki", "jhumki"] },
      faq: [{ q: "Care?", a: "Keep dry." }, { q: "", a: "dropped" }],
    }, facts);
    expect(c.title).not.toContain("K5208");      // design number never in the title
    expect(c.title).not.toContain("<b>");
    expect(c.seo.metaTitle.length <= 60).toBe(true);
    expect(c.seo.metaDescription.length <= 160).toBe(true);
    expect(c.tags).toEqual(["jhumki", "kundan"]);
    expect(Object.keys(c.specs)).toEqual(["Type", "Work"]);
    expect(c.faq.length).toBe(1);
    expect(c.trade.moq).toBe("Minimum order: 1 packet (12 pcs)");
  });
  it("rejects thin answers so the next provider is tried", () => {
    let threw = false;
    try { normalizeListing({ title: "Hi", description: "short" }, facts); } catch { threw = true; }
    expect(threw).toBe(true);
  });
  it("template fallback is always valid and never claims real gold", () => {
    const c = templateListing(facts, normalizeFacts({ work: "kundan", metal_tone: "gold tone", colours: ["white", "pink"], occasion: ["bridal"] }));
    expect(c.title.length > 8).toBe(true);
    expect(c.description.toLowerCase()).toContain("imitation");
    expect(/22k|hallmark|real gold/i.test(c.description)).toBe(false);
    expect(c.seo.keywords.length >= 5).toBe(true);
  });
  it("prompt carries the ground-truth item and the photo facts", () => {
    const p = contentPrompt(facts, { work: "kundan" });
    expect(p).toContain("Item: JHUMKI");
    expect(p).toContain('"work":"kundan"');
  });
  it("clips at word boundaries and slugifies safely", () => {
    expect(clip("Kundan Pearl Jhumki Earrings Gold", 20)).toBe("Kundan Pearl Jhumki");
    expect(slugify("Kundan & Pearl Jhumki — Gold Tone!")).toBe("kundan-and-pearl-jhumki-gold-tone");
  });
});

const prod = (o: Partial<PubProduct> = {}): PubProduct => ({
  id: "11111111-1111-4111-8111-111111111111", code: "RAB12X4", slug: "kundan-jhumki-rab12x4", item: "JHUMKI", type: "PAIR", style: "K5208", color: "W",
  category: "Earrings", pack: 12, mrp: 49900, image_url: "https://img.example.com/media/p.webp", updated_at: "2026-09-28T10:00:00Z", available: 5,
  content: templateListing(facts, { work: "kundan" }), ...o,
});
const shop = { name: "Rungnna Jewellery & Co", whatsapp: "9811122233" };
const B = "https://rungnna.example";

describe("public pages", () => {
  it("product page is SEO-complete", () => {
    const h = renderProduct(prod(), shop, B);
    expect(h).toContain('<link rel="canonical" href="https://rungnna.example/p/kundan-jhumki-rab12x4">');
    expect(h).toContain('"@type":"Product"');
    expect(h).toContain('"price":"499.00"');
    expect(h).toContain('"@type":"BreadcrumbList"');
    expect(h).toContain('"@type":"FAQPage"');
    expect(h).toContain('property="og:image"');
    expect(h).toContain("index,follow");
    expect(h).toContain("https://wa.me/919811122233");
    expect((h.match(/<h1>/g) || []).length).toBe(1);
  });
  it("escapes everything that came from the database", () => {
    const h = renderProduct(prod({ category: '<script>alert(1)</script>', content: { ...templateListing(facts), title: '"><img src=x onerror=alert(1)>' } }), shop, B);
    expect(h).not.toContain("<script>alert(1)");
    expect(h).not.toContain("<img src=x");
    expect(esc('<a href="x">')).toBe("&lt;a href=&quot;x&quot;&gt;");
    const j = renderProduct(prod({ content: { ...templateListing(facts), description: "</script><script>alert(1)</script> " + long } }), shop, B);
    expect(j).not.toContain("</script><script>alert(1)");
  });
  it("retail pages never show a price when MRP is not set", () => {
    const h = renderProduct(prod({ mrp: 0 }), shop, B);
    expect(h).toContain("Price on request");
    expect(h).not.toContain('"@type":"Offer"');
  });
  it("trade portal: locked without a key, rates + order builder with one", () => {
    const locked = renderTrade([prod()], null, shop, B, { canonical: B + "/trade" });
    expect(locked).toContain("noindex,nofollow");
    expect(locked).not.toContain("/pc");
    const open = renderTrade([prod()], [{ id: prod().id, rate: 18000, pack: 12 }], shop, B, { key: "k", canonical: B + "/trade" });
    expect(open).toContain("₹180");
    expect(open).toContain("12 pcs / packet");
    expect(open).toContain('id="send"');
  });
  it("trade catalogue without a valid key shows no trade rates", () => {
    const h = renderCatalogue({ slug: "diwali", title: "Diwali picks", audience: "trade", product_ids: [prod().id], updated_at: "" }, [prod()], null, shop, B, "bad");
    expect(h).toContain("isn't valid");
    expect(h).not.toContain("/pc");
  });
  it("shop listing, sitemap and robots", () => {
    expect(renderShop([prod()], shop, B, { categories: ["Earrings"], page: 1, pages: 1 })).toContain('"@type":"ItemList"');
    expect(renderSitemap([prod()], B)).toContain("<loc>https://rungnna.example/p/kundan-jhumki-rab12x4</loc>");
    expect(renderRobots(B)).toContain("Disallow: /trade");
  });
});
