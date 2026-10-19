import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, getSetting, setSetting, type Staff } from "../src/lib/db";
import { MAIN_STORE, setScope, ownerOnly, requirePerm } from "../src/lib/scope";
import { saveRoles, regenerated } from "../src/lib/roleLogins";
import { resetCounterAccess, entryWait, recordEntryAttempt, personForPin, staffForRolePasscode } from "../src/lib/entryAuth";

const person: Staff = { id: "person", name: "Packer", role: "packer", pin: "2356", phone: "", active: 1, updated_at: "" };
beforeEach(async () => { setScope(MAIN_STORE, "owner"); await Promise.all(db.tables.map(table => table.clear())); });
afterEach(() => vi.useRealTimers());

describe("offline personal access", () => {
  it("locks a saved owner identity on startup and preserves business data, pending sync and drafts", async () => {
    const draft = { id: "draft-keep", status: "hold", items: [{ item: "RELOAD DRAFT", qty: 2 }], selected_box: 3 };
    await setSetting("me", "owner"); await setSetting("draft_bill", draft);
    await db.staff.put(person);
    await db.outbox.add({ table: "staff", row_id: person.id, at: "saved", tries: 0 });
    await resetCounterAccess();
    expect(await getSetting("me", "fallback")).toBe("");
    expect(() => ownerOnly()).toThrow("Owner only");
    expect(() => requirePerm("billing.sell")).toThrow(/role/);
    expect(await getSetting("draft_bill", null)).toEqual(draft);
    expect(await db.staff.get(person.id)).toEqual(person);
    expect(await db.outbox.count()).toBe(1);
  });

  it("requires the selected person's own PIN, with no empty-PIN bypass", async () => {
    await db.staff.put(person);
    expect(await personForPin(person.id, "2356")).toEqual(person);
    expect(await personForPin(person.id, "9999")).toBeUndefined();
    await db.staff.put({ ...person, pin: "" });
    expect(await personForPin(person.id, "")).toBeUndefined();
  });

  it("rechecks disabled and changed people at sign-in instead of trusting the visible selection", async () => {
    await db.staff.put({ ...person, active: 0 });
    expect(await personForPin(person.id, "2356")).toBeUndefined();
    await db.staff.put({ ...person, pin: "5678" });
    expect(await personForPin(person.id, "2356")).toBeUndefined();
    expect((await personForPin(person.id, "5678"))?.id).toBe(person.id);
  });

  it("signs in only through the current role code and matching active role row", async () => {
    const [role] = await saveRoles([{ id: "role", name: "Packer", base: "packer", perms: ["stock.view"] }]);
    expect((await staffForRolePasscode(role.passcode!))?.id).toBe(role.login_id);
    const [next] = await saveRoles(regenerated([role], role.id));
    expect(await staffForRolePasscode(role.passcode!)).toBeUndefined();
    expect((await staffForRolePasscode(next.passcode!))?.id).toBe(next.login_id);
    await db.staff.update(next.login_id!, { role_id: "other-role" });
    expect(await staffForRolePasscode(next.passcode!)).toBeUndefined();
  });

  it("persists PIN and role-code throttling and does not reset it with the known common entry code", async () => {
    vi.spyOn(Date, "now").mockReturnValue(100_000);
    for (let i = 0; i < 4; i++) expect(await recordEntryAttempt(false)).toBe(0);
    expect(await recordEntryAttempt(false)).toBe(15_000);
    expect(await entryWait()).toBe(15_000);
    await recordEntryAttempt(true, "shop");
    expect(await entryWait()).toBe(15_000);
    expect(await entryWait("shop")).toBe(0);
    await recordEntryAttempt(true);
    expect(await entryWait()).toBe(0);
    vi.restoreAllMocks();
  });
});
