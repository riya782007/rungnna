import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, now } from "../src/lib/db";
import { newParty, newBill, DEFAULT_SHOP, totals } from "../src/lib/billing";
import { savePhotoPurchase, validatePhotoRows, pricePhotoRows, type PhotoRow } from "../src/lib/purchase-photo";
import { DEFAULT_RULE } from "../src/lib/pricing";
import { MAIN_STORE, setScope, setScopePerms } from "../src/lib/scope";
import { supplierLedger } from "../src/lib/suppliers";

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
    for (const patch of [{ item: "" }, { cost: "" }, { rate: "" }, { qty: "1.5" }, { unit: "DOZEN" }, { hsn: "bad" }]) expect(() => validatePhotoRows([{ ...row, ...patch }])).toThrow();
  });
  it("restricts purchase-photo saves to owners and roles granted it", async () => {
    setScope(MAIN_STORE, "salesman"); setScopePerms(new Set());
    await expect(savePhotoPurchase([row], input)).rejects.toThrow("doesn't allow");
    // purchases.photo alone is not enough: the save also creates the products it read off the bill
    setScopePerms(new Set(["purchases.photo"]));
    await expect(savePhotoPurchase([row], input)).rejects.toThrow("adding or editing products");
    setScopePerms(new Set(["purchases.photo", "products.edit", "stock.in"]));
    await expect(savePhotoPurchase([row], input)).resolves.toMatchObject({ status: "final" });
    setScopePerms(new Set());
  });
  it("preserves explicit bb box quantities through recalculation", () => {
    expect(totals({ ...newBill("o", DEFAULT_SHOP), box_count: 2 }).box_count).toBe(2);
  });
});

/* The two bill shapes the shop actually hands over:
   - a printed challan (RLJ 5494) with NO article column, "CHOTI"/"SETS"/"Copper Set" repeated
     on 30 lines at different rates, and a Box column beside a piece count;
   - a handwritten order/estimate form where quantity and rate are written together ("23x252").
   Before autoArticle() every one of those lines failed validation for want of an article, and
   any two that shared a name collided on save. */
