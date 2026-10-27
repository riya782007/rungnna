import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type Product } from "../src/lib/db";
import { lineFrom, priceFor } from "../src/lib/billing";
import { blankProduct, saveProduct } from "../src/lib/products";
import { MAIN_STORE, setScope } from "../src/lib/scope";

/* Owner, 27 Oct: a sticker printed "9 3060 X1PCS" scanned into the bill at ₹1,248. The sticker prints `rate`;
   the bill took an older `wholesale_rate` that a later purchase / label print never updated. */
const stale = (): Product => ({ ...blankProduct("t"), item: "N-SET", style: "K1207.5SU", color: "M", rate: 306000, wholesale_rate: 124800, retail_rate: 0 });

describe("the bill charges the sticker's rate", () => {
  beforeEach(async () => { setScope(MAIN_STORE, ""); await Promise.all(db.tables.map(t => t.clear())); });

  it("wholesale and dealer bills use the printed rate, not an old wholesale_rate", () => {
    expect(priceFor(stale(), "wholesale")).toBe(306000);
    expect(priceFor(stale(), "dealer")).toBe(306000);
    expect(lineFrom(stale(), 1, 1, "wholesale").rate).toBe(306000);
  });
  it("retail bills still use the retail rate when there is one", () => {
    expect(priceFor({ ...stale(), retail_rate: 400000 }, "retail")).toBe(400000);
  });
  it("a product with only an imported wholesale rate still bills at it", () => {
    expect(priceFor({ ...stale(), rate: 0 }, "wholesale")).toBe(124800);
  });
  it("saving a product keeps wholesale_rate equal to the rate the sticker prints", async () => {
    const saved = await saveProduct(stale(), true);
    expect(saved.wholesale_rate).toBe(306000);
    expect((await db.products.get(saved.id))?.wholesale_rate).toBe(306000);
  });
});

import { ownPayload, parseLabel } from "../src/lib/parse";
import { productForLabel } from "../src/lib/purchase-labels";
import { toPaise } from "../src/lib/format";

describe("the shop's short QR carries the rate printed on the sticker", () => {
  it("printed rate = QR rate = billed rate, for whole and odd rates", () => {
    for (const rate of [306000, 124800, 39600, 306050]) {
      const p = { ...stale(), code: "RLYI848MOV2", rate, wholesale_rate: 100 };
      const printed = productForLabel(p, 1);            // what the sticker text and its QR are made from
      const qr = parseLabel(ownPayload(printed, "shop"));
      expect(qr.how).toBe("rungnna");
      expect(toPaise(qr.rate || "0")).toBe(printed.rate);
      expect(priceFor(printed, "wholesale")).toBe(printed.rate);
    }
  });
});
