import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { blankProduct, findByScan, label, nameItemCode, auditItemCodes, fixProductCode, itemCodeFor, labelCodeProblem, itemMap } from "../src/lib/products";
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
    await db.config.put({ id: "item_codes", value: { "5186": { name: "SHOP BALI", unit: "PAIR", owner: true } }, updated_at: "" });
    const p = { ...blankProduct("o"), barcodes: [legacy] }; await db.products.put(p);
    expect((await findByScan(legacy))?.item).toBe("SHOP BALI");
    // the owner renames the scanned product (it now carries the label's item code)
    await db.products.put({ ...(await db.products.get(p.id))!, item: "Original product", type: "SET", rate: 23000 });
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

/* Counter reports: an EARING sticker billed as BALI at the BALI's price, and an F-RING
   billed as JHUMKA. The shop prints one style (K5210/2T) on many different items, so a
   style + colour match alone must never decide the product. */
describe("scan accuracy when items share a style", () => {
  const earing = "203~194~1~212~~K5210/2T~KXZ";
  it("does not turn an EARING label into a BALI that shares its style and colour", async () => {
    const bali = { ...blankProduct("o"), item: "BALI", item_code: "5186", type: "PAIR", style: "K5210/2T", color: "KXZ", rate: 26400 };
    await db.products.put(bali);
    const p = (await resolveBillingScan(earing, "o"))!;
    expect(p.id).not.toBe(bali.id);
    expect(lineFrom(p)).toMatchObject({ item: "EARING", style: "K5210/2T", color: "KXZ", rate: 19400 });
  });
  it("detaches a label wrongly linked to another product, so the mistake can't repeat", async () => {
    const bali = { ...blankProduct("o"), item: "BALI", style: "K5210/2T", color: "KXZ", rate: 26400, barcodes: [earing] };
    await db.products.put(bali);
    const p = (await resolveBillingScan(earing, "o"))!;
    expect(p.id).not.toBe(bali.id);
    expect(p.item).toBe("EARING");
    expect((await db.products.get(bali.id))?.barcodes).not.toContain(earing);
    expect((await resolveBillingScan(earing, "o"))?.id).toBe(p.id);
  });
  it("does not turn an F-RING label into an unrelated JHUMKA with the same style", async () => {
    const jhumka = { ...blankProduct("o"), item: "JHUMKA (HOLD)", style: "K5210/11P", color: "W/XZ", rate: 37000 };
    await db.products.put(jhumka);
    const p = (await resolveBillingScan("202~24~1~183~~K5210/11P~W/XZ", "o"))!;
    expect(p.id).not.toBe(jhumka.id);
    expect(p.item).toBe("F-RING");
  });
  it("picks the product at the printed rate when one item and style sell at several rates", async () => {
    const a = { ...blankProduct("o"), item: "TOPS", item_code: "949", style: "K5210/1T", color: "K/MBUL", rate: 26800 };
    const b = { ...blankProduct("o"), item: "TOPS", item_code: "949", style: "K5210/1T", color: "K/MBUL", rate: 19400 };
    await db.products.bulkPut([a, b]);
    expect((await resolveBillingScan("949~194~1~183~~K5210/1T~K/MBUL", "o"))?.id).toBe(b.id);
  });
  it("reads an old label typed with '-' instead of '~' by a scanner on the wrong keyboard layout", async () => {
    const p = (await resolveBillingScan("255-224-1-183--K5208/2T-KXZ", "o"))!;
    expect(lineFrom(p)).toMatchObject({ item: "N-SET", style: "K5208/2T", color: "KXZ", rate: 22400 });
  });
});

/* Counter report: sticker EARING · K5209/11P · W/XZBSPHL · ₹360 X1 PAIR billed as BALI · PCS.
   On a clean system this QR reads EARING (see negative-stock tests); on the shop's system a
   name learned as a side effect had re-pointed code 203 at BALI. */
describe("item code authority", () => {
  const sticker = "203~360~1~212~~K5209/11P~W/XZBSPHL";
  it("reads the old software's name and unit even when a stray learned name disagrees", async () => {
    await db.config.put({ id: "item_codes", value: { "203": { name: "BALI", unit: "" } }, updated_at: "" });
    const p = (await resolveBillingScan(sticker, "o"))!;
    expect(lineFrom(p)).toMatchObject({ item: "EARING", type: "PAIR", rate: 36000, style: "K5209/11P", color: "W/XZBSPHL" });
  });
  it("never lets a product with the wrong code teach that code a new name", async () => {
    await db.products.put({ ...blankProduct("o"), item: "BALI", item_code: "203", style: "X1", color: "G" });
    await fixProductCode((await db.products.toArray())[0], "203");   // saving it must not relearn 203 = BALI
    expect((await itemMap())["203"]).toBeUndefined();
    expect((await resolveBillingScan(sticker, "o"))?.item).toBe("EARING");
  });
  it("finds products that print another item's code, and fixes them", async () => {
    const wrong = { ...blankProduct("o"), item: "EARING", item_code: "5186", style: "K5209/11P", color: "W/XZBSPHL" };
    await db.products.put(wrong);
    const audit = await auditItemCodes();
    expect(audit.wrongCode.map(w => [w.p.id, w.means, w.fixCode])).toEqual([[wrong.id, "BALI", "203"]]);
    await fixProductCode(audit.wrongCode[0].p, "203");
    expect((await auditItemCodes()).wrongCode).toEqual([]);
  });
  it("blocks printing a label whose name and QR code disagree", async () => {
    await itemMap();
    expect(labelCodeProblem("EARING", "5186")).toContain("EARING is code 203");
    expect(labelCodeProblem("EARING", "203")).toBe("");
    expect(await itemCodeFor("EARING")).toBe("203");
  });
  it("keeps an owner's deliberate name for a code", async () => {
    await nameItemCode("203", "EAR TOPS", "PAIR");
    expect((await resolveBillingScan(sticker, "o"))?.item).toBe("EAR TOPS");
  });
});
