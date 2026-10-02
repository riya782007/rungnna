import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSheet } from "../src/components/Invoice";
import { newBill, DEFAULT_SHOP } from "../src/lib/billing";
describe("thermal invoices", () => {
  it("renders a 58mm page with wrap-safe narrow classes and signed government QR", () => { const b = { ...newBill("o", DEFAULT_SHOP, "gst"), compliance: { irn: { id: "registered-irn", generated_at: "2026-10-02", ack_no: "ACK123", signed_qr: "signed-qr-value", sandbox: true }, ewb: { id: "EWB123", generated_at: "2026-10-02", sandbox: true } } }; const html = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format: "58mm" })); expect(html).toContain("58mm auto"); expect(html).toContain("thermal narrow"); expect(html).toContain("ACK123"); expect(html).toContain("EWB123"); expect(html).toContain('class="signed-qr"'); expect(html).toContain("SANDBOX"); });
  it("keeps 80mm printing and excludes cancelled signed QR", () => { const b = { ...newBill("o", DEFAULT_SHOP), compliance: { irn: { id: "irn", generated_at: "2026-10-02", signed_qr: "signed", sandbox: false, cancelled_at: "2026-10-02" } } }; const html = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format: "80mm" })); expect(html).toContain("80mm auto"); expect(html).toContain("CANCELLED"); expect(html).not.toContain('class="signed-qr"'); });
});
