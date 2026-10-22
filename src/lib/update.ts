import { registerSW } from "virtual:pwa-register";
import { isDesktop, isNativeApp, WEB_ORIGIN } from "./platform";

/* Updates never reload the page on their own (that could wipe a bill being typed).
   A small "New version ready" bar appears; it updates when tapped, or by itself when the app is idle on Home.

   One tap is enough (owner, 18 Oct: the bar stayed after "Update" and had to be pressed again): the bar goes
   at once, the waiting version is told to take over directly, and the page reloads when it has — or after a
   few seconds anyway. If the new version still couldn't take over (another tab holding the old one), the bar
   does not come back for the rest of this session; it is applied quietly when the app is next idle/opened. */
let apply: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false, updating = false;
const subs = new Set<(ready: boolean) => void>();
const TAPPED = "rj_update_tapped";
const tappedRecently = () => { try { return Date.now() - Number(sessionStorage.getItem(TAPPED) || 0) < 30 * 60_000; } catch { return false; } };
const show = () => waiting && !updating && !tappedRecently();
export const onUpdate = (f: (ready: boolean) => void) => { subs.add(f); f(show()); return () => { subs.delete(f); }; };
const notify = () => { const s = show(); subs.forEach(f => f(s)); };

/* Windows / Android app: the screens update themselves from the live site (no reinstall).
   The app downloads and checks a new release in the background; the same "New version ready"
   bar appears, and Update (or being idle on Home) switches to it. */
const desk = () => (window as any).rungnnaDesktop;
const nativeUpd = () => (window as any).Capacitor?.Plugins?.RjUpdate;
let appApply: (() => Promise<unknown>) | null = null;
function startAppUpdates() {
  const d = desk(), n = nativeUpd();
  if (d?.started) {
    setTimeout(() => d.started(), 8000);   // these screens ran fine: keep them (else the app rolls back)
    appApply = () => d.applyUpdate();
    const ready = () => { waiting = true; notify(); scheduleIdle(); };
    d.onUpdateReady?.(ready);
    if (d.build?.().ready) ready();
  } else if (n) {
    setTimeout(() => { void n.started().catch(() => {}); }, 8000);
    appApply = () => n.apply();
    const look = async () => { try { const r = await n.check({ origin: WEB_ORIGIN }); if (r?.ready) { waiting = true; notify(); scheduleIdle(); } } catch { /* offline: next time */ } };
    setTimeout(look, 15_000); setInterval(look, 20 * 60_000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) void look(); });
  }
}
let idleSet = false;
function scheduleIdle() {
  if (idleSet) return; idleSet = true;
  // also on the sign-in screen: nobody is typing a bill there (owner's computer stayed on an old version, 22 Oct)
  const idle = () => { if (waiting && !updating && (document.hidden || location.hash === "" || location.hash === "#/home" || document.documentElement.dataset.locked === "1")) void applyUpdate(); };
  document.addEventListener("visibilitychange", idle);
  setInterval(idle, 60_000);
}

export async function applyUpdate() {
  if (updating) return;
  if (appApply) { updating = true; notify(); try { await appApply(); } catch { updating = false; notify(); } return; }
  updating = true; notify();                       // the bar disappears on the first tap
  try { sessionStorage.setItem(TAPPED, String(Date.now())); } catch { /* private mode */ }
  let reloaded = false;
  const reload = () => { if (!reloaded) { reloaded = true; location.reload(); } };
  try {
    const sw = navigator.serviceWorker;
    sw?.addEventListener("controllerchange", reload);
    const reg = await sw?.getRegistration();
    reg?.waiting?.postMessage({ type: "SKIP_WAITING" });   // the same message the plugin sends, sent straight to it
    void apply?.(true).catch(() => {});
  } catch { /* fall through to the timed reload */ }
  setTimeout(reload, 4000);
}

export function startUpdates() {
  if (isDesktop() || isNativeApp()) { startAppUpdates(); return; }
  if (!/^https?:$/.test(location.protocol)) return;
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true; notify();
      const idle = () => { if (document.hidden || location.hash === "" || location.hash === "#/home") apply?.(true); };
      document.addEventListener("visibilitychange", idle);
      setTimeout(idle, 60_000);
    },
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update().catch(() => {}), 30 * 60_000); },
  });
}
