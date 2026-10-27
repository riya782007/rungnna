import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Bill, type Party, type Product } from "../lib/db";
import { go, useApp } from "../lib/app";
import { can } from "../lib/roles";
import { routeOk } from "../lib/routes";
import { rupees } from "../lib/format";
import { usePrivate, visibleBill } from "../lib/privacy";
import { inStore } from "../lib/scope";

/* Ctrl+K anywhere: jump to a product, customer, bill or screen — only ones this person may open.
   Owner, 27 Oct: "only allowed or permitted should be visible; should not indicate other access". Search used to
   list every screen and every product, customer and bill, so it showed what a person had not been given. */
const SCREENS: [string, string][] = [["bill", "New bill"], ["bills", "Bills register"], ["customers", "Customers"], ["scan", "Scan & record"], ["products", "Products"],
  ["labels", "QR labels"], ["racks", "Floors & racks"], ["move", "Move & transfer"], ["ask", "Ask the shop (AI)"], ["activity", "Activity log"], ["settings", "Settings"], ["home", "Dashboard"]];

export function SearchPalette({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  const { me } = useApp();
  const seeStock = can(me, "stock.view"), seeCustomers = can(me, "customers.manage"), seeSuppliers = can(me, "suppliers.manage"), seeBills = can(me, "billing.sell");
  // what the person may not see is not even read from the device
  const products = useLiveQuery((): Promise<Product[]> => seeStock ? db.products.filter(p => !p.deleted).toArray() : Promise.resolve([]), [seeStock], []);
  const parties = useLiveQuery((): Promise<Party[]> => seeCustomers || seeSuppliers ? db.parties.filter(p => !p.deleted && (p.kind === "supplier" ? seeSuppliers : seeCustomers)).toArray() : Promise.resolve([]), [seeCustomers, seeSuppliers], []);
  const bills = useLiveQuery((): Promise<Bill[]> => seeBills ? db.bills.orderBy("at").filter(inStore).reverse().limit(500).toArray() : Promise.resolve([]), [seeBills], []);
  const open = usePrivate();
  const res = useMemo(() => {
    const w = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const m = (s: string) => w.every(x => s.toLowerCase().includes(x));
    const out: { k: string; t: string; s: string; to: string }[] = [];
    SCREENS.forEach(([to, t]) => routeOk(me, to) && (!w.length || m(t)) && out.push({ k: "Go to", t, s: "", to }));
    if (w.length) {
      products.filter(p => m([p.style, p.item, p.color, p.code, p.item_code].join(" "))).slice(0, 8).forEach(p => out.push({ k: "Product", t: [p.item, p.style, p.color].filter(Boolean).join(" · "), s: p.rate ? rupees(p.rate) : "", to: "product/" + p.id }));
      parties.filter(p => m(p.name + " " + p.phone + " " + p.city)).slice(0, 6).forEach(p => p.kind === "supplier"
        ? out.push({ k: "Supplier", t: p.name, s: p.phone, to: "suppliers/" + p.id })
        : out.push({ k: "Customer", t: p.name, s: p.phone, to: "customers/" + p.id }));
      bills.filter(b => visibleBill(b, open) && m(b.no + " " + b.party_name + " " + b.party_phone)).slice(0, 6).forEach(b => out.push({ k: "Bill", t: b.no || "on hold", s: b.party_name + " · " + rupees(b.net), to: (b.status === "hold" ? "bill/" : "bills/") + b.id }));
    }
    return out.slice(0, 24);
  }, [q, products, parties, bills, open, me?.id, me?.updated_at]);
  useEffect(() => { ref.current?.focus(); }, []);
  useEffect(() => setI(0), [q]);
  const pick = (to: string) => { go(to); onClose(); };
  return (
    <div className="modal" style={{ placeItems: "start center", paddingTop: "10vh" }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet card palette">
        <input ref={ref} className="in" placeholder={"Search " + [seeStock && "products", seeCustomers && "customers", seeSuppliers && "suppliers", seeBills && "bills", "screens"].filter(Boolean).join(", ") + "…"} value={q} onChange={e => setQ(e.target.value)}
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
