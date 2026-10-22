import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { db, put, uid, now, getSetting, setSetting, type Staff, type Location } from "./db";
import { initStores } from "./stores";
import { setScope, setScopePerms, currentStore, MAIN_STORE } from "./scope";
import { resetCounterAccess } from "./entryAuth";
import { setRolesCache, setBuiltinCache, permsOf, sessionAllowed } from "./roles";
import { useLiveQuery } from "dexie-react-hooks";

/* ---------- tiny hash router (works offline, no server rewrites needed) ---------- */
export function useRoute(): [string, string[]] {
  const read = () => (location.hash.replace(/^#\/?/, "") || "bill").split("/");
  const [r, setR] = useState(read());
  useEffect(() => { const f = () => setR(read()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  return [r[0], r.slice(1)];
}
export const go = (path: string) => { location.hash = "#/" + path; };

/* ---------- toasts ---------- */
let pushToast: (t: string, bad?: boolean) => void = () => {};
export const toast = (t: string, bad = false) => pushToast(t, bad);
export function Toasts() {
  const [list, setList] = useState<{ id: number; t: string; bad: boolean }[]>([]);
  useEffect(() => {
    pushToast = (t, bad = false) => {
      const id = Date.now() + Math.random();
      setList(l => [...l, { id, t, bad }]);
      setTimeout(() => setList(l => l.filter(x => x.id !== id)), 3200);
    };
  }, []);
  return <div className="toast" role="status">{list.map(x => <div key={x.id} className={x.bad ? "bad" : ""}>{x.t}</div>)}</div>;
}

/* ---------- beep + vibrate on scan (the shop floor is noisy; hands are full) ---------- */
let ac: AudioContext | null = null;
/* Counter sounds, loud enough to hear over a busy shop:
   added      → two bright rising beeps
   repeat     → one firm mid beep (same item again)
   saved      → three quick high beeps
   not found  → three long, low, harsh buzzes that can't be mistaken for success */
const TONES: Record<string, { f: number; ms: number; wave: OscillatorType; gap?: number }[]> = {
  ok: [{ f: 1200, ms: 90, wave: "square" }, { f: 1700, ms: 140, wave: "square", gap: 30 }],
  repeat: [{ f: 900, ms: 180, wave: "square" }],
  saved: [{ f: 1500, ms: 80, wave: "square" }, { f: 1900, ms: 80, wave: "square", gap: 40 }, { f: 2300, ms: 140, wave: "square", gap: 40 }],
  bad: [{ f: 220, ms: 260, wave: "sawtooth" }, { f: 180, ms: 260, wave: "sawtooth", gap: 90 }, { f: 220, ms: 420, wave: "sawtooth", gap: 90 }],
};
export function beep(ok: boolean | "repeat" | "saved" = true) {
  const kind = ok === "repeat" ? "repeat" : ok === "saved" ? "saved" : ok ? "ok" : "bad";
  try {
    ac = ac || new AudioContext();
    void ac.resume();
    const master = ac.createGain(); master.gain.value = kind === "bad" ? 0.9 : 0.7;
    const squash = ac.createDynamicsCompressor();   // as loud as possible without crackling
    master.connect(squash); squash.connect(ac.destination);
    let t = ac.currentTime + 0.01;
    for (const tone of TONES[kind]) {
      t += (tone.gap || 0) / 1000;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = tone.wave; o.frequency.value = tone.f;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(1, t + 0.005);
      g.gain.setValueAtTime(1, t + tone.ms / 1000 - 0.01); g.gain.linearRampToValueAtTime(0, t + tone.ms / 1000);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + tone.ms / 1000 + 0.02);
      t += tone.ms / 1000;
    }
  } catch { /* no audio */ }
  try { navigator.vibrate?.(kind === "bad" ? [200, 80, 200, 80, 300] : kind === "ok" ? [60, 30, 60] : 60); } catch { /* no vibrate */ }
  if (kind === "bad") flashScreen();
}
/* A failed scan also flashes the screen red, so it is seen even if the speaker is off. */
function flashScreen() {
  try {
    const el = document.createElement("div");
    el.className = "scan-fail-flash"; el.setAttribute("aria-hidden", "true");
    document.body.appendChild(el); setTimeout(() => el.remove(), 900);
  } catch { /* no DOM */ }
}

/* ---------- who is using this device ---------- */
type Ctx = { me: Staff | null; setMe: (s: Staff | null) => void; ready: boolean; store: string; switchStore: (id: string) => Promise<void> };
const AppCtx = createContext<Ctx>({ me: null, setMe: () => {}, ready: false, store: currentStore(), switchStore: async () => {} });
export const useApp = () => useContext(AppCtx);

export const BUCKETS: Omit<Location, "id" | "updated_at">[] = [
  { code: "DAMAGED", floor: "", rack: "", box: "", name: "Damaged / quarantine", kind: "bucket" },
  { code: "MISSING", floor: "", rack: "", box: "", name: "Stolen / missing", kind: "bucket" },
  { code: "REPAIR", floor: "", rack: "", box: "", name: "Out for repair", kind: "bucket" },
];

async function firstRun() {
  if (await getSetting("seeded", false)) return;
  // bucket locations get fixed ids so every device creates the same rows
  const ids: Record<string, string> = {
    DAMAGED: "00000000-0000-4000-8000-000000000d01",
    MISSING: "00000000-0000-4000-8000-000000000d02",
    REPAIR: "00000000-0000-4000-8000-000000000d03",
  };
  for (const b of BUCKETS) {
    if (!(await db.locations.where("code").equals(b.code).first()))
      await put("locations", { ...b, id: ids[b.code], updated_at: now() } as Location);
  }
  // local placeholder only (epoch timestamp, not queued): a real owner row from the cloud always wins
  if ((await db.staff.count()) === 0)
    await db.staff.put({ id: SEED_OWNER, name: "Owner", role: "owner", phone: "", pin: "", active: 1, updated_at: "1970-01-01T00:00:00.000Z" } as Staff);
  await setSetting("seeded", true);
  try { await navigator.storage?.persist?.(); } catch { /* browser may refuse */ }
}

/** The blank owner every new install starts with (same id everywhere; never saved to the cloud as the owner). */
export const SEED_OWNER = "00000000-0000-4000-8000-00000000a001";

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMeS] = useState<Staff | null>(null);
  const [ready, setReady] = useState(false);
  const [store, setStore] = useState(currentStore());
  const staffRow = useLiveQuery(() => me ? db.staff.get(me.id) : undefined, [me?.id]);
  useEffect(() => { if (!staffRow || !me || staffRow.updated_at === me.updated_at) return; if (!sessionAllowed(staffRow)) { setMe(null); return; } setMeS(staffRow); const id = staffRow.role === "owner" ? store : staffRow.store_id || MAIN_STORE; setScope(id, staffRow.role, permsOf(staffRow)); setStore(id); }, [staffRow?.updated_at]);
  useEffect(() => {
    (async () => {
      await firstRun();
      { const v = (await db.config.get("roles"))?.value as any; setRolesCache(v?.roles); setBuiltinCache(v?.builtin); }
      // A remembered person must never bypass the common entry code and personal
      // access on the next opening. Keep business data and the billing draft intact.
      const fallbackStore = await initStores();
      const storeId = await getSetting("active_store", fallbackStore);
      await resetCounterAccess(storeId);
      setStore(storeId);
      setReady(true);
    })();
  }, []);
  /* Role AND permissions move together, synchronously. If the permission set were left to the
     effect below, there would be one commit where `role` is the new person and `perms` are still
     the previous person's — reachable on a shared counter when someone switches and scans at once. */
  const setMe = (s: Staff | null) => { const id = s?.role === "owner" ? store : s?.store_id || MAIN_STORE; setScope(id, s?.role || ""); setScopePerms(permsOf(s)); setStore(id); setMeS(s); setSetting("me", s?.id || ""); };
  const switchStore = async (id: string) => { if (me?.role !== "owner") throw new Error("Owner only"); await setSetting("active_store", id); setScope(id, "owner"); setStore(id); };
  // custom roles sync like any setting; every check (lib/roles) and every guarded save (scope.requirePerm) follows them
  const rolesRow = useLiveQuery(() => db.config.get("roles"), []);
  const [, bump] = useState(0);
  useEffect(() => {
    if (!rolesRow) return;
    setRolesCache((rolesRow.value as any)?.roles); setBuiltinCache((rolesRow.value as any)?.builtin);
    if (me && !sessionAllowed(me)) { setMe(null); return; }
    setScopePerms(permsOf(me)); bump(n => n + 1);
  }, [rolesRow?.updated_at, me?.id, me?.role, me?.role_id]);
  return <AppCtx.Provider value={{ me, setMe, ready, store, switchStore }}>{children}</AppCtx.Provider>;
}

export const newStaff = (name: string, role: Staff["role"], pin = "", phone = ""): Staff =>
  ({ id: uid(), name, role, pin, phone, active: 1, updated_at: now() });
