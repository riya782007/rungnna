import { ALL_PERMS, BUILTIN } from "./roles";

export const MAIN_STORE = "00000000-0000-4000-8000-00000000b001";
let selected = MAIN_STORE;
/* Nobody is signed in until the app says so. This must NOT default to "owner":
   ownerOnly() and requirePerm() are the last line of defence, and between sign-out
   and the next PIN the device would otherwise accept owner-only work (full data
   export, new stores) from whoever picks it up. */
let role = "";
/* Permissions of the person signed in on this device. Kept in step with `role` by setScope,
   so the two can never disagree: a role without its permissions used to leave every
   requirePerm() open (or, on a PIN switch, briefly carrying the previous person's rights). */
let perms: Set<string> = new Set();

const builtinPerms = (r: string) =>
  r === "owner" ? new Set(ALL_PERMS) : new Set(BUILTIN[r as keyof typeof BUILTIN] || []);

export function currentStore() { return selected; }
/** Set the active store and who is using the device. Permissions follow the role unless given
    explicitly — the app passes the exact set (custom roles included) right after. */
export function setScope(store: string, staffRole = role, p?: Set<string>) {
  selected = store || MAIN_STORE;
  role = staffRole;
  perms = p ?? builtinPerms(staffRole);
}
export function inStore(row: { store_id?: string | null }, store = selected) { return (row.store_id || MAIN_STORE) === store; }
export function ownerOnly() { if (role !== "owner") throw new Error("Owner only"); }
export function setScopePerms(p: Set<string>) { perms = p; }
export function requirePerm(key: string, what = "this") { if (role !== "owner" && !perms.has(key) && !estimateBilling(key, k => perms.has(k))) throw new Error(`Your role doesn't allow ${what}. Ask the owner.`); }

import { companyKindNow, setCompanyKind, estimateBilling } from "./company-kind";
export { companyKindNow, setCompanyKind };
/** The document type a new bill takes in this company. */
export function typeForCompany<T extends string>(t: T): T | "estimate" | "gst" {
  const kind = companyKindNow();
  if (kind === "estimate" && t !== "return") return "estimate";
  if (kind === "gst" && t === "estimate") return "gst";
  return t;
}
