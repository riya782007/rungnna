import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type Bill, type BillLine } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { createDesign } from "../src/lib/inventory";
import { finalize, newBill, fixLine, convertToGst, voidBill, DEFAULT_SHOP } from "../src/lib/billing";
import { shownStock, onHand, shortBy } from "../src/lib/stockView";

/* Owner, 19 Nov (video): stock showing in minus; "when the estimate is closed, everything linked to it should close". */

let pid = "";
const line = (qty: number): BillLine => fixLine({ id: Math.random().toString(36).slice(2), product_id: pid, code: "X", item: "NECKLACE SET", type: "PCS", style: "K900", color: "GOLD", box_no: 1, pack: 1, pkts: 0, qty, rate: 50000, disc: "", amount: 0 });
const bill = (type: "estimate" | "gst", qty: number, extra: Partial<Bill> = {}) =>
  finalize({ ...newBill("o", DEFAULT_SHOP, type), party_id: "p1", party_name: "SHREE BALAJI", party_phone: "9876543210", items: [line(qty)], ...extra }, "Delhi");
const total = async (open: boolean) => (await shownStock(open)).reduce((a, c) => a + c.qty, 0);

beforeEach(async () => {
  setScope(MAIN_STORE, "owner");
  await Promise.all(db.tables.map(t => t.clear()));
  await db.stores.put({ id: MAIN_STORE, name: "Main", code: "MAIN", updated_at: "" } as any);
  await db.locations.put({ id: "r1", name: "F1-A1", kind: "rack", store_id: MAIN_STORE, updated_at: "" } as any);
  await createDesign({ item: "NECKLACE SET", type: "PCS", style: "K900", pack: 1, cost: 0, rate: 50000, rack: "r1", by: "o", variants: [{ color: "GOLD", size: "", qty: 10 }] } as any);
  pid = (await db.products.toArray())[0].id;
});

describe("stock while estimates are closed", () => {
  it("shows the racks as if the estimates had not happened; open, the real count", async () => {
    await bill("gst", 2);
    await bill("estimate", 3);
    expect(await total(true)).toBe(5);
    expect(await total(false)).toBe(8);       // the 3 on the estimate don't show
  });
  it("an estimate turned into a GST bill is no longer private", async () => {
    const e = await bill("estimate", 4);
    await convertToGst(e, DEFAULT_SHOP, "o");
    expect(await total(false)).toBe(6);
  });
  it("a cancelled estimate changes nothing either way", async () => {
    const e = await bill("estimate", 4);
    await voidBill(e, "wrong", "o");
    expect(await total(true)).toBe(10); expect(await total(false)).toBe(10);
  });
  it("billing more than was entered: shown as 0 with the shortfall beside it", async () => {
    await bill("gst", 14);
    expect(await total(true)).toBe(-4);
    expect([onHand(-4), shortBy(-4), onHand(6), shortBy(6)]).toEqual([0, 4, 6, 0]);
  });
});

import { wholesaleNet } from "../src/lib/billing";
describe("retail bill · wholesale rates (owner, 22 Nov: 'the wholesale rate is wrong')", () => {
  it("an estimate's wholesale price is after the usual 50% (and any less %)", () => {
    expect(wholesaleNet(117600, { bill_type: "estimate" }, { est_disc_pct: 50, est_less_pct: 0 })).toBe(58800);
    expect(wholesaleNet(100000, { bill_type: "estimate" }, { est_disc_pct: 50, est_less_pct: 10 })).toBe(45000);
    expect(wholesaleNet(117600, { bill_type: "gst" }, { est_disc_pct: 50, est_less_pct: 0 })).toBe(117600);
  });
});
