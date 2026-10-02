import { describe, it, expect } from "vitest";
import { totals, fixLine, due, seriesOf, isSale, DEFAULT_SHOP, type Shop } from "../src/lib/billing";
import { canMerge, mergeable, mergeLines, buildMerged, returnable, buildReturn, splittable } from "../src/lib/docs";
import { eodReport } from "../src/lib/eod";
import { statementRange, localDay, type Entry } from "../src/lib/ledger";
import { Pdf, pdfSafe, fit, textWidth } from "../src/lib/pdf";
import { isEstimate, maskNote } from "../src/lib/privacy";
import type { Bill, BillLine, Receipt } from "../src/lib/db";

const shop: Shop = { ...DEFAULT_SHOP, state: "Delhi", gst_rate: 3, gst_mode: "exclusive" };
let n = 0;
const line = (p: Partial<BillLine>): BillLine => fixLine({ id: "l" + ++n, product_id: "ring", code: "", item: "F-RING", type: "PCS", style: "K5208", color: "W", box_no: 1, pack: 1, pkts: 0, qty: 10, rate: 2400, disc: "", amount: 0, ...p });
const bill = (p: Partial<Bill>): Bill => totals({ id: "b" + ++n, no: "", series: "", bill_type: "estimate", status: "final", party_id: "ravi", party_name: "RAVI", party_phone: "", party_gstin: "", party_state: "Delhi",
  salesman: "", box_count: 0, total_qty: 0, gross: 0, discount: 0, discount_pct: 0, packing: 0, adjust: 0, gst_mode: "exclusive", gst_rate: 3,
  gst: 0, cgst: 0, sgst: 0, igst: 0, net: 0, advance: 0, paid: 0, remarks: "", payments: [], items: [line({})], device: "", by_staff: "", at: "2026-10-02T06:00:00.000Z", updated_at: "", ...p }, "Delhi");

describe("document types", () => {
  it("series per type; estimate returns get their own private series", () => {
    expect(seriesOf("gst")).toBe("RJ"); expect(seriesOf("estimate")).toBe("EST"); expect(seriesOf("challan")).toBe("CH");
    expect(seriesOf("return", "gst")).toBe("CN"); expect(seriesOf("return", "estimate")).toBe("ECN");
    expect(isEstimate({ bill_type: "return", src_type: "estimate" })).toBe(true);
    expect(isEstimate({ bill_type: "return", src_type: "gst" })).toBe(false);
    expect(maskNote("ECN/26-27/C01-0001 · return", false)).toBe("");
  });
  it("a challan asks for no money and is not a sale", () => {
    const c = bill({ bill_type: "challan", payments: [{ mode: "cash", amount: 5000 }] });
    expect(c.net).toBe(24000); expect(c.paid).toBe(0); expect(due(c)).toBe(0); expect(c.gst).toBe(0); expect(isSale(c)).toBe(false);
  });
  it("a credit note against a tax invoice reverses GST; against an estimate it carries none", () => {
    expect(bill({ bill_type: "return", src_type: "gst" }).gst).toBe(720);
    expect(bill({ bill_type: "return", src_type: "estimate" }).gst).toBe(0);
  });
});

