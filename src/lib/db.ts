import type { ListingContent } from "../../api/_listing";
import Dexie, { type Table } from "dexie";
import { currentStore, inStore } from "./scope";

/* Money is always integer paise. Every row id is a client-made UUID so any
   device can create records offline without ever colliding with another. */

export type Row = { id: string; updated_at: string; deleted?: 0 | 1; store_id?: string };

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
  sold_tags?: Record<string, string>; // RFID tag (also in barcodes) → bill no. it left on
  cost?: number;           // last purchase cost per piece, paise (owner/manager only)
  vendor_design_code?: string;
  collection?: string;
  material?: string;
  hsn?: string;
  gst_rate?: number;       // % — only if this product is taxed differently from the shop rate (blank = shop rate)
  wholesale_rate?: number; // paise
  retail_rate?: number;    // paise
  /* --- product-master keying & pricing (spec: SKU/Model + Vendor) --- */
  model?: string;          // vendor's model / article number (may differ from our style)
  vendor_id?: string;      // Party id (kind:"supplier") this piece was bought from
  vendor_name?: string;    // denormalised for offline display / labels
  cost_code?: string;      // encrypted cost code printed on the label (from lib/pricing)
  price_locked?: 0 | 1;    // 1 = rate/cost_code were set by hand, don't overwrite from the rule
  size?: string;           // size / measurement option (e.g. 2.4, Free size)
  pro_photo_id?: string;   // polished catalogue image (local); replaces raw for the catalogue
  pro_photo_url?: string;  // cloud copy of the polished catalogue image
  catalogue?: 0 | 1;       // 1 = published to the shareable catalogue
  slug?: string;           // public page address: /p/<slug>
  content?: ListingContent; // AI-written product page (retail + trade + catalogue), see api/_listing.ts
  /* --- image recognition (hybrid matching) --- */
  embedding?: number[];    // visual feature vector for photo search (unit-normalised)
  embedding_dim?: number;  // length of the vector, so a model change can be detected
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
  opening_balance?: number; // paise they owed before this system (+) or we owed them (−)
}

/* Money received from a customer outside a bill. Spread over their oldest dues automatically. */
export interface Receipt extends Row {
  no: string; party_id: string; party_name: string; amount: number; mode: Payment["mode"]; note: string;
  allocations: { bill_id: string; bill_no: string; amount: number }[]; opening_part: number; unallocated: number;
  device: string; by_staff: string; at: string;
}

export interface BillLine {
  hsn?: string;
  gst_rate?: number;       // % override for this line; unset = the bill's rate
  taxable?: number; tax?: number;  // set by totals() only when the bill mixes GST rates (paise)
  id: string; product_id?: string; code: string; item: string; type: string; style: string; color: string;
  box_no: number; pack: number; pkts: number; qty: number; rate: number; disc: string; amount: number;
  stock_done?: 1;          // these pieces already left the racks on another document (merged / challan / split)
  src_line?: string;       // credit note: the line of the original bill being returned
}
export interface Payment { mode: "cash" | "upi" | "card" | "bank" | "credit"; amount: number; ref?: string; at?: string }
/* gst = tax invoice · estimate = private bill · challan = delivery challan (goods out, no money) · return = credit note */
export type BillType = "gst" | "estimate" | "challan" | "return";
export type BillStatus = "hold" | "final" | "void" | "converted" | "merged";

export interface Bill extends Row {
  transport?: Transport;
  compliance?: Compliance;
  oversold?: { product_id: string; item: string; qty: number }[];   // pieces sold beyond the recorded rack stock — recount these
  no: string; series: string; bill_type: BillType; status: BillStatus;
  party_id?: string; party_name: string; party_phone: string; party_gstin: string; party_state: string;
  price_level?: "wholesale" | "retail" | "dealer";
  salesman: string; box_count: number; total_qty: number;
  gross: number; discount: number; discount_pct: number; packing: number; adjust: number;
  gst_mode: "exclusive" | "inclusive"; gst_rate: number; gst: number; cgst: number; sgst: number; igst: number;
  net: number; advance: number; paid: number;
  remarks: string; payments: Payment[]; items: BillLine[];
  photo_id?: string; photo_url?: string; voice_id?: string;
  converted_from?: string; converted_to?: string; void_reason?: string;
  rfid_tags?: string[];    // RFID tags read onto this bill — each counts once, marked sold on save
  merged_into?: string; merged_into_no?: string; // this bill/challan was combined into another invoice
  merged_from?: string[];  // the bills / challans this invoice was made from
  return_of?: string; return_of_no?: string;     // credit note: the bill the goods came back from
  src_type?: BillType;     // credit note: type of that bill (an estimate's return stays private)
  device: string; by_staff: string; at: string;
}

