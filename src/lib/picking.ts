import { db, put, now, type Config, type Location } from "./db";
import { storeStock } from "./stores";

/* Floor-wise picking, KOT style (owner's list R-87 … R-91, R-145, R-160 … R-165, R-194 … R-196).
   A bill / dealer order / spoken request is split by where the goods sit: each floor gets its own
   ticket with rack, box and pieces — on that floor's tablet and as a slip on its printer. The floor
   ticks what it picked; the counter sees every floor's ticket for the token turn green. Saved like
   everything else, so it works on the shop Wi-Fi even when the internet is down (synced when back). */

export type PickItem = { product_id?: string; code: string; item: string; style: string; color: string; qty: number; picked: number; loc: string; rack: string; box: string };
export type PickTicket = {
  id: string; token: string; source: "bill" | "order" | "request"; source_id: string; source_no: string;
  party_name: string; floor: string; to: string; note: string; items: PickItem[];
  status: "new" | "picking" | "done" | "cancelled"; created_at: string; by: string; done_at?: string; done_by?: string;
};
export type PickLine = { product_id?: string; code: string; item: string; style?: string; color?: string; qty: number };

export const NO_FLOOR = "?";
export const floorName = (f: string) => f === NO_FLOOR ? "Not on a rack" : f === "G" ? "Ground floor" : /^\d+$/.test(f) ? `Floor ${f}` : f || "—";

/** Where to pick each line from: the rack that can give it all, else the biggest racks first. */
export function planPicks(lines: PickLine[], cells: { product_id: string; loc_id: string; qty: number }[], locs: Location[]): Map<string, PickItem[]> {
  const L = new Map(locs.map(l => [l.id, l]));
  const left = new Map<string, number>();
  for (const c of cells) { const l = L.get(c.loc_id); if (l && l.kind !== "bucket" && !l.deleted && c.qty > 0) left.set(c.loc_id + "|" + c.product_id, (left.get(c.loc_id + "|" + c.product_id) || 0) + c.qty); }
  const out = new Map<string, PickItem[]>();
  const add = (floor: string, it: PickItem) => (out.get(floor) || out.set(floor, []).get(floor)!).push(it);
  for (const ln of lines) {
    if (!(ln.qty > 0)) continue;
    const base = { product_id: ln.product_id, code: ln.code, item: ln.item, style: ln.style || "", color: ln.color || "", picked: 0 };
    const spots = [...left].filter(([k, q]) => k.endsWith("|" + ln.product_id) && q > 0).map(([k, q]) => ({ loc: L.get(k.split("|")[0])!, q, k }))
      .sort((a, z) => Number(z.q >= ln.qty) - Number(a.q >= ln.qty) || z.q - a.q);
    let need = ln.qty;
    for (const s of spots) {
      if (need <= 0) break;
      const take = Math.min(need, s.q); need -= take; left.set(s.k, s.q - take);
      add(s.loc.floor || NO_FLOOR, { ...base, qty: take, loc: s.loc.code, rack: s.loc.rack, box: s.loc.box });
    }
    if (need > 0) add(NO_FLOOR, { ...base, qty: need, loc: "", rack: "", box: "" });
  }
  for (const list of out.values()) list.sort((a, z) => (a.rack + a.box).localeCompare(z.rack + z.box, undefined, { numeric: true }));
  return out;
}

export async function sendToFloors(src: { source: PickTicket["source"]; id: string; no: string; party: string; to?: string; note?: string; by: string }, lines: PickLine[]): Promise<PickTicket[]> {
  const [cells, locs] = await Promise.all([storeStock(), db.locations.toArray()]);
  const plan = planPicks(lines, cells, locs);
  // sending the same bill again replaces its open tickets instead of doubling the work
  const old = (await listPicks()).filter(t => t.source_id === src.id && t.status !== "done" && t.status !== "cancelled");
  for (const t of old) await savePick({ ...t, status: "cancelled" });
  const out: PickTicket[] = [];
  for (const [floor, items] of plan) {
    const t: PickTicket = { id: crypto.randomUUID(), token: src.no, source: src.source, source_id: src.id, source_no: src.no, party_name: src.party, floor, to: src.to || "Billing counter", note: src.note || "", items, status: "new", created_at: now(), by: src.by };
    await savePick(t); out.push(t);
  }
  return out;
}

export async function savePick(t: PickTicket) { await put("config", { id: "pick:" + t.id, value: t, updated_at: now() } as Config); }
export async function listPicks(): Promise<PickTicket[]> {
  const rows = await db.config.filter(c => c.id.startsWith("pick:") && !c.deleted).toArray();
  return rows.map(r => ({ ...(r.value as PickTicket), id: r.id.slice(5) })).sort((a, z) => a.created_at.localeCompare(z.created_at));
}
export const ticketLeft = (t: PickTicket) => t.items.reduce((a, i) => a + Math.max(0, i.qty - i.picked), 0);

/** This tablet's floor (each floor's tablet remembers its own). */
export const myFloor = () => { try { return localStorage.getItem("rj_pick_floor") || ""; } catch { return ""; } };
export const setMyFloor = (f: string) => { try { localStorage.setItem("rj_pick_floor", f); } catch { /* private mode */ } };
