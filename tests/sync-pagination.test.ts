import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

type CloudRow = { id: string; updated_at: string; [key: string]: unknown };
type Page = { table: string; since: string; filter?: string; order: string[]; ids: string[] };
const remote = vi.hoisted(() => ({
  rows: {} as Record<string, CloudRow[]>, pages: [] as Page[],
  afterPage: undefined as undefined | ((table: string, page: number) => Promise<void>),
  failure: undefined as undefined | { table: string; page: number },
  from: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({
  auth: { getSession: async () => ({ data: { session: { user: { email: "owner@example.test" } } } }) },
  from: remote.from,
}) }));
import { db, getSetting, setSetting } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { setCloudSyncEnabled } from "../src/lib/cloudMode";
import { onSync, resetClient, syncNow, type SyncState } from "../src/lib/sync";

const stamp = "2026-10-19T09:00:00.000Z";
const row = (i: number, updated_at = stamp): CloudRow => ({ id: String(i).padStart(6, "0"), updated_at, item: "Product " + i });
const pagesOf = (table: string) => remote.pages.filter(page => page.table === table);

// An in-memory cloud query model: filtering, two-column order and server page limits are applied independently.
function cloudQuery(table: string) {
  let since = "", filter: string | undefined;
  const order: string[] = [];
  const query = {
    select: () => query,
    gt: (column: string, value: string) => { expect(column).toBe("updated_at"); since = value; return query; },
    or: (value: string) => { filter = value; return query; },
    order: (column: string) => { order.push(column); return query; },
    limit: async (size: number) => {
      expect(order).toEqual(["updated_at", "id"]);
      let after: { time: string; id: string } | undefined;
      if (filter) {
        const quoted = '"(?:[^"\\\\]|\\\\.)*"';
        const match = new RegExp('^updated_at\\.gt\\.(' + quoted + '),and\\(updated_at\\.eq\\.(' + quoted + '),id\\.gt\\.(' + quoted + ')\\)$').exec(filter);
        if (!match) throw new Error("Invalid PostgREST keyset expression: " + filter);
        expect(JSON.parse(match[1])).toBe(JSON.parse(match[2]));
        after = { time: JSON.parse(match[1]), id: JSON.parse(match[3]) };
      }
      const rows = (remote.rows[table] || []).filter(r => Date.parse(r.updated_at) > Date.parse(since)
        && (!after || Date.parse(r.updated_at) > Date.parse(after.time) || (r.updated_at === after.time && r.id > after.id)))
        .sort((a, b) => Date.parse(a.updated_at) - Date.parse(b.updated_at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).slice(0, size);
      const page = pagesOf(table).length + 1;
      remote.pages.push({ table, since, filter, order: [...order], ids: rows.map(r => r.id) });
      if (remote.failure?.table === table && remote.failure.page === page) return { data: null, error: { message: "Simulated cloud failure" } };
      await remote.afterPage?.(table, page);
      return { data: rows, error: null };
    },
  };
  return query;
}

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  setScope(MAIN_STORE, "owner"); resetClient();
  remote.rows = {}; remote.pages = []; remote.afterPage = undefined; remote.failure = undefined;
  remote.from.mockReset().mockImplementation(cloudQuery);
  vi.stubGlobal("navigator", { onLine: true });
  await setSetting("cloud", { url: "https://shop.supabase.co", key: "anon-test" });
});
afterEach(() => vi.unstubAllGlobals());

