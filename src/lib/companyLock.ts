import type { Store } from "./db";

/* Owner, 23 Oct: "to come out of estimates — on the same screen, time out and lock". When a person is working in
   the estimate company and leaves the counter (no tap, key or scan for the idle minutes, or the app left for over
   a minute), the app goes back to the tax-invoice company by itself. Any unsaved estimate stays in Held. */

/** The company to fall back to from the estimate company: the tax-invoice one this person may open. */
export function exitCompany(companies: Pick<Store, "id" | "kind">[], current: string): string {
  const here = companies.find(c => c.id === current);
  if (here?.kind !== "estimate") return "";
  return (companies.find(c => c.kind === "gst") || companies.find(c => c.id !== current && c.kind !== "estimate"))?.id || "";
}

/** Calls onIdle once after `minutes` without activity, or when the app comes back after being away over a minute. */
export function watchIdle(minutes: number, onIdle: () => void, target: Pick<EventTarget, "addEventListener" | "removeEventListener"> = window, doc: Pick<Document, "addEventListener" | "removeEventListener" | "hidden"> | null = typeof document !== "undefined" ? document : null): () => void {
  const ms = Math.max(1, minutes) * 60_000;
  let timer: any = 0, done = false, hiddenAt = 0;
  const fire = () => { if (done) return; done = true; stop(); onIdle(); };
  const poke = () => { if (done) return; clearTimeout(timer); timer = setTimeout(fire, ms); };
  const vis = () => { if (!doc) return; if (doc.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 60_000) fire(); else hiddenAt = 0; };
  const stop = () => { clearTimeout(timer); target.removeEventListener("pointerdown", poke); target.removeEventListener("keydown", poke); doc?.removeEventListener("visibilitychange", vis); };
  target.addEventListener("pointerdown", poke, { passive: true } as any); target.addEventListener("keydown", poke);
  doc?.addEventListener("visibilitychange", vis);
  poke();
  return () => { done = true; stop(); };
}
