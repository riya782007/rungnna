import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, now } from "../src/lib/db";
import { newParty, newBill, DEFAULT_SHOP, totals } from "../src/lib/billing";
import { savePhotoPurchase, validatePhotoRows, pricePhotoRows, type PhotoRow } from "../src/lib/purchase-photo";
import { DEFAULT_RULE } from "../src/lib/pricing";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { supplierLedger } from "../src/lib/suppliers";
import { purchaseLabelJobs } from "../src/lib/purchase-labels";

const row: PhotoRow = { item: "BALI", style: "K5209", color: "G", unit: "PAIR", hsn: "7117", qty: "4", cost: "25.50", rate: "100" };
const input = { by: "owner", rack: "rack", supplierId: "supplier", billNo: "SUP-1", note: "Reviewed" };
beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner");
  await db.parties.put({ ...newParty("SUPPLIER"), id: "supplier", kind: "supplier" });
  await db.locations.put({ id: "rack", floor: "1", rack: "1", box: "", kind: "rack", code: "F1-R01", name: "", updated_at: now() });
});
describe("reviewed photo purchases", () => {
  it("calculates missing selling rates without changing printed rates or guessing packaging", () => {
    expect(pricePhotoRows([{ ...row, rate: "" }], DEFAULT_RULE)[0].rate).toBe("65.00");
    for (const patch of [{ rate: "100" }, { rate: "", cost: "unclear" }, { rate: "", unit: "DOZEN" }]) {
      const r = { ...row, ...patch }; expect(pricePhotoRows([r], DEFAULT_RULE)[0]).toEqual(r);
    }
  });
  it("uses reviewed rates and names for existing articles, with deterministic cost codes", async () => {
    await savePhotoPurchase([row], input);
    await savePhotoPurchase([{ ...row, rate: "115" }], { ...input, billNo: "SUP-2" });
    expect((await db.products.toArray())[0]).toMatchObject({ rate: 11500, item: "BALI", cost_code: "OAX1PAIR", price_locked: 1 });
  });
  it("rejects oversized label batches before committing inventory", async () => {
    await expect(savePhotoPurchase([{ ...row, qty: "5001" }], input)).rejects.toThrow("5000");
    expect(await db.purchases.count()).toBe(0); expect(await db.products.count()).toBe(0);
  });
  it("defaults sticker counts to packets while saving the exact purchased quantity", async () => {
    const p = await savePhotoPurchase([{ ...row, qty: "13", pack: "6", stickers: "" }], input);
    const products = await db.products.toArray();
    expect(p.total_qty).toBe(13); expect((await db.stock.toArray())[0].qty).toBe(13);
    expect(p.items[0]).toMatchObject({ qty: 13, pack: 1, label_pack: 6 });
    expect(p.items[0].print_qty).toBeUndefined();
    expect(purchaseLabelJobs(p, products).map(j => [j.qtyOnLabel, j.copies])).toEqual([[6, 2], [1, 1]]);
  });
  it("persists exact sticker overrides without changing the purchased stock", async () => {
    const p = await savePhotoPurchase([{ ...row, qty: "60", pack: "6", stickers: "4" }], input);
    const saved = (await db.purchases.get(p.id))!;
    expect(saved.items[0]).toMatchObject({ qty: 60, label_pack: 6, print_qty: 4 });
    expect((await db.stock.toArray())[0].qty).toBe(60);
    expect(purchaseLabelJobs(saved, await db.products.toArray())).toMatchObject([{ qtyOnLabel: 6, copies: 4 }]);
  });
  it("saves purchases with zero stickers and limits actual stickers rather than stock units", async () => {
    const p = await savePhotoPurchase([{ ...row, qty: "6000", pack: "6", stickers: "0" }], input);
    expect((await db.purchases.get(p.id))!.items[0].print_qty).toBe(0);
    expect((await db.stock.toArray())[0].qty).toBe(6000);
    expect(purchaseLabelJobs(p, await db.products.toArray())).toEqual([]);
    const next = await savePhotoPurchase([{ ...row, qty: "6000", pack: "6", stickers: "" }], { ...input, billNo: "SUP-2" });
    expect(purchaseLabelJobs(next, await db.products.toArray())).toMatchObject([{ qtyOnLabel: 6, copies: 1000 }]);
  });
  it("keeps an existing product's standard packet size when this purchase uses another size", async () => {
    await savePhotoPurchase([{ ...row, pack: "12" }], input);
    const p = await savePhotoPurchase([{ ...row, qty: "24", pack: "6", stickers: "4" }], { ...input, billNo: "SUP-2" });
    const products = await db.products.toArray();
    expect(products[0].pack).toBe(12);
    expect(purchaseLabelJobs(p, products)).toMatchObject([{ qtyOnLabel: 6, copies: 4 }]);
  });
  it("keeps tax/freight in supplier payable, not per-item inventory cost", async () => {
    const p = await savePhotoPurchase([row], { ...input, invoiceTotal: "120.36" });
    expect(p.total_cost).toBe(10200); expect(p.invoice_total).toBe(12036);
    expect((await supplierLedger((await db.parties.get("supplier"))!)).balance).toBe(12036);
  });
  it("saves product, purchase, movements, stock and outbox together", async () => {
    const p = await savePhotoPurchase([row], input);
    expect(p).toMatchObject({ status: "final", total_qty: 4, total_cost: 10200, supplier_bill: "SUP-1" });
    expect(await db.products.count()).toBe(1); expect(await db.movements.count()).toBe(1);
    expect((await db.stock.toArray())[0].qty).toBe(4);
    expect((await db.products.toArray())[0]).toMatchObject({ item: "BALI", type: "PAIR", hsn: "7117", rate: 10000 });
    expect(await db.outbox.count()).toBeGreaterThan(2);
  });
  it("rejects a repeated supplier bill without taking stock twice", async () => {
    await savePhotoPurchase([row], input);
    await expect(savePhotoPurchase([row], input)).rejects.toThrow("already saved");
    expect(await db.purchases.count()).toBe(1); expect((await db.stock.toArray())[0].qty).toBe(4);
  });
  it("rolls back products and numbering when rack validation fails", async () => {
    await expect(savePhotoPurchase([row], { ...input, rack: "missing" })).rejects.toThrow();
    expect(await db.products.count()).toBe(0); expect(await db.purchases.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0); expect(await db.movements.count()).toBe(0);
    expect((await db.settings.toArray()).filter(s => s.key.startsWith("seq_PI"))).toHaveLength(0);
  });
  it("rolls back the first article when a later article is duplicated", async () => {
    await expect(savePhotoPurchase([row, row], input)).rejects.toThrow("Repeated article");
    expect(await db.products.count()).toBe(0); expect(await db.outbox.count()).toBe(0);
  });
  it("does not guess missing prices or convert packaging quantities", () => {
    for (const patch of [{ item: "" }, { cost: "" }, { rate: "" }, { qty: "1.5" }, { unit: "DOZEN" }, { hsn: "bad" }, { pack: "0" }, { pack: "1.5" }, { stickers: "-1" }, { stickers: "1.5" }, { stickers: "5001" }]) expect(() => validatePhotoRows([{ ...row, ...patch }])).toThrow();
  });
  it("restricts purchase-photo saves to owners", async () => {
    setScope(MAIN_STORE, "salesman"); await expect(savePhotoPurchase([row], input)).rejects.toThrow("Owner only");
  });
  it("preserves explicit bb box quantities through recalculation", () => {
    expect(totals({ ...newBill("o", DEFAULT_SHOP), box_count: 2 }).box_count).toBe(2);
  });
});
