import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, now } from "../src/lib/db";
import { newParty } from "../src/lib/billing";
import { savePhotoPurchase, type PhotoRow } from "../src/lib/purchase-photo";
import { purchaseLabelJobs, productForLabel } from "../src/lib/purchase-labels";
import { ownPayload, parseLabel } from "../src/lib/parse";
import { resolveBillingScan } from "../src/lib/billing-products";
import { MAIN_STORE, setScope } from "../src/lib/scope";

/* Owner's video, 21 Oct: stickers printed from a purchase bill were refused at billing ("Couldn't read the
   label"). They carry the Rungnna QR, RJ1|code|…, and a scanner on another keyboard layout changes the "|"
   (his counter already turns the old labels' "~" into "-", "`" or "^"). */
beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner");
  await db.parties.put({ ...newParty("SUPPLIER"), id: "s", kind: "supplier" });
  await db.locations.put({ id: "rack", floor: "1", rack: "1", box: "", kind: "rack", code: "F1-R01", name: "", updated_at: now() });
});
const row = (o: Partial<PhotoRow> = {}): PhotoRow => ({ item: "F-RING", style: "K5210/11/P", color: "W/XZ/13", unit: "PCS", hsn: "7117", qty: "3", cost: "58", rate: "146", ...o });
const mangle: Record<string, (q: string) => string> = {
  exact: q => q, backslash: q => q.replace(/[|-]/g, "\\"), hash: q => q.replace(/[|-]/g, "#"), slash: q => q.replace(/[|-]/g, "/"),
  tilde: q => q.replace(/[|-]/g, "~"), lower: q => q.toLowerCase(), noShift: q => q.replace(/[|-]/g, "\\").toLowerCase(),
};

describe("purchase-bill stickers scan at billing, whatever the scanner's keyboard does", () => {
  it("finds the item for every variant", async () => {
    const pur = await savePhotoPurchase([row(), row({ item: "01 PIK DAMMI", style: "104208", color: "", rate: "229" })], { by: "o", rack: "rack", supplierId: "s", billNo: "B1", note: "" });
    const prods = await db.products.toArray();
    for (const j of purchaseLabelJobs(pur, prods)) {
      const qr = ownPayload(productForLabel(j.p, j.qtyOnLabel), "shop");
      expect(qr).toMatch(/^RJ2-[A-Z0-9]+-1$/);   // short QR since 22 Oct; stickers already printed carry RJ1|… (tested below)
      for (const [how, f] of Object.entries(mangle)) {
        const p = await resolveBillingScan(f(qr), "o");
        expect(p?.id, how).toBe(j.p.id);
      }
    }
  });
  it("a counter that hasn't synced the item yet still bills it from the sticker", async () => {
    const qr = "RJ1\\RXXI4GR4B9K\\F-RING\\PCS\\K5210/11/P\\W/XZ/13\\\\146\\1";
    const p = await resolveBillingScan(qr, "o");
    expect(p).toMatchObject({ code: "RXXI4GR4B9K", item: "F-RING", style: "K5210/11/P", color: "W/XZ/13", rate: 14600 });
    expect(await resolveBillingScan(qr.toLowerCase(), "o")).toMatchObject({ id: p!.id });
  });
  it("old-software labels typed with a backslash or hash still read", () => {
    for (const sep of ["\\", "#"]) expect(parseLabel(["202", "146", "1", "", "", "K5210/11/P", "W/XZ/13"].join(sep))).toMatchObject({ how: "shop label", icode: "202", style: "K5210/11/P", color: "W/XZ/13" });
  });
});

describe("a sticker whose product was deleted", () => {
  it("brings that product back, with its cost and supplier, even when the scanner types '-' for '|'", async () => {
    const pur = await savePhotoPurchase([row({ item: "BANGLES", style: "24610", color: "", unit: "PAIR", rate: "98" })], { by: "o", rack: "rack", supplierId: "s", billNo: "B9", note: "" });
    const [p] = await db.products.toArray();
    await db.products.put({ ...p, deleted: 1 });                     // the list was deleted after printing (21 Oct)
    const qr = ownPayload(productForLabel(p, 1), "shop").replace(/\|/g, "-");
    const back = await resolveBillingScan(qr, "o");
    expect(back).toMatchObject({ id: p.id, cost: p.cost, vendor_id: "s", deleted: 0 });
    expect((await db.products.get(p.id))!.deleted).toBe(0);
    expect(await db.products.count()).toBe(1);                      // not a second, half-empty copy
    expect(pur.items[0].product_id).toBe(p.id);
  });
});
