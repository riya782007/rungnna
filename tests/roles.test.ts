import { describe, it, expect } from "vitest";
import { can, permsOf, setRolesCache, ALL_PERMS, BUILTIN } from "../src/lib/roles";
import type { Staff } from "../src/lib/db";

/* the app's original rules — built-in roles must behave exactly as before */
const OLD: Record<Staff["role"], string[]> = {
  owner: ["bill", "sales", "void", "settings", "staff", "rates", "discount", "ai", "reports", "lock"],
  manager: ["bill", "sales", "void", "settings", "rates", "discount", "ai"],
  cashier: ["bill", "sales"], salesman: ["bill"], helper: [], packer: [],
};
const LEGACY = ["bill", "sales", "void", "settings", "staff", "rates", "discount", "ai", "reports", "lock"];
const who = (role: Staff["role"], role_id?: string) => ({ role, role_id });

describe("roles & permissions", () => {
  it("built-in roles keep the original rules", () => {
    setRolesCache([]);
    for (const [role, allowed] of Object.entries(OLD)) for (const p of LEGACY) expect(can(who(role as Staff["role"]), p), role + " " + p).toBe(allowed.includes(p));
  });
  it("everyone keeps stock work, as before", () => {
    for (const r of ["salesman", "helper", "packer"] as const) for (const p of ["stock.move", "stock.in", "labels.print"]) expect(can(who(r), p)).toBe(true);
  });
  it("a custom role grants exactly its ticks; unknown keys are ignored", () => {
    setRolesCache([{ id: "r1", name: "Packer+", base: "packer", perms: ["stock.move", "billing.void", "nonsense.key"] }]);
    const p = permsOf(who("packer", "r1"));
    expect([...p].sort()).toEqual(["billing.void", "stock.move"]);
    expect(can(who("packer", "r1"), "void")).toBe(true);
    expect(can(who("packer", "r1"), "stock.in")).toBe(false);
  });
  it("a deleted custom role falls back to the person's built-in role", () => {
    setRolesCache([]);
    expect(permsOf(who("helper", "gone"))).toEqual(new Set(BUILTIN.helper));
  });
  it("the owner always has everything, whatever role list syncs in", () => {
    setRolesCache([{ id: "x", name: "x", base: "salesman", perms: [] }]);
    expect(permsOf(who("owner", "x")).size).toBe(ALL_PERMS.length);
    expect(can(null, "bill")).toBe(false);
  });
});

describe("the sensitive permissions are flagged", () => {
  it("covers every permission that moves money, erases a trail, or hands over the shop", async () => {
    const { SENSITIVE, isSensitive, ALL_PERMS: all } = await import("../src/lib/roles");
    // every flagged key must be a real permission — a typo here would silently flag nothing
    for (const k of SENSITIVE) expect(all, `${k} is flagged but is not a permission`).toContain(k);
    for (const k of ["billing.void", "estimates.delete", "staff.manage", "settings.manage", "import.data"])
      expect(isSensitive(k), `${k} should be flagged`).toBe(true);
    // ordinary shop work must not be flagged, or the flag stops meaning anything
    for (const k of ["billing.sell", "stock.move", "labels.print", "stock.view"])
      expect(isSensitive(k), `${k} should not be flagged`).toBe(false);
  });

  it("no built-in role below manager carries a sensitive permission it should not", async () => {
    const { SENSITIVE } = await import("../src/lib/roles");
    for (const role of ["cashier", "salesman", "helper", "packer"] as Staff["role"][])
      for (const k of BUILTIN[role])
        expect(SENSITIVE.has(k), `${role} has sensitive permission ${k}`).toBe(false);
  });
});
