import { db, now, put } from "./db";
import { VERIFIED_ITEM_CODES } from "./verified-labels";

/* Owner, 23 Oct: "first thing in the morning — the existing software must read the stickers printed by our
   software, so billing doesn't stop; we merge the stock later."

   The old software reads a sticker's QR as ITEMCODE~RATE~PACK~REF~TK~STYLE~COLOR (e.g. 255~224~1~183~~K5210~KXZ)
   and knows the item only by its own numeric ITEMCODE. Our stickers carry that QR whenever the product has an
   old item code. Most of the shop's names are its own ("HALF DULHAN SET", "BANGLES", "SET"), so the owner says
   once which old item each name is billed as (HALF DULHAN SET → 320 BRIDAL SET). That choice, and the REF the old
   software expects (183 on most of his old stickers), live in config "old_codes" and reach every counter. */
export type OldCodes = { aliases: Record<string, string>; ref: string; fallback: string };
/* Owner, 24 Oct: "ALL must scan in one scan, in both softwares". A name not matched yet is billed in the old
   software as 508 · IM-JWELRY (imitation jewellery), so every sticker carries the old QR; the owner can change it. */
export const DEFAULT_FALLBACK = "508";
const KEY = "old_codes";
let cache: OldCodes = { aliases: {}, ref: "183", fallback: DEFAULT_FALLBACK };

const up = (s?: string) => (s || "").trim().toUpperCase();
export function readOldCodes(v: unknown): OldCodes {
  const o = (v && typeof v === "object" ? v : {}) as Partial<OldCodes>;
  const aliases: Record<string, string> = {};
  for (const [k, c] of Object.entries(o.aliases || {})) if (up(k) && /^\d+$/.test(String(c))) aliases[up(k)] = String(c);
  // REF 183 is what most of the shop's old stickers carry; used until the owner sets another
  return { aliases, ref: o.ref === undefined ? "183" : /^[0-9A-Za-z]{0,12}$/.test(String(o.ref)) ? String(o.ref) : "",
    fallback: o.fallback === undefined ? DEFAULT_FALLBACK : /^\d*$/.test(String(o.fallback)) ? String(o.fallback) : DEFAULT_FALLBACK };
}
export async function loadOldCodes(): Promise<OldCodes> { cache = readOldCodes((await db.config.get(KEY))?.value); return cache; }
export const oldCodes = () => cache;
/** The old item code this name is billed as, when the owner chose one. */
export const aliasFor = (item?: string) => cache.aliases[up(item)] || (up(item) ? cache.fallback : "");
/** Only the owner's own choice for this name (no fallback). */
export const chosenFor = (item?: string) => cache.aliases[up(item)] || "";
/** The REF the old software expects on stickers (blank = leave the sticker's own). */
export const defaultRef = () => cache.ref;

export async function saveOldCodes(patch: { aliases?: Record<string, string | null>; ref?: string; fallback?: string }) {
  const cur = await loadOldCodes();
  const aliases = { ...cur.aliases };
  for (const [k, c] of Object.entries(patch.aliases || {})) { if (c && /^\d+$/.test(c)) aliases[up(k)] = c; else delete aliases[up(k)]; }
  const next = readOldCodes({ aliases, ref: patch.ref ?? cur.ref, fallback: patch.fallback ?? cur.fallback });
  await put("config", { id: KEY, value: next, updated_at: now() } as any);
  cache = next;
  return next;
}

/** Every old-software item, for a picker: "320 · BRIDAL SET". */
export const OLD_ITEMS = Object.entries(VERIFIED_ITEM_CODES).map(([code, v]) => ({ code, name: v.name })).sort((a, b) => a.name.localeCompare(b.name));

const SYNONYMS: [RegExp, string][] = [[/DULHAN|BRIDE|BRIDAL/, "BRIDAL SET"], [/EAR ?RINGS?$|^EARRING/, "EARING"], [/JHUMK/, "EARING"], [/BANGLES?$/, "BANGLE"],
  [/^KAMAR/, "KAMARBELT"], [/MANG ?TIKK?A|MAANG/, "MANG TIKA"], [/PAYAL|ANKLET/, "PAYL-ANKLT"], [/^NECKLACE SET|^N[- ]?SET$/, "N-SET"], [/^HAIR CLIPS?$/, "HAIR CLIP"]];
const squash = (s: string) => up(s).replace(/[^A-Z0-9]/g, "");
/** Best guess of the old item for one of the shop's names, or "" when it can't be told. */
export function suggestOldCode(name: string): string {
  const n = up(name); if (!n) return "";
  const alias = chosenFor(n); if (alias) return alias;
  const exact = OLD_ITEMS.filter(i => i.name === n || squash(i.name) === squash(n) || squash(i.name) === squash(n).replace(/S$/, ""));
  if (exact.length === 1) return exact[0].code;
  for (const [re, target] of SYNONYMS) if (re.test(n)) { const hit = OLD_ITEMS.find(i => i.name === target); if (hit) return hit.code; }
  return "";
}
