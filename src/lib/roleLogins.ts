import { db, put, now, uid, type Config, type Staff } from "./db";
import { requirePerm } from "./scope";
import { newPasscode, normPass, type CustomRole } from "./roles";

/* ===========================================================================
   Role passcodes, as on the reference console's Roles & Permissions page.

   Every role has its own passcode. A staff member types it on the opening
   screen, in the same box as the shop passcode, and is signed in as that role,
   seeing only what it allows. Behind each passcode is one staff row marked
   login = "role". It is not a person: it never appears in the person list,
   never carries a PIN, and is never the owner.

   Regenerating a passcode gives the role a new row and retires the old one.
   Every device still signed in with the old passcode is then signed out on its
   next sync (lib/app ends a session whose staff row is retired). A leaked code
   is shut off everywhere, not only for new sign-ins.
=========================================================================== */

/** Give every role what it needs to sign in. Roles that already have a passcode keep it. */
export function withPasscodes(roles: CustomRole[]): CustomRole[] {
  const taken = roles.map(r => r.passcode || "").filter(Boolean);
  return roles.map(r => {
    if (r.passcode && r.login_id) return r;
    const passcode = r.passcode || newPasscode(taken);
    taken.push(passcode);
    return { ...r, passcode, login_id: r.login_id || uid() };
  });
}

/** A new passcode for one role. The old one stops working, including on devices already signed in. */
export function regenerated(roles: CustomRole[], id: string): CustomRole[] {
  const taken = roles.filter(r => r.id !== id).map(r => r.passcode || "").filter(Boolean);
  const old = roles.find(r => r.id === id)?.passcode;
  return roles.map(r => r.id !== id ? r : { ...r, passcode: newPasscode([...taken, ...(old ? [old] : [])]), login_id: uid() });
}

/** The staff row a role's passcode signs in as. Never the owner, whatever the role was copied from. */
export function loginRowFor(r: CustomRole): Pick<Staff, "id" | "name" | "role" | "role_id" | "login" | "pin" | "phone" | "active"> {
  return { id: r.login_id!, name: r.name, role: r.base === "owner" ? "salesman" : r.base, role_id: r.id, login: "role", pin: "", phone: "", active: 1 };
}

/** Make the sign-in rows match the roles: create, rename, and retire the ones no passcode leads to. */
export async function syncRoleLogins(roles: CustomRole[]) {
  const live = new Set(roles.map(r => r.login_id).filter(Boolean));
  for (const s of await db.staff.filter(s => s.login === "role").toArray())
    if (!live.has(s.id) && (!s.deleted || s.active)) await put("staff", { ...s, active: 0, deleted: 1 } as Staff);
  for (const r of roles) {
    if (!r.login_id) continue;
    const want = loginRowFor(r);
    const cur = await db.staff.get(r.login_id);
    const same = cur && cur.name === want.name && cur.role === want.role && cur.role_id === want.role_id
      && cur.login === "role" && !!cur.active && !cur.deleted && !cur.pin;
    if (!same) await put("staff", { ...(cur || {}), ...want, deleted: 0 } as Staff);
  }
}

/** Save the roles and keep every passcode's sign-in in step. Returns the roles as saved. */
export async function saveRoles(next: CustomRole[]): Promise<CustomRole[]> {
  requirePerm("staff.manage", "changing roles");
  const roles = withPasscodes(next);
  const codes = roles.map(r => normPass(r.passcode || ""));
  if (new Set(codes).size !== codes.length) throw new Error("Two roles ended up with the same passcode — regenerate one of them");
  await put("config", { id: "roles", value: { roles }, updated_at: now() } as Config);
  await syncRoleLogins(roles);
  return roles;
}
