/* Sound + touch feedback for the counter.
   Rules (Google Material sound, Apple HIG haptics, Square/Shopify POS):
   - every sound carries meaning: added, added again, not found, saved, paid, removed
   - the more often it happens, the shorter and quieter it is (a scan is ~0.1 s)
   - good news rises, bad news falls; errors are low and can't be mistaken for success
   - nothing is a file: every sound is synthesised, so it works offline and costs 0 KB
   - one tap turns it all off; volume and vibration are per device */
import { useEffect, useState } from "react";

export type Sfx = "add" | "again" | "notfound" | "remove" | "pay" | "saved" | "hold" | "unlock" | "lock" | "tap" | "open";
export type SoundPrefs = { on: boolean; vol: 0 | 1 | 2; clicks: boolean; buzz: boolean };
const DEF: SoundPrefs = { on: true, vol: 1, clicks: false, buzz: true };
const KEY = "rj_sound";
const VOL = [0.45, 0.8, 1.25];

function load(): SoundPrefs {
  try { return { ...DEF, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch { return DEF; }
}
let prefs = load();
const subs = new Set<(p: SoundPrefs) => void>();
export const soundPrefs = () => prefs;
export function setSoundPrefs(p: Partial<SoundPrefs>) {
  prefs = { ...prefs, ...p };
  try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch { /* private mode */ }
  if (master && ctx) master.gain.setTargetAtTime(VOL[prefs.vol], ctx.currentTime, 0.02);
  subs.forEach(f => f(prefs));
}
export function useSoundPrefs(): [SoundPrefs, (p: Partial<SoundPrefs>) => void] {
  const [p, set] = useState(prefs);
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return [p, setSoundPrefs];
}

/* ---------- audio graph ---------- */
let ctx: AudioContext | null = null, master: GainNode | null = null;
function ac(): AudioContext | null {
  try {
    if (!ctx) {
      const C = window.AudioContext || (window as any).webkitAudioContext;
      if (!C) return null;
      ctx = new C({ latencyHint: "interactive" });
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 4; comp.attack.value = 0.002; comp.release.value = 0.12;
      master = ctx.createGain(); master.gain.value = VOL[prefs.vol];
      master.connect(comp); comp.connect(ctx.destination);
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  } catch { return null; }
}
/* phones only allow audio after a touch: open the context on the first one so the first scan isn't silent */
if (typeof window !== "undefined") {
  const warm = () => { if (prefs.on) ac(); };
  addEventListener("pointerdown", warm, { once: true, capture: true });
  addEventListener("keydown", warm, { once: true, capture: true });
}

type Voice = { type?: OscillatorType; gain?: number; attack?: number; partials?: [number, number][]; to?: number };
const BELL: [number, number][] = [[1, 1], [2, 0.32], [3.01, 0.1], [4.2, 0.04]];   // small glass bell
const SOFT: [number, number][] = [[1, 1], [2, 0.08]];

function tone(c: AudioContext, f: number, at: number, dur: number, v: Voice = {}) {
  const { type = "sine", gain = 0.2, attack = 0.004, partials = SOFT, to } = v;
  for (const [ratio, amp] of partials) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(f * ratio, at);
    if (to) o.frequency.exponentialRampToValueAtTime(to * ratio, at + dur);
    const peak = Math.max(0.0002, gain * amp);
    g.gain.setValueAtTime(0.0001, at);
    g.gain.linearRampToValueAtTime(peak, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(g); g.connect(master!);
    o.start(at); o.stop(at + dur + 0.02);
  }
}

const BUZZ: Partial<Record<Sfx, number | number[]>> = {
  add: 18, again: 10, notfound: [70, 50, 70], remove: 12, pay: 14, saved: [18, 60, 30], hold: 14, unlock: [12, 40, 12], lock: 20,
};

let lastAt = 0, lastName = "";
export function sfx(name: Sfx) {
  if (prefs.buzz && BUZZ[name] !== undefined) { try { navigator.vibrate?.(BUZZ[name]!); } catch { /* no vibration */ } }
  if (!prefs.on) return;
  if (name === "tap" && !prefs.clicks) return;
  const c = ac(); if (!c || !master) return;
  const t = c.currentTime + 0.005;
  // a gun that fires twice in 40 ms shouldn't sound like two items
  if (name === lastName && t - lastAt < 0.04) return;
  lastAt = t; lastName = name;
  switch (name) {
    case "add":      // bright rising "ti-ting": something went on the bill
      tone(c, 1568, t, 0.09, { partials: BELL, gain: 0.2 });
      tone(c, 2349, t + 0.05, 0.14, { partials: BELL, gain: 0.15 });
      break;
    case "again":    // one short higher tick: same item, one more
      tone(c, 2093, t, 0.08, { partials: BELL, gain: 0.16 });
      break;
    case "notfound": // low falling double: look up, something's wrong
      tone(c, 392, t, 0.13, { type: "triangle", gain: 0.3, attack: 0.006 });
      tone(c, 294, t + 0.13, 0.22, { type: "triangle", gain: 0.3, attack: 0.006 });
      break;
    case "remove":   // soft downward swoosh
      tone(c, 880, t, 0.13, { gain: 0.12, to: 420 });
      break;
    case "pay":      // coin
      tone(c, 2637, t, 0.05, { partials: BELL, gain: 0.12 });
      tone(c, 3520, t + 0.045, 0.3, { partials: BELL, gain: 0.11 });
      break;
    case "saved":    // the bill is done: a warm major chime (E major arpeggio)
      tone(c, 659, t, 0.45, { gain: 0.07, attack: 0.01 });
      [1319, 1661, 1976, 2637].forEach((f, i) => tone(c, f, t + i * 0.065, 0.7 - i * 0.08, { partials: BELL, gain: 0.14 - i * 0.015 }));
      break;
    case "hold":     // put aside: two soft notes stepping down
      tone(c, 988, t, 0.12, { gain: 0.14 }); tone(c, 784, t + 0.1, 0.2, { gain: 0.14 });
      break;
    case "unlock":
      tone(c, 1175, t, 0.08, { partials: BELL, gain: 0.14 }); tone(c, 1760, t + 0.07, 0.18, { partials: BELL, gain: 0.14 });
      break;
    case "lock":
      tone(c, 1760, t, 0.07, { partials: BELL, gain: 0.12 }); tone(c, 1175, t + 0.06, 0.16, { partials: BELL, gain: 0.12 });
      break;
    case "open":     // camera/scanner is live
      tone(c, 1319, t, 0.1, { gain: 0.08, to: 1760 });
      break;
    case "tap":      // a tiny key click, off by default
      tone(c, 3000, t, 0.018, { gain: 0.05, attack: 0.001, partials: [[1, 1]] });
      break;
  }
}

/* optional key clicks on buttons: one listener for the whole app */
if (typeof document !== "undefined") {
  document.addEventListener("pointerdown", e => {
    if (!prefs.clicks) return;
    const el = (e.target as HTMLElement)?.closest?.("button,a.nav,.tabbar a,.quick a,[role=button]");
    if (el && !(el as HTMLButtonElement).disabled) sfx("tap");
  }, { capture: true, passive: true });
}
