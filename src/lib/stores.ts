import { db, put, now, uid, deviceId, applyMovement, getSetting, setSetting, type Staff, type StoreTransfer, type Movement } from "./db";
import { currentStore, MAIN_STORE, inStore, ownerOnly, requirePerm } from "./scope";
export { currentStore, MAIN_STORE, inStore } from "./scope";

export async function initStores(me?: Staff | null) {
  if (!(await db.stores.get(MAIN_STORE))) await db.stores.put({ id: MAIN_STORE, code: "MAIN", name: "Main store", address: "", active: 1, updated_at: "1970-01-01T00:00:00Z" });
  return me?.role === "owner" ? await getSetting("active_store", MAIN_STORE) : me?.store_id || MAIN_STORE;
}
export async function createStore(name: string, code: string) {
  ownerOnly();
  code = code.trim().toUpperCase();
  if (!name.trim() || !/^[A-Z0-9]{1,4}$/.test(code)) throw new Error("Enter a name and a 1–4 character branch code");
  if (await db.stores.where("code").equals(code).count()) throw new Error("Branch code already exists");
  return db.transaction("rw", [db.stores, db.locations, db.outbox], async () => {
    const s = await put("stores", { id: uid(), name: name.trim(), code, address: "", active: 1, updated_at: now() });
    for (const bucket of ["DAMAGED", "MISSING", "REPAIR"]) await put("locations", { id: uid(), code: code + "/" + bucket, name: bucket, floor: "", rack: "", box: "", kind: "bucket", store_id: s.id, updated_at: now() });
    return s;
  });
}
export async function storeLocations(store = currentStore()) { return db.locations.filter(l => !l.deleted && inStore(l, store)).toArray(); }
export async function storeStock(store = currentStore()) {
  const ids = new Set((await storeLocations(store)).map(l => l.id));
  return db.stock.filter(c => ids.has(c.loc_id)).toArray();
}
export async function assertStoreRow(row?: { store_id?: string | null }) {
  if (row && !inStore(row)) throw new Error("This record belongs to another store");
}
export async function assertLocation(id: string, store = currentStore()) {
  const l = await db.locations.get(id);
  if (!l || l.deleted || !inStore(l, store) || l.kind === "bucket") throw new Error("Choose a rack in the correct store");
  return l;
}
export async function dispatchTransfer(to_store: string, items: StoreTransfer["items"], by: string) {
  const dest = await db.stores.get(to_store);
  if (!dest?.active || dest.deleted || to_store === currentStore() || !items.length) throw new Error("Choose another store and at least one item");
  return db.transaction("rw", [db.store_transfers, db.movements, db.stock, db.products, db.locations, db.settings, db.outbox], async () => {
    const n = (await getSetting("transfer_seq", 0)) + 1;
    await setSetting("transfer_seq", n);
    const t: StoreTransfer = { id: uid(), no: `TR/${deviceId()}/${n}`, from_store: currentStore(), to_store, status: "in_transit", items, at: now(), updated_at: now(), by_staff: by, device: deviceId() };
    const seenTags = new Set<string>();
    for (const item of items) {
      await assertLocation(item.from_loc);
      if (!Number.isInteger(item.qty) || item.qty <= 0) throw new Error("Quantity must be positive whole pieces");
      const p = await db.products.get(item.product_id);
      if (!p || p.deleted) throw new Error("Item no longer exists");
      const c = await db.stock.get(item.product_id + "|" + item.from_loc);
      if ((c?.qty || 0) < item.qty) throw new Error("Not enough stock in the source rack");
      for (const tag of item.tags || []) {
        if (seenTags.has(tag) || !(p.barcodes || []).includes(tag) || p.sold_tags?.[tag]) throw new Error("RFID tag is duplicated or unavailable");
        seenTags.add(tag);
      }
      if (item.tags?.length && item.tags.length !== item.qty) throw new Error("Tagged quantity must equal scanned tags");
      const m: Movement = { id: uid(), product_id: item.product_id, kind: "transfer", qty: item.qty, from_loc: item.from_loc, to_loc: null, store_id: t.from_store, person_type: "employee", person_name: dest.name, by_staff: by, note: t.no + " in transit", ref_bill: t.id, device: deviceId(), at: t.at, updated_at: now() };
      await put("movements", m); await applyMovement(m);
      if (item.tags?.length) await put("products", { ...p, sold_tags: { ...p.sold_tags, ...Object.fromEntries(item.tags.map(tag => [tag, "TRANSFER " + t.id])) } });
    }
    await put("store_transfers", t); return t;
  });
}
export async function receiveTransfer(id: string, racks: Record<string, string>, by: string) {
  requirePerm("stores.transfer", "receiving a transfer");
  return db.transaction("rw", [db.store_transfers, db.movements, db.stock, db.products, db.locations, db.outbox], async () => {
    const t = await db.store_transfers.get(id);
    if (!t || t.status !== "in_transit" || t.to_store !== currentStore()) throw new Error("Transfer cannot be received at this store");
    for (const [i, item] of t.items.entries()) {
      const to_loc = racks[String(i)]; await assertLocation(to_loc, t.to_store);
      const m: Movement = { id: uid(), product_id: item.product_id, kind: "transfer", qty: item.qty, from_loc: null, to_loc, store_id: t.to_store, person_type: "employee", person_name: "Transfer received", by_staff: by, note: t.no, ref_bill: t.id, device: deviceId(), at: now(), updated_at: now() };
      await put("movements", m); await applyMovement(m);
      const p = await db.products.get(item.product_id);
      if (p && item.tags?.length) { const sold_tags = { ...p.sold_tags }; item.tags.forEach(tag => delete sold_tags[tag]); await put("products", { ...p, sold_tags }); }
      item.to_loc = to_loc;
    }
    await put("store_transfers", { ...t, status: "received", received_at: now(), received_by: by });
  });
}

