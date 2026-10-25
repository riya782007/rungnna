import { useEffect, useMemo, useState } from "react";
import type { Party } from "../lib/db";

/* ===========================================================================
   The supplier by roll number, the way the shop works (owner, 18 Oct):
   "remove the names of the suppliers from the print label section — they must type or fetch the supplier
   roll number and get the information."

   No list of names to pick from: the box takes a roll number ("51", "3A", "L9"), suggests only numbers, in
   ascending order (1, 2, 3, 3A, 3B, 4 … 64, 71 … 94, 201 … 238, L9, L10, M1, R1, V1), and once the number
   is right it shows that supplier's details (name, city, rate terms) underneath to confirm.
=========================================================================== */

type Sup = Pick<Party, "id" | "name"> & Partial<Pick<Party, "vendor_code" | "city" | "less_pct" | "rate_divisor">>;

/** Roll numbers in the shop's order: numbers ascending (3, 3A, 3B, 4 … 238), then letter series (L9, L10, M1 …). */
export const byRollNo = (a: Sup, z: Sup) => {
  const x = (a.vendor_code || "").trim(), y = (z.vendor_code || "").trim();
  if (!x !== !y) return x ? -1 : 1;                       // suppliers with no number last
  const dx = /^\d/.test(x), dy = /^\d/.test(y);
  if (dx !== dy) return dx ? -1 : 1;                       // plain numbers before L9 / M1 / R1 / V1
  return x.localeCompare(y, "en", { numeric: true, sensitivity: "base" }) || a.name.localeCompare(z.name);
};

export const findRollNo = <T extends Sup>(suppliers: T[], typed: string): T | undefined => {
  const k = typed.trim().toUpperCase();
  return k ? suppliers.find(s => (s.vendor_code || "").trim().toUpperCase() === k) : undefined;
};

export function supplierInfo(s: Sup) {
  return [s.name, s.city, s.rate_divisor && s.rate_divisor !== 1 ? `rate ÷ ${s.rate_divisor}` : "", s.less_pct ? `${s.less_pct}% less` : ""].filter(Boolean).join(" · ");
}

export function SupplierNo<T extends Sup>({ suppliers, id, onPick, label = "Supplier roll no." }:
  { suppliers: T[]; id?: string; onPick: (s?: T) => void; label?: string }) {
  const sorted = useMemo(() => [...suppliers].sort(byRollNo), [suppliers]);
  const cur = suppliers.find(s => s.id === id);
  const [text, setText] = useState(cur?.vendor_code || "");
  useEffect(() => { setText(cur?.vendor_code || ""); }, [id, cur?.vendor_code]);
  const hit = findRollNo(suppliers, text);
  const listId = "roll-nos";
  return (
    <label className="f">{label}
      <input className="in mono" aria-label={label} value={text} list={listId} placeholder="e.g. 51" autoComplete="off"
        onChange={e => { const t = e.target.value.toUpperCase(); setText(t); onPick(findRollNo(suppliers, t)); }} />
      <datalist id={listId}>{sorted.filter(s => s.vendor_code).map(s => <option key={s.id} value={s.vendor_code} />)}</datalist>
      {text.trim()
        ? <span className={"xs " + (hit ? "mut" : "bad-text")}>{hit ? supplierInfo(hit) : `No supplier has roll number ${text.trim()}`}</span>
        : cur ? <span className="xs mut">{supplierInfo(cur)} · no roll number yet (add it on the Suppliers page)</span> : null}
    </label>
  );
}
