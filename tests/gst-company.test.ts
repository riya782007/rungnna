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

/* Owner, 14 Nov (voice): every new estimate starts at the shop's usual 50%, even on a counter whose shop details came
   without the setting; a value saved in Settings (0 included) still wins. */
import { withEstimateDiscount, newBill, DEFAULT_SHOP } from "../src/lib/billing";
describe("usual estimate discount", () => {
  it("is 50% when the shop details don't say", () => {
    expect(withEstimateDiscount(newBill("k", { ...DEFAULT_SHOP }, "estimate"), { ...DEFAULT_SHOP }).discount_pct).toBe(50);
  });
  it("follows what the owner saved", () => {
    expect(withEstimateDiscount(newBill("k", DEFAULT_SHOP, "estimate"), { ...DEFAULT_SHOP, est_disc_pct: 0 }).discount_pct ?? 0).toBe(0);
    expect(withEstimateDiscount(newBill("k", DEFAULT_SHOP, "estimate"), { ...DEFAULT_SHOP, est_disc_pct: 40 }).discount_pct).toBe(40);
  });
});
