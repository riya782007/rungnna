import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, put } from "../src/lib/db";
import { permsOf, can } from "../src/lib/roles";
import { setScope, setCompanyKind, typeForCompany, MAIN_STORE } from "../src/lib/scope";
import { setUpTwoCompanies, companiesFor } from "../src/lib/stores";
import { newBill, DEFAULT_SHOP, getShop, saveShop } from "../src/lib/billing";
import { getRule, saveRule, DEFAULT_RULE } from "../src/lib/pricing";
import { viewCodeMatches, setViewCode } from "../src/lib/viewCode";
import { isOpen, setOwnerOpen, setCompanyOpen } from "../src/lib/privacy";

/* Owner's answers, 23 Oct: two companies, a 777 code, a person = a name + ticks. */
beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); setCompanyKind(undefined); setOwnerOpen(false); setCompanyOpen(false); });

describe("a person is a name with ticks", () => {
  it("uses the person's own ticks, not the role's", () => {
    const p = { role: "salesman" as const, perms: ["billing.sell"] };
    expect([...permsOf(p)]).toEqual(["billing.sell"]);
    expect(can(p, "stock.move")).toBe(false);
    expect(can({ role: "salesman" }, "stock.move")).toBe(true);
  });
});

describe("two companies", () => {
  it("keeps contact email, GSTIN, UPI and bank profiles separate without copying tax details into estimates", async () => {
    await db.stores.put({ id: MAIN_STORE, code: "MAIN", name: "Main", address: "", active: 1, updated_at: "1970-01-01" });
    await saveShop({ ...DEFAULT_SHOP, email: "gst@example.test", gstin: "07ABCDE1234F1Z5", upi: "gst@bank", bank: "GST account" });
    const est = await setUpTwoCompanies();
    setScope(est.id, "owner");
    expect((await getShop()).gstin).toBe("");
    expect((await getShop()).email).toBeUndefined();
    expect((await getShop()).upi).toBe("");
    await saveShop({ ...DEFAULT_SHOP, email: "est@example.test", upi: "est@bank", bank: "Estimate account" });
    setScope(MAIN_STORE, "owner");
    expect(await getShop()).toMatchObject({ email: "gst@example.test", gstin: "07ABCDE1234F1Z5", upi: "gst@bank", bank: "GST account" });
    expect(await getShop(est.id)).toMatchObject({ email: "est@example.test", gstin: "", upi: "est@bank", bank: "Estimate account" });
  });
  it("sets up the estimate company beside the tax-invoice one, and each bills only its own kind", async () => {
    await db.stores.put({ id: MAIN_STORE, code: "MAIN", name: "Main", address: "", active: 1, updated_at: "1970-01-01" });
    const est = await setUpTwoCompanies();
    expect((await db.stores.get(MAIN_STORE))?.kind).toBe("gst");
    expect((await db.stores.get(est.id))?.kind).toBe("estimate");
    expect((await companiesFor({ role: "owner" } as any)).length).toBe(2);
    expect((await companiesFor({ role: "salesman", stores: [est.id] } as any)).map(s => s.id)).toEqual([est.id]);
    setCompanyKind("estimate"); expect(newBill("o", DEFAULT_SHOP, "gst").bill_type).toBe("estimate");
    setCompanyKind("gst"); expect(newBill("o", DEFAULT_SHOP, "estimate").bill_type).toBe("gst");
    expect(typeForCompany("challan")).toBe("challan");
  });
  it("keeps each company's profit margin apart", async () => {
    await saveRule({ ...DEFAULT_RULE, margin: { ...DEFAULT_RULE.margin, mode: "percent", percent: 154 } });
    setScope("est-co", "owner");
    expect((await getRule()).margin.percent).toBe(154);       // until set, the main rule
    await saveRule({ ...DEFAULT_RULE, margin: { ...DEFAULT_RULE.margin, mode: "percent", percent: 100 } });
    expect((await getRule()).margin.percent).toBe(100);
    setScope(MAIN_STORE, "owner");
    expect((await getRule()).margin.percent).toBe(154);
  });
  it("estimates are simply open for the owner and inside the estimate company", () => {
    expect(isOpen()).toBe(false);
    setOwnerOpen(true); expect(isOpen()).toBe(true); setOwnerOpen(false);
    setCompanyOpen(true); expect(isOpen()).toBe(true);
  });
});

describe("the 777 code", () => {
  it("is 777 until the owner changes it", async () => {
    expect(await viewCodeMatches("777")).toBe(true);
    await setViewCode("4321");
    expect(await viewCodeMatches("777")).toBe(false);
    expect(await viewCodeMatches("4321")).toBe(true);
  });
});
