import { describe, expect, it } from "vitest";
import { checkBill, checkSummary, resolveDitto, matchSupplier, fallbackBillNo, paise, type ReadRow } from "../src/lib/billCheck";

/* Karan's real estimate form of 6/10/2026: 14 handwritten lines, Net ₹24,939. Written out as a
   reader could return it: ditto marks left as "11", and line 5's quantity misread as 15 (the
   bill's own amount, 1044 at ₹58, says 18). */
const r = (item: string, style: string, qty: string, cost: string, amount: string, box = ""): ReadRow =>
  ({ item, style, color: "", unit: "PCS", hsn: "", qty, cost, rate: "", amount, box });

const KARAN: ReadRow[] = [
  r("B.N. KADA MIX", "", "23", "252", "5796"),
  r("KAMAR BELT MIX", "", "24", "75", "1800", "2"),
  r("11 1", "", "18", "25", "450", "1"),
  r("11 3-2", "", "36", "35", "1260", "2"),
  r("11 4", "", "15", "58", "1044", "1"),          // misread: 1044 ÷ 58 = 18
  r("KAMAR BELT GOLD", "0705", "12", "112", "1344", "1"),
  r("11", "0714", "12", "100", "1200", "1"),
  r("KADI 1 STONE", "28", "48", "36", "1728", "2"),
  r("11", "24", "72", "30", "2160", "3"),
  r("ANKLET BELL", "9095", "9", "89", "801", "1"),
  r("11", "9325", "12", "68", "816", "1"),
  r("11 GOLD", "0713/0717", "24", "100", "2400", "2"),
  r("11", "R.74", "12", "121", "1452", "1"),
  r("11", "0704/0708", "24", "112", "2688", "2"),
];

describe("reading a handwritten bill against itself", () => {
  it("catches the misread quantity from the bill's own amount, and says why", () => {
    const c = checkBill(KARAN, "24939");
    expect(c.rows[4].qty).toBe("18");
    expect(c.fixes).toEqual([{ line: 5, field: "qty", from: "15", to: "18", why: "1044 ÷ ₹58 = 18 pieces" }]);
    expect(c.doubts).toEqual([]);
  });

  it("then adds up to the Net written at the bottom, to the paisa", () => {
    const c = checkBill(KARAN, "24939");
    expect(c.sum).toBe(2493900);
    expect(c.addsUp).toBe(true);
    expect(c.pieces).toBe(23 + 24 + 18 + 36 + 18 + 12 + 12 + 48 + 72 + 9 + 12 + 24 + 12 + 24);
    expect(checkSummary(c)).toMatch(/^14 lines · 344 pieces · adds up to ₹24,939, the bill's own total \(after 1 correction/);
  });

  it("without amounts to check by, the misread leaves the total ₹174 short, and it says so", () => {
    const c = checkBill(KARAN.map(x => ({ ...x, amount: "" })), "24939");    // no amounts to check lines with
    expect(c.addsUp).toBe(false);
    expect(c.sum).toBe(2493900 - 3 * 5800);
    expect(checkSummary(c)).toMatch(/difference ₹174/);
  });

  it("asks instead of guessing when no single reading fixes a line", () => {
    const c = checkBill([r("SETS", "", "7", "33", "250")], "250");
    expect(c.fixes).toEqual([]);
    expect(c.doubts[0]).toMatchObject({ line: 1 });
    expect(c.rows[0].qty).toBe("7");
  });

  it("fixes a misread rate the same way when the quantity is right", () => {
    const c = checkBill([r("CHOTI", "", "12", "28", "1452")]);   // 1452 ÷ 12 = 121
    expect(c.rows[0].cost).toBe("121");
    expect(c.fixes[0]).toMatchObject({ field: "cost", from: "28", to: "121" });
    expect(c.addsUp).toBeNull();                                  // no Net on this one
  });
});

describe("ditto marks", () => {
  it("writes them out as the item above, keeping the size mark that follows", () => {
    const items = resolveDitto(KARAN).map(x => x.item);
    expect(items.slice(1, 5)).toEqual(["KAMAR BELT MIX", "KAMAR BELT MIX 1", "KAMAR BELT MIX 3-2", "KAMAR BELT MIX 4"]);
    expect(items[6]).toBe("KAMAR BELT GOLD");
    expect(items[8]).toBe("KADI 1 STONE");
    // "11 GOLD" is the item above in gold; the two plain "11"s after it copy the item, not "GOLD"
    expect(items.slice(11)).toEqual(["ANKLET BELL GOLD", "ANKLET BELL", "ANKLET BELL"]);
  });

  it("copies the written item, never the variant of the line above", () => {
    const items = resolveDitto([r("KAMAR BELT", "", "1", "1", ""), r("11 3-2", "", "1", "1", ""), r("11 4", "", "1", "1", "")]).map(x => x.item);
    expect(items).toEqual(["KAMAR BELT", "KAMAR BELT 3-2", "KAMAR BELT 4"]);
  });

  it("knows 〃 and do, but leaves a size that starts with 11 alone", () => {
    const items = resolveDitto([r("JHUMKA", "", "1", "1", ""), r("〃", "", "1", "1", ""), r("do", "", "1", "1", ""),
      r("11 MM PEARL", "", "1", "1", ""), r("11 INCH MALA", "", "1", "1", "")]).map(x => x.item);
    expect(items).toEqual(["JHUMKA", "JHUMKA", "JHUMKA", "11 MM PEARL", "11 INCH MALA"]);
  });

  it("never invents an item for a ditto on the first line", () => {
    expect(resolveDitto([r("11", "", "1", "1", "")])[0].item).toBe("11");
  });
});

describe("supplier and bill number", () => {
  const sups = [{ id: "a", name: "SUHAG JEWELLERS" }, { id: "b", name: "RLJ" }, { id: "c", name: "SOLANKI", vendor_code: "51" }];

  it("finds the supplier the way it is scribbled", () => {
    expect(matchSupplier("Suhag Jew.", sups)?.id).toBe("a");
    expect(matchSupplier("suhag jewellers", sups)?.id).toBe("a");
    expect(matchSupplier("51", sups)?.id).toBe("c");
  });

  it("never picks one of two lookalikes, and never matches on a scrap", () => {
    expect(matchSupplier("Suhag", [...sups, { id: "d", name: "SUHAG GOLD" }])).toBeUndefined();
    expect(matchSupplier("Su", sups)).toBeUndefined();
    expect(matchSupplier("", sups)).toBeUndefined();
  });

  it("gives an estimate form with no number a stable one, so uploading it twice is caught", () => {
    expect(fallbackBillNo("6/10/2026", 2493900)).toBe("EST 6/10/2026 ₹24939");
    expect(fallbackBillNo("6/10/2026", 2493900)).toBe(fallbackBillNo(" 6/10/2026 ", 2493900));
  });

  it("reads money as written on Indian bills", () => {
    expect(paise("1,044")).toBe(104400);
    expect(paise("₹ 24939/-")).toBe(2493900);
    expect(paise("12.5")).toBe(1250);
    expect(paise("twelve")).toBeUndefined();
    expect(paise("")).toBeUndefined();
  });
});
