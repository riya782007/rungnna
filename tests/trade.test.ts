import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { db, now, type Dealer, type TradeOrder } from "../src/lib/db";
import { blankProduct } from "../src/lib/products";
import { orderToBill, refreshOrderStatus, setDealerStatus } from "../src/lib/trade";
import { finalize, totals, DEFAULT_SHOP } from "../src/lib/billing";
import { MAIN_STORE, setScope } from "../src/lib/scope";

const dealer: Dealer = { id: "d1", phone: "9876543210", name: "Ravi", shop_name: "Ravi Jewellers", city: "Jaipur", gstin: "", status: "pending", note: "", created_at: now(), updated_at: now() };
const order = (p: Partial<TradeOrder> = {}): TradeOrder => ({ id: "o1", no: "TO-261012-0001", dealer_id: "d1", dealer_name: "Ravi", dealer_phone: "9876543210", dealer_shop: "Ravi Jewellers",
  items: [{ product_id: "p1", code: "R1", title: "Kundan set", item: "SET", style: "K1", color: "GOLD", pack: 12, qty: 24, rate: 25000, amount: 600000 }],
  total_qty: 24, total: 600000, note: "by bus", status: "new", bill_no: "", at: now(), updated_at: now(), ...p });

beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner");
  await db.products.put({ ...blankProduct("o"), id: "p1", code: "R1", item: "SET", type: "SET", style: "K1", color: "GOLD", pack: 12, rate: 27000 });
  await db.dealers.put(dealer); await db.trade_orders.put(order());
});

describe("trade orders → bills", () => {
  it("approving a dealer links a wholesale customer account by mobile", async () => {
    await setDealerStatus(dealer, "approved");
    const d = await db.dealers.get("d1"); const p = await db.parties.get(d!.party_id!);
    expect(d!.status).toBe("approved"); expect(p).toMatchObject({ name: "Ravi Jewellers", tier: "wholesale", phone: "9876543210" });
  });
  it("makes a held bill at the order's rates (not today's price), once", async () => {
    const b = await orderToBill(order(), "gst", "o");
    expect(b.status).toBe("hold"); expect(b.items[0]).toMatchObject({ qty: 24, rate: 25000, amount: 600000 });
    expect(b.remarks).toContain("TO-261012-0001");
    expect((await db.trade_orders.get("o1"))?.status).toBe("accepted");
    await expect(orderToBill((await db.trade_orders.get("o1"))!, "gst", "o")).rejects.toThrow(/already/);
  });
  it("shows the bill number once the bill is saved", async () => {
    const b = await orderToBill(order(), "estimate", "o");
    const done = await finalize(totals(b, "Delhi"), "Delhi");
    await refreshOrderStatus((await db.trade_orders.get("o1"))!);
    expect(await db.trade_orders.get("o1")).toMatchObject({ status: "billed", bill_no: done.no });
  });
});
