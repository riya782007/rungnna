import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, setSetting, type Staff } from "../src/lib/db";
import { setScope, MAIN_STORE } from "../src/lib/scope";
const auth = vi.hoisted(() => ({ level: "aal1", challenge: vi.fn() }));
vi.mock("../src/lib/sync", () => ({ sb: async () => ({ auth: { mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: auth.level } }), listFactors: async () => ({ data: { totp: [{ id: "f", status: "verified" }] } }), challengeAndVerify: auth.challenge } } }) }));
import { ownerVerified, trustOwner, verifyOwner, enableOwnerSecurity } from "../src/lib/security";
const owner = { id: "o", name: "Owner", role: "owner" } as Staff;
beforeEach(async () => { setScope(MAIN_STORE, "owner"); auth.level = "aal1"; auth.challenge.mockReset().mockImplementation(async () => { auth.level = "aal2"; return { error: null }; }); await Promise.all(db.tables.map(t => t.clear())); });
describe("owner verification", () => {
  it("requires a challenge on a new device but preserves verified offline trust", async () => { await db.config.put({ id: "owner_security", value: { enabled: true, version: "v1" }, updated_at: "" }); expect(await ownerVerified(owner)).toBe(false); await verifyOwner("123456", owner); expect(auth.challenge).toHaveBeenCalledWith({ factorId: "f", code: "123456" }); expect(await ownerVerified(owner)).toBe(true); });
  it("never trusts a device with only password assurance", async () => { await expect(trustOwner(owner)).rejects.toThrow("Verify"); await expect(enableOwnerSecurity(owner)).rejects.toThrow("Verify"); });
  it("invalidates old device trust when the owner re-enables security", async () => { await setSetting("owner_trust_other", "old"); auth.level = "aal2"; await enableOwnerSecurity(owner); expect(await ownerVerified(owner)).toBe(true); expect(await ownerVerified({ ...owner, id: "other" })).toBe(false); expect((await db.config.get("owner_security"))?.value).not.toHaveProperty("secret"); });
});
