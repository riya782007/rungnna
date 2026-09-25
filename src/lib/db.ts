import Dexie, { type Table } from "dexie";

/* Money is always integer paise. Every row id is a client-made UUID so any
   device can create records offline without ever colliding with another. */

export type Row = { id: string; updated_at: string; deleted?: 0 | 1 };

export interface Product extends Row {
  code: string;            // our own short code, printed under the QR
  barcodes: string[];      // every raw value that should find this product (old labels + new QR)
  item: string;            // CHAIN, EARRING, SET …
  type: string;            // PCS, PAIR, SET, DOZEN …
  style: string;           // K5209/59SH
  color: string;           // K/GBN
  tk: string;              // TK field from the owner's current label screen
  rate: number;            // paise
  mrp: number;             // paise (0 = not set)
  category: string;
  notes: string;
  photo_id?: string;       // local photo row
  photo_url?: string;      // cloud copy once uploaded
  raw_scan?: string;       // the exact text first read off the old label
  item_code?: string;      // numeric item code from the old software (202 = F-RING)
  ref?: string;            // 4th field of the old label (meaning to be confirmed)
  pack?: number;           // pieces per packet (the X12PCS on the label)
  created_by: string;
  created_at: string;
}

export interface Location extends Row {
  code: string;            // F1-R04-B2 — also printed as a QR on the rack
  floor: string;           // G, 1, 2, 3, 4
  rack: string;
  box: string;
  name: string;            // "Bridal wall", "Godown top shelf"
  kind: "rack" | "counter" | "godown" | "bucket";
}

export type MoveKind = "intake" | "transfer" | "sale" | "return" | "adjust" | "damage" | "missing" | "found";
export type PersonType = "employee" | "helper" | "customer" | "supplier" | "owner" | "";

export interface Movement extends Row {
  product_id: string;
  kind: MoveKind;
  qty: number;             // always positive; direction comes from from/to
  from_loc: string | null;
  to_loc: string | null;
  person_type: PersonType;
  person_name: string;
  by_staff: string;        // staff id who recorded it
  photo_id?: string;
  photo_url?: string;
  note: string;
  device: string;
  ref_bill?: string;       // the bill that caused this movement (sale / void return)
  at: string;              // when it happened
}

export interface Party extends Row {
  kind: "customer" | "dealer" | "supplier";
  name: string; alt_name: string; phone: string; gstin: string;
  address: string; city: string; state: string; pin: string;
  photo_id?: string; photo_url?: string;
  tier: "retail" | "wholesale" | "dealer"; credit_limit: number; notes: string;
}

export interface BillLine {
  id: string; product_id?: string; code: string; item: string; type: string; style: string; color: string;
  box_no: number; pack: number; pkts: number; qty: number; rate: number; disc: string; amount: number;
}
export interface Payment { mode: "cash" | "upi" | "card" | "bank" | "credit"; amount: number; ref?: string }
export type BillType = "gst" | "estimate";
export type BillStatus = "hold" | "final" | "void" | "converted";

export interface Bill extends Row {
  no: string; series: string; bill_type: BillType; status: BillStatus;
  party_id?: string; party_name: string; party_phone: string; party_gstin: string; party_state: string;
  salesman: string; box_count: number; total_qty: number;
  gross: number; discount: number; discount_pct: number; packing: number; adjust: number;
  gst_mode: "exclusive" | "inclusive"; gst_rate: number; gst: number; cgst: number; sgst: number; igst: number;
  net: number; advance: number; paid: number;
  remarks: string; payments: Payment[]; items: BillLine[];
  photo_id?: string; photo_url?: string; voice_id?: string;
  converted_from?: string; converted_to?: string; void_reason?: string;
  device: string; by_staff: string; at: string;
}

export interface VoiceNote extends Row {
  entity: string; entity_id: string; seconds: number; transcript: string; url?: string; by_staff: string; at: string;
}
/* shop-wide settings that every device must share (name, GSTIN, UPI…) */
export interface Config extends Row { value: any }
export interface VoiceBlob { id: string; blob: Blob; uploaded: 0 | 1; url?: string; created_at: string }

export interface Staff extends Row {
  name: string;
  role: "owner" | "manager" | "salesman" | "helper" | "packer" | "cashier";
  phone: string;
  pin: string;             // 4-digit, hashed later when auth moves server-side
  active: 0 | 1;
}

export interface Setting { key: string; value: any; updated_at: string }
export interface Photo { id: string; blob: Blob; w: number; h: number; bytes: number; url?: string; uploaded: 0 | 1; created_at: string }
export interface Outbox { seq?: number; table: string; row_id: string; at: string; tries: number; last_error?: string }
export interface StockCell { key: string; product_id: string; loc_id: string; qty: number }

