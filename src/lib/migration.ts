import { XMLParser, XMLValidator } from "fast-xml-parser";
import readXlsxFile from "read-excel-file/browser";
import { db, put, uid, now, deviceId, applyMovement, type ImportBatch, type Party, type Product, type Movement } from "./db";
import { parseCSV, findHeader, guessMap, txt, num, balancePaise, type Kind } from "./importer";
import { blankProduct, normUnit } from "./products";
import { newParty } from "./billing";
import { currentStore, inStore, ownerOnly } from "./scope";
import { assertUnlocked } from "./finance";

export type MigrationKind = Kind | "stock";
export type Sheet = { kind: MigrationKind; headers: string[]; rows: unknown[][] };
const arr = (v: any): any[] => v === undefined ? [] : Array.isArray(v) ? v : [v];
const scalar = (v: any): string => typeof v === "object" ? txt(v?.["#text"]) : txt(v);
export function tallySheets(xml: string): Sheet[] {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("XML entities and DTDs are not supported");
  const valid = XMLValidator.validate(xml); if (valid !== true) throw new Error("Invalid Tally XML");
  const root = new XMLParser({ ignoreAttributes: false, parseTagValue: false }).parse(xml);
  const items: any[] = [], ledgers: any[] = [];
  const walk = (node: any) => { if (!node || typeof node !== "object") return; for (const [k, v] of Object.entries(node)) { if (k === "STOCKITEM") items.push(...arr(v)); else if (k === "LEDGER") ledgers.push(...arr(v)); else arr(v).forEach(walk); } }; walk(root);
  const sheets: Sheet[] = [];
  const itemRows: unknown[][] = [], stockRows: unknown[][] = [];
  for (const p of items) {
    const name = scalar(p["@_NAME"] || p.NAME), code = scalar(p["MAILINGNAME.LIST"]?.MAILINGNAME || p.ARTICLENUMBER || p.ALIAS) || name;
    const qty = scalar(p.OPENINGBALANCE), rate = scalar(p.OPENINGRATE || p.STANDARDPRICE);
    const numeric = (s: string) => Number(s.match(/-?\d[\d,]*(?:\.\d+)?/)?.[0].replace(/,/g, "") || 0);
    const hsn = scalar(arr(p["GSTDETAILS.LIST"])[0]?.HSNCODE || p.HSNCODE);
    itemRows.push([code, name, scalar(p.BASEUNITS), numeric(rate), hsn, scalar(p.PARENT)]);
    const allocations = arr(p["BATCHALLOCATIONS.LIST"]);
    if (allocations.length) allocations.forEach(a => stockRows.push([code, name, scalar(a.GODOWNNAME) || "OPENING", numeric(scalar(a.OPENINGBALANCE || a.ACTUALQTY))]));
    else if (numeric(qty)) stockRows.push([code, name, "OPENING", numeric(qty)]);
  }
  if (itemRows.length) sheets.push({ kind: "products", headers: ["Item code", "Item name", "Unit", "Rate", "HSN", "Category"], rows: itemRows });
  const partyRows = ledgers.filter(p => /sundry\s*(debtors|creditors)/i.test(scalar(p.PARENT))).map(p => [scalar(p["@_NAME"] || p.NAME), scalar(p.LEDGERPHONE || p.LEDGERMOBILE), scalar(p.PARTYGSTIN), arr(p["ADDRESS.LIST"]?.ADDRESS).map(scalar).join(", "), scalar(p.STATENAME), scalar(p.PINCODE), /creditors/i.test(scalar(p.PARENT)) ? "supplier" : "customer", (/creditors/i.test(scalar(p.PARENT)) ? 1 : -1) * Math.round(num(p.OPENINGBALANCE) * 100) / 100]);
  if (partyRows.length) sheets.push({ kind: "parties", headers: ["Name", "Phone", "GSTIN", "Address", "State", "PIN", "Kind", "Opening balance"], rows: partyRows });
  if (stockRows.length) sheets.push({ kind: "stock", headers: ["Item code", "Item name", "Rack", "Qty"], rows: stockRows });
  if (!sheets.length) throw new Error("No stock items or customer/supplier ledgers found in Tally XML");
  return sheets;
}
export async function readSheetFile(file: File): Promise<unknown[][]> {
  if (/\.xlsx$/i.test(file.name)) { const sheets = await readXlsxFile(file); return sheets[0]?.data || []; }
  if (/\.xls$/i.test(file.name)) throw new Error("Save the legacy .xls file as .xlsx or CSV first");
  return parseCSV(await file.text());
}
export async function loadMigration(file: File, kind: MigrationKind): Promise<Sheet[]> {
  if (/\.xml$/i.test(file.name)) return tallySheets(await file.text());
  const rows = await readSheetFile(file), i = findHeader(rows, kind === "parties" ? "parties" : "products");
  return [{ kind, headers: rows[i]?.map(txt) || [], rows: rows.slice(i + 1) }];
}
export function migrationMap(sheet: Sheet) {
  const map = guessMap(sheet.headers, sheet.kind === "parties" ? "parties" : "products");
  const rack = sheet.headers.findIndex(x => /^(rack|godown|location|warehouse)$/i.test(x)); if (rack >= 0) map.rack = rack;
  const pin = sheet.headers.findIndex(x => /^(pin|pincode|postalcode)$/i.test(x)); if (pin >= 0) map.pin = pin;
  return map;
}
export type MappedSheet = Sheet & { map: Record<string, number>; rack?: string };
export function mappedRows(sheet: MappedSheet) { return sheet.rows.filter(r => r.some(v => txt(v))).map(r => Object.fromEntries(Object.entries(sheet.map).map(([k, i]) => [k, r[i]]))); }
const productKey = (r: any) => txt(r.item_code).toUpperCase() || [txt(r.item), txt(r.style), txt(r.color)].join("|").toUpperCase();
export async function migrationPreview(sheets: MappedSheet[]) {
  const products = (await db.products.toArray()).filter(p => !p.deleted), parties = (await db.parties.toArray()).filter(p => !p.deleted);
  const seen = new Set<string>(); const issues: string[] = []; let added = 0, updated = 0;
  for (const sheet of sheets) for (const [i, r] of mappedRows(sheet).entries()) {
    const key = sheet.kind === "parties" ? txt(r.name).toUpperCase() : productKey(r);
    const signature = `${sheet.kind}:${key}${sheet.kind === "stock" ? ":" + txt(r.rack || sheet.rack) : ""}`;
    if (!key || key === "||") issues.push(`${sheet.kind} row ${i + 1}: missing item code/name`);
    if (seen.has(signature)) issues.push(`${sheet.kind} row ${i + 1}: duplicate ${key}`); seen.add(signature);
    if ((sheet.kind === "stock" || (sheet.kind === "products" && num(r.qty) > 0)) && (!txt(r.rack || sheet.rack) || !Number.isInteger(num(r.qty)) || num(r.qty) < 0)) issues.push(`Stock row ${i + 1}: choose rack and whole non-negative quantity`);
    const old = sheet.kind === "parties" ? parties.find(p => p.name.toUpperCase() === key && p.kind === (/sup|creditor|vendor/i.test(txt(r.kind)) ? "supplier" : "customer")) : products.find(p => productKey(p) === key);
    old ? updated++ : added++;
  }
  return { issues, added, updated };
}
export async function importMigration(sheets: MappedSheet[], filename: string, by: string) {
  ownerOnly(); await assertUnlocked(now());
  return db.transaction("rw", [db.products, db.parties, db.locations, db.movements, db.stock, db.import_batches, db.config, db.outbox], async () => {
    const preview = await migrationPreview(sheets); if (preview.issues.length) throw new Error(preview.issues.join("; "));
    const batch: ImportBatch = { id: uid(), filename, at: now(), by_staff: by, store_id: currentStore(), updated_at: now(), changes: [] };
    const write = async (table: ImportBatch["changes"][number]["table"], row: any) => { const before = await db.table(table).get(row.id); await put(table, row); batch.changes.push({ table, id: row.id, before, after: structuredClone(row) }); };
    const products = (await db.products.toArray()).filter(p => !p.deleted), parties = (await db.parties.toArray()).filter(p => !p.deleted);
    const stockSheets: MappedSheet[] = [];
    for (const sheet of sheets) {
      if (sheet.kind === "stock") { stockSheets.push(sheet); continue; }
      for (const r of mappedRows(sheet)) {
        if (sheet.kind === "parties") {
          const kind = /sup|creditor|vendor/i.test(txt(r.kind)) ? "supplier" : "customer";
          const old = parties.find(p => p.name.toUpperCase() === txt(r.name).toUpperCase() && p.kind === kind);
          const p: Party = { ...(old || newParty()), name: txt(r.name), kind, phone: txt(r.phone), gstin: txt(r.gstin).toUpperCase(), address: txt(r.address), city: txt(r.city), state: txt(r.state), pin: txt(r.pin), opening_balance: balancePaise(r.opening_balance) };
          await write("parties", p); if (!old) parties.push(p);
        } else {
          const key = productKey(r), old = products.find(p => productKey(p) === key), p: Product = { ...(old || blankProduct(by)), item_code: txt(r.item_code), item: txt(r.item), style: txt(r.style), color: txt(r.color), type: normUnit(r.unit) || "PCS", rate: Math.round(num(r.rate) * 100), category: txt(r.category), hsn: txt(r.hsn), vendor_design_code: txt(r.vendor_design_code), material: txt(r.material), collection: txt(r.collection) };
          for (const k of ["cost", "mrp", "wholesale_rate", "retail_rate"] as const) if (r[k] !== undefined) p[k] = Math.round(num(r[k]) * 100);
          await write("products", p); if (!old) products.push(p);
          if (r.qty !== undefined && num(r.qty) > 0) stockSheets.push({ kind: "stock", headers: [], rows: [[p.item_code || p.code, txt(r.rack) || sheet.rack, r.qty]], map: { item_code: 0, rack: 1, qty: 2 } });
        }
      }
    }
    for (const sheet of stockSheets) for (const r of mappedRows(sheet)) {
      const p = products.find(p => productKey(p) === productKey(r) || p.code === txt(r.item_code) || (!!txt(r.item) && p.item.toUpperCase() === txt(r.item).toUpperCase()));
      if (!p) throw new Error("Opening stock item not found: " + productKey(r));
      const rack = txt(r.rack || sheet.rack), existing = await db.locations.filter(l => !l.deleted && inStore(l) && (l.id === rack || l.code === rack || l.name === rack)).first();
      const l = existing || { id: uid(), code: currentStore().slice(-6) + "/" + rack, name: rack, floor: "", rack, box: "", kind: "rack" as const, store_id: currentStore(), updated_at: now() };
      if (!existing) await write("locations", l);
      const qty = num(r.qty); if (!Number.isInteger(qty) || qty < 0) throw new Error("Opening quantities must be whole non-negative pieces"); if (!qty) continue;
      const m: Movement = { id: uid(), product_id: p.id, kind: "intake", qty, from_loc: null, to_loc: l.id, person_type: "owner", person_name: "Opening stock", by_staff: by, note: "Import " + batch.id, at: batch.at, device: deviceId(), store_id: currentStore(), updated_at: now() };
      await write("movements", m); await applyMovement(m);
    }
    await put("import_batches", batch); return batch;
  });
}
export async function undoMigration() {
  ownerOnly();
  await assertUnlocked(now());
  return db.transaction("rw", [db.products, db.parties, db.locations, db.movements, db.stock, db.import_batches, db.config, db.bills, db.receipts, db.vouchers, db.purchases, db.outbox], async () => {
    const batch = (await db.import_batches.filter(b => inStore(b) && !b.deleted).sortBy("at")).slice(-1)[0]; if (!batch || batch.undone) throw new Error("No import to undo");
    await assertUnlocked(batch.at);
    const ids = new Set(batch.changes.map(c => c.id));
    const laterMoves = await db.movements.filter(m => !m.deleted && !ids.has(m.id) && m.at >= batch.at && (ids.has(m.product_id) || ids.has(m.from_loc || "") || ids.has(m.to_loc || ""))).count();
    const laterBills = await db.bills.filter(b => !b.deleted && b.at >= batch.at && (ids.has(b.party_id || "") || b.items.some(l => ids.has(l.product_id || "")))).count();
    const laterMoney = await db.receipts.filter(r => !r.deleted && r.at >= batch.at && ids.has(r.party_id)).count() + await db.vouchers.filter(v => !v.deleted && v.at >= batch.at && ids.has(v.party_id || "")).count();
    const laterPurchases = await db.purchases.filter(p => !p.deleted && p.at >= batch.at && (ids.has(p.supplier_id || "") || p.items.some(l => ids.has(l.product_id)))).count();
    if (laterMoves || laterBills || laterMoney || laterPurchases) throw new Error("Imported records have been used since import; undo is unavailable");
    for (const change of [...batch.changes].reverse()) {
      const current = await db.table(change.table).get(change.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(change.after)) throw new Error("An imported record changed after import; undo is unavailable");
      if (change.table === "movements") await applyMovement(current, -1);
      await put(change.table, change.before ? { ...change.before } : { ...current, deleted: 1 });
    }
    await put("import_batches", { ...batch, undone: true }); return batch;
  });
}
