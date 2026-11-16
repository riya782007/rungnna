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
/* Owner, 23 Oct: "the owner's screens never show a lock or anything hidden" — while the owner is signed in,
   estimates are simply open; for anyone else they stay private. */
let ownerOpen = false;
export function setOwnerOpen(v: boolean) { if (ownerOpen !== v) { ownerOpen = v; emit(); } }
export const isOwnerOpen = () => ownerOpen;
// in the estimate company, estimates are its everyday bills: open for whoever may open that company
let companyOpen = false;
export function setCompanyOpen(v: boolean) { if (companyOpen !== v) { companyOpen = v; emit(); } }
/* Owner, 16 Nov (voice): "I set 5 idle minutes but after 5 minutes everything about estimates was still on the
   screen — and give a button or a key that closes it all at once". Hidden = estimates closed on this screen for
   everyone, the owner too, until shown again with a PIN or the estimate code. It also happens by itself after the
   idle minutes of the estimate code (Settings), and when someone presses Ctrl+Q or the lock button. */
const KEEP = "rj_est_hidden";   // a reload must not open them again
let hidden = (() => { try { return localStorage.getItem(KEEP) === "1"; } catch { return false; } })();
const keep = (v: boolean) => { try { v ? localStorage.setItem(KEEP, "1") : localStorage.removeItem(KEEP); } catch { /* private mode */ } };
export const isHidden = () => hidden;
export const isOpen = () => !hidden && (ownerOpen || companyOpen || Date.now() < until);
export function lockNow() { until = 0; clearTimeout(timer); emit(); }
export function hideEstimates() { hidden = true; keep(true); lockNow(); }
export function showEstimates() { if (hidden) { hidden = false; keep(false); lastPoke = Date.now(); lastActive = Date.now(); emit(); } }
let lastActive = Date.now();
function arm(min: number) {
  until = Date.now() + min * 60_000; clearTimeout(timer);
  timer = setTimeout(lockNow, min * 60_000); emit();
}
export async function unlock(code: string): Promise<boolean> {
  const c = await getPrivate(); if (!c || !code) return false;
  if ((await sha(c.salt + code)) !== c.hash) return false;
  arm(c.minutes || 10); return true;
}
/** Is this the estimate code? (checks only: opens nothing) */
export async function codeIs(code: string): Promise<boolean> {
  const c = await getPrivate(); if (!c || !code) return false;
  return (await sha(c.salt + code)) === c.hash;
}
/* any tap or key while open keeps it open (idle lock, not a hard timer) */
let lastPoke = 0;
if (typeof window !== "undefined") {
  const poke = () => { lastActive = Date.now(); if (Date.now() < until && Date.now() - lastPoke > 20_000) { lastPoke = Date.now(); getPrivate().then(c => arm(c?.minutes || 10)); } };
  // the owner's always-open estimates close too after the idle minutes
  setInterval(() => { if (!hidden && (ownerOpen || companyOpen)) getPrivate().then(c => { if (Date.now() - lastActive > (c?.minutes || 10) * 60_000) hideEstimates(); }); }, 30_000);
  addEventListener("keydown", (ev: Event) => { const e = ev as KeyboardEvent; if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "q") { e.preventDefault(); hideEstimates(); } });
  addEventListener("pointerdown", poke, { passive: true }); addEventListener("keydown", poke);
  let hiddenAt = 0; // a quick trip to the camera app must not lock; leaving the app for a minute does
  document.addEventListener("visibilitychange", () => { if (document.hidden) hiddenAt = Date.now(); else if (hiddenAt && Date.now() - hiddenAt > 60_000) { lockNow(); if (ownerOpen || companyOpen) hideEstimates(); } });
}
export function usePrivate() {
  const [open, setOpen] = useState(isOpen());
  useEffect(() => { const f = (v: boolean) => setOpen(v); subs.add(f); return () => { subs.delete(f); }; }, []);
  return open;
}

/* one rule used by every screen */
/* private = an estimate, or a credit note that returns goods from an estimate */
export const isEstimate = (b: Pick<Bill, "bill_type"> & { src_type?: Bill["src_type"] }) => b.bill_type === "estimate" || (b.bill_type === "return" && b.src_type === "estimate");
export const visibleBill = (b: Bill, open = isOpen()) => !b.deleted && (open || !isEstimate(b));
export const maskNote = (note: string, open = isOpen()) => (!open && /^(EST|ECN)\//.test(note || "") ? "" : note);
