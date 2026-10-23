import "fake-indexeddb/auto";
import { beforeEach, expect, it } from "vitest";
import { db, uid } from "../src/lib/db";
import { blankProduct } from "../src/lib/products";
import { customerProfit } from "../src/lib/customerProfit";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { setOwnerOpen } from "../src/lib/privacy";

beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); setOwnerOpen(true); });
const bill = (at: string, qty: number, rate: number, pid: string, extra: any = {}) => ({ id: uid(), no: "INV/" + at, bill_type: "gst", status: "final", party_id: "c", at, store_id: MAIN_STORE,
  items: [{ id: uid(), product_id: pid, item: "SET", qty, rate, amount: qty * rate }], net: Math.round(qty * rate * 1.03), gst: Math.round(qty * rate * 0.03), updated_at: at, ...extra }) as any;

it("works out his profit, how often he comes and what to do", async () => {
  const p = { ...blankProduct("o"), item: "SET", cost: 10000 };
  await db.products.put(p);
  await db.bills.bulkPut([bill("2026-08-01T10:00:00Z", 10, 20000, p.id), bill("2026-08-11T10:00:00Z", 5, 20000, p.id), bill("2026-08-21T10:00:00Z", 5, 20000, p.id)]);
  const r = await customerProfit("c", 50000, Date.parse("2026-10-24T10:00:00Z"));
  expect(r.sales).toBe(400000); expect(r.cost).toBe(200000); expect(r.profit).toBe(200000); expect(r.margin).toBe(50);
  expect(r.everyDays).toBe(10);
  expect(r.advice.join(" ")).toMatch(/call him today/);
  expect(r.advice.join(" ")).toMatch(/owes ₹500/);
  expect(r.items[0]).toMatchObject({ name: "SET", qty: 20 });
});
