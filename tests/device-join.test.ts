import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";

/* Owner, 22 Oct: "it keeps asking me to create the company again and again". A new computer must join the
   shop by itself (no email, no password), and a product it made under a code the cloud already has must
   become the cloud's product, with its stock moved across, so "Sync problem" clears. */

const auth = vi.hoisted(() => ({
  getSession: vi.fn(async () => ({ data: { session: null as any } })),
  signInAnonymously: vi.fn(),
  signOut: vi.fn(),
}));
const cloudRows = vi.hoisted(() => ({ products: [] as any[] }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth,
    from: (t: string) => ({ select: () => ({ eq: (_k: string, v: string) => ({ limit: async () => ({ data: (cloudRows as any)[t].filter((r: any) => r.code === v), error: null }) }) }) }),
  }),
}));

const { db, setSetting, put } = await import("../src/lib/db");
const { ensureSession, markShopDevice, adoptCloudProduct, isCodeClash, resetClient, sb } = await import("../src/lib/sync");

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  await setSetting("cloud", { url: "https://x.supabase.co", key: "anon" });
  resetClient();
  auth.getSession.mockReset().mockResolvedValue({ data: { session: null } });
  auth.signInAnonymously.mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

describe("a new computer joins the shop by itself", () => {
  it("does nothing before the shop's entry code was passed on this computer", async () => {
    expect(await ensureSession()).toBe(false);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it("connects without an email or password once the entry code was passed", async () => {
    auth.signInAnonymously.mockResolvedValue({ data: { session: { access_token: "t" } }, error: null });
    await markShopDevice();
    expect(await ensureSession()).toBe(true);
  });

  it("keeps an existing login and never replaces it", async () => {
    auth.getSession.mockResolvedValue({ data: { session: { access_token: "t", user: { email: "owner@gmail.com" } } } });
    await markShopDevice();
    expect(await ensureSession()).toBe(true);
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });
});

describe("the same product made on two computers", () => {
  it("recognises the cloud's code clash", () => {
    expect(isCodeClash({ code: "23505", message: 'duplicate key value violates unique constraint "products_code_uq"' })).toBe(true);
    expect(isCodeClash({ code: "23503", message: "violates foreign key constraint" })).toBe(false);
  });

  it("takes the cloud's product and moves this computer's stock onto it", async () => {
    cloudRows.products = [{ id: "cloud-1", code: "RLYABC12", item: "BANGLES", updated_at: "2026-10-21T10:00:00.000Z", created_at: "2026-10-21T10:00:00.000Z" }];
    await db.products.put({ id: "local-1", code: "RLYABC12", item: "BANGLES", updated_at: "2026-10-20T10:00:00.000Z" } as any);
    await put("movements", { id: "m1", product_id: "local-1", to_loc: "L1", qty: 12, kind: "in", at: "2026-10-22T10:00:00.000Z" } as any);
    const c = (await sb())!;
    expect(await adoptCloudProduct(c, "local-1", "RLYABC12")).toBe(true);
    expect(await db.products.get("local-1")).toBeUndefined();
    expect((await db.products.get("cloud-1"))?.item).toBe("BANGLES");
    expect((await db.movements.get("m1"))?.product_id).toBe("cloud-1");
    expect(await db.outbox.filter(o => o.table === "products" && o.row_id === "local-1").count()).toBe(0);
  });
});