describe("cloud pull pagination", () => {
  it("pulls every product when more than 1000 rows share the identical timestamp", async () => {
    remote.rows.products = Array.from({ length: 2501 }, (_, i) => row(i)).reverse();
    await syncNow();
    expect(await db.products.count()).toBe(2501);
    expect(pagesOf("products").map(p => p.ids.length)).toEqual([1000, 1000, 501]);
    expect(new Set(pagesOf("products").flatMap(p => p.ids)).size).toBe(2501);
    expect(await getSetting("cursor_products", "")).toBe(stamp);
  });
  it("finishes an exact full-page boundary and advances by time before ID across pages", async () => {
    remote.rows.products = Array.from({ length: 1000 }, (_, i) => ({ ...row(i), id: "z" + row(i).id }));
    await syncNow();
    expect(pagesOf("products").map(p => p.ids.length)).toEqual([1000, 0]);
    remote.pages = [];
    const nextTime = "2026-10-19T09:00:01.000Z";
    remote.rows.products.push({ ...row(1001, nextTime), id: "a-newer" });
    await syncNow();
    expect(await db.products.count()).toBe(1001);
    expect(pagesOf("products").map(p => p.ids.length)).toEqual([1000, 1]);
    expect((await db.products.get("a-newer"))?.updated_at).toBe(nextTime);
  });
  it("quotes and escapes text config IDs at the keyset boundary", async () => {
    const special = 'b, "quoted" \\ path';
    remote.rows.config = [
      ...Array.from({ length: 999 }, (_, i) => ({ ...row(i), id: "a" + row(i).id, value: i })),
      { id: special, updated_at: stamp, value: "special" },
      { id: "z-last", updated_at: stamp, value: "last" },
    ];
    await syncNow();
    expect(await db.config.count()).toBe(1001);
    expect((await db.config.get(special))?.value).toBe("special");
    expect(pagesOf("config")[1].filter).toContain(JSON.stringify(special));
  });
  it("replays the fixed overlap to pick up late commits without regressing the cursor or overwriting newer local data", async () => {
    const cursor = "2026-10-19T09:00:10.000Z";
    await setSetting("cursor_products", cursor);
    await db.products.put({ ...row(4, "2026-10-19T09:00:12.000Z"), item: "Local edit" } as any);
    remote.rows.products = [row(1, "2026-10-19T09:00:03.000Z"), row(2, "2026-10-19T09:00:05.001Z"), row(3, "2026-10-19T09:00:07.000Z"), row(4, "2026-10-19T09:00:11.000Z")];
    await syncNow();
    expect(await db.products.get("000001")).toBeUndefined();
    expect(await db.products.get("000002")).toBeDefined();
    expect(await db.products.get("000003")).toBeDefined();
    expect((await db.products.get("000004"))?.item).toBe("Local edit");
    expect(pagesOf("products")[0].since).toBe("2026-10-19T09:00:05.000Z");
    expect(await getSetting("cursor_products", "")).toBe("2026-10-19T09:00:11.000Z");
    remote.rows.products = [row(5, "2026-10-19T09:00:08.000Z")];
    await syncNow();
    expect(await db.products.get("000005")).toBeDefined();
    expect(await getSetting("cursor_products", "")).toBe("2026-10-19T09:00:11.000Z");
  });
  it("retries a failed later page without committing an incomplete table cursor", async () => {
    remote.rows.products = Array.from({ length: 1500 }, (_, i) => row(i));
    remote.failure = { table: "products", page: 2 };
    let state: SyncState | undefined; const stop = onSync(s => { state = s; });
    try {
      await syncNow();
      expect(state?.status).toBe("error");
      expect(await db.products.count()).toBe(1000);
      expect(await getSetting("cursor_products", "")).toBe("");
      remote.failure = undefined; remote.pages = [];
      await syncNow();
      expect(await db.products.count()).toBe(1500);
      expect(await getSetting("cursor_products", "")).toBe(stamp);
    } finally { stop(); }
  });
  it("checks owner pause before the next page and rebuilds stock for already applied movement pages", async () => {
    remote.rows.movements = Array.from({ length: 1001 }, (_, i) => ({ ...row(i), product_id: "p", qty: 1, from_loc: null, to_loc: "rack" }));
    remote.afterPage = async (table, page) => { if (table === "movements" && page === 1) await setCloudSyncEnabled(false); };
    await syncNow();
    expect(pagesOf("movements")).toHaveLength(1);
    expect(await db.movements.count()).toBe(1000);
    expect((await db.stock.get("p|rack"))?.qty).toBe(1000);
    expect(await getSetting("cursor_movements", "")).toBe("");
    remote.afterPage = undefined;
    await setCloudSyncEnabled(true);
    await syncNow();
    expect(await db.movements.count()).toBe(1001);
    expect((await db.stock.get("p|rack"))?.qty).toBe(1001);
  });
});
