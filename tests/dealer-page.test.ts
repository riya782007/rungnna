import { describe, it, expect } from "vitest";
import { renderDealer } from "../api/_dealer";

describe("dealer portal page", () => {
  const html = renderDealer({ name: "RUNGNNA JEWELLERY & CO", phone: "9876543210" }, "https://x.test", { url: "https://p.supabase.co", key: "sb_publishable_abc" });
  it("is private and carries no secrets beyond the public key", () => {
    expect(html).toContain('name="robots" content="noindex, nofollow"');
    expect(html).toContain("sb_publishable_abc");
    expect(html).not.toMatch(/service_role|sb_secret/);
  });
  it("its script parses and talks only to the dealer functions", () => {
    const js = html.match(/<script>([\s\S]*)<\/script><\/body>/)![1];
    expect(() => new Function(js)).not.toThrow();
    const fns = [...js.matchAll(/rpc\("(\w+)"/g)].map(m => m[1]);
    expect(new Set(fns)).toEqual(new Set(["dealer_portal_info", "dealer_catalogue", "dealer_register", "dealer_login", "dealer_logout", "dealer_place_order"]));
    expect(js).not.toContain("</script");
  });
  it("orders send product ids and quantities only — never prices", () => {
    const js = html.match(/<script>([\s\S]*)<\/script><\/body>/)![1];
    expect(js).toMatch(/return\{product_id:id,qty:n\*\(\(it&&it\.pack\)\|\|1\)\}/);
  });
});
