import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
const remote = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn(), create: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: (...args: unknown[]) => {
  remote.create(...args);
  return { auth: { getSession: remote.session }, from: remote.from };
} }));
import { db, setSetting } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { cloudSyncEnabled, setCloudSyncEnabled } from "../src/lib/cloudMode";
import { onSync, resetClient, syncNow, type SyncState } from "../src/lib/sync";
import { submitGst } from "../src/lib/compliance";
import { newBill, DEFAULT_SHOP } from "../src/lib/billing";

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  setScope(MAIN_STORE, "owner"); resetClient();
  remote.create.mockClear(); remote.from.mockReset(); remote.session.mockReset();
  remote.session.mockResolvedValue({ data: { session: { user: { email: "owner@example.test" }, access_token: "local-test" } } });
  remote.from.mockImplementation(() => {
    const chain: any = { select: () => chain, gt: () => chain, order: () => chain, limit: async () => ({ data: [], error: null }), upsert: async () => ({ error: null }) };
    return chain;
  });
  vi.stubGlobal("navigator", { onLine: true });
  await setSetting("cloud", { url: "https://shop.supabase.co", key: "anon-test" });
});
afterEach(() => vi.unstubAllGlobals());

describe("offline counter and explicit online controls", () => {
  it("retains queued GST changes without any cloud calls when the counter has no internet", async () => {
    await db.outbox.add({ table: "bills", row_id: "offline-gst", at: new Date().toISOString(), tries: 0 });
    let state: SyncState | undefined; const stop = onSync(s => { state = s; });
    try {
      vi.stubGlobal("navigator", { onLine: false });
      expect(await cloudSyncEnabled()).toBe(true);
      await syncNow();
      expect(state).toMatchObject({ status: "offline", cloudEnabled: true, pending: 1 });
      expect(await db.outbox.count()).toBe(1);
      expect(remote.create).not.toHaveBeenCalled(); expect(remote.from).not.toHaveBeenCalled();
    } finally { stop(); }
  });
  it("syncs the exact locally saved GST bill after connectivity returns without requiring a second bill save", async () => {
    const bill = newBill("owner", DEFAULT_SHOP, "gst");
    await db.bills.put(bill);
    await db.outbox.add({ table: "bills", row_id: bill.id, at: bill.updated_at, tries: 0 });
    vi.stubGlobal("navigator", { onLine: false }); await syncNow();
    expect(await db.outbox.count()).toBe(1); expect(remote.from).not.toHaveBeenCalled();
    vi.stubGlobal("navigator", { onLine: true }); await syncNow();
    expect(remote.from).toHaveBeenCalledWith("bills"); expect(await db.outbox.count()).toBe(0);
    expect((await db.bills.get(bill.id))?.id).toBe(bill.id);
  });
  it("allows only an owner to enable or disable this computer's cloud sync", async () => {
    setScope(MAIN_STORE, "salesman");
    await expect(setCloudSyncEnabled(false)).rejects.toThrow("Owner only");
    expect(await cloudSyncEnabled()).toBe(true);
    setScope(MAIN_STORE, "owner"); await setCloudSyncEnabled(true); expect(await cloudSyncEnabled()).toBe(true);
    await syncNow(); expect(remote.from).toHaveBeenCalled();
    remote.from.mockClear(); remote.session.mockClear();
    await setCloudSyncEnabled(false); await syncNow();
    expect(remote.from).not.toHaveBeenCalled(); expect(remote.session).not.toHaveBeenCalled();
  });
  it("serializes simultaneous sync triggers before asynchronous session lookup", async () => {
    await setCloudSyncEnabled(true);
    let resolveSession!: (value: any) => void;
    remote.session.mockReturnValueOnce(new Promise(resolve => { resolveSession = resolve; }));
    const first = syncNow();
    await vi.waitFor(() => expect(remote.session).toHaveBeenCalledTimes(1));
    const second = syncNow();
    resolveSession({ data: { session: { user: { email: "owner@example.test" } } } });
    await Promise.all([first, second]);
    expect(remote.session).toHaveBeenCalledTimes(1);
  });
  it("does not start a government request without both separate approval and cloud permission", async () => {
    await setCloudSyncEnabled(false);
    const bill = newBill("owner", DEFAULT_SHOP, "gst");
    await expect(submitGst(bill, "irn", "generate")).rejects.toThrow("separate online submission box");
    await expect(submitGst(bill, "irn", "generate", undefined, true)).rejects.toThrow("Offline mode is active");
    expect(remote.create).not.toHaveBeenCalled(); expect(remote.from).not.toHaveBeenCalled();
  });
});
