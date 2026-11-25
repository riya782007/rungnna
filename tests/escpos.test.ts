import { describe, expect, it } from "vitest";
import { receiptLines, slipLines, billJob, ascii, wrap } from "../src/lib/escpos";
import { newBill, fixLine, totals, DEFAULT_SHOP } from "../src/lib/billing";
import type { BillLine } from "../src/lib/db";

/* Owner, 24–25 Nov: junk letters on the roll — bills now go to the printer as text (ESC/POS). */
const shop = { ...DEFAULT_SHOP, name: "RUNGNNA JEWELLERY & CO", est_disc_pct: 50 };
const line = (i: number, item: string, qty: number, rate: number, box = 1): BillLine => fixLine({ id: "l" + i, product_id: "p" + i, code: "", item, type: i % 2 ? "PAIR" : "PCS", style: "K52" + i, color: "GOLD", box_no: box, pack: 1, pkts: 0, qty, rate, disc: "", amount: 0 });
const bill = (type: "estimate" | "gst", n = 26) => {
  const items = Array.from({ length: n }, (_, i) => line(i + 1, i % 3 ? "MANGALSUTRA" : "HAIR ACCESSORIES SET LONG NAME", 1 + (i % 3), 1640 + i * 100, i < n / 2 ? 1 : 2));
  const b = { ...newBill("o", shop, type), no: type === "gst" ? "INV/26/0001" : "EST/26CUJE0342", status: "final" as const, party_name: "PIYUSH BHATIA", party_phone: "7417883758", party_address: "shop no. 3 ranipur mor haridwar, HARIDWAR, 249408", party_state: "Uttarakhand", items, discount_pct: type === "estimate" ? 50 : 0, box_count: 2, remarks: "mal/mani" };
  return totals(b, "Delhi", "");
};

describe("text-mode roll bills", () => {
  it("fit the roll, carry every line and the totals, in plain ASCII", () => {
    for (const [type, W] of [["estimate", 48], ["gst", 48], ["estimate", 32]] as const) {
      const b = bill(type), lines = receiptLines(b, shop, W);
      for (const l of lines) { expect(l.t.length).toBeLessThanOrEqual(l.big ? W / 2 : W); expect(l.t).toMatch(/^[\x20-\x7e]*$/); }
      const text = lines.map(l => l.t).join("\n");
      for (let i = 1; i <= b.items.length; i++) expect(text).toMatch(new RegExp("(^|\\n)" + i + " "));
      expect(text).toContain("NET"); expect(text).toContain("Box No.: 2");
      if (type === "estimate") { expect(text).toContain("SALE NOT EXECUTED"); expect(text).toContain("Discount 50%"); expect(lines[0].t).toBe("RJ"); }
      else { expect(text).toMatch(/CGST|IGST/); }
    }
  });
  it("one job: bill, bag tag, cash slip — each cut once, a few KB", () => {
    const b = bill("estimate", 200);
    const data = billJob(b, shop, { width: 80, feedMm: 25, cut: "partial", slips: [{ kind: "tag", n: 1 }, { kind: "cash" }] });
    expect(data.length).toBeLessThan(30000);
    let cuts = 0; for (let i = 0; i < data.length - 2; i++) if (data[i] === 0x1d && data[i + 1] === 0x56) cuts++;
    expect(cuts).toBe(3);
    expect(slipLines(b, shop, { kind: "cash" }).map(l => l.t).join("\n")).toContain("TO COLLECT");
  });
  it("turns Hindi, ₹ and dots into plain letters, and wraps long words", () => {
    expect(ascii("₹ 120 · बिक्री").trim()).toBe("Rs. 120 -");
    expect(wrap("ABCDEFGHIJKLMNOP", 5)).toEqual(["ABCDE", "FGHIJ", "KLMNO", "P"]);
  });
});
