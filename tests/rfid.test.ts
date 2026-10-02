import { describe, it, expect } from "vitest";
import { normTag, isRfidTag, TagSet, countReport, tagsOf, soldBill, Recent, rfidDefaults } from "../src/lib/rfid";

const T1 = "E28068940000501234567890", T2 = "E28068940000501234567891", T3 = "E28068940000501234567892", T4 = "300833B2DDD9014000000001";
const prod = (id: string, barcodes: string[], sold_tags?: Record<string, string>) => ({ id, barcodes, sold_tags });

describe("RFID tags from a UHF reader in keyboard mode", () => {
  it("recognises 96/128-bit EPCs, tolerating spaces, dashes and lower case", () => {
    expect(isRfidTag(T1)).toBe(true);
    expect(isRfidTag("e280 6894 0000 5012 3456 7890")).toBe(true);
    expect(normTag("e2-80-68-94-00-00-50-12-34-56-78-90")).toBe(T1);
    expect(isRfidTag("E2806894000050123456789000000000")).toBe(true); // 128-bit
  });
  it("strips the labels and separators readers add", () => {
    expect(normTag("EPC: " + T1)).toBe(T1);
    expect(normTag("tid=" + T1.toLowerCase())).toBe(T1);
    expect(normTag("0x" + T1)).toBe(T1);
    expect(normTag(" E2.80.68.94.00.00.50.12.34.56.78.90 ")).toBe(T1);
    expect(isRfidTag("EPC:" + T1)).toBe(true);
  });
  it("accepts 64-bit and long user-memory reads, but not short all-digit barcodes", () => {
    expect(isRfidTag("E280689400005012")).toBe(true);                       // 64-bit with letters
    expect(isRfidTag("1234567890123456")).toBe(false);                      // 16-digit number: a barcode
    expect(isRfidTag("123456789012345678901234")).toBe(true);               // 24 digits: an EPC that happens to be all digits
    expect(isRfidTag(T1 + T1)).toBe(true);                                  // 192-bit
    expect(isRfidTag(T1 + T1 + T1)).toBe(false);                            // longer than 256 bits
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
  it("warns about an unlinked tag once, not on every repeat read", () => {
    const r = new Recent(5000);
    expect(r.first(T1, 1000)).toBe(true);
    expect(r.first(T1.toLowerCase(), 1500)).toBe(false);
    expect(r.first(T1, 4000)).toBe(false);
    expect(r.first(T1, 9500)).toBe(true);      // quiet for 5 s after the last read
    expect(r.first(T2, 9500)).toBe(true);
  });
  it("sync never sends null into the RFID columns for rows saved before RFID", () => {
    expect(rfidDefaults("products", { id: "a" })).toEqual({ id: "a", sold_tags: {} });
    expect(rfidDefaults("bills", { id: "b" })).toEqual({ id: "b", rfid_tags: [] });
    expect(rfidDefaults("purchases", { id: "c", rfid_tags: null })).toEqual({ id: "c", rfid_tags: [] });
    expect(rfidDefaults("bills", { id: "d", rfid_tags: [T1] })).toEqual({ id: "d", rfid_tags: [T1] });
    expect(rfidDefaults("parties", { id: "e" })).toEqual({ id: "e" });
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