/* Stock coming in: from a supplier bill, or just a counting session into a rack. */
export interface PurchaseLine { id: string; product_id: string; code: string; item: string; style: string; color: string; pack: number; pkts: number; qty: number; cost: number; rate: number; isNew?: boolean }
export interface Purchase extends Row {
  invoice_total?: number; // supplier payable, including reviewed tax/freight/discount
  no: string; status: "draft" | "final"; supplier_id?: string; supplier_name: string; supplier_bill: string; loc_id: string;
  items: PurchaseLine[]; total_qty: number; total_cost: number; note: string; photo_id?: string; photo_url?: string;
  rfid_tags?: string[];    // RFID tags read in this stock-in — each counts once
  device: string; by_staff: string; at: string;
}

export interface PurchaseReturnLine { id: string; product_id: string; code: string; item: string; style: string; color: string; qty: number; cost: number; loc_id: string }
export interface PurchaseReturn extends Row {
  no: string; series: string; supplier_id?: string; supplier_name: string; purchase_id?: string; purchase_no?: string;
  items: PurchaseReturnLine[]; total_qty: number; total_cost: number; note: string; device: string; by_staff: string; at: string;
}

export type VoucherType = "payment" | "receipt" | "expense" | "journal";
export type MoneyMode = "cash" | "upi" | "card" | "bank" | "cheque" | "credit";
export type ExpenseCategory = "rent" | "salary" | "electricity" | "transport" | "tea" | "other";
export interface Voucher extends Row {
  ref?: string;
  no: string; series: string; type: VoucherType; at: string; mode: MoneyMode; amount: number;
  party_id?: string; party_name?: string; party_kind?: Party["kind"]; category?: ExpenseCategory; note: string;
  debit_account?: string; credit_account?: string; device: string; by_staff: string;
}

export interface FiscalYearClose extends Row {
  fy: string; closed_upto: string; customer_balances: Record<string, number>; supplier_balances: Record<string, number>;
  device: string; by_staff: string; at: string;
}

export interface VoiceNote extends Row {
  entity: string; entity_id: string; seconds: number; transcript: string; url?: string; by_staff: string; at: string;
}
/* shop-wide settings that every device must share (name, GSTIN, UPI…) */
export interface Config extends Row { value: any }
export interface VoiceBlob { id: string; blob: Blob; uploaded: 0 | 1; url?: string; created_at: string }

export interface Staff extends Row {
  auth_user_id?: string;
  name: string;
  role: "owner" | "manager" | "salesman" | "helper" | "packer" | "cashier";
  phone: string;
  pin: string;             // 4-digit, hashed later when auth moves server-side
  active: 0 | 1;
}

export interface Setting { key: string; value: any; updated_at: string }
export interface Photo { id: string; blob: Blob; w: number; h: number; bytes: number; url?: string; uploaded: 0 | 1; created_at: string }
export interface Outbox { seq?: number; table: string; row_id: string; at: string; tries: number; last_error?: string }
export interface StockCell { key: string; product_id: string; loc_id: string; qty: number; store_id?: string }

