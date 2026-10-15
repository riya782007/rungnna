import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, type Product } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";

/* Writing a page costs money on every call. The loop has to protect three things:
   the owner's credit, the work already done, and the owner's own words. */

const gen = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("../src/lib/listing", async (orig) => ({
  ...(await orig<typeof import("../src/lib/listing")>()),
  generateListing: gen.run,
}));

const { writePages, pickForListing, needsPage, canWritePage, planPublish, publishAll, describePlan, GIVE_UP_AFTER } =
  await import("../src/lib/bulkListing");

const page = (title: string) => ({
  content: { title, subtitle: "", description: "", highlights: [], seo: { metaTitle: "", metaDescription: "", keywords: [] }, trade: { summary: "", bullets: [], packing: "", moq: "" } },
  provider: "openai", vision: false, attempts: [],
});

const prod = (over: Partial<Product> = {}): Product => ({
  id: Math.random().toString(36).slice(2), code: "R" + Math.random().toString(36).slice(2, 7).toUpperCase(),
  barcodes: [], item: "NECKLACE SET", type: "PCS", style: "K900", color: "GOLD", tk: "",
  rate: 2400, mrp: 0, category: "", notes: "", created_by: "t", created_at: "", updated_at: "2026-01-01",
  ...over,
});

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  setScope(MAIN_STORE, "owner");
  gen.run.mockReset().mockImplementation(async (p: Product) => page("Page for " + p.code));
  vi.stubGlobal("navigator", { onLine: true });
});

describe("choosing what to write", () => {
  it("writes only the products with no page yet, and never invents one from nothing", async () => {
    await db.products.bulkPut([
      prod({ id: "a" }),
      prod({ id: "b", content: page("Already written").content }),
      prod({ id: "c", item: "", style: "" }),            // nothing to describe
    ]);
    const missing = await pickForListing("missing");
    expect(missing.map(p => p.id)).toEqual(["a"]);
    const all = await pickForListing("all");
    expect(all.map(p => p.id).sort()).toEqual(["a", "b"]);   // "c" never appears in either
    expect(canWritePage(prod({ item: "", style: "" }))).toBe(false);
    expect(needsPage(prod({ content: page("x").content }))).toBe(false);
  });
});

describe("writing in bulk", () => {
  it("saves each page as it is written, so stopping keeps the work", async () => {
    const ps = [prod({ id: "1" }), prod({ id: "2" }), prod({ id: "3" })];
    await db.products.bulkPut(ps);
    let seen = 0;
    const r = await writePages(ps, { gapMs: 0, cancelled: () => ++seen > 2 });   // stop before the third
    expect(r.stopped).toBe("cancelled");
    expect(r.ok).toBe(2);
    expect((await db.products.get("1"))!.content!.title).toBe("Page for " + ps[0].code);
    expect((await db.products.get("2"))!.content!.title).toBeTruthy();
    expect((await db.products.get("3"))!.content).toBeUndefined();              // untouched
  });

  it("stops after three failures in a row instead of burning the whole catalogue", async () => {
    const ps = Array.from({ length: 50 }, (_, i) => prod({ id: String(i) }));
    await db.products.bulkPut(ps);
    gen.run.mockRejectedValue(new Error("exceeded your current quota"));
    const r = await writePages(ps, { gapMs: 0 });
    expect(r.stopped).toBe("provider");
    expect(gen.run).toHaveBeenCalledTimes(GIVE_UP_AFTER);        // 3 calls, not 50
    expect(r.failures[0].why).toContain("quota");
  });

  it("keeps going when one product fails for its own reason", async () => {
    const ps = [prod({ id: "1" }), prod({ id: "2" }), prod({ id: "3" })];
    await db.products.bulkPut(ps);
    gen.run.mockImplementation(async (p: Product) => {
      if (p.id === "2") throw new Error("photo unreadable");
      return page("Page for " + p.id);
    });
    const r = await writePages(ps, { gapMs: 0 });
    expect(r.stopped).toBe("");                                   // the streak reset
    expect(r.ok).toBe(2);
    expect(r.failures).toHaveLength(1);
    expect(r.failures[0].item).toContain("NECKLACE SET");
  });

  it("refuses an answer with no title rather than saving an empty page", async () => {
    const ps = [prod({ id: "1" })];
    await db.products.bulkPut(ps);
    gen.run.mockResolvedValue({ ...page(""), content: { ...page("").content, title: "   " } });
    const r = await writePages(ps, { gapMs: 0 });
    expect(r.ok).toBe(0);
    expect(r.failures[0].why).toContain("no title");
    expect((await db.products.get("1"))!.content).toBeUndefined();
  });

  it("does not overwrite a slug the owner chose", async () => {
    const ps = [prod({ id: "1", slug: "my-own-address" })];
    await db.products.bulkPut(ps);
    await writePages(ps, { gapMs: 0 });
    expect((await db.products.get("1"))!.slug).toBe("my-own-address");
  });

  it("says plainly that it needs internet rather than failing product by product", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(writePages([prod()], { gapMs: 0 })).rejects.toThrow(/needs internet/);
    expect(gen.run).not.toHaveBeenCalled();
  });

  it("reports progress the owner can watch", async () => {
    const ps = [prod({ id: "1" }), prod({ id: "2" })];
    await db.products.bulkPut(ps);
    const seen: string[] = [];
    await writePages(ps, { gapMs: 0, onProgress: s => seen.push(`${s.done}/${s.total}`) });
    expect(seen[0]).toBe("0/2");
    expect(seen.at(-1)).toBe("2/2");
  });
});

describe("publishing in bulk", () => {
  const live = (over: Partial<Product> = {}) => prod({ content: page("T").content, photo_url: "https://img/x.jpg", ...over });

  it("separates what can go live from what is still missing something", () => {
    const plan = planPublish([live({ id: "ok" }), prod({ id: "nopage", photo_url: "https://img/y.jpg" }), live({ id: "nophoto", photo_url: "" })]);
    expect(plan.ready.map(p => p.id)).toEqual(["ok"]);
    expect(plan.blocked.map(b => b.p.id).sort()).toEqual(["nopage", "nophoto"]);
    expect(plan.blocked.find(b => b.p.id === "nopage")!.why).toMatch(/product page/i);
    expect(plan.blocked.find(b => b.p.id === "nophoto")!.why).toMatch(/photo/i);
  });

  it("publishes only the ready ones and leaves the blocked ones alone", async () => {
    const ps = [live({ id: "ok" }), live({ id: "nophoto", photo_url: "" })];
    await db.products.bulkPut(ps);
    const r = await publishAll(ps);
    expect(r).toEqual({ published: 1, blocked: 1 });
    expect((await db.products.get("ok"))!.catalogue).toBe(1);
    expect((await db.products.get("ok"))!.slug).toBeTruthy();
    expect((await db.products.get("nophoto"))!.catalogue).toBeUndefined();
  });

  it("summarises a run before the owner commits to it", () => {
    const d = describePlan([live(), prod({ photo_url: "https://i/1.jpg" }), prod()]);
    expect(d).toMatchObject({ total: 3, withPage: 1, withPhoto: 2, ready: 1 });
  });
});
