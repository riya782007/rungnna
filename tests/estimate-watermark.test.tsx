import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSheet } from "../src/components/Invoice";
import { DEFAULT_SHOP, newBill, totals } from "../src/lib/billing";
import type { Bill } from "../src/lib/db";

/**
 * Owner rule R-204: an estimate must say "sale not executed", in Hindi and English, on every
 * page — so a quotation can never be mistaken for a bill by the party, by a salesman, or by an
 * inspector reading it a year later. A numbered tax invoice must NEVER carry it.
 */
const sheet = (b: Bill, format: any = "a5") =>
  renderToStaticMarkup(<InvoiceSheet b={totals(b, "Delhi")} shop={DEFAULT_SHOP} format={format} />);

const bill = (t: any, no = ""): Bill => ({ ...newBill("owner", DEFAULT_SHOP, t), no, status: no ? "final" : "hold" });

describe("estimate carries 'sale not executed' (R-204)", () => {
  it("an estimate shows it in English and Hindi", () => {
    const html = sheet(bill("estimate", "EST/26C10001"));
    expect(html).toContain("SALE NOT EXECUTED");
    expect(html).toContain("बिक्री निष्पादित नहीं");
  });

  it("a numbered tax invoice never shows it", () => {
    const html = sheet(bill("gst", "RJ/26C10001"));
    expect(html).not.toContain("SALE NOT EXECUTED");
    expect(html).not.toContain("बिक्री निष्पादित नहीं");
  });

  it("an unnumbered draft shows it — a draft is not a sale either", () => {
    expect(sheet(bill("gst", ""))).toContain("SALE NOT EXECUTED");
  });

  it("a credit note never shows it", () => {
    expect(sheet(bill("return", "CN/26C10001"))).not.toContain("SALE NOT EXECUTED");
  });

  it("the diagonal watermark is on sheet formats, where it repeats per page", () => {
    for (const f of ["a4", "a5"]) expect(sheet(bill("estimate", "EST/1"), f)).toContain("inv-wm");
  });

  it("the thermal roll gets the band but not the diagonal watermark — it would eat the paper", () => {
    for (const f of ["80mm", "58mm"]) {
      const html = sheet(bill("estimate", "EST/1"), f);
      expect(html).toContain("SALE NOT EXECUTED");
      expect(html).not.toContain("inv-wm");
    }
  });

  it("a packing slip carries no price and no sale wording", () => {
    expect(sheet(bill("estimate", "EST/1"), "packing")).not.toContain("SALE NOT EXECUTED");
  });
});
