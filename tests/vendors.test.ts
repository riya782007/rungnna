import "fake-indexeddb/auto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { parseVendorList, importVendors, vendorCost } from "../src/lib/vendors";
import { applyVendorTerms, type PhotoRow } from "../src/lib/purchase-photo";
import { BILLS, CHALLAN_PAGES } from "./fixtures/rungnna-bills";

const list = parseVendorList(readFileSync(new URL("../src/data/vendors.txt", import.meta.url), "utf8"));
const by = (c: string) => list.find(v => v.code === c)!;

describe("vendor list", () => {
  it("reads codes, names and city groups; skips unassigned numbers", () => {
    expect(list).toHaveLength(90);
    expect(by("3A")).toMatchObject({ name: "AKSHAY BHAI" });
    expect(by("46")).toMatchObject({ name: "शुभ MALA".toUpperCase() });
    expect(by("M1")).toMatchObject({ name: "RAMDEV" });
    expect(by("L9").name).toBe("ASAD ANSARI HAIR ACCESSORIES");
    for (const gap of ["14", "21", "29", "64", "M2"]) expect(list.some(v => v.code === gap)).toBe(false);
    expect(by("71").city).toBe("Jaipur"); expect(by("91").city).not.toBe("Jaipur");
    expect(by("201").city).toBe("Daman"); expect(by("202").city).toBe("Srinagar"); expect(by("35").city).toBe("Kolkata"); expect(by("92").city).toBe("Rohtak");
  });
  it("picks up vendor terms written in the list", () => {
    expect(by("51")).toMatchObject({ name: "SOLANKI", rate_divisor: 1.2, less_pct: 0 });
    expect(by("12")).toMatchObject({ name: "SOLANKI", rate_divisor: 1 });
    expect(parseVendorList("7 test 5% less")[0]).toMatchObject({ name: "TEST", less_pct: 5 });
  });
  it("loads into suppliers once, and again without duplicates", async () => {
    await Promise.all(db.tables.map(t => t.clear()));
    expect(await importVendors(list)).toEqual({ added: 90, updated: 0 });
    expect(await importVendors(list)).toEqual({ added: 0, updated: 90 });
    const sup = await db.parties.toArray();
    expect(sup).toHaveLength(90); expect(sup.every(p => p.kind === "supplier")).toBe(true);
    expect(sup.find(p => p.vendor_code === "51")).toMatchObject({ rate_divisor: 1.2 });
    expect(sup.filter(p => p.name === "SOLANKI")).toHaveLength(2);
  });
  it("keeps terms the owner edited when the list is loaded again", async () => {
    await Promise.all(db.tables.map(t => t.clear())); await importVendors(list);
    const p = (await db.parties.toArray()).find(x => x.vendor_code === "3")!; await db.parties.put({ ...p, less_pct: 10 });
    await importVendors(list); expect((await db.parties.get(p.id))!.less_pct).toBe(10);
  });
});

describe("vendor terms on purchase cost", () => {
  it("applies less % and rate divisor, leaving anything unclear untouched", () => {
    expect(vendorCost("100", { less_pct: 10, rate_divisor: 1 })).toBe("90.00");
    expect(vendorCost("120", { less_pct: 0, rate_divisor: 1.2 })).toBe("100.00");
    expect(vendorCost("120", { less_pct: 5, rate_divisor: 1.2 })).toBe("95.00");
    for (const c of ["", "abc", "0"]) expect(vendorCost(c, { less_pct: 10, rate_divisor: 1 })).toBe(c);
    expect(vendorCost("100", { less_pct: 0, rate_divisor: 1 })).toBe("100");
    expect(vendorCost("100", { less_pct: 100, rate_divisor: 1 })).toBe("100");
  });
  it("adjusts every review row", () => {
    const r = { item: "X", style: "S", color: "", unit: "PCS", hsn: "", qty: "1", cost: "200", rate: "" } as PhotoRow;
    expect(applyVendorTerms([r, { ...r, cost: "50" }], { less_pct: 5, rate_divisor: 1 }).map(x => x.cost)).toEqual(["190.00", "47.50"]);
  });
});

describe("photographed Rangana bills add up", () => {
  for (const b of BILLS) it(b.id, () => {
    for (const [name, qty, rate, amount] of b.lines) expect(qty * rate, name).toBeCloseTo(amount, 2);
    expect(b.lines.reduce((n, l) => n + l[3], 0)).toBeCloseTo(b.goods, 2);
    expect(b.goods + (b.extras || []).reduce((n, e) => n + e.amount, 0)).toBeCloseTo(b.grand, 2);
  });
  it("challan 5494 matches its printed page totals", () => {
    const l = BILLS[1].lines, sum = (a: number, z: number) => l.slice(a, z).reduce((n, x) => n + x[3], 0);
    expect(l).toHaveLength(62);
    expect([sum(0, 30), sum(30, 60), sum(60, 62)]).toEqual(CHALLAN_PAGES);
  });
});
