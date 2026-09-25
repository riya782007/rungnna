import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { go } from "../lib/app";
import { rupees } from "../lib/format";

/* Ctrl+K anywhere: jump to any product, customer, bill or screen. */
const SCREENS: [string, string][] = [["bill", "New bill"], ["bills", "Bills register"], ["customers", "Customers"], ["scan", "Scan & record"], ["products", "Products"],
  ["labels", "QR labels"], ["racks", "Floors & racks"], ["move", "Move & transfer"], ["ask", "Ask the shop (AI)"], ["activity", "Activity log"], ["settings", "Settings"], ["home", "Dashboard"]];

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], []);
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted).toArray(), [], []);
  const bills = useLiveQuery(() => db.bills.orderBy("at").reverse().limit(500).toArray(), [], []);
  const res = useMemo(() => {
    const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const m = (s: string) => w.every(x => s.toLowerCase().includes(x));
    const out: { k: string; t: string; s: string; to: string }[] = [];
    SCREENS.forEach(([to, t]) => (!w.length || m(t)) && out.push({ k: "Go to", t, s: "", to }));
    if (w.length) {
      products.filter(p => m([p.style, p.item, p.color, p.code, p.item_code].join(" "))).slice(0, 8).forEach(p => out.push({ k: "Product", t: [p.item, p.style, p.color].filter(Boolean).join(" · "), s: p.rate ? rupees(p.rate) : "", to: "product/" + p.id }));
      parties.filter(p => m(p.name + " " + p.phone + " " + p.city)).slice(0, 6).forEach(p => out.push({ k: "Customer", t: p.name, s: p.phone, to: "customers/" + p.id }));
      bills.filter(b => m(b.no + " " + b.party_name + " " + b.party_phone)).slice(0, 6).forEach(b => out.push({ k: "Bill", t: b.no || "on hold", s: b.party_name + " · " + rupees(b.net), to: (b.status === "hold" ? "bill/" : "bills/") + b.id }));
    }
    return out.slice(0, 24);
  }, [q, products, parties, bills]);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => setI(0), [q]);
  const pick = (to: string) => { go(to); onClose(); };
  return (
    <div className="modal" style={{ placeItems: "start center", paddingTop: "10vh" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet card palette">
        <input ref={ref} className="in" placeholder="Search products, customers, bills, screens…" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => {
            if (e.key === "Escape") onClose();
            if (e.key === "ArrowDown") { e.preventDefault(); setI(x => Math.min(res.length - 1, x + 1)); }
            if (e.key === "ArrowUp") { e.preventDefault(); setI(x => Math.max(0, x - 1)); }
            if (e.key === "Enter" && res[i]) pick(res[i].to);
          }} />
        <div className="pal-list">{res.map((r, j) => (
          <button key={r.k + r.to} className={j === i ? "on" : ""} onMouseEnter={() => setI(j)} onClick={() => pick(r.to)}>
            <span className="pill">{r.k}</span><span className="grow">{r.t}</span><span className="xs mut">{r.s}</span></button>))}</div>
      </div>
    </div>
  );
}
