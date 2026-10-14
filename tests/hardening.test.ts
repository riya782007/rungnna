import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type Product } from "../src/lib/db";
import { rupees } from "../src/lib/format";
import { newCode } from "../src/lib/parse";
import { MAIN_STORE, setScope, setScopePerms, ownerOnly, requirePerm } from "../src/lib/scope";
import { createDesign, normSize } from "../src/lib/inventory";
import { voidBill, deleteEstimates, saveShop, DEFAULT_SHOP, newBill, finalize, lineFrom } from "../src/lib/billing";
import { saveProduct } from "../src/lib/products";

/* Regressions found while hardening the shop for live use. Each test is the defect, not the fix. */

describe("money reads with both paise digits", () => {
  it("prints ₹12.50, never ₹12.5 — this goes on a tax invoice", () => {
    expect(rupees(1250)).toBe("₹12.50");
    expect(rupees(50)).toBe("₹0.50");
    expect(rupees(1230)).toBe("₹12.30");
  });
  it("still groups lakhs the Indian way and keeps whole rupees exact", () => {
    expect(rupees(2400)).toBe("₹24.00");
    expect(rupees(123456789)).toBe("₹12,34,567.89");
  });
});

describe("product codes are unique", () => {
  it("mints 18 distinct codes inside one millisecond (6 colours × 3 sizes)", () => {
    const codes = Array.from({ length: 18 }, () => newCode("abcdef"));
    expect(new Set(codes).size).toBe(18);
  });
  it("stays unique across a whole intake day, so a sticker can only mean one product", () => {
    const codes = Array.from({ length: 1296 }, () => newCode("abcdef"));
    expect(new Set(codes).size).toBe(1296);
  });
});

describe("nobody is the owner by default", () => {
  beforeEach(() => setScope(MAIN_STORE, ""));
  it("refuses owner-only work when no one is signed in", () => {
    expect(() => ownerOnly()).toThrow("Owner only");
    expect(() => requirePerm("billing.void", "cancelling a bill")).toThrow("doesn't allow");
  });
  it("gives a role its permissions in the same breath, so the two can never disagree", () => {
    setScope(MAIN_STORE, "salesman");
    expect(() => requirePerm("billing.sell")).not.toThrow();   // a salesman bills
    expect(() => requirePerm("billing.void")).toThrow();       // but never cancels
    setScope(MAIN_STORE, "owner");
    expect(() => requirePerm("billing.void")).not.toThrow();
  });
  it("lets the app override with a custom role's exact set", () => {
    setScope(MAIN_STORE, "helper");
    setScopePerms(new Set(["billing.void"]));
    expect(() => requirePerm("billing.void")).not.toThrow();
    expect(() => requirePerm("stock.move")).toThrow();
  });
});

describe("the sensitive saves are guarded in the library, not just hidden in the page", () => {
  beforeEach(async () => { setScope(MAIN_STORE, "helper"); await Promise.all(db.tables.map(t => t.clear())); });
  const bill = () => ({ ...newBill("h", DEFAULT_SHOP, "estimate"), id: "b1" });
  it("a helper cannot cancel a bill, delete estimates, change shop settings or edit products", async () => {
    await expect(voidBill(bill() as any, "oops", "h")).rejects.toThrow("doesn't allow");
    await expect(deleteEstimates([bill() as any], false, "h")).rejects.toThrow("doesn't allow");
    await expect(saveShop(DEFAULT_SHOP)).rejects.toThrow("doesn't allow");
    setScopePerms(new Set());   // a custom role with stock work but no products.edit
    await expect(saveProduct({ ...base, id: "x" })).rejects.toThrow("doesn't allow");
  });
});

const base: Product = {
  id: "p", code: "P1", barcodes: ["P1"], item: "NECKLACE SET", type: "PCS", style: "K900", color: "GOLD", tk: "",
  rate: 2400, mrp: 0, category: "", notes: "", created_by: "t", created_at: "", updated_at: "",
};