export interface Transport { vehicle_no: string; transporter_id: string; transporter_name: string; distance: number; mode: "1" | "2" | "3" | "4"; doc_no?: string; doc_date?: string; from_city: string; from_pin: string; to_address: string; to_city: string; to_pin: string; to_state_code: string }
export interface ComplianceRecord { id: string; generated_at: string; ack_no?: string; signed_qr?: string; cancelled_at?: string; sandbox: boolean }
export interface Compliance { irn?: ComplianceRecord; ewb?: ComplianceRecord }
export interface Store extends Row { name: string; code: string; address: string; active: 0 | 1 }
export interface StoreTransfer extends Row { no: string; from_store: string; to_store: string; status: "in_transit" | "received"; items: { product_id: string; qty: number; from_loc: string; to_loc?: string; tags?: string[] }[]; by_staff: string; received_by?: string; at: string; received_at?: string; device: string }
export interface BankLine extends Row { account: string; fingerprint: string; date: string; narration: string; debit: number; credit: number; ref: string; match_key?: string; matched_at?: string; batch: string }
export interface ImportBatch extends Row { filename: string; at: string; by_staff: string; undone?: boolean; changes: { table: "products" | "parties" | "locations" | "movements"; id: string; before?: any; after: any }[] }

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
  receipts!: Table<Receipt, string>;
  purchases!: Table<Purchase, string>;
  purchase_returns!: Table<PurchaseReturn, string>;
  vouchers!: Table<Voucher, string>;
  fiscal_year_closes!: Table<FiscalYearClose, string>;
  stores!: Table<Store, string>;
  store_transfers!: Table<StoreTransfer, string>;
  bank_lines!: Table<BankLine, string>;
  import_batches!: Table<ImportBatch, string>;

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
    this.version(4).stores({ receipts: "id, party_id, at, updated_at" });
    this.version(5).stores({ purchases: "id, no, status, supplier_id, at, updated_at" });
    // v6: product-master keying on model / vendor for the SKU+Vendor lookup, and
    // the new pricing/vision fields (embedding is not indexed — scanned in memory).
    this.version(6).stores({
      products: "id, code, *barcodes, style, item, item_code, color, model, vendor_id, updated_at, created_at",
    });
    // credit notes find their bill, merged sources find their invoice
    this.version(7).stores({ bills: "id, no, status, bill_type, party_id, at, updated_at, return_of, merged_into" });
    this.version(8).stores({
      products: "id, code, *barcodes, style, item, item_code, color, model, vendor_id, vendor_design_code, collection, material, hsn, updated_at, created_at",
      vouchers: "id, no, type, party_id, party_kind, category, at, updated_at",
      purchase_returns: "id, no, supplier_id, purchase_id, at, updated_at",
      fiscal_year_closes: "id, fy, closed_upto, at, updated_at",
    });
    this.version(9).stores({
      stores: "id, &code, updated_at",
      store_transfers: "id, no, from_store, to_store, status, at, updated_at",
      bank_lines: "id, account, &fingerprint, match_key, date, updated_at",
      import_batches: "id, at, updated_at",
      locations: "id, &code, store_id, floor, updated_at",
      bills: "id, no, store_id, status, bill_type, party_id, at, updated_at, return_of, merged_into",
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

const memDevice = "D" + Math.random().toString(36).slice(2, 7).toUpperCase();   // only used if localStorage is blocked
export function deviceId(): string {
  try {
    let d = localStorage.getItem("rj_device");
    if (!d) { d = "D" + Math.random().toString(36).slice(2, 7).toUpperCase(); localStorage.setItem("rj_device", d); }
    return d;
  } catch { return memDevice; }
}

/* ---- write helpers: every write lands locally first, then queues for the cloud ---- */
export type Syncable = "products" | "locations" | "movements" | "staff" | "parties" | "bills" | "voice_notes" | "config" | "receipts" | "purchases" | "purchase_returns" | "vouchers" | "fiscal_year_closes" | "stores" | "store_transfers" | "bank_lines" | "import_batches";
const STORE_TABLES = new Set(["locations", "movements", "staff", "bills", "receipts", "purchases", "purchase_returns", "vouchers", "bank_lines", "import_batches"]);

export async function put<T extends Row>(table: Syncable, row: T) {
  if (STORE_TABLES.has(table)) row.store_id ||= currentStore();
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
  await db.transaction("rw", [db.movements, db.outbox, db.stock, db.locations], async () => {
    if (!Number.isInteger(row.qty) || row.qty <= 0) throw new Error("Quantity must be positive whole pieces");
    for (const id of [row.from_loc, row.to_loc].filter(Boolean)) { const l = await db.locations.get(id!); if (!l || !inStore(l)) throw new Error("Rack belongs to another store"); }
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
  const locs = new Set((await db.locations.filter(l => inStore(l) && !l.deleted).toArray()).map(l => l.id));
  const cells = await db.stock.where("product_id").equals(product_id).toArray();
  return cells.filter(c => c.qty !== 0 && locs.has(c.loc_id));
}
