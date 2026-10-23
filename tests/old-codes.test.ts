import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { blankProduct, labelCodeProblem, readItemMap } from "../src/lib/products";
import { resolveBillingScan } from "../src/lib/billing-products";
import { ownPayload, parseLabel } from "../src/lib/parse";
import { productForLabel } from "../src/lib/purchase-labels";
import { saveOldCodes, loadOldCodes, suggestOldCode } from "../src/lib/old-codes";
import { MAIN_STORE, setScope } from "../src/lib/scope";

/* Owner, 23 Oct: the old billing software must read the stickers this app prints. */
beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); await loadOldCodes(); });

describe("stickers the old software reads", () => {
  it("suggests the old item for the shop's own names", () => {
    expect(suggestOldCode("BANGLES")).toBe("1942");
    expect(suggestOldCode("HALF DULHAN SET")).toBe("320");
    expect(suggestOldCode("KAMAR PATT A")).toBe("235");
    expect(suggestOldCode("SET")).toBe("");      // could be several: the owner chooses
  });
  it("prints the old software's QR once the name is matched, with REF 183, and our billing still finds it", async () => {
    const p = { ...blankProduct("o"), item: "HALF DULHAN SET", style: "K5210/2TXZ", color: "EGHZ", rate: 157600, pack: 1 };
    await db.products.put(p);
    expect(ownPayload(productForLabel(p, 1), "shop")).toMatch(/^RJ2-/);
    await saveOldCodes({ aliases: { "half dulhan set": "320" } });
    const raw = ownPayload(productForLabel(p, 1), "shop");
    expect(raw).toBe("320~1576~1~183~~K5210/2TXZ~EGHZ");
    expect(parseLabel(raw).how).toBe("shop label");
    expect(labelCodeProblem(p.item, "320")).toBe("");
    expect((await resolveBillingScan(raw, "o"))?.id).toBe(p.id);
    expect(await db.products.count()).toBe(1);
  });
  it("ignores a whole QR saved by mistake as an item name", () => {
    expect(readItemMap({ "248": { name: "252~20~3~183~~K5210/11P~LKQR" } })["248"]).toBeUndefined();
  });
});
