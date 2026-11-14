import { db, put, now, type Config, type Party } from "./db";

/* Customer map + tour planning (owner's list R-108, R-109, R-201).
   Where a customer is: their PIN code turned into a map point once (OpenStreetMap search,
   saved so it is never asked again), or the exact spot when someone visits and taps "I am here".
   The tour order is worked out on this computer: nearest stop first, then the route is
   untangled (2-opt) until no swap makes it shorter. No paid map service. */

export type Geo = { lat: number; lng: number; src: "pin" | "gps" | "city"; at: string };
export type Pt = { id: string; lat: number; lng: number };
export const SHOP: Pt = { id: "shop", lat: 28.6583, lng: 77.2120 }; // Gali Matke Wali, Sadar Bazar

export const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 6371, r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

const pathKm = (p: Pt[], start: Pt, back: boolean) => {
  let d = 0, cur = start;
  for (const x of p) { d += km(cur, x); cur = x; }
  return back ? d + km(cur, start) : d;
};

/** Best visiting order from `start` (road distance is roughly 1.3 × the straight line). */
export function planTour(stops: Pt[], start: Pt = SHOP, back = true): { order: Pt[]; km: number } {
  const left = [...stops], order: Pt[] = [];
  let cur = start;
  while (left.length) {
    let bi = 0; for (let i = 1; i < left.length; i++) if (km(cur, left[i]) < km(cur, left[bi])) bi = i;
    cur = left.splice(bi, 1)[0]; order.push(cur);
  }
  let best = pathKm(order, start, back), improved = true, guard = 0;
  while (improved && guard++ < 200) {
    improved = false;
    for (let i = 0; i < order.length - 1; i++) for (let j = i + 1; j < order.length; j++) {
      const t = [...order.slice(0, i), ...order.slice(i, j + 1).reverse(), ...order.slice(j + 1)];
      const d = pathKm(t, start, back);
      if (d + 1e-9 < best) { order.splice(0, order.length, ...t); best = d; improved = true; }
    }
  }
  return { order, km: best };
}

/** Google Maps directions, split into legs of 10 stops (the most one link takes). */
export function mapsLinks(order: Pt[], start: Pt = SHOP, back = true): string[] {
  const all = [start, ...order, ...(back ? [start] : [])].map(p => `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`);
  const out: string[] = [];
  for (let i = 0; i < all.length - 1; i += 10) {
    const leg = all.slice(i, i + 11);
    out.push(`https://www.google.com/maps/dir/?api=1&travelmode=driving&origin=${leg[0]}&destination=${leg[leg.length - 1]}${leg.length > 2 ? "&waypoints=" + encodeURIComponent(leg.slice(1, -1).join("|")) : ""}`);
  }
  return out;
}

export async function allGeo(): Promise<Map<string, Geo>> {
  const rows = await db.config.filter(c => c.id.startsWith("geo:") && !c.deleted).toArray();
  return new Map(rows.map(r => [r.id.slice(4), r.value as Geo]));
}
export async function saveGeo(partyId: string, g: Omit<Geo, "at">) {
  await put("config", { id: "geo:" + partyId, value: { ...g, at: now() }, updated_at: now() } as Config);
}

/** Look up a PIN code (or city) on OpenStreetMap. One request a second, as their rules ask. */
let last = 0;
export async function lookup(p: Pick<Party, "pin" | "city" | "state">): Promise<Omit<Geo, "at"> | null> {
  const wait = last + 1100 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
  last = Date.now();
  const q = /^\d{6}$/.test(p.pin || "") ? `postalcode=${p.pin}&country=India` : p.city ? `q=${encodeURIComponent([p.city, p.state, "India"].filter(Boolean).join(", "))}` : "";
  if (!q) return null;
  try {
    const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&${q}`, { headers: { Accept: "application/json" } });
    const j = await r.json();
    if (!j?.[0]) return null;
    return { lat: +j[0].lat, lng: +j[0].lon, src: /^\d{6}$/.test(p.pin || "") ? "pin" : "city" };
  } catch { return null; }
}

export function here(): Promise<{ lat: number; lng: number }> {
  return new Promise((res, rej) => navigator.geolocation ? navigator.geolocation.getCurrentPosition(p => res({ lat: p.coords.latitude, lng: p.coords.longitude }), e => rej(new Error(e.message || "Location is off")), { enableHighAccuracy: true, timeout: 15000 }) : rej(new Error("This device has no location")));
}

export type Visit = { at: string; by: string; party_id: string; party_name: string; note: string; photo_id?: string; lat?: number; lng?: number };
export type Tour = { id: string; name: string; date: string; salesman: string; stops: string[]; km: number; created_at: string; visits: Visit[] };
export async function saveTour(t: Tour) { await put("config", { id: "tour:" + t.id, value: t, updated_at: now() } as Config); }
export async function listTours(): Promise<Tour[]> {
  const rows = await db.config.filter(c => c.id.startsWith("tour:") && !c.deleted).toArray();
  return rows.map(r => ({ ...(r.value as Tour), id: r.id.slice(5) })).sort((a, z) => z.created_at.localeCompare(a.created_at));
}
