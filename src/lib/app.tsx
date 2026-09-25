import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { db, put, uid, now, getSetting, setSetting, type Staff, type Location } from "./db";

/* ---------- tiny hash router (works offline, no server rewrites needed) ---------- */
export function useRoute(): [string, string[]] {
  const read = () => (location.hash.replace(/^#\/?/, "") || "home").split("/");
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
export function beep(ok = true) {
  try {
    ac = ac || new AudioContext();
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = ok ? 1250 : 320; g.gain.value = 0.08;
    o.connect(g); g.connect(ac.destination); o.start(); o.stop(ac.currentTime + (ok ? 0.09 : 0.25));
  } catch { /* no audio */ }
  try { navigator.vibrate?.(ok ? 40 : [60, 40, 60]); } catch { /* no vibrate */ }
}

/* ---------- who is using this device ---------- */
type Ctx = { me: Staff | null; setMe: (s: Staff | null) => void; ready: boolean };
const AppCtx = createContext<Ctx>({ me: null, setMe: () => {}, ready: false });
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
    await db.staff.put({ id: "00000000-0000-4000-8000-00000000a001", name: "Owner", role: "owner", phone: "", pin: "", active: 1, updated_at: "1970-01-01T00:00:00.000Z" } as Staff);
  await setSetting("seeded", true);
  try { await navigator.storage?.persist?.(); } catch { /* browser may refuse */ }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [me, setMeS] = useState<Staff | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    (async () => {
      await firstRun();
      const id = await getSetting<string>("me", "");
      if (id) setMeS((await db.staff.get(id)) || null);
      setReady(true);
    })();
  }, []);
  const setMe = (s: Staff | null) => { setMeS(s); setSetting("me", s?.id || ""); };
  return <AppCtx.Provider value={{ me, setMe, ready }}>{children}</AppCtx.Provider>;
}

export const newStaff = (name: string, role: Staff["role"], pin = "", phone = ""): Staff =>
  ({ id: uid(), name, role, pin, phone, active: 1, updated_at: now() });
