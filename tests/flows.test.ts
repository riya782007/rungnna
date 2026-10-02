import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db, type Bill, type BillLine, type Product } from "../src/lib/db";
import { finalize, holdBill, newBill, lineFrom, voidBill, partyDue, DEFAULT_SHOP, type Shop } from "../src/lib/billing";
import { mergeBills, splitBill, buildReturn, saveReturn, returnable } from "../src/lib/docs";

/* End-to-end on a real (in-memory) IndexedDB: the stock book must stay right through every document flow. */
const shop: Shop = { ...DEFAULT_SHOP, state: "Delhi" };
const RACK = "rack-1";
const ring: Product = { id: "ring", code: "R1", barcodes: ["R1"], item: "F-RING", type: "PCS", style: "K5208", color: "W", tk: "", rate: 2400, mrp: 0,
  category: "", notes: "", created_by: "t", created_at: "", updated_at: "" };
const chain: Product = { ...ring, id: "chain", code: "C1", barcodes: ["C1"], item: "CHAIN", style: "K9", rate: 9600 };

const stock = async (pid: string) => (await db.stock.get(pid + "|" + RACK))?.qty ?? 0;
const doc = (type: Bill["bill_type"], lines: BillLine[]): Bill =>
  ({ ...newBill("t", shop, type), party_id: "ravi", party_name: "RAVI", items: lines });
const pcs = (p: Product, q: number) => ({ ...lineFrom(p, 1, 1), qty: q, pkts: 0, amount: q * p.rate });

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  await db.locations.put({ id: RACK, code: "G-R01-B1", floor: "G", rack: "R01", box: "B1", name: "", kind: "rack", updated_at: "" });
  await db.products.bulkPut([ring, chain]);
  await db.stock.bulkPut([{ key: "ring|" + RACK, product_id: "ring", loc_id: RACK, qty: 100 }, { key: "chain|" + RACK, product_id: "chain", loc_id: RACK, qty: 50 }]);
});

describe("challan → invoice", () => {
  it("stock leaves once with the challan; the invoice never takes it again; cancelling unwinds in order", async () => {
    const ch = await finalize(doc("challan", [pcs(ring, 10)]), "Delhi");
    expect(ch.no).toMatch(/^CH\//); expect(await stock("ring")).toBe(90);
    const inv = await mergeBills([ch], "gst", shop, "t");
    expect(inv.no).toMatch(/^RJ\//); expect(await stock("ring")).toBe(90);
    expect((await db.bills.get(ch.id))).toMatchObject({ status: "merged", merged_into: inv.id, merged_into_no: inv.no });
    expect(await partyDue("ravi")).toBe(inv.net);                    // the invoice is owed, the challan never was
    await voidBill(inv, "wrong rate", "owner");
    expect((await db.bills.get(ch.id))!.status).toBe("final");       // challan is back
    expect(await stock("ring")).toBe(90);                            // its goods are still out
    await voidBill((await db.bills.get(ch.id))!, "returned", "owner");
    expect(await stock("ring")).toBe(100);
  });
});

describe("merge estimates / orders", () => {
  it("a saved estimate's pieces are not deducted again; a held order's are", async () => {
    const est = await finalize(doc("estimate", [pcs(ring, 10)]), "Delhi");
    const order = doc("gst", [pcs(ring, 5), pcs(chain, 2)]); order.advance = 1000; await holdBill(order);
    expect(await stock("ring")).toBe(90);
    const inv = await mergeBills([est, (await db.bills.get(order.id))!], "gst", shop, "t");
    expect(await stock("ring")).toBe(85); expect(await stock("chain")).toBe(48);
    expect(inv.items.reduce((a, l) => a + l.qty, 0)).toBe(17);
    expect(inv.paid).toBe(1000);                                     // the order's advance moved across as a payment
    expect((await db.bills.get(order.id))!.status).toBe("merged");
    await voidBill(inv, "redo", "owner");                            // the order comes back on hold, its pieces back on the rack
    expect((await db.bills.get(order.id))!.status).toBe("hold");
    expect((await db.bills.get(est.id))!.status).toBe("final");
    expect(await stock("ring")).toBe(90); expect(await stock("chain")).toBe(50);
  });
  it("refuses bills that changed after being ticked", async () => {
    const a = await finalize(doc("estimate", [pcs(ring, 1)]), "Delhi"), b = await finalize(doc("estimate", [pcs(ring, 1)]), "Delhi");
    await mergeBills([a, b], "gst", shop, "t");
    await expect(mergeBills([a, b], "gst", shop, "t")).rejects.toThrow(/can't be merged/);
  });
});

describe("sales return", () => {
  it("credit note puts pieces back on their rack, credits the account, can't over-return, and cancels cleanly", async () => {
    const inv = await finalize(doc("gst", [pcs(ring, 10), pcs(chain, 2)]), "Delhi");
    expect(await stock("ring")).toBe(90);
    const draft = buildReturn(inv, [{ line_id: inv.items[0].id, qty: 4 }], returnable(inv, []), shop, "t");
    const cn = await saveReturn(draft, inv, shop);
    expect(cn.no).toMatch(/^CN\//); expect(cn.gst).toBeGreaterThan(0);
    expect(await stock("ring")).toBe(94);
    expect(await partyDue("ravi")).toBe(inv.net - cn.net);
    const again = buildReturn(inv, [{ line_id: inv.items[0].id, qty: 6 }], returnable(inv, [cn]), shop, "t");
    expect(again.items[0].qty).toBe(6);
    const tooMany = { ...again, items: again.items.map(l => ({ ...l, qty: 7 })) };
    await expect(saveReturn(tooMany, inv, shop)).rejects.toThrow(/can still be returned/);
    await voidBill(cn, "mistake", "owner");
    expect(await stock("ring")).toBe(90);
    expect(await partyDue("ravi")).toBe(inv.net);
  });
  it("a refund paid out is recorded on the credit note", async () => {
    const inv = await finalize(doc("gst", [pcs(ring, 10)]), "Delhi");
    const d = buildReturn(inv, [{ line_id: inv.items[0].id, qty: 10 }], returnable(inv, []), shop, "t");
    const cn = await saveReturn(d, inv, shop, { mode: "cash", amount: 5000 });
    expect(cn.paid).toBe(5000);
    expect(await partyDue("ravi")).toBe(inv.net - (cn.net - 5000));
  });
});

describe("split", () => {
  it("moved lines take their sale movements with them; each bill cancels only its own pieces", async () => {
    const inv = await finalize(doc("gst", [pcs(ring, 10), pcs(chain, 3)]), "Delhi");
    const { original, split } = await splitBill(inv, [inv.items[1].id], shop, "t");
    expect(split.no).toMatch(/^RJ\//); expect(split.no).not.toBe(inv.no); expect(original.no).toBe(inv.no);
    expect(await stock("chain")).toBe(47);                           // nothing deducted twice
    expect((await db.movements.where("ref_bill").equals(split.id).toArray()).map(m => m.product_id)).toEqual(["chain"]);
    await voidBill(split, "x", "owner");
    expect(await stock("chain")).toBe(50); expect(await stock("ring")).toBe(90);
  });
  it("a held bill becomes two held bills", async () => {
    const h = doc("gst", [pcs(ring, 1), pcs(chain, 1)]); await holdBill(h);
    const { original, split } = await splitBill(h, [h.items[0].id], shop, "t");
    expect(original.status).toBe("hold"); expect(split.status).toBe("hold"); expect(split.no).toBe("");
    expect(await stock("ring")).toBe(100);
  });
});