describe("merge", () => {
  it("only one customer, never a saved tax invoice, at least two (or one challan)", () => {
    const a = bill({}), b = bill({}), other = bill({ party_id: "sita" });
    expect(canMerge([a, b])).toBeNull();
    expect(canMerge([a])).toMatch(/at least two/);
    expect(canMerge([a, other])).toMatch(/same customer/);
    expect(canMerge([a, bill({ bill_type: "gst" })])).toMatch(/saved tax invoice/);
    expect(canMerge([bill({ bill_type: "challan" })])).toBeNull();
    expect(mergeable(bill({ status: "merged", merged_into: "x" }))).toBe(false);
    expect(mergeable(bill({ bill_type: "gst", status: "hold" }))).toBe(true);
  });
  it("combines the same product at the same rate; pieces from saved sources are never deducted again", () => {
    const saved = bill({ items: [line({ qty: 10 }), line({ product_id: "chain", qty: 4, rate: 9600 })] });
    const order = bill({ status: "hold", items: [line({ qty: 5 })] });
    const lines = mergeLines([saved, order]);
    const rings = lines.filter(l => l.product_id === "ring");
    expect(rings.find(l => l.stock_done)?.qty).toBe(10);           // from the saved estimate: already off the racks
    expect(rings.find(l => !l.stock_done)?.qty).toBe(5);           // from the held order: still to be deducted
    expect(lines.find(l => l.product_id === "chain")!.amount).toBe(38400);
    const twice = mergeLines([bill({ items: [line({ qty: 3 })] }), bill({ items: [line({ qty: 7 })] })]);
    expect(twice).toHaveLength(1); expect(twice[0].qty).toBe(10); expect(twice[0].amount).toBe(24000);
    expect(mergeLines([bill({ items: [line({ rate: 2400 })] }), bill({ items: [line({ rate: 2500 })] })])).toHaveLength(2);
  });
  it("packets add up as packets", () => {
    const x = mergeLines([bill({ items: [line({ pack: 12, pkts: 2 })] }), bill({ items: [line({ pack: 12, pkts: 3 })] })]);
    expect(x[0].pkts).toBe(5); expect(x[0].qty).toBe(60);
  });
  it("carries discounts, packing, payments; advances become dated cash payments", () => {
    const a = bill({ discount_pct: 10, advance: 5000, at: "2026-10-01T05:00:00.000Z" });
    const b = bill({ packing: 2000, payments: [{ mode: "upi", amount: 10000, at: "2026-10-02T05:00:00.000Z" }] });
    const m = totals(buildMerged([a, b], "gst", shop, "me"), "Delhi");
    expect(m.discount).toBe(2400); expect(m.packing).toBe(2000); expect(m.advance).toBe(0);
    expect(m.payments.find(p => p.mode === "cash")).toMatchObject({ amount: 5000, at: "2026-10-01T05:00:00.000Z" });
    expect(m.paid).toBe(15000); expect(m.merged_from).toEqual([a.id, b.id]); expect(m.gst).toBeGreaterThan(0);
  });
  it("split only on live sale / challan documents", () => {
    expect(splittable(bill({}))).toBe(true); expect(splittable(bill({ status: "void" }))).toBe(false);
    expect(splittable(bill({ bill_type: "return" }))).toBe(false); expect(splittable(bill({ status: "merged", merged_into: "x" }))).toBe(false);
  });
});

describe("sales return", () => {
  const src = bill({ bill_type: "gst", no: "RJ/26-27/C01-0009", items: [line({ id: "A", qty: 10 }), line({ id: "B", product_id: "chain", qty: 4, rate: 9600 })], discount_pct: 10 });
  it("can't return more than is left after earlier credit notes", () => {
    const cn1 = { ...bill({ bill_type: "return", return_of: src.id, items: [line({ src_line: "A", qty: 4 })] }) };
    const left = returnable(src, [cn1, { ...cn1, status: "void" }]);
    expect(left.get("A")).toBe(6); expect(left.get("B")).toBe(4);
  });
  it("credit note: same rates, discount shared in proportion, GST reversed, capped quantities", () => {
    const left = returnable(src, []);
    const cn = totals(buildReturn(src, [{ line_id: "A", qty: 5 }, { line_id: "B", qty: 99 }], left, shop, "me"), "Delhi");
    expect(cn.items.find(l => l.src_line === "A")!.qty).toBe(5);
    expect(cn.items.find(l => l.src_line === "B")!.qty).toBe(4);              // capped at what was sold
    expect(cn.gross).toBe(5 * 2400 + 4 * 9600);
    expect(cn.discount).toBe(Math.round(src.discount * cn.gross / src.gross)); // 10% of the returned value
    expect(cn.gst).toBe(Math.round((cn.gross - cn.discount) * 0.03));
    expect(cn).toMatchObject({ bill_type: "return", src_type: "gst", return_of: src.id, return_of_no: src.no, party_id: "ravi" });
    expect(buildReturn(src, [{ line_id: "A", qty: 0 }], left, shop, "me").items).toHaveLength(0);
  });
});

