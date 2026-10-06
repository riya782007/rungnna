import { db, uid, setSetting, type Product, type Purchase } from "./db";
import { blankProduct, findByKey, saveProduct } from "./products";
import { newPurchase, lineOf, finalizePurchase } from "./stockin";
import { moneyInput } from "./pos";
import { ownerOnly } from "./scope";
import { getRule, priceFromCost, type PricingRule } from "./pricing";

export type PhotoRow = { item: string; style: string; color: string; unit: string; hsn: string; qty: string; cost: string; rate: string };
export function pricePhotoRows(rows: PhotoRow[], rule: PricingRule): PhotoRow[] {
  return rows.map(r => {
    if (r.rate.trim() || !r.cost.trim() || !/^(PCS|PAIR|SET)$/i.test(r.unit.trim())) return r;
    try {
      const cost = moneyInput(r.cost);
      if (cost <= 0) return r;
      return { ...r, rate: (priceFromCost(cost, rule, 1, r.unit).rate / 100).toFixed(2) };
    } catch { return r; }
  });
}
export function validatePhotoRows(rows: PhotoRow[]) {
  if (!rows.length || rows.length > 300) throw new Error("Review 1–300 purchase lines");
  return rows.map((r, i) => {
    const qty = Number(r.qty);
    if (!r.item.trim() || !r.style.trim()) throw new Error(`Line ${i + 1}: enter product name and article/style`);
    if (!Number.isSafeInteger(qty) || qty < 1 || qty > 1000000) throw new Error(`Line ${i + 1}: quantity must be a positive whole number`);
    if (!r.cost.trim() || !r.rate.trim()) throw new Error(`Line ${i + 1}: review cost and selling rate`);
    const cost = moneyInput(r.cost), rate = moneyInput(r.rate);
    if (cost <= 0 || rate <= 0) throw new Error(`Line ${i + 1}: enter positive cost and selling rate`);
    if (!Number.isSafeInteger(qty * cost)) throw new Error("Purchase amount is too large");
    if (!/^(PCS|PAIR|SET)$/i.test(r.unit)) throw new Error(`Line ${i + 1}: convert dozen/box/packet to PCS, PAIR or SET before saving`);
    if (r.hsn && !/^\d{4,8}$/.test(r.hsn)) throw new Error(`Line ${i + 1}: check HSN`);
    return { ...r, qty, cost, rate };
  });
}

export async function savePhotoPurchase(rows: PhotoRow[], input: { by: string; rack: string; supplierId: string; billNo: string; photoId?: string; note: string; invoiceTotal?: string }): Promise<Purchase> {
  ownerOnly();
  const checked = validatePhotoRows(rows);
  if (checked.reduce((n, r) => n + r.qty, 0) > 5000) throw new Error("Purchase exceeds the 5000-label batch limit. Split it before saving.");
  const invoice_total = input.invoiceTotal?.trim() ? moneyInput(input.invoiceTotal) : undefined;
  if (invoice_total !== undefined && invoice_total <= 0) throw new Error("Check supplier invoice total");
  return db.transaction("rw", [db.products, db.purchases, db.parties, db.movements, db.stock, db.outbox, db.settings, db.config, db.locations, db.stores], async () => {
    const supplier = await db.parties.get(input.supplierId);
    if (!supplier || supplier.deleted || supplier.kind !== "supplier") throw new Error("Choose a supplier account");
    if (!input.billNo.trim()) throw new Error("Enter supplier bill number");
    if (await db.purchases.filter(p => !p.deleted && p.status === "final" && p.supplier_id === supplier.id && p.supplier_bill.trim().toUpperCase() === input.billNo.trim().toUpperCase()).count()) throw new Error("This supplier bill is already saved");
    const purchase = { ...newPurchase(input.by, input.rack), supplier_id: supplier.id, supplier_name: supplier.name, supplier_bill: input.billNo.trim(), photo_id: input.photoId, note: input.note, ...(invoice_total !== undefined ? { invoice_total } : {}) };
    const rule = await getRule();
    const seen = new Set<string>();
    for (const row of checked) {
      const key = [row.style.trim().toUpperCase(), row.color.trim().toUpperCase()].join("|");
      if (seen.has(key)) throw new Error("Repeated article/colour: combine its quantities before saving");
      seen.add(key);
      const old = await findByKey({ model: row.style, style: row.style, color: row.color, vendor_id: supplier.id });
      if (old && old.type !== row.unit.toUpperCase()) throw new Error("Unit differs from the existing article. Review before saving.");
      const code = priceFromCost(row.cost, rule, old?.pack || 1, row.unit).cost_code;
      const p: Product = old ? { ...old, item: row.item, hsn: row.hsn || old.hsn, cost: row.cost, rate: row.rate, price_locked: 1, cost_code: code } : { ...blankProduct(input.by), item: row.item, style: row.style, model: row.style, color: row.color, type: row.unit, hsn: row.hsn, rate: row.rate, cost: row.cost, cost_code: code, price_locked: 1, vendor_id: supplier.id, vendor_name: supplier.name, pack: 1 };
      const saved = await saveProduct(p);
      purchase.items.push({ ...lineOf(saved, !old), id: uid(), qty: row.qty, pkts: 0, pack: 1, cost: row.cost });
    }
    const saved = await finalizePurchase(purchase);
    await setSetting("purchase_photo_draft", null);
    return saved;
  });
}
