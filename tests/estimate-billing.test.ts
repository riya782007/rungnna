import { describe, expect, it } from "vitest";
import { can } from "../src/lib/roles";
import { setCompanyKind } from "../src/lib/company-kind";
import { MAIN_STORE, requirePerm, setScope } from "../src/lib/scope";

/* Owner, 24 Oct: M has "Open private estimates" ticked but not "Make bills" — in the estimate company M must still
   be able to make the bill (an estimate); in the tax-invoice company "Make bills" still decides. */
const m = { role: "salesman" as const, perms: ["estimates.open", "stock.view"] };
describe("private estimates tick lets a person bill in the estimate company", () => {
  it("estimate company: yes; tax-invoice company: no", () => {
    setCompanyKind("estimate"); expect(can(m, "billing.sell")).toBe(true);
    setCompanyKind("gst"); expect(can(m, "billing.sell")).toBe(false);
    setCompanyKind("estimate"); expect(can({ role: "salesman", perms: ["stock.view"] }, "billing.sell")).toBe(false);
  });
  it("the save check follows the same rule", () => {
    setScope(MAIN_STORE, "salesman", new Set(["estimates.open"]));
    setCompanyKind("estimate"); expect(() => requirePerm("billing.sell", "x")).not.toThrow();
    setCompanyKind("gst"); expect(() => requirePerm("billing.sell", "x")).toThrow();
    setCompanyKind(undefined);
  });
});

import { setEstimatesOnly } from "../src/lib/company-kind";
import { typeForCompany } from "../src/lib/scope";
describe("the shop's one company (owner, 24 Oct night: 'ticked estimates, still no bill')", () => {
  it("private-estimates tick bills estimates, and only estimates, without 'Make bills'", () => {
    setCompanyKind(undefined);
    expect(can(m, "billing.sell")).toBe(true);
    setEstimatesOnly(true);
    expect(typeForCompany("gst")).toBe("estimate");
    expect(typeForCompany("challan")).toBe("estimate");
    expect(typeForCompany("return")).toBe("return");
    setCompanyKind("gst"); expect(typeForCompany("gst")).toBe("gst");
    setEstimatesOnly(false); setCompanyKind(undefined);
    expect(typeForCompany("gst")).toBe("gst");
  });
});
