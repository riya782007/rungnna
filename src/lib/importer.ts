/* Bring the old software's lists across: items, customers, opening stock.
   Works with the Excel (.xlsx) or CSV export of any billing software — columns are matched by name. */

export type Kind = "products" | "parties";
export const FIELDS: Record<Kind, { key: string; label: string; syn: string[] }[]> = {
  products: [
    { key: "item_code", label: "Item code", syn: ["itemcode", "icode", "itemno", "code", "itemid", "barcode"] },
    { key: "item", label: "Item name", syn: ["item", "itemname", "product", "productname", "name", "description", "itemdescription"] },
    { key: "style", label: "Style / design", syn: ["style", "styleno", "design", "designno", "model", "article", "artno", "articleno"] },
    { key: "color", label: "Colour", syn: ["color", "colour", "clr", "shade"] },
    { key: "rate", label: "Sale rate", syn: ["rate", "salerate", "saleprice", "sellingprice", "price", "srate", "sp", "wholesalerate"] },
    { key: "mrp", label: "MRP", syn: ["mrp"] },
    { key: "cost", label: "Cost", syn: ["cost", "purchaserate", "prate", "purchaseprice", "cp", "costprice"] },
    { key: "pack", label: "Pieces per packet", syn: ["pack", "packing", "pcsperpacket", "qtyperpack", "pcspkt", "packsize", "set"] },
    { key: "qty", label: "Stock (pieces)", syn: ["qty", "stock", "closingstock", "balanceqty", "quantity", "closingqty", "balance", "stockqty"] },
    { key: "category", label: "Category / group", syn: ["category", "group", "itemgroup", "type"] },
    { key: "tk", label: "TK (dead)", syn: ["tk", "dead"] },
  ],
  parties: [
    { key: "name", label: "Name", syn: ["name", "partyname", "customername", "customer", "party", "accountname", "ledgername", "firm"] },
    { key: "phone", label: "Mobile", syn: ["mobile", "phone", "mobileno", "phoneno", "contact", "contactno", "whatsapp", "mob"] },
    { key: "city", label: "City", syn: ["city", "town", "place", "station"] },
    { key: "state", label: "State", syn: ["state"] },
    { key: "gstin", label: "GSTIN", syn: ["gstin", "gst", "gstno", "gstnumber"] },
    { key: "address", label: "Address", syn: ["address", "addr", "address1"] },
    { key: "opening_balance", label: "Balance due (₹)", syn: ["balance", "openingbalance", "closingbalance", "due", "outstanding", "amount", "opbal", "clbal"] },
  ],
};

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/* Guess which column is which. Exact synonym first, then "header contains synonym". Each column used once. */
export function guessMap(headers: string[], kind: Kind): Record<string, number> {
  const h = headers.map(norm), used = new Set<number>(), out: Record<string, number> = {};
  for (const pass of [0, 1]) for (const f of FIELDS[kind]) {
    if (out[f.key] !== undefined) continue;
    const i = h.findIndex((x, j) => !used.has(j) && x && f.syn.some(s => (pass === 0 ? x === s : x.includes(s))));
    if (i >= 0) { out[f.key] = i; used.add(i); }
  }
  return out;
}

/* Small, forgiving CSV reader (quotes, commas inside quotes, CRLF). */
export function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = [], cur = "", q = false;
  const t = text.replace(/^﻿/, "");
  const sep = (t.split("\n")[0].match(/;/g)?.length || 0) > (t.split("\n")[0].match(/,/g)?.length || 0) ? ";" : ",";
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; continue; }
    if (c === '"') q = true;
    else if (c === sep) { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); rows.push(row); row = []; cur = ""; }
    else cur += c;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => String(x).trim()));
}

/* The header row is the first row with at least two recognisable column names (exports often start with a title). */
export function findHeader(rows: unknown[][], kind: Kind): number {
  for (let i = 0; i < Math.min(rows.length, 15); i++) if (Object.keys(guessMap(rows[i].map(String), kind)).length >= 2) return i;
  return 0;
}

export const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[₹,\s]/g, "").replace(/\((.*)\)/, "-$1")); return Number.isFinite(n) ? n : 0; };
export const txt = (v: unknown) => String(v ?? "").trim();

/* "1,234.50 Dr" → +123450 paise (they owe us); "Cr" → negative */
export function balancePaise(v: unknown) {
  const s = String(v ?? "").trim(); const n = Math.round(num(s.replace(/\s*(dr|cr)\.?$/i, "")) * 100);
  return /cr\.?$/i.test(s) ? -Math.abs(n) : n;
}
