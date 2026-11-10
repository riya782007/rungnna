/* Owner, 10 Nov (voice): "in the rush, when we fill the customer's details it asks for the PIN code — many people
   don't know it. When we write the address, it should take the PIN code from the address by itself."
   public/pincodes.txt lists every post office in India with its PIN code, district and GST state code
   (scripts/build-pincodes.mjs). It is fetched once and kept by the app for offline use. */
import { GST_STATES } from "./states";

export type PinPlace = { pin: string; office: string; district: string; state: string; stateCode: string };
type Office = { name: string; words: string[]; pin: string; d: number; s: string };
type Table = { districts: string[]; offices: Office[]; byWord: Map<string, number[]>; byPin: Map<string, number[]>; districtWords: string[][] };

const words = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").split(/\s+/).filter(Boolean);
// words that say nothing about where a place is
const WEAK = new Set(["NAGAR", "ROAD", "MARG", "COLONY", "BAZAR", "BAZAAR", "MARKET", "GALI", "LANE", "CHOWK", "NEW", "OLD", "EAST",
  "WEST", "NORTH", "SOUTH", "MAIN", "SECTOR", "PHASE", "BLOCK", "NEAR", "OPP", "SHOP", "NO", "HOUSE", "FLOOR", "STREET", "CITY", "TOWN"]);

export function parsePins(text: string): Table {
  const lines = text.split("\n");
  const districts = (lines[0] || "").replace(/^#D\|/, "").split("|");
  const offices: Office[] = [], byWord = new Map<string, number[]>(), byPin = new Map<string, number[]>();
  for (let i = 1; i < lines.length; i++) {
    const [name, pin, d, s] = lines[i].split("|"); if (!pin) continue;
    const k = offices.length, w = words(name);
    offices.push({ name, words: w, pin, d: Number(d), s });
    for (const x of new Set(w)) { const a = byWord.get(x); a ? a.push(k) : byWord.set(x, [k]); }
    const p = byPin.get(pin); p ? p.push(k) : byPin.set(pin, [k]);
  }
  return { districts, offices, byWord, byPin, districtWords: districts.map(words) };
}

let table: Promise<Table> | null = null;
export function loadPins(): Promise<Table> {
  table ??= fetch("/pincodes.txt").then(r => { if (!r.ok) throw new Error("PIN codes could not load"); return r.text(); }).then(parsePins)
    .catch(e => { table = null; throw e; });
  return table;
}

const title = (s: string) => s.toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
const place = (t: Table, o: Office): PinPlace =>
  ({ pin: o.pin, office: title(o.name), district: title(t.districts[o.d] || ""), state: GST_STATES[o.s] || "", stateCode: o.s });

/** Where a PIN code is: its district and state (for filling City and State). */
export function placeOfPin(t: Table, pin: string): PinPlace | undefined {
  const k = t.byPin.get(pin)?.[0];
  return k === undefined ? undefined : place(t, t.offices[k]);
}

/** The likeliest PIN codes for an address: post offices whose whole name is in the address, the longest and most
    specific names first, and those in a district or state the address also names. */
export function pinsForAddress(t: Table, address: string, max = 4, near = ""): PinPlace[] {
  const have = new Set(words(address)); if (!have.size) return [];
  const scored = new Map<number, number>();
  for (const w of have) {
    if (w.length < 3 || /^\d+$/.test(w)) continue;
    for (const k of t.byWord.get(w) || []) {
      if (scored.has(k)) continue;
      const o = t.offices[k];
      // "DELHI SADAR BAZAR" is found from "Sadar Bazar" too: the city/state words in an office name may be left out
      const where = new Set([...(t.districtWords[o.d] || []), ...words(GST_STATES[o.s] || "")]);
      const need = o.words.filter(x => !where.has(x));
      const must = need.length ? need : o.words;
      if (!must.every(x => have.has(x))) continue;
      const strong = must.filter(x => !WEAK.has(x) && x.length > 2);
      if (!strong.length) continue;                     // "NEW MARKET" alone says nothing
      // an office named only after its city ("NEW DELHI", "MEERUT") is the last choice: any named area beats it
      let score = need.length ? 10 + strong.reduce((a, x) => a + x.length, 0) + must.length : 1;
      if (need.length && o.words.every(x => have.has(x))) score += 1;
      if (t.districtWords[o.d]?.length && t.districtWords[o.d].every(x => have.has(x))) score += 6;
      if (words(GST_STATES[o.s] || "").every(x => have.has(x))) score += 4;
      if (near && o.s === near) score += 4;              // the shop's own state, when the address names no other
      scored.set(k, score);
    }
  }
  const out: PinPlace[] = [], pins = new Set<string>();
  for (const [k] of [...scored].sort((a, b) => b[1] - a[1])) {
    const o = t.offices[k]; if (pins.has(o.pin)) continue;
    pins.add(o.pin); out.push(place(t, o)); if (out.length >= max) break;
  }
  return out;
}
