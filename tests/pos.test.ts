import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { resolveBillingScan } from "../src/lib/billing-products";
import { DEFAULT_SHOP, newBill, lineFrom, finalize, totals } from "../src/lib/billing";
import { manualLine, moneyInput, validatePosLines } from "../src/lib/pos";
import { calculate } from "../src/lib/calculator";
import { mergeBoxLine } from "../src/lib/billingBox";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSheet } from "../src/components/Invoice";

beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); });
const photographedQr = "5186~100~1~212~~K5209/~KXZKLN";
describe("owner's photographed QR", () => {
  it("produces BALI, PAIR, style, colour, pack and rate without prior setup", async () => {
    const p = (await resolveBillingScan(photographedQr, "owner"))!;
    expect(p.ref).toBe("212");
    expect(lineFrom(p)).toMatchObject({ item: "BALI", type: "PAIR", pack: 1, qty: 1, style: "K5209/", color: "KXZKLN", rate: 10000 });
    const b = await finalize({ ...newBill("owner", DEFAULT_SHOP), items: [lineFrom(p)] }, "");
    const html = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format: "58mm" }));
    expect(html).toContain("BALI"); expect(html).toContain("PAIR"); expect(html).toContain("100.00");
    expect((await db.bills.get(b.id))?.items[0].item).toBe("BALI");
  });
  it("reuses the same product on four scans and respects shop overrides", async () => {
    const ids = await Promise.all([1, 2, 3, 4].map(async () => (await resolveBillingScan(photographedQr, "o"))!.id));
    expect(new Set(ids).size).toBe(1);
    await db.config.put({ id: "item_codes", value: { "5186": { name: "Shop BALI", unit: "PAIR" } }, updated_at: "" });
    await db.products.clear();
    expect((await resolveBillingScan(photographedQr, "o"))?.item).toBe("SHOP BALI");
  });
  it("never invents the name for unverified item codes", async () => { expect((await resolveBillingScan("987654~100~1~212~~K5209/~KXZKLN", "o"))?.item).toBe(""); });
});
describe("manual POS", () => {
  const input = { item: "BALI", style: "K5209", color: "GOLD", unit: "PAIR", hsn: "7117", qty: "3", rate: "100.50", box: 2 };
  it("saves a named custom line without fabricated inventory", async () => {
    const line = manualLine(input); expect(line).toMatchObject({ item: "BALI", type: "PAIR", qty: 3, rate: 10050, amount: 30150 });
    const bill = await finalize({ ...newBill("o", DEFAULT_SHOP), items: [line] }, "");
    expect(bill.items[0].hsn).toBe("7117"); expect(await db.movements.count()).toBe(0); expect(await db.products.count()).toBe(0);
  });
  it("validates names, whole quantities and exact money", () => {
    for (const change of [{ item: " " }, { qty: "-1" }, { qty: "1.5" }, { rate: "-3" }, { rate: "abc" }, { rate: "1.999" }]) expect(() => manualLine({ ...input, ...change })).toThrow();
    expect(moneyInput("1,200.50")).toBe(120050);
    expect(() => validatePosLines([{ ...manualLine(input), qty: 0 }])).toThrow();
  });
  it("does not merge different manually entered prices", () => {
    const a = { ...manualLine(input), product_id: "p" }, b = { ...manualLine({ ...input, rate: "90" }), product_id: "p" };
    expect(mergeBoxLine([a, b], b.id)).toHaveLength(2);
  });
  it("adds mixed stock/manual lines to the same totals", async () => {
    const p = (await resolveBillingScan(photographedQr, "o"))!;
    expect(totals({ ...newBill("o", DEFAULT_SHOP, "challan"), items: [lineFrom(p), manualLine(input)] }).gross).toBe(40150);
  });
  it("rolls back number allocation and all documents if final save fails", async () => {
    const b = { ...newBill("o", DEFAULT_SHOP), items: [manualLine(input)] };
    await expect(finalize(b, "", "", async () => { throw new Error("Simulated save failure"); })).rejects.toThrow("Simulated");
    expect(await db.bills.count()).toBe(0); expect(await db.outbox.count()).toBe(0);
    expect((await db.settings.toArray()).filter(s => s.key.startsWith("seq_"))).toHaveLength(0);
    const saved = await finalize(b, ""); expect(saved.no).toMatch(/0001$/);
  });
});
describe("POS calculator", () => {
  it("uses decimal arithmetic, precedence and parentheses", () => { expect(calculate("0.1+0.2")).toBe("0.3"); expect(calculate("100+50×2")).toBe("200"); expect(calculate("(100+50)÷3")).toBe("50"); expect(calculate("100×10/100")).toBe("10"); });
  it("handles zero and negative intermediate results", () => { expect(calculate("100-100")).toBe("0"); expect(calculate("50-100")).toBe("-50"); });
  it("rejects unsafe syntax, invalid input and division by zero", () => { for (const e of ["1/0", "", "2++", "import('x')", "a=5", "sqrt(4)", "2^999", "[1,2]", "9".repeat(121)]) expect(() => calculate(e)).toThrow(); });
});
