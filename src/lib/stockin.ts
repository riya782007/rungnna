import { db, put, uid, now, deviceId, getSetting, setSetting, type Movement, type Product, type Purchase, type PurchaseLine } from "./db";
import { findByScan, fromParsed, saveProduct, patterns, itemNameFor } from "./products";
import { parseLabel } from "./parse";
import { fy, counterCode } from "./billing";

export function newPurchase(by: string, loc = ""): Purchase {
  return { id: uid(), no: "", status: "draft", supplier_name: "", supplier_bill: "", loc_id: loc, items: [], total_qty: 0, total_cost: 0,
    note: "", device: deviceId(), by_staff: by, at: now(), updated_at: now() };
}
export const lineQty = (l: PurchaseLine) => (l.pack > 1 ? l.pkts * l.pack : l.qty);
export function sum(p: Purchase): Purchase {
  const items = p.items.map(l => ({ ...l, qty: lineQty(l) }));
  return { ...p, items, total_qty: items.reduce((a, l) => a + l.qty, 0), total_cost: items.reduce((a, l) => a + l.qty * l.cost, 0) };
}
export function lineOf(p: Product, isNew = false): PurchaseLine {
  const pack = p.pack && p.pack > 1 ? p.pack : 1;
  return { id: uid(), product_id: p.id, code: p.code, item: p.item || (p.item_code ? "ITEM " + p.item_code : ""), style: p.style, color: p.color,
    pack, pkts: pack > 1 ? 1 : 0, qty: pack > 1 ? pack : 1, cost: p.cost || 0, rate: p.rate, isNew };
}

/* A scan during stock-in: known product → +1 packet; the shop's own label → product created on the spot. */
export async function resolveScan(raw: string, by: string): Promise<{ product?: Product; created?: boolean }> {
  const r = raw.trim(); if (!r) return {};
  const parsed = parseLabel(r, await patterns());
  let product = await findByScan(r, parsed);
  if (product) return { product };
  if (parsed.style || parsed.code || parsed.icode) {
    const np = fromParsed(parsed, by);
    np.item = np.item || (await itemNameFor(np.item_code)) || "";
    if (!np.style && !np.item) return {};
    product = await saveProduct(np);
    return { product, created: true };
  }
  return {};
}

/* Save: one intake movement per line into the chosen rack, remember the cost, number the stock-in. */
export async function finalizePurchase(p0: Purchase): Promise<Purchase> {
  const p = sum(p0);
  const cc = await counterCode(); const key = `seq_PI_${fy()}_${cc}`;
  const n = (await getSetting<number>(key, 0)) + 1; await setSetting(key, n);
  const done: Purchase = { ...p, no: `PI/${fy()}/${cc}-${String(n).padStart(4, "0")}`, status: "final", at: now() };
  await db.transaction("rw", [db.purchases, db.movements, db.outbox, db.stock, db.products], async () => {
    await put("purchases", done);
    for (const l of done.items) {
      if (!l.qty) continue;
      const m: Movement = { id: uid(), product_id: l.product_id, kind: "intake", qty: l.qty, from_loc: null, to_loc: done.loc_id,
        person_type: done.supplier_name ? "supplier" : "employee", person_name: done.supplier_name, by_staff: done.by_staff,
        note: done.no + (done.supplier_bill ? " · bill " + done.supplier_bill : ""), device: deviceId(), ref_bill: done.id, at: done.at, updated_at: now() };
      await put("movements", m);
      const k = l.product_id + "|" + done.loc_id; const c = await db.stock.get(k);
      await db.stock.put({ key: k, product_id: l.product_id, loc_id: done.loc_id, qty: (c?.qty || 0) + l.qty });
      if (l.cost) { const pr = await db.products.get(l.product_id); if (pr && pr.cost !== l.cost) await put("products", { ...pr, cost: l.cost }); }
    }
  });
  return done;
}
