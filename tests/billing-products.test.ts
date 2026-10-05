import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../src/lib/db";
import { blankProduct } from "../src/lib/products";
import { ownPayload } from "../src/lib/parse";
import { resolveBillingScan, fillBillNames } from "../src/lib/billing-products";
import { DEFAULT_SHOP, finalize, lineFrom, newBill, billText } from "../src/lib/billing";
import { InvoiceSheet, type PrintFormat } from "../src/components/Invoice";
import { MAIN_STORE, setScope } from "../src/lib/scope";

beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); });
describe("QR details on bills", () => {
  it("resolves a legacy item number and carries its name, unit, pack, style, colour and rate", async () => {
    await db.config.put({ id: "item_codes", value: { "202": { name: "F-RING", unit: "PAIR" } }, updated_at: "" });
    const p = (await resolveBillingScan("202~24~12~183~~K5208/K-LT~W/LP/B", "o"))!;
    expect(lineFrom(p)).toMatchObject({ item: "F-RING", type: "PAIR", pack: 12, pkts: 1, qty: 12, style: "K5208/K-LT", color: "W/LP/B", rate: 2400 });
    expect((await resolveBillingScan("202~24~12~183~~K5208/K-LT~W/LP/B", "o"))?.id).toBe(p.id);
    expect(await db.products.count()).toBe(1);
  });
  it("fills an exact-match product's blank fields from a named QR without changing existing prices", async () => {
    const raw = "RJ1|P1|JHUMKI|PAIR|J101|GOLD||96|6";
    await db.products.put({ ...blankProduct("o"), id: "p1", code: "P1", barcodes: [raw], rate: 12000 });
    const p = (await resolveBillingScan(raw, "o"))!;
    expect(lineFrom(p)).toMatchObject({ item: "JHUMKI", type: "PAIR", style: "J101", color: "GOLD", pack: 6, qty: 6, rate: 12000 });
  });
  it("accepts named JSON QRs and preserves the name through saved and printed bills", async () => {
    const p = (await resolveBillingScan('{"name":"CHAIN","style":"C101","colour":"GOLD","unit":"PCS","rate":96}', "o"))!;
    const b = await finalize({ ...newBill("o", DEFAULT_SHOP, "challan"), items: [lineFrom(p)] }, "");
    expect((await db.bills.get(b.id))?.items[0].item).toBe("CHAIN");
    expect(billText(b, DEFAULT_SHOP)).toContain("CHAIN");
    for (const format of ["a4", "a5", "58mm", "80mm", "packing"] as PrintFormat[]) expect(renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format }))).toContain("CHAIN");
  });
  it("recovers unnamed old lines but never renames historical invoice names", async () => {
    const p = { ...blankProduct("o"), item: "F-RING", item_code: "202" }; await db.products.put(p);
    const b = { ...newBill("o", DEFAULT_SHOP), items: [{ ...lineFrom(p), item: "ITEM 202" }, { ...lineFrom(p), item: "Original ring name" }] };
    expect((await fillBillNames(b)).items.map(l => l.item)).toEqual(["F-RING", "Original ring name"]);
  });
  it("refuses an unnamed final invoice instead of silently billing just a style", async () => {
    const p = (await resolveBillingScan("999~24~12~183~~K5208~WHITE", "o"))!;
    await expect(finalize({ ...newBill("o", DEFAULT_SHOP), items: [lineFrom(p)] }, "")).rejects.toThrow("product name");
    expect(await db.bills.count()).toBe(0);
  });
  it("encodes pack size on new named QRs", async () => {
    const p = (await resolveBillingScan(ownPayload({ code: "X", item: "CHAIN", type: "SET", style: "C1", color: "GOLD", tk: "", rate: 9600, pack: 3 }, "rungnna"), "o"))!;
    expect(lineFrom(p)).toMatchObject({ item: "CHAIN", type: "SET", qty: 3, rate: 9600 });
  });
});
