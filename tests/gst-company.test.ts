import { describe, it, expect, afterEach } from "vitest";
import { permsOf, setCompanyFeatures, companyAllows, ALL_PERMS } from "../src/lib/roles";

/* Owner, 5–6 Nov (voice): "when we open the GST company it should be only GST — after shifting, no trace". */
describe("a company with estimates switched off", () => {
  afterEach(() => setCompanyFeatures(null));
  it("shows no estimates to anyone there, the owner included", () => {
    setCompanyFeatures(ALL_PERMS.filter(k => !k.startsWith("estimates.")));
    expect(companyAllows("estimates.open")).toBe(false);
    const owner = permsOf({ role: "owner" });
    expect(owner.has("estimates.open")).toBe(false);
    expect(owner.has("billing.sell")).toBe(true);
    expect(owner.has("settings.manage")).toBe(true);   // the owner keeps everything else
  });
  it("leaves the owner every feature in a company that has estimates", () => {
    setCompanyFeatures(null);
    expect(permsOf({ role: "owner" }).size).toBe(ALL_PERMS.length);
    setCompanyFeatures(["billing.sell", "estimates.open"]);
    expect(permsOf({ role: "owner" }).has("estimates.open")).toBe(true);
    expect(permsOf({ role: "owner" }).has("settings.manage")).toBe(true);
  });
});
