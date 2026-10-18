import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import { renderDealer } from "../api/_dealer";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MIGRATIONS = fileURLToPath(new URL("../supabase/migrations", import.meta.url));

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

  /* The page and the database are deployed separately. Renaming an argument in SQL — p_shop to
     p_shop_name, say — used to pass CI happily and then kill dealer registration in production,
     because PostgREST binds RPC arguments by NAME. This pins the page's calls to the signatures
     the migrations actually declare. */
  it("calls every dealer function with the argument names the migrations declare", () => {
    const sql = readdirSync(MIGRATIONS).filter(f => f.endsWith(".sql")).sort()
      .map(f => readFileSync(join(MIGRATIONS, f), "utf8")).join("\n");

    const overloads = new Map<string, { name: string; optional: boolean }[][]>();
    for (const m of sql.matchAll(/create or replace function\s+(dealer_\w+)\s*\(([^)]*)\)/gi)) {
      const params = m[2].split(",").map(x => x.trim()).filter(Boolean)
        .map(part => ({ name: part.split(/\s+/)[0], optional: /default/i.test(part) }));
      overloads.set(m[1], [...(overloads.get(m[1]) || []), params]);
    }
    expect(overloads.size).toBeGreaterThan(5);

    const js = html.match(/<script>([\s\S]*)<\/script><\/body>/)![1];
    const calls = [...js.matchAll(/rpc\("(\w+)",\{([^}]*)\}/g)].map(m => ({
      fn: m[1],
      keys: [...m[2].matchAll(/(?:^|,)\s*([A-Za-z_]\w*)\s*:/g)].map(k => k[1]),
    }));
    expect(calls.length).toBeGreaterThan(5);

    for (const c of calls) {
      const defs = overloads.get(c.fn);
      expect(defs, `${c.fn} is called by the page but no migration declares it`).toBeTruthy();
      const fits = defs!.some(ps => {
        const names = ps.map(x => x.name);
        const required = ps.filter(x => !x.optional).map(x => x.name);
        return c.keys.every(k => names.includes(k)) && required.every(r => c.keys.includes(r));
      });
      expect(fits, `${c.fn}({${c.keys.join(", ")}}) matches no declared signature: ` +
        defs!.map(ps => "(" + ps.map(x => x.name + (x.optional ? "?" : "")).join(", ") + ")").join(" | ")).toBe(true);
    }
  });

  it("asks a new dealer for the state that decides CGST+SGST vs IGST", () => {
    expect(html).toContain('name="state"');
    const js = html.match(/<script>([\s\S]*)<\/script><\/body>/)![1];
    expect(js).toContain("p_state:");
  });

  it("empties the cart on log out, so a shared counter tablet does not hand it to the next dealer", () => {
    const js = html.match(/<script>([\s\S]*)<\/script><\/body>/)![1];
    const logout = js.slice(js.indexOf('#out'), js.indexOf('#out') + 320);
    expect(logout).toMatch(/set\(C,null\)/);
    expect(logout).toMatch(/state\.cart=\{\}/);
  });
});
