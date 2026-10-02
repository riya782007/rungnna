import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type Product, type Party } from "../src/lib/db";
import { lineFrom, DEFAULT_SHOP, newBill, finalize } from "../src/lib/billing";
import { eodReport } from "../src/lib/eod";
import { localDay } from "../src/lib/ledger";
import { supplierAging, supplierLedger } from "../src/lib/suppliers";
import { saveVoucher } from "../src/lib/vouchers";
import { reportData } from "../src/lib/reports";

const product: Product = { id: "p1", code: "P1", barcodes: ["P1"], item: "CHAIN", type: "PCS", style: "K1", color: "G", tk: "", rate: 10000,
  wholesale_rate: 10000, retail_rate: 18000, mrp: 20000, category: "", notes: "", cost: 4000, hsn: "7117", created_by: "t", created_at: "", updated_at: "" };
const supplier: Party = { id: "s1", kind: "supplier", name: "SUP", alt_name: "", phone: "", gstin: "", address: "", city: "", state: "", pin: "",
  tier: "wholesale", credit_limit: 0, notes: "", opening_balance: 10000, updated_at: "" };

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear()));
  await db.products.put(product);
  await db.parties.put(supplier);
});

describe("phase 2 finance", () => {
  it("billing picks customer price level", () => {
    expect(lineFrom(product, 1, 1, "wholesale").rate).toBe(10000);
    expect(lineFrom(product, 1, 1, "retail").rate).toBe(18000);
  });

  it("supplier ledger combines purchase bills and payment vouchers", async () => {
    await db.purchases.put({ id: "pi1", no: "PI/1", status: "final", supplier_id: "s1", supplier_name: "SUP", supplier_bill: "A1", loc_id: "r1",
      items: [], total_qty: 10, total_cost: 50000, note: "", device: "d", by_staff: "t", at: "2026-06-01T00:00:00.000Z", updated_at: "" });
    await saveVoucher({ type: "payment", party: supplier, amount: 20000, mode: "cash", by: "t", at: "2026-06-10T00:00:00.000Z" });
    const led = await supplierLedger(supplier);
    expect(led.balance).toBe(40000);
    const aging = await supplierAging("2026-07-15");
    expect(aging.get("s1")!.d31_60).toBeGreaterThan(0);
  });

  it("vouchers feed end of day cash", async () => {
    const day = localDay(new Date().toISOString());
    const v = await saveVoucher({ type: "expense", amount: 2500, mode: "cash", category: "tea", by: "t" });
    const r = eodReport([], [], day, 10000, true, [v]);
    expect(r.cashOut).toBe(2500);
    expect(r.closing).toBe(7500);
  });

  it("reports exclude estimates unless private estimates are open", async () => {
    await db.locations.put({ id: "r1", code: "R1", floor: "", rack: "", box: "", name: "", kind: "rack", updated_at: "" });
    await db.stock.put({ key: "p1|r1", product_id: "p1", loc_id: "r1", qty: 5 });
    const b = { ...newBill("t", DEFAULT_SHOP, "gst"), items: [lineFrom(product, 1, 1, "wholesale")] };
    await finalize(b, "");
    const data = await reportData({ from: "2026-01-01", to: "2099-01-01" });
    expect(data.byItem[0].sales).toBeGreaterThan(0);
  });
});

