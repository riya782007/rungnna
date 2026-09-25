import { registerSW } from "virtual:pwa-register";

/* Updates never reload the page on their own (that could wipe a bill being typed).
   A small "New version ready" bar appears; it updates when tapped, or by itself when the app is idle on Home. */
let apply: ((reload?: boolean) => Promise<void>) | null = null;
let waiting = false;
const subs = new Set<() => void>();
export const onUpdate = (f: () => void) => { subs.add(f); if (waiting) f(); return () => { subs.delete(f); }; };
export const applyUpdate = () => apply?.(true);

export function startUpdates() {
  apply = registerSW({
    immediate: true,
    onNeedRefresh() {
      waiting = true; subs.forEach(f => f());
      const idle = () => { if (document.hidden || location.hash === "" || location.hash === "#/home") apply?.(true); };
      document.addEventListener("visibilitychange", idle);
      setTimeout(idle, 60_000);
    },
    onRegisteredSW(_url, reg) { if (reg) setInterval(() => reg.update().catch(() => {}), 30 * 60_000); },
  });
}
