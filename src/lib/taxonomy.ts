import { db, getSetting, setSetting, now, type Config } from "./db";
import { DEFAULT_ITEMS } from "./products";

/* ===========================================================================
   Shop-wide taxonomy master: CATEGORIES, STYLES, COLOURS and SIZES.

   Until now item/style/colour/category were free text, with dropdowns guessed
   from whatever products already existed (products.distinct()). That's fine for
   scanning old labels, but to build a clean catalogue the owner needs a managed
   master list he controls — add a colour once, and it appears everywhere.

   Stored in the synced `config` table (one row, id "taxonomy") so every device
   and counter shares the same lists, with a device-local mirror for instant
   offline reads. Colours carry a short barcode-friendly CODE (like the reference
   project) so a variant's label code can be {style}-{colourCode}.

   Free text is still allowed everywhere — the master just powers the dropdowns
   and keeps things consistent; it never blocks an unlisted value.
=========================================================================== */

export interface Colour { name: string; code: string; sort: number }
export interface Taxonomy {
  categories: string[];        // e.g. Bridal, Daily wear, Party
  styles: string[];            // e.g. Kundan, Polki, Temple, AD, Oxidised
  colours: Colour[];
  sizes: string[];             // e.g. 2.4, 2.6, Free, S, M, L
  updated_at?: string;
}

/* A sensible starter set for a fashion / imitation jewellery shop. The owner
   edits all of this in Settings; nothing here is hard-coded into logic. */
export const DEFAULT_TAXONOMY: Taxonomy = {
  categories: ["Bridal", "Party wear", "Daily wear", "Office", "Festive", "Kids"],
  styles: ["Kundan", "Polki", "Temple", "AD / American Diamond", "Oxidised", "Meenakari", "Pearl", "Antique", "Contemporary"],
  colours: [
    "Gold", "Rose Gold", "Silver", "White", "Red", "Green", "Blue", "Royal Blue",
    "Maroon", "Pink", "Rani Pink", "Peach", "Purple", "Black", "Ruby", "Emerald",
    "Multicolour", "Pastel", "Mint", "Lavender",
  ].map((name, i) => ({ name, code: colourCodeFor(name), sort: i + 1 })),
  sizes: ["Free size", "2.2", "2.4", "2.6", "2.8", "Small", "Medium", "Large"],
};

/* A short, uppercase, barcode-safe code from a colour name (first token, vowels
   trimmed only if long). Deterministic so the same name always maps the same. */
export function colourCodeFor(name: string): string {
  const n = (name || "").trim().toUpperCase().replace(/[^A-Z0-9 ]/g, "");
  if (!n) return "";
  const words = n.split(/\s+/);
  if (words.length >= 2) return words.map(w => w[0]).join("").slice(0, 6); // "Rose Gold" -> "RG"
  const w = words[0];
  return w.length <= 6 ? w : w.replace(/[AEIOU]/g, "").slice(0, 6) || w.slice(0, 6);
}

const KEY = "taxonomy";

export async function getTaxonomy(): Promise<Taxonomy> {
  const c = await db.config.get(KEY);
  if (c?.value) return normalize(c.value);
  const local = await getSetting<Taxonomy | null>(KEY, null);
  return normalize(local || DEFAULT_TAXONOMY);
}

export async function saveTaxonomy(t: Taxonomy): Promise<Taxonomy> {
  const n = normalize(t); n.updated_at = now();
  const { put } = await import("./db");
  await put("config", { id: KEY, value: n, updated_at: now() } as Config);   // synced to all devices
  await setSetting(KEY, n);                                                    // instant offline mirror
  return n;
}

function normalize(t: Taxonomy): Taxonomy {
  const clean = (a?: string[]) => [...new Set((a || []).map(s => s.trim()).filter(Boolean))];
  const colours = (t.colours || [])
    .map((c, i) => ({ name: (c.name || "").trim(), code: (c.code || colourCodeFor(c.name)).toUpperCase().trim(), sort: c.sort ?? i + 1 }))
    .filter(c => c.name);
  // de-dupe colours by name, keep first
  const seen = new Set<string>();
  const uniqCol = colours.filter(c => { const k = c.name.toUpperCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => a.sort - b.sort);
  return {
    categories: clean(t.categories),
    styles: clean(t.styles),
    colours: uniqCol,
    sizes: clean(t.sizes),
    updated_at: t.updated_at,
  };
}

/* --- small mutation helpers the UI uses (all return the saved taxonomy) --- */
export async function addTo(field: "categories" | "styles" | "sizes", value: string): Promise<Taxonomy> {
  const t = await getTaxonomy(); const v = value.trim(); if (!v) return t;
  if (!t[field].some(x => x.toLowerCase() === v.toLowerCase())) t[field] = [...t[field], v];
  return saveTaxonomy(t);
}
export async function removeFrom(field: "categories" | "styles" | "sizes", value: string): Promise<Taxonomy> {
  const t = await getTaxonomy();
  t[field] = t[field].filter(x => x !== value);
  return saveTaxonomy(t);
}
export async function addColour(name: string, code?: string): Promise<Taxonomy> {
  const t = await getTaxonomy(); const n = name.trim(); if (!n) return t;
  if (!t.colours.some(c => c.name.toLowerCase() === n.toLowerCase())) {
    t.colours = [...t.colours, { name: n, code: (code || colourCodeFor(n)).toUpperCase(), sort: (t.colours.at(-1)?.sort || 0) + 1 }];
  }
  return saveTaxonomy(t);
}
export async function removeColour(name: string): Promise<Taxonomy> {
  const t = await getTaxonomy();
  t.colours = t.colours.filter(c => c.name !== name);
  return saveTaxonomy(t);
}

/* Combined item list = curated defaults + anything the shop already uses. */
export function allItems(existing: string[]): string[] {
  return [...new Set([...DEFAULT_ITEMS, ...existing.map(s => s.trim()).filter(Boolean)])];
}
