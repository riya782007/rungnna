import { db, getSetting, setSetting, type Staff } from "./db";
import { MAIN_STORE, setScope } from "./scope";
import { roleForPasscode, sessionAllowed, type CustomRole } from "./roles";

type Failures = { n: number; until: number };
type EntryStage = "shop" | "identity";
const keyFor = (stage: EntryStage) => stage === "shop" ? "shop_entry_fails" : "open_fails";
export async function entryWait(stage: EntryStage = "identity"): Promise<number> {
  const failure = await getSetting<Failures>(keyFor(stage), { n: 0, until: 0 });
  return Math.max(0, failure.until - Date.now());
}
export async function recordEntryAttempt(success: boolean, stage: EntryStage = "identity"): Promise<number> {
  return db.transaction("rw", db.settings, async () => {
    if (success) { await setSetting(keyFor(stage), { n: 0, until: 0 }); return 0; }
    const failure = await getSetting<Failures>(keyFor(stage), { n: 0, until: 0 });
    const n = failure.n + 1, pause = n >= 5 ? Math.min(300_000, 15_000 * 2 ** (n - 5)) : 0;
    await setSetting(keyFor(stage), { n, until: Date.now() + pause });
    return pause;
  });
}

/** Read current local rows instead of a potentially stale person selected before sync. */
export async function personForPin(id: string, pin: string): Promise<Staff | undefined> {
  const person = await db.staff.get(id);
  if (!person || person.login === "role" || !/^\d{4}$/.test(pin) || pin !== person.pin || !sessionAllowed(person)) return;
  return person;
}

export async function staffForRolePasscode(code: string): Promise<Staff | undefined> {
  const roles: CustomRole[] = ((await db.config.get("roles"))?.value?.roles as CustomRole[]) || [];
  const role = roleForPasscode(code, roles);
  const person = role?.login_id ? await db.staff.get(role.login_id) : undefined;
  return person?.login === "role" && person.role_id === role?.id && sessionAllowed(person, roles) ? person : undefined;
}

/** Opening or reloading a shared counter requires fresh identity, without touching
 * stock, saved documents, pending sync writes or the in-progress billing draft. */
export async function resetCounterAccess(store = MAIN_STORE): Promise<void> {
  setScope(store, "", new Set());
  await setSetting("me", "");
}