describe("bills that print no article number", () => {
  const challan = (item: string, cost: string, qty: string): PhotoRow =>
    ({ item, style: "", color: "", unit: "PCS", hsn: "", qty, cost, rate: "" });

  it("builds an article from the item and its rate, so same-name lines stay separate", async () => {
    const { autoArticle } = await import("../src/lib/purchase-photo");
    const rows = autoArticle([
      challan("CHOTI", "273", "23"), challan("CHOTI", "176", "5"), challan("CHOTI", "190", "5"),
      challan("SETS", "255", "33"), challan("SETS", "86", "40"), challan("Copper Set", "980", "2"),
    ]);
    expect(rows.map(r => r.style)).toEqual(["CHOTI-273", "CHOTI-176", "CHOTI-190", "SETS-255", "SETS-86", "COPPERSET-980"]);
    expect(rows.every(r => r.autoStyle)).toBe(true);
    expect(new Set(rows.map(r => r.style)).size).toBe(rows.length);
  });

  it("separates two lines of the same item at the same rate instead of silently merging them", async () => {
    const { autoArticle } = await import("../src/lib/purchase-photo");
    // the real challan has SETS at 91.00 on both line 13 and line 18
    const rows = autoArticle([challan("SETS", "91", "20"), challan("SETS", "91", "8")]);
    expect(rows.map(r => r.style)).toEqual(["SETS-91", "SETS-91-2"]);
  });

  it("never touches an article the bill actually printed", async () => {
    const { autoArticle } = await import("../src/lib/purchase-photo");
    const rows = autoArticle([
      { ...challan("KADA", "112", "12"), style: "0705" },
      challan("KADA", "100", "12"),
    ]);
    expect(rows[0].style).toBe("0705");
    expect(rows[0].autoStyle).toBeUndefined();
    expect(rows[1].style).toBe("KADA-100");
  });

  it("turns a whole page of that challan into saveable lines and the right label count", async () => {
    const { autoArticle } = await import("../src/lib/purchase-photo");
    const page = [
      ["CHOTI", "273", "23"], ["CHOTI", "176", "5"], ["CHOTI", "190", "5"], ["CHOTI", "149", "11"],
      ["CHOTI", "196", "11"], ["CHOTI", "216", "11"], ["CHOTI", "162", "18"], ["SETS", "255", "33"],
      ["SETS", "86", "40"], ["SETS", "90", "17"], ["SETS", "121", "12"], ["SETS", "193", "16"],
      ["SETS", "91", "20"], ["SETS", "100", "16"], ["SETS", "83", "18"], ["SETS", "95", "17"],
      ["SETS", "92", "16"], ["SETS", "91", "8"], ["SETS", "125", "6"], ["SETS", "76", "144"],
    ].map(([i, c, q]) => challan(i, c, q));
    const rows = pricePhotoRows(autoArticle(page), DEFAULT_RULE);
    const checked = validatePhotoRows(rows);              // would have thrown before autoArticle
    expect(checked).toHaveLength(20);
    expect(checked.reduce((n, r) => n + r.qty, 0)).toBe(447);   // one label per piece
    // qty x cost must reproduce the bill's own arithmetic: the 20 printed line totals
    // (6279 + 880 + 950 + ... + 10944) add up to Rs 55,544.00
    expect(checked.reduce((n, r) => n + r.qty * r.cost, 0)).toBe(5554400);
  });

  it("saves a no-article bill end to end and gives every line its own product", async () => {
    setScopePerms(new Set(["purchases.photo", "products.edit", "stock.in"]));
    const { autoArticle } = await import("../src/lib/purchase-photo");
    const rows = pricePhotoRows(autoArticle([
      challan("CHOTI", "273", "23"), challan("CHOTI", "176", "5"), challan("SETS", "91", "20"), challan("SETS", "91", "8"),
    ]), DEFAULT_RULE);
    const p = await savePhotoPurchase(rows, { ...input, billNo: "5494" });
    expect(p.status).toBe("final");
    expect(p.items).toHaveLength(4);
    const products = await db.products.toArray();
    expect(products).toHaveLength(4);
    expect(new Set(products.map(x => x.code)).size).toBe(4);     // distinct codes, so a scan is unambiguous
    expect(new Set(products.map(x => x.style)).size).toBe(4);
    expect(p.items.reduce((n, l) => n + l.qty, 0)).toBe(56);
    setScopePerms(new Set());
  });

  it("re-buying the same item at the same rate matches the existing product instead of making a new one", async () => {
    setScopePerms(new Set(["purchases.photo", "products.edit", "stock.in"]));
    const { autoArticle } = await import("../src/lib/purchase-photo");
    const once = pricePhotoRows(autoArticle([challan("CHOTI", "273", "23")]), DEFAULT_RULE);
    await savePhotoPurchase(once, { ...input, billNo: "5494" });
    const again = pricePhotoRows(autoArticle([challan("CHOTI", "273", "10")]), DEFAULT_RULE);
    await savePhotoPurchase(again, { ...input, billNo: "5611" });
    expect(await db.products.count()).toBe(1);                   // same article, restocked
    expect(await db.purchases.count()).toBe(2);
    setScopePerms(new Set());
  });
});

describe("sticker preview before approval", () => {
  it("shows the real sticker fields, and never becomes the thing that prints", async () => {
    const { draftLabelProducts } = await import("../src/lib/purchase-photo");
    const [p] = draftLabelProducts([{ ...row, item: "choti", style: "choti-273", cost: "273", rate: "550" }], "owner", DEFAULT_RULE);
    expect(p.item).toBe("CHOTI");
    expect(p.style).toBe("CHOTI-273");
    expect(p.rate).toBe(55000);
    expect(p.cost).toBe(27300);
    expect(p.cost_code).toBeTruthy();     // the owner's cost cipher, as on the packet stickers
    expect(p.pack).toBe(1);
  });
  it("does not throw while a cost is half-typed", async () => {
    const { draftLabelProducts } = await import("../src/lib/purchase-photo");
    expect(() => draftLabelProducts([{ ...row, cost: "", rate: "" }], "owner", DEFAULT_RULE)).not.toThrow();
  });
});
