import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { newPasscode, roleForPasscode, normPass, PASS_ALPHABET, PASS_LEN, isRoleLogin, sessionAllowed, permsOf, setRolesCache, type CustomRole } from "../src/lib/roles";
import { saveRoles, regenerated, withPasscodes } from "../src/lib/roleLogins";

/* A role passcode is a key to the shop. These are the promises it has to keep:
   unique, hard to guess, never the owner, and dead everywhere the moment it is replaced. */

const role = (over: Partial<CustomRole> = {}): CustomRole => ({ id: crypto.randomUUID(), name: "Counter staff", perms: ["billing.sell", "stock.view"], base: "salesman", ...over });

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  setScope(MAIN_STORE, "owner");
});

describe("making a passcode", () => {
  it("is six characters a person can read aloud, with no 0/O or 1/I/L to confuse", () => {
    for (let i = 0; i < 200; i++) {
      const c = newPasscode();
      expect(c).toHaveLength(PASS_LEN);
      for (const ch of c) expect(PASS_ALPHABET).toContain(ch);
      expect(c).not.toMatch(/[01OIL]/);
    }
  });

  it("never repeats a passcode another role already has", () => {
    const taken = Array.from({ length: 50 }, () => newPasscode());
    for (let i = 0; i < 200; i++) expect(taken).not.toContain(newPasscode(taken));
  });

  it("gives roles from before passcodes existed one each, and leaves existing ones alone", () => {
    const old = role({ passcode: "ABC234", login_id: "keep-me" });
    const [kept, filled] = withPasscodes([old, role()]);
    expect(kept).toEqual(old);
    expect(filled.passcode).toHaveLength(PASS_LEN);
    expect(filled.login_id).toBeTruthy();
    expect(filled.passcode).not.toBe(kept.passcode);
  });
});

describe("signing in with a passcode", () => {
  const r = role({ passcode: "K7M2QX", login_id: "row-1" });

  it("forgives case and spaces, as people type them", () => {
    expect(roleForPasscode("k7m2qx", [r])?.id).toBe(r.id);
    expect(roleForPasscode(" K7M 2QX ", [r])?.id).toBe(r.id);
    expect(normPass("k7-m2 qx")).toBe("K7M2QX");
  });

  it("never matches a half-typed or longer code", () => {
    expect(roleForPasscode("K7M2Q", [r])).toBeUndefined();
    expect(roleForPasscode("K7M2QXX", [r])).toBeUndefined();
    expect(roleForPasscode("", [r])).toBeUndefined();
  });

  it("does not open a role whose sign-in has not been set up yet", () => {
    expect(roleForPasscode("K7M2QX", [{ ...r, login_id: undefined }])).toBeUndefined();
  });
});

describe("the sign-in behind each passcode", () => {
  it("is a role sign-in, not a person, and never the owner even when copied from one", async () => {
    const [saved] = await saveRoles([role({ base: "owner", name: "Partner" })]);
    const row = (await db.staff.get(saved.login_id!))!;
    expect(isRoleLogin(row)).toBe(true);
    expect(row.role).not.toBe("owner");
    expect(row.pin).toBe("");
    expect(row.role_id).toBe(saved.id);
    expect(row.name).toBe("Partner");
  });

  it("carries exactly the role's permissions", async () => {
    const [saved] = await saveRoles([role({ perms: ["stock.view", "labels.print"] })]);
    setRolesCache([saved]);
    const row = (await db.staff.get(saved.login_id!))!;
    expect([...permsOf(row)].sort()).toEqual(["labels.print", "printers.manage", "stock.view"]);   // a role saved before the printer switch keeps printer settings
    expect(permsOf(row).has("billing.void")).toBe(false);
  });

  it("regenerating replaces the code AND retires the old sign-in, so signed-in devices are dropped", async () => {
    const [first] = await saveRoles([role()]);
    const [second] = await saveRoles(regenerated([first], first.id));
    expect(second.passcode).not.toBe(first.passcode);
    expect(second.login_id).not.toBe(first.login_id);
    const old = (await db.staff.get(first.login_id!))!;
    expect(old.deleted).toBe(1);
    expect(old.active).toBe(0);
    expect((await db.staff.get(second.login_id!))!.active).toBe(1);
    expect(roleForPasscode(first.passcode!, [second])).toBeUndefined();   // the old code opens nothing
  });

  it("deleting a role retires its sign-in", async () => {
    const [a, b] = await saveRoles([role({ name: "A" }), role({ name: "B" })]);
    await saveRoles([b]);
    expect((await db.staff.get(a.login_id!))!.deleted).toBe(1);
    expect((await db.staff.get(b.login_id!))!.deleted).toBeFalsy();
  });

  it("renaming a role renames its sign-in, so bills show the role's current name", async () => {
    const [a] = await saveRoles([role({ name: "Counter" })]);
    await saveRoles([{ ...a, name: "Front counter" }]);
    expect((await db.staff.get(a.login_id!))!.name).toBe("Front counter");
  });

  it("only someone who may manage roles can change them", async () => {
    setScope(MAIN_STORE, "salesman");
    await expect(saveRoles([role()])).rejects.toThrow(/role/i);
    expect(await db.staff.count()).toBe(0);
  });
  it("revokes an old session when the new role configuration arrives before its retired staff row", async () => {
    const [first] = await saveRoles([role()]);
    const original = (await db.staff.get(first.login_id!))!;
    expect(sessionAllowed(original, [first])).toBe(true);
    const next = regenerated([first], first.id);
    expect(sessionAllowed(original, next)).toBe(false);
    expect(sessionAllowed(original, [])).toBe(false);
    expect(sessionAllowed({ ...original, role: "owner" }, [first])).toBe(false);
  });

  it("rolls back the role configuration and queue if creating its sign-in fails", async () => {
    const fail = () => { throw new Error("Simulated storage failure"); };
    db.staff.hook("creating", fail);
    try { await expect(saveRoles([role()])).rejects.toThrow("Simulated storage failure"); }
    finally { db.staff.hook("creating").unsubscribe(fail); }
    expect(await db.config.get("roles")).toBeUndefined();
    expect(await db.staff.count()).toBe(0);
    expect(await db.outbox.count()).toBe(0);
  });

});
