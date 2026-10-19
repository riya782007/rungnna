import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { finalize, newBill, fixLine, DEFAULT_SHOP, balanceBefore } from "../src/lib/billing";
import { InvoiceSheet, COPY_NAMES } from "../src/components/Invoice";
import { db, now, type BillLine } from "../src/lib/db";
import { rupees, billAmount } from "../src/lib/format";
import { MAIN_STORE, setScope } from "../src/lib/scope";

/* What a wholesale bill has to say that a shop counter receipt doesn't (checked 16 Oct against the printed
   output of every format, and against how wholesale billing apps print a party's running account). */
const line = (p: Partial<BillLine>): BillLine => fixLine({ id: Math.random().toString(36).slice(2), code: "", item: "EARING", type: "PAIR", style: "K5210/11P", color: "K/GRN", box_no: 1, pack: 1, pkts: 0, qty: 10, rate: 32000, disc: "", amount: 0, ...p });
const party = { id: "p1", kind: "customer", name: "SHREE BALAJI", alt_name: "", phone: "9876543210", gstin: "", address: "", city: "", state: "Delhi", pin: "", tier: "wholesale", credit_limit: 0, notes: "", opening_balance: 100000, store_id: MAIN_STORE, updated_at: now() } as any;
const sale = (t: "gst" | "estimate", items: BillLine[]) => ({ ...newBill("o", DEFAULT_SHOP, t), party_id: "p1", party_name: "SHREE BALAJI", items });

describe("money is printed the way it is read", () => {
  it("a negative amount reads -₹0.25, never ₹-0.25 (the round-off line)", () => {
    expect(rupees(-25)).toBe("-₹0.25");
    expect(rupees(2085200)).toBe("₹20,852.00");
    expect(rupees(0)).toBe("₹0.00");
  });
});

describe("previous balance on a wholesale bill", () => {
  beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); await db.parties.put(party); });

  it("freezes what the party owed before the bill, and prints it with the total due", async () => {
    const first = await finalize(sale("gst", [line({ qty: 10 })]), "Delhi");           // ₹3,200 + 3% → ₹3,296, unpaid
    expect(first.prev_due).toBe(100000);                                                 // the opening balance
    const second = await finalize(sale("gst", [line({ qty: 1 })]), "Delhi");
    expect(second.prev_due).toBe(100000 + first.net);
    const html = renderToStaticMarkup(<InvoiceSheet b={second} shop={DEFAULT_SHOP} format="a5" />);
    expect(html).toContain("Previous balance");
    expect(html).toContain(billAmount(100000 + first.net));
    expect(html).toContain("Total due");
    expect(html).toContain(billAmount(100000 + first.net + second.net));
  });

  it("keeps the frozen figure when the bill is edited and saved again", async () => {
    const b = await finalize(sale("gst", [line({ qty: 2 })]), "Delhi");
    await finalize(sale("gst", [line({ qty: 5 })]), "Delhi");                           // a later bill
    const again = await finalize({ ...b, remarks: "edited" }, "Delhi");
    expect(again.prev_due).toBe(b.prev_due);
  });

  it("a tax invoice never shows money owed on private estimates", async () => {
    await finalize(sale("estimate", [line({ qty: 50 })]), "Delhi");
    const g = sale("gst", [line({ qty: 1 })]);
    expect(await balanceBefore(g as any)).toBe(100000);
  });

  it("prints nothing extra for a walk-in with no account", async () => {
    const b = await finalize({ ...newBill("o", DEFAULT_SHOP, "gst"), items: [line({})] }, "Delhi");
    expect(b.prev_due).toBeUndefined();
    expect(renderToStaticMarkup(<InvoiceSheet b={b} shop={DEFAULT_SHOP} format="80mm" />)).not.toContain("Previous balance");
  });
});

describe("what each printed copy carries", () => {
  const b = { ...newBill("o", DEFAULT_SHOP, "gst"), no: "RJ/26-27/1", status: "final" as const, salesman: "RAMESH", items: [line({ disc: "5%" })] };
  it("says which copy it is (GST rule 48: original, duplicate, triplicate)", () => {
    const html = renderToStaticMarkup(<InvoiceSheet b={b} shop={DEFAULT_SHOP} format="a4" copy={COPY_NAMES[1]} />);
    expect(html).toContain("DUPLICATE FOR TRANSPORTER");
  });
  it("names the salesman", () => {
    expect(renderToStaticMarkup(<InvoiceSheet b={b} shop={DEFAULT_SHOP} format="a5" />)).toContain("RAMESH");
  });
  it("a packing slip shows no discount, because it shows no prices", () => {
    expect(renderToStaticMarkup(<InvoiceSheet b={b} shop={DEFAULT_SHOP} format="packing" />)).not.toContain("disc 5%");
    expect(renderToStaticMarkup(<InvoiceSheet b={b} shop={DEFAULT_SHOP} format="a5" />)).toContain("disc 5%");
  });
  it("the 'sale not executed' band sits under the title, not as a column of the header", () => {
    const est = { ...newBill("o", DEFAULT_SHOP, "estimate"), items: [line({})] };
    const html = renderToStaticMarkup(<InvoiceSheet b={est} shop={DEFAULT_SHOP} format="a5" />);
    expect(html).toMatch(/class="inv-title">ESTIMATE.*inv-notexec/);
  });
});

describe("the shop's state decides CGST+SGST or IGST", () => {
  beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); });
  it("a profile saved with a blank state (as on 16 Oct) still bills a Rajasthan party with IGST", async () => {
    const { getShop, totals } = await import("../src/lib/billing");
    await db.config.put({ id: "shop", value: { ...DEFAULT_SHOP, state: "" }, updated_at: now() } as any);
    const shop = await getShop();
    expect(shop.state).toBe("Delhi");
    const t = totals({ ...newBill("o", shop, "gst"), party_state: "Rajasthan", items: [line({ qty: 10 })] }, shop.state, shop.gstin);
    expect(t.igst).toBeGreaterThan(0); expect(t.cgst).toBe(0);
  });
});
