import { db, put, now, type Party } from "./db";
import { newParty } from "./billing";
import type { VendorRow } from "./vendors-parse";
export { parseVendorList, type VendorRow } from "./vendors-parse";

/* The shop's vendor list. Each vendor has a short CODE (1, 3A, M1, L9, 201 …) that is also the
   "rate number" the supplier is known by. A vendor can give a discount ("5% less") or quote rates that
   must be divided by a factor ("rate number divide 1.2"). Both are stored on the supplier so the
   purchase-bill review can apply them, and the original bill rate is never overwritten silently. */

/* Suppliers are matched by vendor code first, then by name, so loading the list twice never duplicates anyone. */
export async function importVendors(rows: VendorRow[]): Promise<{ added: number; updated: number }> {
  let added = 0, updated = 0;
  const all = await db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray();
  for (const r of rows) {
    const old = all.find(p => (p.vendor_code || "").toUpperCase() === r.code) || all.find(p => !p.vendor_code && p.name.toUpperCase() === r.name);
    const fields = { vendor_code: r.code, city: old?.city || r.city, less_pct: old?.less_pct ?? r.less_pct, rate_divisor: old?.rate_divisor ?? r.rate_divisor, notes: old?.notes || r.notes };
    if (old) { await put("parties", { ...old, ...fields, updated_at: now() } as Party); updated++; }
    else { const p = { ...newParty(r.name), kind: "supplier" as const, ...fields }; await put("parties", p); all.push(p); added++; }
  }
  return { added, updated };
}

/* Cost after the vendor's terms: printed rate ÷ divisor, then less %. Returns the printed text unchanged when
   there is nothing to apply or the cost is not a plain number. */
export function vendorCost(cost: string, v?: Pick<Party, "less_pct" | "rate_divisor">): string {
  const less = v?.less_pct || 0, div = v?.rate_divisor || 1;
  const n = Number(cost.trim());
  if ((!less && div === 1) || !cost.trim() || !Number.isFinite(n) || n <= 0 || less < 0 || less >= 100 || div <= 0) return cost;
  return (n / div * (1 - less / 100)).toFixed(2);
}

/* Owner, 5 Nov (photo, "Vendor list still duplicate"): 32 RAVI BH, 33 NIKHIL BHAI, 34 AMAN ARTS (KOL) … each listed
   twice — the vendor list was loaded on two counters before they had synced, so each counter made its own copy.
   Copies with the SAME roll number and the SAME name are one supplier: their bills, payments, returns and stickers
   move to the copy that has most of them, blank details are filled from the others, and the extra copies are hidden.
   Different names on one roll number are never merged here — that needs the owner's eye. */
const rollOf = (v?: string) => (v || "").trim().toUpperCase().replace(/\s+/g, "").replace(/^0+(?=\d)/, "");
const nameOf = (v?: string) => (v || "").trim().toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim();

export function duplicateSupplierGroups<T extends Pick<Party, "id" | "name" | "vendor_code" | "kind" | "deleted">>(parties: T[]): T[][] {
  const groups = new Map<string, T[]>();
  for (const p of parties) {
    if (p.deleted || p.kind !== "supplier" || !nameOf(p.name)) continue;
    const k = rollOf(p.vendor_code) + "|" + nameOf(p.name);
    groups.set(k, [...(groups.get(k) || []), p]);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

export async function mergeDuplicateSuppliers(): Promise<number> {
  const groups = duplicateSupplierGroups(await db.parties.toArray());
  if (!groups.length) return 0;
  const [purchases, returns, vouchers, products] = await Promise.all([
    db.purchases.toArray(), db.purchase_returns.toArray(), db.vouchers.toArray(), db.products.toArray()]);
  const uses = (id: string) => purchases.filter(x => x.supplier_id === id).length + returns.filter(x => x.supplier_id === id).length
    + vouchers.filter(x => x.party_id === id).length + products.filter(x => x.vendor_id === id).length;
  let merged = 0;
  for (const g of groups) {
    const ranked = [...g].sort((a, z) => uses(z.id) - uses(a.id) || String(a.updated_at || "").localeCompare(String(z.updated_at || "")));
    const keep = { ...ranked[0] } as Party;
    const extra = ranked.slice(1);
    for (const o of extra) for (const k of ["phone", "gstin", "address", "city", "state", "pin", "notes", "alt_name"] as const)
      if (!String(keep[k] || "").trim() && String((o as Party)[k] || "").trim()) (keep as any)[k] = (o as Party)[k];
    for (const o of extra) {
      if (!keep.less_pct && (o as Party).less_pct) keep.less_pct = (o as Party).less_pct;
      if ((!keep.rate_divisor || keep.rate_divisor === 1) && (o as Party).rate_divisor && (o as Party).rate_divisor !== 1) keep.rate_divisor = (o as Party).rate_divisor;
      if (!keep.opening_balance && (o as Party).opening_balance) keep.opening_balance = (o as Party).opening_balance;
    }
    const ids = new Set(extra.map(o => o.id));
    for (const x of purchases) if (x.supplier_id && ids.has(x.supplier_id)) await put("purchases", { ...x, supplier_id: keep.id });
    for (const x of returns) if (x.supplier_id && ids.has(x.supplier_id)) await put("purchase_returns", { ...x, supplier_id: keep.id });
    for (const x of vouchers) if (x.party_id && ids.has(x.party_id)) await put("vouchers", { ...x, party_id: keep.id });
    for (const x of products) if (x.vendor_id && ids.has(x.vendor_id)) await put("products", { ...x, vendor_id: keep.id });
    await put("parties", keep);
    for (const o of extra) { await put("parties", { ...(o as Party), deleted: 1 }); merged++; }
  }
  return merged;
}
