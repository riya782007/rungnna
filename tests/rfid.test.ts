import { describe, it, expect } from "vitest";
import { normTag, isRfidTag, TagSet, countReport, tagsOf, soldBill } from "../src/lib/rfid";

const T1 = "E28068940000501234567890", T2 = "E28068940000501234567891", T3 = "E28068940000501234567892", T4 = "300833B2DDD9014000000001";
const prod = (id: string, barcodes: string[], sold_tags?: Record<string, string>) => ({ id, barcodes, sold_tags });

describe("RFID tags from a UHF reader in keyboard mode", () => {
  it("recognises 96/128-bit EPCs, tolerating spaces, dashes and lower case", () => {
    expect(isRfidTag(T1)).toBe(true);
    expect(isRfidTag("e280 6894 0000 5012 3456 7890")).toBe(true);
    expect(normTag("e2-80-68-94-00-00-50-12-34-56-78-90")).toBe(T1);
    expect(isRfidTag("E2806894000050123456789000000000")).toBe(true); // 128-bit
  });
  it("never mistakes a printed label for a tag", () => {
    expect(isRfidTag("202~24~12~183~~K5208/K-LT~W/LP/B")).toBe(false);     // old shop label
    expect(isRfidTag("RJ1|RAB12CD|CHAIN|PCS|K5209|GOLD||96")).toBe(false); // our QR
    expect(isRfidTag("8901234567890")).toBe(false);                         // EAN-13
    expect(isRfidTag("RAB12CDE")).toBe(false);                              // our product code
    expect(isRfidTag("E2806894000050123456789")).toBe(false);               // 23 hex: not an EPC length
    expect(isRfidTag("")).toBe(false);
  });
  it("counts one tag once per bill / stock-in", () => {
    const s = new TagSet([T1]);
    expect(s.add(T1)).toBe(false);
    expect(s.add(T2.toLowerCase())).toBe(true);
    expect(s.add(T2)).toBe(false);
    expect(s.size).toBe(2);
    s.delete(T2); expect(s.add(T2)).toBe(true);
    expect(s.list()).toEqual([T1, T2]);
  });
  it("lists a product's tags and which were sold", () => {
    const p = prod("a", ["RAB1", T1, T2], { [T2]: "RJ/26-27/C01-0007" });
    expect(tagsOf(p)).toEqual([T1, T2]);
    expect(soldBill(p, T2.toLowerCase())).toBe("RJ/26-27/C01-0007");
    expect(soldBill(p, T1)).toBeUndefined();
  });
});

describe("RFID count", () => {
  const products = [
    prod("ring", ["RRING", T1, T2]),
    prod("chain", ["RCHAIN", T3], { [T3]: "EST/26-27/C01-0003" }),
    prod("kada", ["RKADA"]),
    prod("bangle", ["RBANG", T4]),
  ];
  it("expected vs found, missing, sold flagged, unknown listed, repeats counted once", () => {
    const expected = new Map([["ring", 3], ["chain", 1], ["kada", 2]]);
    const r = countReport(expected, [T1, T1, T3, "E28068940000509999999999", T4], products);
    const row = (id: string) => r.rows.find(x => x.product_id === id)!;
    expect(row("ring")).toMatchObject({ expected: 3, found: 1, tagged: 2 });
    expect(row("chain").found).toBe(0);
    expect(row("chain").sold).toEqual([{ tag: T3, bill: "EST/26-27/C01-0003" }]);
    expect(row("kada")).toMatchObject({ expected: 2, found: 0, tagged: 0 });
    expect(row("bangle")).toMatchObject({ expected: 0, found: 1 });     // read here but booked elsewhere
    expect(r.unknown).toEqual(["E28068940000509999999999"]);
    expect(r.missing).toBe(2 + 1 + 2);
    expect(r.foundTotal).toBe(2); expect(r.expectedTotal).toBe(6); expect(r.soldTotal).toBe(1);
    expect(r.rows[0].product_id).toBe("ring");                            // biggest shortfall first
  });
  it("ignores hidden products and an empty rack", () => {
    const r = countReport(new Map(), [T1], [{ ...prod("ring", [T1]), deleted: 1 as const }]);
    expect(r.rows).toEqual([]); expect(r.unknown).toEqual([T1]); expect(r.missing).toBe(0);
  });
});
