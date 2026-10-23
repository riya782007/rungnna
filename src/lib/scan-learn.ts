import { db, put, now, deviceId, type Product } from "./db";
import { TAUGHT } from "./products";
import { parseLabel } from "./parse";

/* Owner, 25 Oct: "the stickers our previous software printed don't scan in your billing — make them scan with
   the same speed". Two things so a sticker that once failed never fails again, with nothing new to learn:
   1. Every sticker the app could not read is kept (newest 60, all counters, in the cloud) with exactly what the
      scanner typed, so the reason can be seen and fixed for all of them at once.
   2. The biller does what he always does after a miss — picks the item by its style or name. Right after a
      miss that pick is remembered as that sticker's item, so the next scan of the same sticker just adds it. */
export type ScanMiss = { raw: string; at: string; device: string; by: string; learnt?: string };
const KEY = "scan_misses", KEEP = 60, WINDOW = 2 * 60_000;

let last: { raw: string; at: number } | null = null;
/** A scanned label (not a typed word) that could be learnt. */
export const learnable = (raw: string) => {
  const r = raw.trim(), x = parseLabel(r);
  return r.length >= 6 && r.length <= 200 && !/^\d{1,5}$/.test(r) && (x.how !== "code" || r.length > 12 || /[~|`^¬\\#]/.test(r));
};

export async function noteMiss(raw: string, by = "") {
  const r = raw.trim(); if (!learnable(r)) { last = null; return; }
  last = { raw: r, at: Date.now() };
  try {
    const cur = ((await db.config.get(KEY))?.value as ScanMiss[]) || [];
    const list = [{ raw: r, at: now(), device: deviceId(), by }, ...cur.filter(m => m.raw !== r)].slice(0, KEEP);
    await put("config", { id: KEY, value: list, updated_at: now() } as any);
  } catch { /* the log must never stop billing */ }
}
export const clearMiss = () => { last = null; };
/** The sticker that just failed, if the item is being picked by hand right after it. */
export const pendingMiss = () => (last && Date.now() - last.at < WINDOW ? last.raw : "");

/** The biller picked this product right after a sticker failed: from now on that sticker means this product. */
export async function learnFromPick(p: Product): Promise<boolean> {
  const raw = pendingMiss(); last = null;
  if (!raw || !p?.id) return false;
  const cur = await db.products.get(p.id);
  if (!cur || cur.deleted) return false;
  const map = { ...(((await db.config.get(TAUGHT))?.value as Record<string, string>) || {}) };
  if (map[raw] === cur.id) return false;
  map[raw] = cur.id;
  const keys = Object.keys(map); for (const k of keys.slice(0, Math.max(0, keys.length - 3000))) delete map[k];   // newest 3000
  await put("config", { id: TAUGHT, value: map, updated_at: now() } as any);
  try {
    const list = ((await db.config.get(KEY))?.value as ScanMiss[]) || [];
    if (list.some(m => m.raw === raw)) await put("config", { id: KEY, value: list.map(m => (m.raw === raw ? { ...m, learnt: cur.item + " " + (cur.style || cur.code) } : m)), updated_at: now() } as any);
  } catch { /* log only */ }
  return true;
}
