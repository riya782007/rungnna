import { db, put, now, type Config, type Staff, type Store } from "./db";
import { MAIN_STORE, ownerOnly } from "./scope";
import { createStore } from "./stores";
import { codeMatches, getOpenCode, normCode } from "./openCode";
import { setCompanyFeatures } from "./roles";

/* Companies (owner, 27 Oct; see docs/companies.md). One master owner makes as many companies as he wants. Each
   company has its own entry code; after it the person signs in with their own name and PIN, and only that
   company opens. The owner decides per company which features exist there and after how many idle minutes it
   signs out. Everything lives in config rows, so it reaches every counter with the normal sync (no migration). */

export type CompanyCfg = { salt?: string; hash?: string; features?: string[] | null; idle_minutes?: number };
export type Entry = { store: string; master: boolean };
const cfgKey = (id: string) => "company_" + id;
const MASTER = "master_code";

const bare = (s: string) => normCode(s).replace(/ /g, "");
async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, "0")).join("");
}
const newSalt = () => Array.from(crypto.getRandomValues(new Uint32Array(4))).join("-");
const hashMatches = async (c: { salt?: string; hash?: string } | undefined, typed: string) =>
  !!c?.salt && !!c.hash && !!bare(typed) && (await sha(c.salt + bare(typed))) === c.hash;

export async function companyCfg(id: string): Promise<CompanyCfg> {
  return ((await db.config.get(cfgKey(id)))?.value as CompanyCfg) || {};
}
async function saveCfg(id: string, patch: Partial<CompanyCfg>) {
  ownerOnly();
  const cur = await companyCfg(id);
  await put("config", { id: cfgKey(id), value: { ...cur, ...patch }, updated_at: now() } as Config);
}

/** Companies anyone can be in (the old estimate company of 23–26 Oct is never offered again). */
export const liveCompanies = () => db.stores.filter(s => !s.deleted && !!s.active && s.kind !== "estimate").toArray();

/** What a typed entry code opens: the master view, one company, or nothing. */
export async function entryFor(typed: string): Promise<Entry | null> {
  if (!bare(typed)) return null;
  if (await hashMatches((await db.config.get(MASTER))?.value, typed)) return { store: MAIN_STORE, master: true };
  for (const s of await liveCompanies()) {
    if (s.id === MAIN_STORE) continue;
    if (await hashMatches(await companyCfg(s.id), typed)) return { store: s.id, master: false };
  }
  // the main company keeps the shop's common entry code ("Rungnna 2026"); until a master code is set, the owner
  // coming in through it is the master, exactly as before companies existed
  if (codeMatches(typed, await getOpenCode())) return { store: MAIN_STORE, master: !(await hasMasterCode()) };
  return null;
}
export const hasMasterCode = async () => !!(await db.config.get(MASTER))?.value?.hash;

/** May this person work in the company the entry code opened? A "no" looks like a wrong PIN to them. */
export function mayOpen(person: Pick<Staff, "role" | "store_id" | "stores">, entry: Entry): boolean {
  if (person.role === "owner") return true;
  if (entry.master) return false;
  return worksIn(person, entry.store);
}
/** People lists inside a company show only its own people (and the owner), never another company's staff. */
export const worksIn = (person: Pick<Staff, "role" | "store_id" | "stores">, store: string) =>
  person.role === "owner" || (person.stores?.length ? person.stores : [person.store_id || MAIN_STORE]).includes(store);

/** No two companies (or the master) may share an entry code: the code is what decides which company opens. */
async function assertFreeCode(code: string, forId: string) {
  if (bare(code).length < 4) throw new Error("Use at least 4 letters or numbers");
  let taken = forId !== MASTER && await hashMatches((await db.config.get(MASTER))?.value, code);
  taken ||= forId !== MAIN_STORE && codeMatches(code, await getOpenCode());
  for (const s of await liveCompanies()) if (!taken && s.id !== forId && s.id !== MAIN_STORE) taken = await hashMatches(await companyCfg(s.id), code);
  if (taken) throw new Error("Another company (or the master) already uses this code — choose a different one");
}
/** For the main company's common entry code (Settings › Shop): it must not be another company's or the master's. */
export const assertMainCodeFree = (code: string) => assertFreeCode(code, MAIN_STORE);
export async function setCompanyCode(id: string, code: string) {
  ownerOnly();
  if (id === MAIN_STORE) throw new Error("The main company uses the shop's common entry code (Settings › Shop)");
  await assertFreeCode(code, id);
  const salt = newSalt();
  await saveCfg(id, { salt, hash: await sha(salt + bare(code)) });
}
export async function setMasterCode(code: string) {
  ownerOnly();
  await assertFreeCode(code, MASTER);
  const salt = newSalt();
  await put("config", { id: MASTER, value: { salt, hash: await sha(salt + bare(code)) }, updated_at: now() } as Config);
}
/** null = every feature (the default); otherwise only these permission keys exist in the company. */
export const setCompanyFeaturesFor = (id: string, features: string[] | null) => saveCfg(id, { features });
export const setCompanyIdle = (id: string, minutes: number) => saveCfg(id, { idle_minutes: Math.max(0, Math.min(240, Math.round(minutes) || 0)) });

/** A new company starts with the main company's bill layout and details, so every company looks the same. */
export async function createCompany(name: string, code: string, entryCode: string): Promise<Store> {
  ownerOnly();
  await assertFreeCode(entryCode, "new");
  const s = await createStore(name, code) as Store;
  const main = (await db.config.get("shop"))?.value;
  if (main) await put("config", { id: "shop_" + s.id, value: { ...main, name: name.trim().toUpperCase(), gstin: "" }, updated_at: now() } as Config);
  await setCompanyCode(s.id, entryCode);
  return s;
}

/** Load a company's feature switch into the permission checks. Call before the person is set. Returns its idle minutes. */
export async function applyCompany(id: string): Promise<number> {
  const c = await companyCfg(id);
  setCompanyFeatures(Array.isArray(c.features) ? c.features : null);
  return c.idle_minutes || 0;
}

/** Calls onIdle once after `minutes` without a tap or key, or when the app comes back after being away over a minute.
 * (From the estimate-company timeout of 23 Oct, kept for every company.) */
export function watchIdle(minutes: number, onIdle: () => void, target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window, doc: Pick<Document, "addEventListener" | "removeEventListener" | "hidden"> | null = typeof document !== "undefined" ? document : null): () => void {
  const ms = Math.max(1, minutes) * 60_000;
  let timer: ReturnType<typeof setTimeout> | undefined, done = false, hiddenAt = 0;
  const fire = () => { if (done) return; done = true; stop(); onIdle(); };
  const poke = () => { if (done) return; clearTimeout(timer); timer = setTimeout(fire, ms); };
  const vis = () => { if (!doc) return; if (doc.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 60_000) fire(); else hiddenAt = 0; };
  const stop = () => { clearTimeout(timer); target.removeEventListener("pointerdown", poke); target.removeEventListener("keydown", poke); doc?.removeEventListener("visibilitychange", vis); };
  target.addEventListener("pointerdown", poke, { passive: true } as AddEventListenerOptions); target.addEventListener("keydown", poke);
  doc?.addEventListener("visibilitychange", vis);
  poke();
  return () => { done = true; stop(); };
}
