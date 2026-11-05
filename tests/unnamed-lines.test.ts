import { describe, it, expect } from "vitest";
import { unnamedGroups } from "../src/lib/billing-products";
import type { BillLine, Product } from "../src/lib/db";

const line = (id: string, item: string, style: string, extra: Partial<BillLine> = {}): BillLine =>
  ({ id, code: id, item, type: "PCS", style, color: "", box_no: 12, pack: 1, pkts: 0, qty: 1, rate: 10000, disc: "", amount: 10000, ...extra });
const prod = (id: string, item: string, style: string, extra: Partial<Product> = {}) => ({ id, code: id, item, style, ...extra }) as unknown as Product;

describe("lines with no product name at save (owner, 5 Nov)", () => {
  it("finds only the unnamed lines and guesses the name from the same design family", () => {
    const items = [line("a", "BRACELET", "K5205/53T"), line("b", "", "K5210/2T"), line("c", "TOPS", "K5210/39P"), line("d", "TOPS", "K/5210/4P")];
    const g = unnamedGroups(items, []);
    expect(g.map(x => x.style)).toEqual(["K5210/2T"]);
    expect(g[0].guess).toBe("TOPS");
  });
  it("groups lines that share an item number, so one answer names them all", () => {
    const items = [line("a", "ITEM 55", "K5210/2T"), line("b", "ITEM 55", "K5210/3T"), line("c", "", "X1", { product_id: "p1" })];
    const g = unnamedGroups(items, [prod("p1", "", "X1", { item_code: "55" } as Partial<Product>)]);
    expect(g).toHaveLength(1);
    expect(g[0].code).toBe("55");
    expect(g[0].lines.map(l => l.id)).toEqual(["a", "b", "c"]);
  });
  it("falls back to saved products for the guess, and leaves it blank when nothing matches", () => {
    expect(unnamedGroups([line("a", "", "K5210/2T")], [prod("p", "TOPS", "K5210/39P")])[0].guess).toBe("TOPS");
    expect(unnamedGroups([line("a", "", "Z99")], [prod("p", "TOPS", "K5210/39P")])[0].guess).toBe("");
    expect(unnamedGroups([line("a", "BRACELET", "K1")], [])).toEqual([]);
  });
});