/* ---------- the two companies (owner, 23 Oct) ---------- */
export const companyKind = async (id = currentStore()) => (await db.stores.get(id))?.kind;
/** Turn the main store into the tax-invoice company and make the estimate company beside it (once). */
export async function setUpTwoCompanies() {
  ownerOnly();
  const main = await db.stores.get(MAIN_STORE);
  if (main && main.kind !== "gst") await put("stores", { ...main, kind: "gst", name: main.name === "Main store" ? "Tax invoices" : main.name });
  const est = await db.stores.filter(s => !s.deleted && s.kind === "estimate").first();
  if (est) { await ensureCounterRack(est); return est; }
  const made = await createStore("Estimates", "E");
  await put("stores", { ...(await db.stores.get(made.id))!, kind: "estimate" });
  await ensureCounterRack(made);
  return made;
}
/* Owner, 26 Oct: the estimate company started with only DAMAGED/MISSING/REPAIR, so "Stock in" there had no rack
   to put anything on. It gets one counter rack, ready to use; more can be added in Racks. */
async function ensureCounterRack(s: { id: string; code: string }) {
  if (await db.locations.filter(l => !l.deleted && l.store_id === s.id && l.kind !== "bucket").count()) return;
  const code = s.code + "/COUNTER", old = await db.locations.where("code").equals(code).first();   // codes are unique
  if (old) { if (old.store_id === s.id) await put("locations", { ...old, deleted: 0 }); return; }
  await put("locations", { id: uid(), code, name: "Counter", floor: "", rack: "", box: "", kind: "counter", store_id: s.id, updated_at: now() });
}
/** The companies this person may open after the PIN. */
export async function companiesFor(me: Pick<Staff, "role" | "store_id" | "stores"> | null | undefined) {
  const all = await db.stores.filter(s => !s.deleted && !!s.active).toArray();
  if (!me) return [];
  if (me.role === "owner") return all;
  const ids = new Set(me.stores?.length ? me.stores : [me.store_id || MAIN_STORE]);
  return all.filter(s => ids.has(s.id));
}
