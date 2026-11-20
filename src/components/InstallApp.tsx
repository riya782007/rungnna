import { useEffect, useState } from "react";

/* Owner, 20 Nov (voice): "on the phone the app has to be opened from the inbox every time — there is no icon on the
   home screen to tap", and the downloaded app would not install on the second phone and computer. The website itself
   installs as an app, with its own icon, no file to download: Chrome / Edge offer it (beforeinstallprompt), an iPhone
   does it from Safari's Share button. A link opened inside WhatsApp can't install — it has to be opened in Chrome. */

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: Prompt | null = null;
const subs = new Set<() => void>();
if (typeof window !== "undefined") {
  addEventListener("beforeinstallprompt", e => { e.preventDefault(); deferred = e as Prompt; subs.forEach(f => f()); });
  addEventListener("appinstalled", () => { deferred = null; subs.forEach(f => f()); });
}

export type Where = "installed" | "prompt" | "inapp" | "ios" | "android" | "desktop";
export function whereAmI(ua = typeof navigator !== "undefined" ? navigator.userAgent : "", standalone = false, desktopApp = false, canPrompt = false): Where {
  if (standalone || desktopApp) return "installed";
  if (canPrompt) return "prompt";
  if (/WhatsApp|FBAN|FBAV|Instagram|; wv\)|Line\//i.test(ua)) return "inapp";
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}
const isStandalone = () => typeof matchMedia !== "undefined" && (matchMedia("(display-mode: standalone)").matches || (navigator as any).standalone === true);
const inApp = () => typeof window !== "undefined" && (!!(window as any).rungnnaDesktop || !!(window as any).Capacitor?.isNativePlatform?.());

export function useInstall() {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick(n => n + 1); subs.add(f); return () => { subs.delete(f); }; }, []);
  const where = whereAmI(undefined, isStandalone(), inApp(), !!deferred);
  const install = async () => { const d = deferred; if (!d) return false; await d.prompt(); const r = await d.userChoice; deferred = null; tick(n => n + 1); return r.outcome === "accepted"; };
  return { where, install };
}

const HOW: Record<Exclude<Where, "installed" | "prompt">, string> = {
  inapp: "This page is open inside WhatsApp, so it can't be put on the home screen. Tap ⋮ (top right) › Open in Chrome, then press Install there.",
  ios: "In Safari: tap the Share button (□↑) › Add to Home Screen › Add. The Rungnna icon then opens the app straight away.",
  android: "In Chrome: tap ⋮ (top right) › Add to Home screen (or Install app) › Install. The Rungnna icon then opens the app straight away.",
  desktop: "In Chrome or Edge: click the install icon at the right end of the address bar (or ⋮ › Install Rungnna). It then opens from the Start menu / desktop like any program.",
};

/** Settings card, and the hint everyone can find again. */
export function InstallCard() {
  const { where, install } = useInstall();
  if (where === "installed") return null;
  return <div className="card"><header><h3>Put Rungnna on this {/Android|iPhone|iPad/i.test(navigator.userAgent) ? "phone's home screen" : "computer"}</h3></header>
    <div className="pad stack">
      <div className="xs mut">No file to download: the app installs from this page, gets its own icon, opens full screen and updates by itself. Works without internet once opened.</div>
      {where === "prompt" ? <div><button className="btn p" onClick={() => void install()}>Install Rungnna</button></div> : <div className="note sm">{HOW[where]}</div>}
    </div></div>;
}

const KEY = "rj_install_later";
/** A thin strip at the top for phones and computers that haven't installed it yet; "Later" hides it for a week. */
export function InstallBanner() {
  const { where, install } = useInstall();
  const [later, setLater] = useState(() => { try { return Date.now() < Number(localStorage.getItem(KEY) || 0); } catch { return false; } });
  if (where === "installed" || later || (where === "desktop")) return null;
  const hide = () => { try { localStorage.setItem(KEY, String(Date.now() + 7 * 864e5)); } catch { /* private mode */ } setLater(true); };
  return <div className="note sm row" role="status" style={{ gap: 8, margin: "0 0 10px", alignItems: "center" }}>
    <span className="grow">{where === "prompt" ? "Put Rungnna on the home screen: one tap opens it, no WhatsApp link needed." : HOW[where]}</span>
    {where === "prompt" && <button className="btn sm p" onClick={() => void install()}>Install</button>}
    <button className="btn sm" onClick={hide}>Later</button>
  </div>;
}
