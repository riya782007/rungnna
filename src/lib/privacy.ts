import { useEffect, useState } from "react";
import { db, put, now, type Bill, type Config } from "./db";

/* Private estimates.
   Estimates are hidden everywhere (bill screen, bills list, totals, customer balances, search, AI) until the
   owner's secret code is entered. The code is stored only as a salted SHA-256 hash, shared by all counters.
   Unlocking lasts for this device only and locks itself after a few idle minutes or when the app is closed. */

export type PrivateCfg = { salt: string; hash: string; hint: string; minutes: number };
const KEY = "private_estimates";

async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export async function getPrivate(): Promise<PrivateCfg | null> { return ((await db.config.get(KEY))?.value as PrivateCfg) || null; }
export async function setCode(code: string, hint: string, minutes = 10) {
  const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
  await put("config", { id: KEY, value: { salt, hash: await sha(salt + code), hint, minutes } as PrivateCfg, updated_at: now() } as Config);
}

let until = 0, timer: any = 0;
const subs = new Set<(v: boolean) => void>();
const emit = () => subs.forEach(f => f(isOpen()));
export const isOpen = () => Date.now() < until;
export function lockNow() { until = 0; clearTimeout(timer); emit(); }
function arm(min: number) {
  until = Date.now() + min * 60_000; clearTimeout(timer);
  timer = setTimeout(lockNow, min * 60_000); emit();
}
export async function unlock(code: string): Promise<boolean> {
  const c = await getPrivate(); if (!c || !code) return false;
  if ((await sha(c.salt + code)) !== c.hash) return false;
  arm(c.minutes || 10); return true;
}
/* any tap or key while open keeps it open (idle lock, not a hard timer) */
let lastPoke = 0;
if (typeof window !== "undefined") {
  const poke = () => { if (isOpen() && Date.now() - lastPoke > 20_000) { lastPoke = Date.now(); getPrivate().then(c => arm(c?.minutes || 10)); } };
  addEventListener("pointerdown", poke, { passive: true }); addEventListener("keydown", poke);
  let hiddenAt = 0; // a quick trip to the camera app must not lock; leaving the app for a minute does
  document.addEventListener("visibilitychange", () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 60_000) lockNow(); });
}
export function usePrivate() {
  const [open, setOpen] = useState(isOpen());
  useEffect(() => { const f = (v: boolean) => setOpen(v); subs.add(f); return () => { subs.delete(f); }; }, []);
  return open;
}

/* one rule used by every screen */
export const isEstimate = (b: Pick<Bill, "bill_type">) => b.bill_type === "estimate";
export const visibleBill = (b: Bill, open = isOpen()) => !b.deleted && (open || !isEstimate(b));
export const maskNote = (note: string, open = isOpen()) => (!open && /^EST\//.test(note || "") ? "" : note);
