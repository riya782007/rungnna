import { afterEach, describe, expect, it } from "vitest";
import { BUILTIN, BUILTIN_DEFAULT, builtinEdited, can, permsOf, setBuiltinCache } from "../src/lib/roles";
import { missingColumn, strip } from "../src/lib/sync";

afterEach(() => setBuiltinCache(undefined));

describe("owner can change built-in roles", () => {
  it("applies an edited salesman role to every salesman", () => {
    const salesman = { role: "salesman" as const };
    expect(can(salesman, "billing.rates")).toBe(false);
    setBuiltinCache({ salesman: [...BUILTIN_DEFAULT.salesman, "billing.rates"] });
    expect(builtinEdited("salesman")).toBe(true);
    expect(can(salesman, "billing.rates")).toBe(true);
    expect(BUILTIN.salesman).toContain("billing.rates");
  });
  it("can take a permission away and reset to the original", () => {
    setBuiltinCache({ helper: [] });
    expect(permsOf({ role: "helper" }).size).toBe(0);
    setBuiltinCache({});
    expect([...permsOf({ role: "helper" })].sort()).toEqual([...BUILTIN_DEFAULT.helper].sort());
  });
  it("never lets an edit reduce the owner or grant unknown permissions", () => {
    setBuiltinCache({ owner: [], packer: ["stock.view", "make.me.admin"] });
    expect(can({ role: "owner" }, "staff.manage")).toBe(true);
    expect([...permsOf({ role: "packer" })]).toEqual(["stock.view"]);
  });
});

describe("sync before the cloud has a new column", () => {
  it("stops sending only the missing column and keeps the rest of the bill", () => {
    const bill = { id: "b1", salesman: "KARAN", helper: "SONU", net: 100 };
    expect(strip("bills" as any, bill)).toMatchObject({ helper: "SONU", salesman: "KARAN" });
    expect(missingColumn("bills", "Could not find the 'helper' column of 'bills' in the schema cache")).toBe("helper");
    const row = strip("bills" as any, bill);
    expect(row).not.toHaveProperty("helper");
    expect(row).toMatchObject({ id: "b1", salesman: "KARAN", net: 100 });
    expect(missingColumn("bills", "duplicate key value")).toBeUndefined();
  });
});