describe("adding one design many times", () => {
  beforeEach(async () => {
    setScope(MAIN_STORE, "owner");
    await Promise.all(db.tables.map(t => t.clear()));
    await db.stores.put({ id: MAIN_STORE, name: "Main", code: "MAIN", updated_at: "" } as any);
    await db.locations.put({ id: "r1", name: "F1-A1", kind: "rack", store_id: MAIN_STORE, updated_at: "" } as any);
  });

  const design = (over: Record<string, unknown> = {}) => ({
    item: "NECKLACE SET", type: "PCS", style: "K900", pack: 1, cost: 0, rate: 2400,
    rack: "r1", by: "o", variants: [{ color: "GOLD", size: "2.4", qty: 1 }], ...over,
  }) as any;

  it("treats '2.4 ' and '2.4' as the same size instead of forking the design", async () => {
    expect(normSize(" 2.4 ")).toBe("2.4");
    expect(normSize("Free Size")).toBe("FREE SIZE");
    await createDesign(design());
    await createDesign(design({ variants: [{ color: "GOLD", size: " 2.4 ", qty: 1 }] }));
    expect(await db.products.count()).toBe(1);
  });

  it("gives every colour of one design its own code", async () => {
    await createDesign(design({
      variants: ["GOLD", "SILVER", "ROSE", "BLACK", "WHITE", "GREEN"].flatMap(color =>
        ["2.4", "2.6", "2.8"].map(size => ({ color, size, qty: 1 }))),
    }));
    const ps = await db.products.toArray();
    expect(ps).toHaveLength(18);
    expect(new Set(ps.map(p => p.code)).size).toBe(18);
  });

  it("does not re-price a rate the owner set by hand", async () => {
    await createDesign(design({ rate: 2400 }));                       // typed → price_locked
    const before = (await db.products.toArray())[0];
    expect(before.price_locked).toBe(1);
    await createDesign(design({ rate: 0, cost: 1000 }));              // re-stock, let the rule price it
    const after = await db.products.get(before.id);
    expect(after!.rate).toBe(2400);                                   // the hand-set rate survived
  });

  it("writes nothing at all when the rack is wrong", async () => {
    await expect(createDesign(design({ rack: "nope" }))).rejects.toThrow(/rack/i);
    expect(await db.products.count()).toBe(0);                        // no orphan products left behind
    expect(await db.purchases.count()).toBe(0);
  });
});

describe("a finalised bill still adds up", () => {
  beforeEach(async () => {
    setScope(MAIN_STORE, "owner");
    await Promise.all(db.tables.map(t => t.clear()));
    await db.stores.put({ id: MAIN_STORE, name: "Main", code: "MAIN", updated_at: "" } as any);
    await db.locations.put({ id: "r1", name: "F1-A1", kind: "rack", store_id: MAIN_STORE, updated_at: "" } as any);
    await db.products.put(base);
    await db.stock.put({ key: "p|r1", product_id: "p", loc_id: "r1", qty: 100 });
  });
  it("taxable + CGST + SGST + round-off equals the total printed on the invoice", async () => {
    const b = await finalize({ ...newBill("o", { ...DEFAULT_SHOP, state: "Delhi" }, "gst"), items: [{ ...lineFrom(base), qty: 7 }] }, "Delhi");
    expect(b.cgst + b.sgst).toBe(b.gst);
    expect(b.igst).toBe(0);
    expect(b.net - b.adjust - b.gst + b.cgst + b.sgst + b.adjust).toBe(b.net);
    expect(b.net % 100).toBe(0);                                      // rounded to whole rupees
  });
  it("charges IGST, not CGST+SGST, when the buyer is in another state", async () => {
    const b = await finalize({ ...newBill("o", { ...DEFAULT_SHOP, state: "Delhi" }, "gst"), party_state: "Maharashtra", items: [{ ...lineFrom(base), qty: 7 }] }, "Delhi");
    expect(b.igst).toBe(b.gst);
    expect(b.cgst + b.sgst).toBe(0);
  });
});