class RungnnaDB extends Dexie {
  products!: Table<Product, string>;
  locations!: Table<Location, string>;
  movements!: Table<Movement, string>;
  staff!: Table<Staff, string>;
  settings!: Table<Setting, string>;
  photos!: Table<Photo, string>;
  outbox!: Table<Outbox, number>;
  stock!: Table<StockCell, string>;
  parties!: Table<Party, string>;
  bills!: Table<Bill, string>;
  voice_notes!: Table<VoiceNote, string>;
  voice_blobs!: Table<VoiceBlob, string>;
  config!: Table<Config, string>;

  constructor() {
    super("rungnna");
    this.version(1).stores({
      products: "id, code, *barcodes, style, item, color, updated_at, created_at",
      locations: "id, &code, floor, updated_at",
      movements: "id, product_id, from_loc, to_loc, kind, at, updated_at",
      staff: "id, name, updated_at",
      settings: "key",
      photos: "id, uploaded",
      outbox: "++seq, table, row_id",
      stock: "key, product_id, loc_id",
    });
    this.version(2).stores({
      products: "id, code, *barcodes, style, item, item_code, color, updated_at, created_at",
    });
    this.version(3).stores({
      movements: "id, product_id, from_loc, to_loc, kind, at, updated_at, ref_bill",
      parties: "id, name, phone, kind, updated_at",
      bills: "id, no, status, bill_type, party_id, at, updated_at",
      voice_notes: "id, entity_id, updated_at",
      voice_blobs: "id, uploaded",
      config: "id, updated_at",
    });
  }
}

export const db = new RungnnaDB();

export const uid = () =>
  (crypto as any).randomUUID ? crypto.randomUUID() :
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16);
  });

export const now = () => new Date().toISOString();

export function deviceId(): string {
  try {
    let d = localStorage.getItem("rj_device");
    if (!d) { d = "D" + Math.random().toString(36).slice(2, 7).toUpperCase(); localStorage.setItem("rj_device", d); }
    return d;
  } catch { return "D-NOSTORE"; }
}

/* ---- write helpers: every write lands locally first, then queues for the cloud ---- */
type Syncable = "products" | "locations" | "movements" | "staff" | "parties" | "bills" | "voice_notes" | "config";

export async function put<T extends Row>(table: Syncable, row: T) {
  row.updated_at = now();
  await db.transaction("rw", (db as any)[table], db.outbox, async () => {
    await (db as any)[table].put(row);
    await db.outbox.add({ table, row_id: row.id, at: row.updated_at, tries: 0 });
  });
  return row;
}

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await db.settings.get(key);
  return s ? (s.value as T) : fallback;
}
export async function setSetting(key: string, value: any) {
  await db.settings.put({ key, value, updated_at: now() });
}

/* ---- stock: movements are the truth; the stock table is a fast cache of them ---- */
const cellKey = (p: string, l: string) => p + "|" + l;

async function bump(product_id: string, loc_id: string, delta: number) {
  const key = cellKey(product_id, loc_id);
  const c = await db.stock.get(key);
  await db.stock.put({ key, product_id, loc_id, qty: (c?.qty || 0) + delta });
}

export async function applyMovement(m: Movement, sign = 1) {
  if (m.deleted) return;
  if (m.from_loc) await bump(m.product_id, m.from_loc, -m.qty * sign);
  if (m.to_loc) await bump(m.product_id, m.to_loc, m.qty * sign);
}

export async function recordMovement(m: Omit<Movement, "id" | "updated_at" | "device" | "at"> & { at?: string }) {
  const row: Movement = { ...m, id: uid(), updated_at: now(), device: deviceId(), at: m.at || now() };
  await db.transaction("rw", db.movements, db.outbox, db.stock, async () => {
    await put("movements", row);
    await applyMovement(row);
  });
  return row;
}

/* rebuild the cache from scratch (after a pull from the cloud or an import) */
export async function rebuildStock() {
  await db.transaction("rw", db.stock, db.movements, async () => {
    await db.stock.clear();
    const map = new Map<string, StockCell>();
    await db.movements.each(m => {
      if (m.deleted) return;
      const add = (l: string | null, d: number) => {
        if (!l) return; const k = cellKey(m.product_id, l);
        const c = map.get(k) || { key: k, product_id: m.product_id, loc_id: l, qty: 0 };
        c.qty += d; map.set(k, c);
      };
      add(m.from_loc, -m.qty); add(m.to_loc, m.qty);
    });
    await db.stock.bulkPut([...map.values()]);
  });
}

export async function stockOf(product_id: string) {
  const cells = await db.stock.where("product_id").equals(product_id).toArray();
  return cells.filter(c => c.qty !== 0);
}
