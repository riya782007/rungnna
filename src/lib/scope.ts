export const MAIN_STORE = "00000000-0000-4000-8000-00000000b001";
let selected = MAIN_STORE;
let role = "owner";
export function currentStore() { return selected; }
export function setScope(store: string, staffRole = role) { selected = store || MAIN_STORE; role = staffRole; }
export function inStore(row: { store_id?: string | null }, store = selected) { return (row.store_id || MAIN_STORE) === store; }
export function ownerOnly() { if (role !== "owner") throw new Error("Owner only"); }
/* permissions of the person signed in on this device (set by the app from lib/roles) */
let perms: Set<string> = new Set();
export function setScopePerms(p: Set<string>) { perms = p; }
export function requirePerm(key: string, what = "this") { if (role !== "owner" && !perms.has(key)) throw new Error(`Your role doesn't allow ${what}. Ask the owner.`); }
