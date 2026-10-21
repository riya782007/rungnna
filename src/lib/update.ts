import { registerSW } from "virtual:pwa-register";
import { isDesktop } from "./platform";

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

export async function applyUpdate() {
  if (updating) return;
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
  // The desktop app ships its files inside the installer; new versions come as a new installer.
  if (isDesktop() || !/^https?:$/.test(location.protocol)) return;
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
