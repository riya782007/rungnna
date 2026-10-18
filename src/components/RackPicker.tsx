import { useEffect, useMemo, useState } from "react";
import { db, put, uid, now, type Location } from "../lib/db";
import { inStore } from "../lib/scope";
import { useLocations } from "./common";
import { toast } from "../lib/app";

/* ===========================================================================
   Where the goods go: Floor · Rack · Box, picked or typed.

   The old picker listed only racks that already existed, and the shop had made racks on floor 1 only, so
   floors 2 and 3 could not be chosen at all (owner, 18 Oct). Here every floor of the shop is always offered,
   any rack number can be typed, and a rack that doesn't exist yet is added the moment it is used. The Racks
   page stays the place to name racks and print their QR stickers.
=========================================================================== */

export const FLOORS: [string, string][] = [["G", "Ground"], ["1", "Floor 1"], ["2", "Floor 2"], ["3", "Floor 3"], ["GD", "Godown"]];

/** Same codes as the Racks page: F2-R07, F1-R03-B02, G-R01, GD-R04. */
export const rackCode = (floor: string, rack: string, box: string) =>
  [floor === "G" ? "G" : floor === "GD" ? "GD" : "F" + floor, rack && "R" + rack.padStart(2, "0"), box && "B" + box.padStart(2, "0")].filter(Boolean).join("-");

const clean = (s: string) => s.trim().toUpperCase().replace(/^0+(?=\d)/, "");

/** The rack for this floor/rack/box, made if it doesn't exist yet. */
export async function ensureRack(floor: string, rack: string, box = ""): Promise<Location> {
  const f = clean(floor), r = clean(rack), b = clean(box);
  if (!f || !r) throw new Error("Choose the floor and type the rack number");
  const code = rackCode(f, r, b);
  const have = await db.locations.where("code").equals(code).first();   // codes are unique: one row per code
  if (have && !have.deleted && inStore(have)) return have;
  if (have && have.deleted && inStore(have)) return put("locations", { ...have, deleted: 0 });   // a removed rack used again
  if (have) throw new Error(`${code} belongs to another store`);
  return put("locations", { id: uid(), code, floor: f, rack: r, box: b, name: "", kind: "rack", updated_at: now() } as Location);
}

export function RackPicker({ value, onChange, label = "Location" }: { value: string; onChange: (id: string) => void; label?: string }) {
  const locs = useLocations();
  const cur = locs.find(l => l.id === value);
  const [floor, setFloor] = useState(cur?.floor || "1");
  const [rack, setRack] = useState(cur?.rack || "");
  const [box, setBox] = useState(cur?.box || "");
  useEffect(() => { if (cur) { setFloor(cur.floor || "1"); setRack(cur.rack || ""); setBox(cur.box || ""); } }, [cur?.id]);

  const racks = useMemo(() => [...new Set(locs.filter(l => l.kind !== "bucket" && l.floor === floor && l.rack).map(l => l.rack))]
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [locs, floor]);
  const boxes = useMemo(() => locs.filter(l => l.floor === floor && l.rack === clean(rack) && l.box).map(l => l.box), [locs, floor, rack]);
  const exists = !!rack.trim() && locs.some(l => l.code === rackCode(floor, clean(rack), clean(box)));

  // a rack is chosen (and made, if new) when the number is finished: on leaving the box, Enter, or picking a floor
  const commit = async (f = floor, r = rack, b = box) => {
    if (!r.trim()) { onChange(""); return; }
    try { const l = await ensureRack(f, r, b); if (l.id !== value) onChange(l.id); }
    catch (e: any) { toast(e.message, true); }
  };
  const key = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); void commit(); } };

  return (
    <div className="f rack-picker">
      <span>{label}</span>
      <div className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
        <select className="in" aria-label="Floor" value={floor} style={{ flex: "1 1 40%" }}
          onChange={e => { setFloor(e.target.value); if (rack.trim()) void commit(e.target.value); }}>
          {FLOORS.map(([k, n]) => <option key={k} value={k}>{n}</option>)}
        </select>
        <input className="in mono" aria-label="Rack" placeholder="Rack" inputMode="numeric" list={"racks-" + floor} value={rack} style={{ flex: "1 1 30%", minWidth: 0 }}
          onChange={e => setRack(e.target.value.toUpperCase())} onBlur={() => void commit()} onKeyDown={key} />
        <datalist id={"racks-" + floor}>{racks.map(r => <option key={r} value={r} />)}</datalist>
        <input className="in mono" aria-label="Box (optional)" placeholder="Box" list={"boxes-" + floor} value={box} style={{ flex: "1 1 25%", minWidth: 0 }}
          onChange={e => setBox(e.target.value.toUpperCase())} onBlur={() => void commit()} onKeyDown={key} />
        <datalist id={"boxes-" + floor}>{[...new Set(boxes)].map(b => <option key={b} value={b} />)}</datalist>
      </div>
      <span className="xs mut">{rack.trim() ? `${rackCode(floor, clean(rack), clean(box))}${exists ? "" : " · new rack, added when chosen"}` : `${racks.length} rack${racks.length === 1 ? "" : "s"} on this floor · type any number for a new one`}</span>
    </div>
  );
}
