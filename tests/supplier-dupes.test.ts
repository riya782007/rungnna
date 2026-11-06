import "fake-indexeddb/auto";
import { beforeEach, describe, it, expect } from "vitest";
import { db } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { duplicateSupplierGroups, mergeDuplicateSuppliers } from "../src/lib/vendors";

const sup = (id: string, vendor_code: string, name: string, extra: Record<string, unknown> = {}) => ({ id, vendor_code, name, kind: "supplier" as const, ...extra });
describe("suppliers listed twice (owner, 5 Nov: 'Vendor list still duplicate')", () => {
  it("groups the same roll no. + same name, however it was typed", () => {
    const g = duplicateSupplierGroups([sup("a", "32", "RAVI BH"), sup("b", " 32 ", "Ravi  BH"), sup("c", "34", "AMAN ARTS (KOL)"), sup("d", "034", "AMAN ARTS (KOL)"), sup("e", "31", "BHAVESH BH")]);
    expect(g.map(x => x.map(p => p.id))).toEqual([["a", "b"], ["c", "d"]]);
  });
  it("never merges different names on one roll no., customers, or hidden copies", () => {
    expect(duplicateSupplierGroups([sup("a", "1", "UP"), sup("b", "1", "U P TRADERS")])).toEqual([]);
    expect(duplicateSupplierGroups([sup("a", "1", "UP"), sup("b", "1", "UP", { deleted: 1 })])).toEqual([]);
    expect(duplicateSupplierGroups([sup("a", "1", "UP"), { ...sup("b", "1", "UP"), kind: "customer" as never }])).toEqual([]);
  });
});


describe("merging the copies", () => {
  beforeEach(async () => { setScope(MAIN_STORE, "owner"); await Promise.all(db.tables.map(t => t.clear())); });
  it("moves bills, payments and stickers to one copy, fills its blanks, hides the other", async () => {
    await db.parties.bulkPut([
      { ...sup("keep", "33", "NIKHIL BHAI"), phone: "", city: "" } as any,
      { ...sup("copy", "33", "NIKHIL BHAI"), phone: "9811111111", city: "Delhi", less_pct: 5 } as any,
    ]);
    await db.purchases.bulkPut([{ id: "p1", supplier_id: "keep" }, { id: "p2", supplier_id: "keep" }, { id: "p4", supplier_id: "keep" }, { id: "p5", supplier_id: "keep" }, { id: "p3", supplier_id: "copy" }] as any);
    await db.vouchers.put({ id: "v1", party_id: "copy" } as any);
    await db.products.put({ id: "x1", vendor_id: "copy" } as any);
    expect(await mergeDuplicateSuppliers()).toBe(1);
    expect((await db.purchases.toArray()).every(p => p.supplier_id === "keep")).toBe(true);
    expect((await db.vouchers.get("v1"))?.party_id).toBe("keep");
    expect((await db.products.get("x1"))?.vendor_id).toBe("keep");
    const keep = await db.parties.get("keep");
    expect([keep?.phone, keep?.city, keep?.less_pct, keep?.deleted]).toEqual(["9811111111", "Delhi", 5, undefined]);
    expect((await db.parties.get("copy"))?.deleted).toBe(1);
    expect(await mergeDuplicateSuppliers()).toBe(0);
  });
});
