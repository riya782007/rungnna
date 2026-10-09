import { describe, it, expect } from "vitest";
import { isInterState, stateCode, gstinState } from "../src/lib/states";
import { totals, lineAmount, fixLine, fy, type Shop } from "../src/lib/billing";
import { inWords } from "../src/components/Invoice";
import type { Bill, BillLine } from "../src/lib/db";

const line = (p: Partial<BillLine>): BillLine => fixLine({ id: "l", code: "", item: "F-RING", type: "PCS", style: "K5208/K-LT", color: "W/LP/B", box_no: 1, pack: 12, pkts: 3, qty: 0, rate: 2400, disc: "", amount: 0, ...p });
const bill = (p: Partial<Bill>): Bill => ({ id: "b", no: "", series: "", bill_type: "gst", status: "hold", party_name: "", party_phone: "", party_gstin: "", party_state: "",
  salesman: "", box_count: 0, total_qty: 0, gross: 0, discount: 0, discount_pct: 0, packing: 0, adjust: 0, gst_mode: "exclusive", gst_rate: 3,
  gst: 0, cgst: 0, sgst: 0, igst: 0, net: 0, advance: 0, paid: 0, remarks: "", payments: [], items: [], device: "", by_staff: "", at: "", updated_at: "", ...p });

describe("billing maths", () => {
  it("packets × pack × rate", () => { const l = line({}); expect(l.qty).toBe(36); expect(l.amount).toBe(86400); });
  it("line discount % and ₹", () => {
    expect(lineAmount({ qty: 10, rate: 1000, disc: "10%" })).toBe(9000);
    expect(lineAmount({ qty: 10, rate: 1000, disc: "5" })).toBe(9500);
  });
  it("GST exclusive, same state → CGST+SGST, rounded to rupee", () => {
    const t = totals(bill({ items: [line({})], party_state: "Delhi" }), "Delhi");
    expect(t.gross).toBe(86400); expect(t.gst).toBe(2592); expect(t.cgst + t.sgst).toBe(2592); expect(t.igst).toBe(0);
    expect(t.net % 100).toBe(0); expect(t.net).toBe(89000); expect(t.adjust).toBe(8);
  });
  it("other state → IGST", () => { const t = totals(bill({ items: [line({})], party_state: "Rajasthan" }), "Delhi"); expect(t.igst).toBe(t.gst); expect(t.cgst).toBe(0); });
  it("state spelling does not matter: 'delhi ', 'NCT of Delhi' and a 07 GSTIN are all Delhi → CGST+SGST", () => {
    for (const ps of ["delhi ", "NCT of Delhi", "07-Delhi", "DL"]) { const t = totals(bill({ items: [line({})], party_state: ps }), "Delhi"); expect(t.igst).toBe(0); expect(t.cgst + t.sgst).toBe(t.gst); }
  });
  it("GSTIN prefix beats a wrong typed state, and the shop GSTIN beats a blank shop state", () => {
    const g = "08AAAAA0000A1Z5";   // Rajasthan
    const t = totals(bill({ items: [line({})], party_state: "Delhi", party_gstin: g }), "Delhi", "07BBBBB1111B1Z5");
    expect(t.igst).toBe(t.gst); expect(t.cgst).toBe(0);
    const u = totals(bill({ items: [line({})], party_state: "", party_gstin: "07CCCCC2222C1Z5" }), "", "07BBBBB1111B1Z5");
    expect(u.igst).toBe(0); expect(u.cgst + u.sgst).toBe(u.gst);
  });
  it("unknown or blank state on either side stays intra-state; unknown names fall back to exact-name compare", () => {
    expect(isInterState({ state: "" }, "Rajasthan")).toBe(false); expect(isInterState({ state: "Delhi" }, "")).toBe(false);
    expect(isInterState({ state: "Nowhereland" }, "Elsewhere")).toBe(true); expect(isInterState({ state: "Nowhereland" }, "nowhereland")).toBe(false);
    expect(stateCode("Jammu & Kashmir")).toBe("01"); expect(gstinState("not a gstin")).toBe(""); expect(gstinState("99AAAAA0000A1Z5")).toBe("");
  });
  it("GST inclusive keeps the total", () => { const t = totals(bill({ items: [line({ pkts: 1, rate: 10300 })], gst_mode: "inclusive" }), ""); expect(t.gross).toBe(123600); expect(t.net).toBe(123600); expect(t.gst).toBe(3600); });
  it("estimate has no GST; discount %, packing, payments", () => {
    const t = totals(bill({ bill_type: "estimate", items: [line({})], discount_pct: 10, packing: 5000, payments: [{ mode: "cash", amount: 50000 }, { mode: "credit", amount: 0 }] }), "");
    expect(t.gst).toBe(0); expect(t.discount).toBe(8640); expect(t.net).toBe(82800); expect(t.paid).toBe(50000);
  });
  it("bill discount is capped at the bill amount — NET never goes negative", () => {
    const one = [line({ pkts: 1 })]; // 12 × ₹24 = ₹288
    expect(totals(bill({ items: one, discount: 100000 }), "").net).toBe(0);
    expect(totals(bill({ items: one, discount: 100000 }), "").discount).toBe(28800);
    expect(totals(bill({ items: one, discount_pct: 150 }), "").discount).toBe(28800);
    expect(totals(bill({ bill_type: "estimate", items: one, discount: 100000, packing: 5000 }), "").net).toBe(5000);
    expect(totals(bill({ items: [], discount: 5000 }), "").net).toBe(0);
  });
  it("boxes and pieces", () => { const t = totals(bill({ items: [line({}), line({ id: "m", box_no: 2, pack: 1, pkts: 0, qty: 5 })] }), ""); expect(t.total_qty).toBe(41); expect(t.box_count).toBe(2); });
  it("financial year", () => { expect(fy(new Date(2026, 8, 25))).toBe("26-27"); expect(fy(new Date(2027, 1, 1))).toBe("26-27"); expect(fy(new Date(2027, 3, 1))).toBe("27-28"); });
  it("amount in words, Indian system", () => { expect(inWords(12345600)).toBe("Rupees One Lakh Twenty Three Thousand Four Hundred Fifty Six Only"); expect(inWords(89000)).toBe("Rupees Eight Hundred Ninety Only"); });
});
