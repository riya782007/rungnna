import { useEffect, useState } from "react";
import { loadPins, pinsForAddress, placeOfPin, type PinPlace } from "../lib/pincode";
import { getShop } from "../lib/billing";
import { stateCode } from "../lib/states";

/* PIN code box that finds the PIN from the address (owner, 10 Nov: "many people don't know their PIN code").
   While the box is empty, the likeliest PIN codes for the address appear under it — tap one, or press Enter to take
   the first. A typed PIN fills an empty City and State. */
/** City for a PIN: the district, except in Delhi, where every district is simply "Delhi". */
export const pinCity = (p: PinPlace) => (p.stateCode === "07" ? "Delhi" : p.district).toUpperCase();

export function PinField({ pin, address, onPin, onPlace, label = "PIN code" }: {
  pin: string; address: string; onPin: (pin: string) => void; onPlace?: (p: PinPlace) => void; label?: string;
}) {
  const [hits, setHits] = useState<PinPlace[]>([]);
  const [near, setNear] = useState("");
  useEffect(() => { getShop().then(s => setNear(stateCode(s.state || ""))).catch(() => {}); }, []);
  useEffect(() => {
    if (pin || address.trim().length < 4) { setHits([]); return; }
    let live = true;
    const t = setTimeout(() => { loadPins().then(tb => { if (live) setHits(pinsForAddress(tb, address, 4, near)); }).catch(() => {}); }, 250);
    return () => { live = false; clearTimeout(t); };
  }, [pin, address, near]);
  const take = (p: PinPlace) => { onPin(p.pin); onPlace?.(p); setHits([]); };
  const typed = (v: string) => {
    onPin(v);
    if (v.length === 6) loadPins().then(tb => { const p = placeOfPin(tb, v); if (p) onPlace?.(p); }).catch(() => {});
  };
  return <label className="f pin-field">{label}
    <input className="in mono" inputMode="numeric" maxLength={6} value={pin} placeholder={hits[0] ? hits[0].pin + " ?" : ""}
      onChange={e => typed(e.target.value.replace(/\D/g, ""))}
      onKeyDown={e => { if (e.key === "Enter" && !pin && hits[0]) take(hits[0]); }} />
    {!pin && hits.length > 0 && <span className="pin-hits">{hits.map(h =>
      <button type="button" key={h.pin} className="chip" title={`${h.office}, ${h.district}, ${h.state}`} onClick={() => take(h)}>
        <b className="mono">{h.pin}</b> {h.office}{h.district && h.district.toUpperCase() !== h.office.toUpperCase() ? ", " + h.district : ""}
      </button>)}</span>}
  </label>;
}
