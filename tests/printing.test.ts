import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSheet } from "../src/components/Invoice";
import { newBill, DEFAULT_SHOP } from "../src/lib/billing";
import { preparePrint, thermalPage } from "../src/lib/printing";
describe("thermal invoices", () => {
  it("waits for fonts, decoded images and two painted frames", async () => {
    const events: string[] = [];
    const doc = { fonts: { ready: Promise.resolve().then(() => events.push("fonts")) }, getElementById: () => null, querySelectorAll: () => [{ decode: async () => { events.push("image"); } }] } as unknown as Document;
    await preparePrint(doc, async () => { events.push("frame"); });
    expect(events).toEqual(["fonts", "image", "frame", "frame"]);
  });
  it("uses valid measured thermal dimensions instead of width plus auto", () => {
    expect(thermalPage(80, 960)).toBe("@page rj-receipt{size:80mm 260mm;margin:2mm}");
    expect(thermalPage(80, 6000)).toBe("@page rj-receipt{size:80mm 1594mm;margin:2mm}");
    expect(() => thermalPage(90, 100)).toThrow();
    expect(() => thermalPage(80, 0)).toThrow();
    expect(() => thermalPage(58, NaN)).toThrow();
  });
  it("measures the receipt's overflowing content and restores the hidden root", async () => {
    const page = { dataset: { thermalWidth: "80" }, textContent: "@page{size:auto}" };
    const receipt = { getBoundingClientRect: () => ({ height: 400 }), scrollHeight: 960 };
    const root = { style: { cssText: "display:none" }, querySelector: (s: string) => s === ".inv" ? receipt : page };
    const doc = { getElementById: () => root, querySelectorAll: () => [] } as unknown as Document;
    await preparePrint(doc, async () => {});
    expect(page.textContent).toBe(thermalPage(80, 960));
    expect(root.style.cssText).toBe("display:none");
  });
  it("refuses a blank thermal job instead of printing an automatic-length page", async () => {
    const page = { dataset: { thermalWidth: "58" }, textContent: "original" };
    const root = { style: { cssText: "display:none" }, querySelector: (s: string) => s === ".inv" ? null : page };
    const doc = { getElementById: () => root, querySelectorAll: () => [] } as unknown as Document;
    await expect(preparePrint(doc, async () => {})).rejects.toThrow("Invalid receipt dimensions");
    expect(root.style.cssText).toBe("display:none");
    expect(page.textContent).toBe("original");
  });
  it("assigns different pages to an A5 preview and a thermal estimate", () => {
    const b = newBill("o", DEFAULT_SHOP, "estimate");
    const sheet = (format: "a5" | "80mm") => renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format }));
    expect(sheet("a5")).toContain("page:rj-a5");
    expect(sheet("80mm")).toContain("page:rj-receipt");
    expect(sheet("80mm")).not.toContain("@page{");
  });
  it("renders a 58mm page with wrap-safe narrow classes and signed government QR", () => { const b = { ...newBill("o", DEFAULT_SHOP, "gst"), compliance: { irn: { id: "registered-irn", generated_at: "2026-10-02", ack_no: "ACK123", signed_qr: "signed-qr-value", sandbox: true }, ewb: { id: "EWB123", generated_at: "2026-10-02", sandbox: true } } }; const html = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format: "58mm" })); expect(html).toContain('data-thermal-width="58"'); expect(html).toContain("thermal narrow"); expect(html).toContain("ACK123"); expect(html).toContain("EWB123"); expect(html).toContain('class="signed-qr"'); expect(html).toContain("SANDBOX"); });
  it("keeps 80mm printing and excludes cancelled signed QR", () => { const b = { ...newBill("o", DEFAULT_SHOP), compliance: { irn: { id: "irn", generated_at: "2026-10-02", signed_qr: "signed", sandbox: false, cancelled_at: "2026-10-02" } } }; const html = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format: "80mm" })); expect(html).toContain('data-thermal-width="80"'); expect(html).toContain("CANCELLED"); expect(html).not.toContain('class="signed-qr"'); });
});
