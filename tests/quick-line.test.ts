import { describe, expect, it } from "vitest";
import { parseQuickLine, parseSrList } from "../src/lib/quick-line";

const L = (t: string, prev = "", code = false) => { const r = parseQuickLine(t, prev, code); return r.ok ? r.line : r.error; };
describe("owner, 29 Oct: one bill line typed the way it is printed", () => {
  it("item, code, quantity and cost", () => {
    expect(L("TIKA 19430 12 51")).toEqual({ item: "TIKA", style: "19430", qty: "12", cost: "51" });
    expect(L("tika - 19430  12pc  ₹51")).toEqual({ item: "TIKA", style: "19430", qty: "12", cost: "51" });
    expect(L("NATH-470 12 47")).toEqual({ item: "NATH", style: "470", qty: "12", cost: "47" });
    expect(L("BAHUBALI E1/E2/E3 36 290")).toEqual({ item: "BAHUBALI", style: "E1/E2/E3", qty: "36", cost: "290" });
    expect(L("SET 8500-1 TO 8500-12 13x12 470")).toEqual({ item: "SET", style: "8500-1 TO 8500-12", qty: "156", cost: "470", pack: "12", stickers: "13" });
  });
  it("carries the item of the line above when a line starts with its code", () => {
    expect(L("19016 12 67", "TIKA")).toEqual({ item: "TIKA", style: "19016", qty: "12", cost: "67" });
    expect(L("Z-128 26 350", "SET")).toEqual({ item: "SET", style: "Z-128", qty: "26", cost: "350" });
    expect(L("19016 12 67")).toMatch(/item name once/);
  });
  it("boxes x pieces: one sticker per box", () => {
    expect(L("TIKA 19020 4 x 12 53")).toEqual({ item: "TIKA", style: "19020", qty: "48", cost: "53", pack: "12", stickers: "4" });
  });
  it("no cost typed, or no code on the bill", () => {
    expect(L("TIKA 19430 12")).toEqual({ item: "TIKA", style: "19430", qty: "12", cost: "" });
    expect(L("19430 12", "TIKA")).toEqual({ item: "TIKA", style: "19430", qty: "12", cost: "" });
    expect(L("CHOTI 24 273")).toEqual({ item: "CHOTI", style: "", qty: "24", cost: "273" });
    expect(L("TIKA 340 12", "", true)).toEqual({ item: "TIKA", style: "340", qty: "12", cost: "" });
  });
  it("Sr. lists for a carton", () => {
    expect(parseSrList("1-5, 8 11")).toEqual([1, 2, 3, 4, 5, 8, 11]);
    expect(parseSrList("9-7")).toEqual([7, 8, 9]);
  });
});