describe("end of day", () => {
  const day = "2026-10-02";
  const at = (h: number, d = 2) => new Date(2026, 9, d, h).toISOString();
  const gst = bill({ bill_type: "gst", at: at(11), advance: 1000, payments: [{ mode: "upi", amount: 10000 }, { mode: "credit", amount: 0 }] });
  const est = bill({ bill_type: "estimate", at: at(12), payments: [{ mode: "cash", amount: 24000, at: at(12) }] });
  const old = bill({ bill_type: "gst", at: at(10, 1), payments: [{ mode: "cash", amount: 3000, at: at(15) }, { mode: "cash", amount: 9999, at: at(10, 1) }, { mode: "upi", amount: 500, ref: "RCPT RC/1", at: at(15) }] });
  const order = bill({ bill_type: "gst", status: "hold", at: at(13), advance: 2000 });   // an order taken with an advance
  const cn = bill({ bill_type: "return", src_type: "gst", at: at(16), payments: [{ mode: "cash", amount: 4000, at: at(16) }] });
  const ch = bill({ bill_type: "challan", at: at(17) });
  const merged = bill({ status: "merged", merged_into: "x", at: at(9) });
  const rc: Receipt = { id: "r", no: "RC/1", party_id: "ravi", party_name: "RAVI", amount: 7000, mode: "cash", note: "", allocations: [{ bill_id: "e", bill_no: "EST/26-27/C01-0001", amount: 2000 }],
    opening_part: 0, unallocated: 0, device: "", by_staff: "", at: at(14), updated_at: "" };
  const all = [gst, est, old, order, cn, ch, merged];
  it("splits money by mode, keeps estimates apart, counts receipts once, closes cash", () => {
    const r = eodReport(all, [rc], day, 50000, true);
    expect(r.gst).toMatchObject({ count: 1, net: gst.net }); expect(r.gst.received).toEqual({ cash: 1000, upi: 10000, card: 0, bank: 0 });
    expect(r.gst.credit).toBe(due(gst));
    expect(r.est!.received.cash).toBe(24000);
    expect(r.later).toEqual({ cash: 3000, upi: 0, card: 0, bank: 0 });  // RCPT part is under receipts, yesterday's cash is yesterday's
    expect(r.orders.cash).toBe(2000);
    expect(r.receipts).toMatchObject({ count: 1, modes: { cash: 7000, upi: 0, card: 0, bank: 0 } });
    expect(r.returns).toMatchObject({ count: 1, net: cn.net, refunds: { cash: 4000, upi: 0, card: 0, bank: 0 } });
    expect(r.challans).toEqual({ count: 1, pcs: 10 });
    expect(r.cashIn).toBe(1000 + 24000 + 3000 + 2000 + 7000); expect(r.cashOut).toBe(4000);
    expect(r.closing).toBe(50000 + r.cashIn - 4000);
  });
  it("locked: no estimate section, estimate cash and the estimate part of receipts left out", () => {
    const r = eodReport(all, [rc], day, 0, false);
    expect(r.est).toBeNull(); expect(r.receipts.modes.cash).toBe(5000);
    expect(r.cashIn).toBe(1000 + 3000 + 2000 + 5000);
  });
});

describe("party statement", () => {
  const e = (at: string, kind: Entry["kind"], debit: number, credit: number): Entry => ({ at, kind, ref: kind, debit, credit, balance: 0 });
  const raw = [e("0000", "opening", 1000, 0), e(new Date(2026, 8, 5, 12).toISOString(), "bill", 5000, 0), e(new Date(2026, 9, 1, 12).toISOString(), "bill", 3000, 0),
    e(new Date(2026, 9, 2, 12).toISOString(), "receipt", 0, 4000), e(new Date(2026, 9, 3, 12).toISOString(), "return", 0, 500)];
  let bal = 0; const entries = raw.map(x => ({ ...x, balance: (bal += x.debit - x.credit) }));
  it("folds everything before the range into the opening and runs the balance", () => {
    const st = statementRange(entries, "2026-10-01", "2026-10-02");
    expect(st.opening).toBe(6000); expect(st.rows.map(r => r.kind)).toEqual(["bill", "receipt"]);
    expect(st.rows.map(r => r.balance)).toEqual([9000, 5000]); expect(st.closing).toBe(5000);
    expect(st.debit).toBe(3000); expect(st.credit).toBe(4000);
    expect(statementRange(entries, "2020-01-01", "2030-01-01").closing).toBe(bal);
    expect(localDay(new Date(2026, 9, 2, 23, 59).toISOString())).toBe("2026-10-02");
  });
});

describe("pdf", () => {
  it("writes a valid PDF with a correct cross-reference table, and pages", () => {
    const doc = new Pdf();
    doc.text(40, 50, "Statement ₹1,200 — (RAVI)", { size: 12, font: "F2" }).line(40, 60, 500, 60);
    doc.addPage().text(40, 50, "page two");
    const s = new TextDecoder("latin1").decode(doc.bytes());
    expect(s.startsWith("%PDF-1.4")).toBe(true); expect(s.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(s).toContain("/Count 2"); expect(s).toContain("(Statement Rs. 1,200 - \\(RAVI\\)) Tj");
    const xref = Number(s.match(/startxref\n(\d+)/)![1]);
    expect(s.slice(xref, xref + 4)).toBe("xref");
    const offs = [...s.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => Number(m[1]));
    offs.forEach((o, i) => expect(s.slice(o).startsWith(`${i + 1} 0 obj`)).toBe(true));
  });
  it("keeps text inside its column", () => {
    expect(pdfSafe("राम ₹5")).toBe("??? Rs. 5");
    const t = fit("A VERY LONG CUSTOMER NAME THAT WILL NOT FIT", 80, 9);
    expect(t.endsWith("...")).toBe(true); expect(textWidth(t, 9)).toBeLessThanOrEqual(80);
  });
});
