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
