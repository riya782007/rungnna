import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { blankProduct, findByScan, label, nameItemCode } from "../src/lib/products";
import { resolveScan, lineOf } from "../src/lib/stockin";
import { resolveBillingScan } from "../src/lib/billing-products";
import { ownPayload } from "../src/lib/parse";
import { productForLabel } from "../src/lib/purchase-labels";
import { lineFrom } from "../src/lib/billing";
import { MAIN_STORE, setScope } from "../src/lib/scope";

const legacy = "5186~100~1~212~~K5209/~KXZKLN";
const tag = "E2000017221101441890ABCD";
beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); });

describe("consistent named products across scanners", () => {
  it.each(["shop", "rungnna"] as const)("uses a %s sticker's quantity in billing and stock without changing the master packet", async format => {
    const p = { ...blankProduct("o"), item: "BALI", type: "PAIR", style: "K5209", item_code: "5186", pack: 12, rate: 10000 };
    await db.products.put(p);
    const raw = ownPayload(productForLabel(p, 1), format);
    const billing = (await resolveBillingScan(raw, "o"))!;
    const stock = (await resolveScan(raw, "o")).product!;
    expect(lineFrom(billing, 1).qty).toBe(1); expect(lineOf(stock).qty).toBe(1);
    expect((await findByScan(raw))?.pack).toBe(1);
    expect((await db.products.get(p.id))?.pack).toBe(12);
    expect(await db.products.count()).toBe(1);
  });
  it("repairs stock-in's exact barcode match even when its stored item code is missing", async () => {
    const p = { ...blankProduct("o"), barcodes: [legacy], rate: 12300 };
    await db.products.put(p);
    const result = await resolveScan(legacy, "o");
    expect(result.created).toBe(false);
    expect(result.product).toMatchObject({ id: p.id, item: "BALI", item_code: "5186", type: "PAIR", rate: 12300, style: "K5209/", color: "KXZKLN" });
    expect(lineOf(result.product!).item).toBe("BALI");
    expect((await db.products.get(p.id))?.item).toBe("BALI");
    const queued = await db.outbox.count();
    await findByScan(legacy);
    expect(await db.outbox.count()).toBe(queued);
  });
  it("uses the same product and details in billing, stock-in and lookup-only scans", async () => {
    const stock = (await resolveScan(legacy, "o")).product!;
    const bill = (await resolveBillingScan(legacy, "o"))!;
    const lookup = (await findByScan(legacy))!;
    expect([bill.id, lookup.id]).toEqual([stock.id, stock.id]);
    expect([stock, bill, lookup].map(p => label(p))).toEqual(Array(3).fill("BALI · K5209/ · KXZKLN"));
    expect(await db.products.count()).toBe(1);
    expect(await db.stock.count()).toBe(0);
    expect(await db.movements.count()).toBe(0);
  });
  it.each(["opaque-123", tag])("recovers a name for %s using the stored legacy label", async raw => {
    const p = { ...blankProduct("o"), barcodes: [raw, legacy] };
    await db.products.put(p);
    expect(await findByScan(raw)).toMatchObject({ id: p.id, item: "BALI", type: "PAIR", item_code: "5186" });
  });
  it("fills names from named QRs for label, movement, recheck and RFID-link lookups", async () => {
    const raw = "RJ1|P1|JHUMKI|PAIR|J101|GOLD||96|6";
    await db.products.put({ ...blankProduct("o"), code: "P1", barcodes: [raw], item: "ITEM 777", rate: 12000 });
    const p = (await findByScan(raw))!;
    expect(p).toMatchObject({ item: "JHUMKI", type: "PAIR", style: "J101", color: "GOLD", pack: 6, rate: 12000 });
    expect(label(p)).toContain("JHUMKI");
  });
  it("honours learned names and never replaces real names, units or prices", async () => {
    await db.config.put({ id: "item_codes", value: { "5186": { name: "SHOP BALI", unit: "PAIR" } }, updated_at: "" });
    const p = { ...blankProduct("o"), barcodes: [legacy] }; await db.products.put(p);
    expect((await findByScan(legacy))?.item).toBe("SHOP BALI");
    await db.products.put({ ...p, item: "Original product", type: "SET", rate: 23000 });
    expect(await findByScan(legacy)).toMatchObject({ item: "ORIGINAL PRODUCT", type: "SET", rate: 23000 });
  });
  it("lets stock-in create a named JSON product without requiring a style", async () => {
    expect((await resolveScan('{"name":"CHAIN","unit":"PCS","rate":96}', "o")).product).toMatchObject({ item: "CHAIN", rate: 9600 });
  });
  it("keeps unrecognized codes unknown and flags genuinely missing names", async () => {
    expect(await findByScan(legacy)).toBeUndefined();
    expect(await resolveScan("unknown-barcode", "o")).toEqual({});
    expect(await db.products.count()).toBe(0);
    const raw = "987654~100~1~212~~K5209/~KXZKLN";
    const p = (await resolveScan(raw, "o")).product!;
    expect(p.item).toBe(""); expect(label(p)).toContain("Name needed");
    await nameItemCode("987654", "BRACELET", "PCS");
    expect((await findByScan(raw))?.item).toBe("BRACELET");
  });
  it("rolls back product, learned mapping and sync writes together on failure", async () => {
    const raw = '{"name":"CHAIN","item_code":"555","style":"C1"}';
    const p = { ...blankProduct("o"), barcodes: [raw] }; await db.products.put(p);
    let writes = 0;
    const fail = () => { if (++writes === 2) throw new Error("queue unavailable"); };
    db.outbox.hook("creating", fail);
    try { await expect(findByScan(raw)).rejects.toThrow("queue unavailable"); }
    finally { db.outbox.hook("creating").unsubscribe(fail); }
    expect((await db.products.get(p.id))?.item).toBe("");
    expect(await db.config.get("item_codes")).toBeUndefined();
    expect(await db.outbox.count()).toBe(0);
  });
});
