import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSheet } from "../src/components/Invoice";
import { newBill, DEFAULT_SHOP } from "../src/lib/billing";
import { manualLine } from "../src/lib/pos";
import { preparePrint, thermalPage } from "../src/lib/printing";
describe("thermal invoices", () => {
  it("prints product names, units and the old counter's per-box quantities", () => {
    const b = { ...newBill("o", DEFAULT_SHOP), items: [manualLine({ item: "BALI", style: "K5209", color: "G", unit: "PAIR", hsn: "7117", qty: "4", rate: "100", box: 1 })] };
    for (const format of ["80mm", "58mm"] as const) {
      const html = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format }));
      expect(html).toContain("BALI"); expect(html).toContain("PAIR"); expect(html).toContain("Box No.:"); expect(html).toContain("Box qty:"); expect(html).toContain("400.00");
    }
  });
  it("waits for fonts, decoded images and two painted frames", async () => {
    const events: string[] = [];
    const doc = { fonts: { ready: Promise.resolve().then(() => events.push("fonts")) }, getElementById: () => null, querySelectorAll: () => [{ decode: async () => { events.push("image"); } }] } as unknown as Document;
    await preparePrint(doc, async () => { events.push("frame"); });
    expect(events).toEqual(["fonts", "image", "frame", "frame"]);
  });
  it("uses valid measured thermal dimensions instead of width plus auto", () => {
    expect(thermalPage(80, 960)).toBe("@page{size:80mm 260mm;margin:2mm}");
    expect(() => thermalPage(90, 100)).toThrow();
  });
  it("renders a 58mm page with wrap-safe narrow classes and signed government QR", () => { const b = { ...newBill("o", DEFAULT_SHOP, "gst"), compliance: { irn: { id: "registered-irn", generated_at: "2026-10-02", ack_no: "ACK123", signed_qr: "signed-qr-value", sandbox: true }, ewb: { id: "EWB123", generated_at: "2026-10-02", sandbox: true } } }; const html = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format: "58mm" })); expect(html).toContain('data-thermal-width="58"'); expect(html).toContain("thermal narrow"); expect(html).toContain("ACK123"); expect(html).toContain("EWB123"); expect(html).toContain('class="signed-qr"'); expect(html).toContain("SANDBOX"); });
  it("keeps 80mm printing and excludes cancelled signed QR", () => { const b = { ...newBill("o", DEFAULT_SHOP), compliance: { irn: { id: "irn", generated_at: "2026-10-02", signed_qr: "signed", sandbox: false, cancelled_at: "2026-10-02" } } }; const html = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format: "80mm" })); expect(html).toContain('data-thermal-width="80"'); expect(html).toContain("CANCELLED"); expect(html).not.toContain('class="signed-qr"'); });
});
