import "fake-indexeddb/auto";
import { describe, it, expect, beforeEach } from "vitest";
import { totals, lineAmount, fixLine, discError, taxLines, taxSummary, convertToGst, finalize, newBill, DEFAULT_SHOP } from "../src/lib/billing";
import { validatePosLines } from "../src/lib/pos";
import { db, now, type Bill, type BillLine } from "../src/lib/db";
import { strip } from "../src/lib/sync";
import { COLUMNS } from "../src/lib/columns";
import { MAIN_STORE, setScope } from "../src/lib/scope";

const line = (p: Partial<BillLine>): BillLine => fixLine({ id: Math.random().toString(36).slice(2), code: "", item: "SET", type: "PCS", style: "S1", color: "G", box_no: 1, pack: 1, pkts: 0, qty: 1, rate: 10000, disc: "", amount: 0, ...p });
const bill = (p: Partial<Bill>): Bill => ({ id: "b", no: "", series: "", bill_type: "gst", status: "hold", party_name: "", party_phone: "", party_gstin: "", party_state: "Delhi",
  salesman: "", box_count: 0, total_qty: 0, gross: 0, discount: 0, discount_pct: 0, packing: 0, adjust: 0, gst_mode: "exclusive", gst_rate: 3,
  gst: 0, cgst: 0, sgst: 0, igst: 0, net: 0, advance: 0, paid: 0, remarks: "", payments: [], items: [], device: "", by_staff: "", at: now(), updated_at: now(), ...p });
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("line discounts can only lower a line", () => {
  it("rejects negative, non-numeric and over-100% discounts", () => {
    for (const d of ["-5", "abc", "5-", "150%", "1.234"]) expect(discError(d)).not.toBe("");
    for (const d of ["", "10%", "10.5%", "25", "25.50", " 7 % "]) expect(discError(d.replace(/\s/g, ""))).toBe("");
    expect(lineAmount({ qty: 2, rate: 1000, disc: "-5" })).toBe(2000);         // never raises the price
    expect(lineAmount({ qty: 2, rate: 1000, disc: "100%" })).toBe(0);
    expect(lineAmount({ qty: 2, rate: 1000, disc: "50" })).toBe(0);            // flat ₹50 off ₹20 stops at zero
    expect(() => validatePosLines([line({ disc: "-5" })])).toThrow(/Discount/);
  });
  it("bill discount % is held to 0–100 and packing can't be negative", () => {
    const t = totals(bill({ items: [line({ qty: 10 })], discount_pct: 250, packing: -500 }), "Delhi");
    expect(t.discount).toBe(t.gross); expect(t.packing).toBe(0); expect(t.net).toBe(0);
  });
});

describe("tax shown on the invoice always adds up", () => {
  const cases: [string, Partial<Bill>][] = [
    ["single rate, discount + packing", { items: [line({ qty: 7, rate: 3333 }), line({ qty: 3, rate: 999, disc: "5%" })], discount_pct: 7, packing: 4900 }],
    ["inclusive", { gst_mode: "inclusive", items: [line({ qty: 13, rate: 7777 }), line({ qty: 1, rate: 101 })], discount: 1234 }],
    ["mixed 3% and 12%", { items: [line({ qty: 5, rate: 4567 }), line({ qty: 2, rate: 89999, gst_rate: 12, hsn: "7113" }), line({ qty: 9, rate: 1111, gst_rate: 5, hsn: "6217" })], discount_pct: 3, packing: 1500 }],
    ["mixed inclusive inter-state", { gst_mode: "inclusive", party_state: "Rajasthan", items: [line({ qty: 3, rate: 50001, gst_rate: 18 }), line({ qty: 11, rate: 2311 })] }],
  ];
  for (const [name, p] of cases) it(name, () => {
    const t = totals(bill(p), "Delhi");
    const rows = taxLines(t), byRate = taxSummary(t, "rate");
    expect(sum(rows.map(r => r.taxable))).toBe(t.net - t.adjust - t.gst);
    expect(sum(byRate.map(r => r.cgst))).toBe(t.cgst);
    expect(sum(byRate.map(r => r.sgst))).toBe(t.sgst);
    expect(sum(byRate.map(r => r.igst))).toBe(t.igst);
    expect(t.cgst + t.sgst + t.igst).toBe(t.gst);
    expect(Math.abs(t.adjust)).toBeLessThanOrEqual(50);
    expect(t.net % 100).toBe(0);
    for (const g of byRate) if (!t.igst) expect(Math.abs(g.cgst - g.sgst)).toBeLessThanOrEqual(1);
  });
  it("each rate's tax is that rate of its taxable value (within a paisa per line)", () => {
    const t = totals(bill(cases[2][1]), "Delhi");
    for (const g of taxSummary(t, "rate")) expect(Math.abs(g.cgst + g.sgst - Math.round(g.taxable * g.rate / 100))).toBeLessThanOrEqual(3);
  });
  it("HSN summary keeps different HSNs apart", () => {
    const t = totals(bill(cases[2][1]), "Delhi");
    expect(taxSummary(t, "hsn").map(r => r.hsn + "@" + r.rate)).toEqual(["7117@3", "6217@5", "7113@12"]);
  });
  it("non-GST documents carry no tax lines", () => {
    expect(taxLines(totals(bill({ bill_type: "estimate", items: [line({})] }), "Delhi"))).toEqual([]);
  });
});

describe("sync never sends fields the cloud lacks", () => {
  it("drops draft-only and unknown fields, keeps real columns", () => {
    const row = strip("bills" as any, { ...bill({ items: [line({})] }), selected_box: 3, somethingNew: 1, party_address: "Sadar Bazar" });
    expect(row).not.toHaveProperty("selected_box"); expect(row).not.toHaveProperty("somethingNew");
    expect(row.party_address).toBe("Sadar Bazar");
    for (const k of Object.keys(row)) expect(COLUMNS.bills).toContain(k);
  });
});

describe("estimate → GST invoice", () => {
  beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); });
  it("marks the estimate converted in the same save and refuses a second conversion", async () => {
    const est = await finalize({ ...newBill("o", DEFAULT_SHOP, "estimate"), items: [line({ qty: 2 })] }, "Delhi");
    const g = await convertToGst(est, DEFAULT_SHOP, "o");
    expect(g.bill_type).toBe("gst"); expect(g.no).toMatch(/^INV\//);
    expect((await db.bills.get(est.id))?.status).toBe("converted");
    await expect(convertToGst(est, DEFAULT_SHOP, "o")).rejects.toThrow(/already converted/);
    expect((await db.bills.toArray()).filter(b => b.bill_type === "gst")).toHaveLength(1);
  });
});

describe("free lines with packing still add up", () => {
  it("all lines 100% off + packing: packing is taxed and every row adds up", () => {
    for (const items of [[line({ disc: "100%" }), line({ disc: "100%" })], [line({ disc: "100%" }), line({ disc: "100%", gst_rate: 12 })]]) {
      const t = totals(bill({ items, packing: 5000 }), "Delhi");
      expect(t.net - t.adjust - t.gst).toBe(5000);
      const rows = taxLines(t);
      expect(sum(rows.map(r => r.taxable))).toBe(5000);
      expect(sum(rows.map(r => r.cgst + r.sgst))).toBe(t.gst);
    }
  });
});
