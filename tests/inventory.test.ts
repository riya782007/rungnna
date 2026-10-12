import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db, now } from "../src/lib/db";
import { createDesign, validateDesign, variantGrid, type DesignInput } from "../src/lib/inventory";
import { purchaseLabelJobs } from "../src/lib/purchase-labels";
import { supplierBalances } from "../src/lib/suppliers";
import { MAIN_STORE, setScope, setScopePerms } from "../src/lib/scope";

const base = (p: Partial<DesignInput> = {}): DesignInput => ({ item: "NECKLACE SET", type: "SET", style: "K5209", pack: 12, cost: 0, rate: 25000, rack: "rack", by: "o",
  variants: variantGrid(["GOLD", "RED"], ["2.4", "2.6"]).map(v => ({ ...v, qty: 13 })), ...p });

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner");
  await db.locations.put({ id: "rack", floor: "1", rack: "1", box: "", kind: "rack", code: "F1-R01", name: "", updated_at: now() });
});

describe("add inventory", () => {
  it("makes one product per colour × size and puts every piece on the rack", async () => {
    const r = await createDesign(base());
    expect(r.products).toHaveLength(4);
    expect(r.purchase?.total_qty).toBe(52);
    const stock = await db.stock.toArray();
    expect(stock.reduce((n, c) => n + c.qty, 0)).toBe(52);
    expect(new Set(r.products.map(p => p.color + p.size))).toEqual(new Set(["GOLD2.4", "GOLD2.6", "RED2.4", "RED2.6"]));
  });
  it("one sticker per full packet, leftover pieces labelled separately", async () => {
    const r = await createDesign(base());
    const jobs = purchaseLabelJobs(r.purchase!, r.products);
    // 13 pieces = 1 packet of 12 + 1 loose, for each of 4 variants
    expect(jobs.reduce((n, j) => n + j.copies, 0)).toBe(8);
    expect(jobs.filter(j => j.qtyOnLabel === 12)).toHaveLength(4);
  });
  it("saving the same design again updates instead of duplicating", async () => {
    await createDesign(base());
    const r2 = await createDesign(base({ rate: 26000 }));
    expect(await db.products.count()).toBe(4);
    expect(r2.products.every(p => p.rate === 26000)).toBe(true);
  });
  it("prices from cost with the shop rule when no rate is typed", async () => {
    const r = await createDesign(base({ rate: 0, cost: 10000, variants: [{ color: "GOLD", size: "", qty: 0 }] }));
    expect(r.products[0].rate).toBeGreaterThan(10000);
    expect(r.products[0].cost_code).toBeTruthy();
    expect(r.purchase).toBeUndefined();
  });
  it("adding stock with a vendor does not create a supplier bill", async () => {
    await db.parties.put({ id: "v", kind: "supplier", name: "SOLANKI", alt_name: "", phone: "", gstin: "", address: "", city: "", state: "", pin: "", tier: "wholesale", credit_limit: 0, notes: "", updated_at: now() });
    await createDesign(base({ vendor_id: "v", vendor_name: "SOLANKI", cost: 5000 }));
    expect((await supplierBalances()).get("v") || 0).toBe(0);
  });
  it("refuses bad input and roles without permission", async () => {
    expect(validateDesign(base({ style: "" }))).toMatch(/style/);
    expect(validateDesign(base({ rack: "" }))).toMatch(/rack/);
    expect(validateDesign(base({ variants: [{ color: "A", size: "", qty: 1 }, { color: "a", size: "", qty: 2 }] }))).toMatch(/twice/);
    setScope(MAIN_STORE, "helper"); setScopePerms(new Set(["stock.in"]));
    await expect(createDesign(base())).rejects.toThrow(/doesn't allow/);
    setScope(MAIN_STORE, "owner"); setScopePerms(new Set());
  });
});
