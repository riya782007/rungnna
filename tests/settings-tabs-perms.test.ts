import { describe, it, expect, afterEach } from "vitest";
import { setScope, requireAnyPerm, MAIN_STORE } from "../src/lib/scope";
import { ALL_PERMS, can } from "../src/lib/roles";

/* Owner, 6 Nov (voice): a permission for each Settings item — who may go in, and what is allowed there. */
describe("Settings, one permission per tab", () => {
  afterEach(() => setScope(MAIN_STORE, ""));
  it("lists each tab as its own tick", () => {
    for (const k of ["settings.shop", "settings.prices", "settings.suppliers", "settings.backup"]) expect(ALL_PERMS).toContain(k);
  });
  it("a person with only Prices may change prices but not the shop's details", () => {
    setScope(MAIN_STORE, "staff", new Set(["settings.prices"]));
    expect(() => requireAnyPerm(["settings.manage", "settings.prices"], "changing the pricing rule")).not.toThrow();
    expect(() => requireAnyPerm(["settings.manage", "settings.shop"], "changing shop settings")).toThrow();
    expect(can({ role: "staff", perms: ["settings.prices"] }, "settings.shop")).toBe(false);
  });
  it("'Settings — every tab' still opens everything", () => {
    setScope(MAIN_STORE, "staff", new Set(["settings.manage"]));
    expect(() => requireAnyPerm(["settings.manage", "settings.shop"])).not.toThrow();
  });
});
