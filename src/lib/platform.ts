/* Where the app is running: the website, or the Windows desktop app (desktop/main.cjs).
   The desktop app serves this same build from app://rungnna, so links meant for other
   people (dealer portal, catalogue pages, phone-as-scanner) must use the public website. */
export const WEB_ORIGIN = "https://rungnnashopos.vercel.app";
export const desktop = (): { version: string } | undefined => (typeof window !== "undefined" ? (window as any).rungnnaDesktop : undefined);
export const isDesktop = () => !!desktop();
/** The address other people and phones can open. */
export const publicOrigin = () => (typeof location !== "undefined" && /^https?:$/.test(location.protocol) ? location.origin : WEB_ORIGIN);
