import { describe, it, expect } from "vitest";
import { normUnit, readItemMap, needsName, withItemInfo, blankProduct, fromParsed } from "../src/lib/products";
import { parseLabel } from "../src/lib/parse";

const prod = (p: Record<string, unknown>) => ({ ...blankProduct("t"), ...p });

describe("item numbers on old shop labels", () => {
  it("normalises units", () => {
    expect(normUnit("pcs")).toBe("PCS"); expect(normUnit("Nos.")).toBe("PCS"); expect(normUnit("prs")).toBe("PAIR");
    expect(normUnit("Pair")).toBe("PAIR"); expect(normUnit("sets")).toBe("SET"); expect(normUnit("")).toBe(""); expect(normUnit("dozen")).toBe("DOZEN");
  });
  it("reads old name-only lists and new name+unit lists", () => {
    expect(readItemMap({ "202": "f-ring", "305": { name: "jhumki", unit: "pair" } }))
      .toEqual({ "202": { name: "F-RING", unit: "" }, "305": { name: "JHUMKI", unit: "PAIR" } });
    expect(readItemMap(undefined)).toEqual({});
  });
  it("'ITEM 202' and a blank name both count as unnamed", () => {
    expect(needsName({ item: "", item_code: "202" })).toBe(true);
    expect(needsName({ item: "ITEM 202", item_code: "202" })).toBe(true);
    expect(needsName({ item: "F-RING", item_code: "202" })).toBe(false);
    expect(needsName({ item: "", item_code: undefined })).toBe(false);
  });
  it("a new scan of 202~… fills name and unit", () => {
    const np = fromParsed(parseLabel("202~24~12~183~~K5208/K-LT~W/LP/B"), "t");
    expect(np.item).toBe(""); expect(np.item_code).toBe("202");
    const x = withItemInfo(np, { name: "F-RING", unit: "PAIR" })!;
    expect(x.item).toBe("F-RING"); expect(x.type).toBe("PAIR");
  });
  it("a product saved earlier as 'ITEM 202' gets the name and unit on its next scan", () => {
    const x = withItemInfo(prod({ item: "ITEM 202", item_code: "202", type: "PCS" }), { name: "F-RING", unit: "SET" })!;
    expect(x.item).toBe("F-RING"); expect(x.type).toBe("SET");
  });
  it("never renames a product that already has a real name or unit", () => {
    expect(withItemInfo(prod({ item: "TOE RING", item_code: "202", type: "PAIR" }), { name: "F-RING", unit: "SET" })).toBeNull();
    expect(withItemInfo(prod({ item: "F-RING", item_code: "202", type: "PAIR" }), { name: "F-RING", unit: "PAIR" })).toBeNull();
    expect(withItemInfo(prod({ item: "", item_code: undefined }), { name: "F-RING", unit: "PAIR" })).toBeNull();
  });
});
