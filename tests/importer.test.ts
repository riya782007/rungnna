import { describe, it, expect } from "vitest";
import { guessMap, parseCSV, findHeader, balancePaise } from "../src/lib/importer";

describe("importer", () => {
  it("maps typical old-software headers", () => {
    const m = guessMap(["Item Code", "Item Name", "Design No.", "Colour", "Sale Rate", "Closing Stock", "Packing"], "products");
    expect(m).toEqual({ item_code: 0, item: 1, style: 2, color: 3, rate: 4, qty: 5, pack: 6 });
  });
  it("maps customer headers", () => {
    expect(guessMap(["Party Name", "Mobile No", "City", "GSTIN", "Closing Balance"], "parties")).toEqual({ name: 0, phone: 1, city: 2, gstin: 3, opening_balance: 4 });
  });
  it("reads CSV with quotes and finds the header under a title row", () => {
    const rows = parseCSV('RUNGNNA STOCK REPORT\r\nItem Code,Item Name,Rate\r\n202,"F-RING, fancy",24\r\n');
    expect(rows[2]).toEqual(["202", "F-RING, fancy", "24"]);
    expect(findHeader(rows, "products")).toBe(1);
  });
  it("Dr / Cr balances", () => { expect(balancePaise("1,234.50 Dr")).toBe(123450); expect(balancePaise("500 Cr")).toBe(-50000); });
});
