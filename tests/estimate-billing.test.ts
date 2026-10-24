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
