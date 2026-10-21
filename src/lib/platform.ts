/* Where the app is running: the website, or the Windows desktop app (desktop/main.cjs).
   The desktop app serves this same build from app://rungnna, so links meant for other
   people (dealer portal, catalogue pages, phone-as-scanner) must use the public website. */
export const WEB_ORIGIN = "https://rungnnashopos.vercel.app";
export const desktop = (): { version: string } | undefined => (typeof window !== "undefined" ? (window as any).rungnnaDesktop : undefined);
export const isDesktop = () => !!desktop();
/** The address other people and phones can open. */
export const publicOrigin = () => (typeof location !== "undefined" && /^https?:$/.test(location.protocol) && !isNativeApp() ? location.origin : WEB_ORIGIN);
/** Inside the Android / iOS app (Capacitor), whose own pages are served from the phone. */
export const isNativeApp = () => typeof window !== "undefined" && !!(window as any).Capacitor?.isNativePlatform?.();
/** Server functions: same site on the web and in the desktop app (it forwards /api), the live site in the phone app. */
export const apiUrl = (path: string) => (isNativeApp() ? WEB_ORIGIN : "") + "/api/" + path.replace(/^\/+/, "");
/** Android app print bridge (mobile/android-src RjPrintPlugin), when present. */
export const nativePrinter = (): { printHtml: (o: { html: string; name: string }) => Promise<unknown> } | undefined =>
  isNativeApp() ? (window as any).Capacitor?.Plugins?.RjPrint : undefined;
