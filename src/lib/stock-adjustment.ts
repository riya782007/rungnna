import { db, put, now, uid, deviceId, applyMovement, type BillLine, type Product } from "./db";
import { currentStore, inStore, requirePerm } from "./scope";
import { blankProduct, normUnit } from "./products";

/** Deterministic across counters: each store has one regular rack for unassigned/negative stock. */
export function unassignedRackId(store = currentStore()) {
  const compact = store.replace(/-/g, "");
  if (!/^[a-f0-9]{32}$/i.test(compact)) throw new Error("Store ID is invalid");
  const tail = (BigInt("0x" + compact.slice(20)) ^ 0x6e6567617469n).toString(16).padStart(12, "0");
  return compact.slice(0, 8) + "-" + compact.slice(8, 12) + "-4" + compact.slice(13, 16) + "-8" + compact.slice(17, 20) + "-" + tail;
}
export async function unassignedRack() {
  const store = currentStore(), id = unassignedRackId(store);
  const existing = await db.locations.get(id);
  if (existing && !existing.deleted && inStore(existing) && existing.kind !== "bucket") return id;
  await put("locations", { id, store_id: store, code: "UNASSIGNED/" + store.replace(/-/g, ""), name: "Unassigned stock", floor: "", rack: "", box: "", kind: "rack", updated_at: now() });
  return id;
}

/** A manually named sale is a stock-tracked article even before any intake. */
export async function trackCustomLines(lines: BillLine[], by: string): Promise<BillLine[]> {
  const products = await db.products.filter(p => !p.deleted).toArray();
  const normalized = (v?: string) => (v || "").trim().toUpperCase();
  const output: BillLine[] = [];
  for (const line of lines) {
    if (line.product_id || line.stock_done) { output.push(line); continue; }
    let product = products.find(p => normalized(p.item) === normalized(line.item) && normalized(p.style) === normalized(line.style) && normalized(p.color) === normalized(line.color) && normUnit(p.type) === normUnit(line.type));
    if (!product) {
      product = { ...blankProduct(by), item: normalized(line.item), style: normalized(line.style), color: normalized(line.color), type: normUnit(line.type) || "PCS", rate: line.rate, hsn: line.hsn, pack: 1 } as Product;
      await put("products", product); products.push(product);
    }
    output.push({ ...line, product_id: product.id, code: product.code });
  }
  return output;
}

/** Set the saleable total to an exact signed count, recording the difference as an auditable movement. */
export async function setStockQuantity(productId: string, target: number, reason: string, by: string, expected?: number) {
  requirePerm("stock.move", "adjusting stock");
  if (!Number.isSafeInteger(target)) throw new Error("Enter a whole stock quantity, including zero or a negative number");
  if (!reason.trim()) throw new Error("Write a reason for the stock correction");
  return db.transaction("rw", [db.products, db.locations, db.stock, db.movements, db.outbox], async () => {
    const product = await db.products.get(productId);
    if (!product || product.deleted) throw new Error("Product no longer exists");
    const racks = new Set((await db.locations.filter(l => !l.deleted && inStore(l) && l.kind !== "bucket").toArray()).map(l => l.id));
    const cells = (await db.stock.where("product_id").equals(productId).toArray()).filter(c => racks.has(c.loc_id));
    const current = cells.reduce((sum,c) => sum + c.qty, 0);
    if (expected !== undefined && current !== expected) throw new Error("Stock changed while you were editing. Check the new count and try again.");
    const delta = target - current;
    if (!Number.isSafeInteger(delta)) throw new Error("Stock correction is too large");
    if (!delta) return target;
    const rack = cells[0]?.loc_id || await unassignedRack();
    const timestamp = now();
    const movement = { id: uid(), product_id: productId, store_id: currentStore(), kind: "adjust" as const, qty: Math.abs(delta), from_loc: delta < 0 ? rack : null, to_loc: delta > 0 ? rack : null, person_type: "employee" as const, person_name: "", by_staff: by, note: "Set total stock " + current + " → " + target + ": " + reason.trim(), device: deviceId(), at: timestamp, updated_at: timestamp };
    await put("movements", movement); await applyMovement(movement);
    return target;
  });
}
