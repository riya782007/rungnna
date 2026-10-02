import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, stockOf } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { createStore, dispatchTransfer, receiveTransfer, storeStock } from "../src/lib/stores";
import { blankProduct } from "../src/lib/products";
import { DEFAULT_SHOP, finalize, newBill, lineFrom } from "../src/lib/billing";
import { reportData } from "../src/lib/reports";
beforeEach(async () => {
  setScope(MAIN_STORE, "owner"); await Promise.all(db.tables.map(t => t.clear()));
  await db.stores.bulkPut([{ id: MAIN_STORE, code: "MAIN", name: "Main", address: "", active: 1, updated_at: "" }, { id: "s2", code: "B2", name: "Branch 2", address: "", active: 1, updated_at: "" }]);
  await db.locations.bulkPut([{ id: "r1", store_id: MAIN_STORE, code: "R1", floor: "", rack: "", box: "", name: "", kind: "rack", updated_at: "" }, { id: "r2", store_id: "s2", code: "B2/R1", floor: "", rack: "", box: "", name: "", kind: "rack", updated_at: "" }]);
  await db.products.put({ ...blankProduct("o"), id: "p", item: "CHAIN", rate: 10000 });
  await db.stock.bulkPut([{ key: "p|r1", product_id: "p", loc_id: "r1", qty: 10 }, { key: "p|r2", product_id: "p", loc_id: "r2", qty: 100 }]);
});
describe("branches", () => {
  it("takes sales only from this branch and uses its series", async () => { const p = (await db.products.get("p"))!; const b = await finalize({ ...newBill("o", DEFAULT_SHOP, "gst"), items: [{ ...lineFrom(p), qty: 2 }] }, ""); expect((await db.stock.get("p|r1"))?.qty).toBe(8); expect((await db.stock.get("p|r2"))?.qty).toBe(100); expect(b.store_id).toBe(MAIN_STORE); expect(b.no.length).toBeLessThanOrEqual(16); setScope("s2", "salesman"); expect((await stockOf("p"))[0].loc_id).toBe("r2"); await expect(finalize(b, "")).rejects.toThrow("another store"); });
  it("dispatches, tracks in transit, and receives exactly once", async () => { const t = await dispatchTransfer("s2", [{ product_id: "p", from_loc: "r1", qty: 3 }], "o"); expect((await db.stock.get("p|r1"))?.qty).toBe(7); expect((await db.stock.get("p|r2"))?.qty).toBe(100); setScope("s2", "salesman"); await receiveTransfer(t.id, { "0": "r2" }, "s"); expect((await db.stock.get("p|r2"))?.qty).toBe(103); await expect(receiveTransfer(t.id, { "0": "r2" }, "s")).rejects.toThrow("cannot be received"); });
  it("rolls back a multi-line transfer if any line lacks stock", async () => { await expect(dispatchTransfer("s2", [{ product_id: "p", from_loc: "r1", qty: 3 }, { product_id: "p", from_loc: "r1", qty: 20 }], "o")).rejects.toThrow("Not enough stock"); expect((await db.stock.get("p|r1"))?.qty).toBe(10); expect(await db.store_transfers.count()).toBe(0); expect(await db.movements.count()).toBe(0); });
  it("rejects receiving into the wrong branch rack", async () => { const t = await dispatchTransfer("s2", [{ product_id: "p", from_loc: "r1", qty: 3 }], "o"); setScope("s2", "salesman"); await expect(receiveTransfer(t.id, { "0": "r1" }, "s")).rejects.toThrow("correct store"); expect((await db.store_transfers.get(t.id))?.status).toBe("in_transit"); });
  it("filters valuation by store or all stores", async () => { expect((await storeStock()).reduce((a, c) => a + c.qty, 0)).toBe(10); const r = { from: "2026-01-01", to: "2026-12-31" }; expect((await reportData(r)).valuation.length).toBe(1); expect((await reportData({ ...r, store: "all" })).valuation.length).toBe(2); });
  it("requires the owner to create a branch", async () => { setScope(MAIN_STORE, "salesman"); await expect(createStore("Branch", "B3")).rejects.toThrow("Owner only"); });
});
