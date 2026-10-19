import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSheet, type PrintFormat } from "../src/components/Invoice";
import { billImage, billText, DEFAULT_SHOP, newBill, totals } from "../src/lib/billing";
import { billAmount, rupees } from "../src/lib/format";
import { manualLine } from "../src/lib/pos";

const finalEstimate = () => totals({ ...newBill("owner", DEFAULT_SHOP, "estimate"), no: "EST/OWNER/1", status: "final" as const,
  party_name: "WHOLESALE CUSTOMER", prev_due: 10000, packing: 500, advance: 1000,
  payments: [{ mode: "cash" as const, amount: 2000 }], remarks: "FINAL REMARKS: approval goods checked",
  items: Array.from({ length: 140 }, (_, i) => manualLine({ item: "OWNER-LINE-" + String(i + 1).padStart(3, "0"), style: "K521011/P", color: "WXZ/13", unit: "PCS", hsn: "7117", qty: "3", rate: "100.25", box: i % 4 + 1 }))
}, "Delhi");
const htmlFor = (format: PrintFormat) => renderToStaticMarkup(<InvoiceSheet b={finalEstimate()} shop={DEFAULT_SHOP} format={format} />);

afterEach(() => vi.unstubAllGlobals());
describe("Karan's complete estimate and bill presentation", () => {
  it("keeps every finalized item, settlement and last remarks on every priced print format", () => {
    for (const format of ["a4", "a5", "80mm", "58mm"] as const) {
      const html = htmlFor(format);
      for (let i = 1; i <= 140; i++) expect(html).toContain("OWNER-LINE-" + String(i).padStart(3, "0"));
      for (const label of ["APPROVAL CHALLAN", "SALE NOT EXECUTED", "FINAL REMARKS", "Previous balance", "Total due", "Advance", "Paid"])
        expect(html).toContain(label);
      expect(html).not.toContain("₹"); expect(html).not.toContain("inv-words");
      expect(html).not.toContain("Rupees ");
    }
  });
  it("watermarks paper estimates with ESTIMATE and preserves the existing bilingual notice", () => {
    for (const format of ["a4", "a5"] as const) {
      expect(htmlFor(format)).toMatch(/class="inv-wm"[^>]*><span>ESTIMATE<br/);
      expect(htmlFor(format)).toContain("बिक्री निष्पादित नहीं");
    }
    const estimate = finalEstimate();
    const gst = renderToStaticMarkup(<InvoiceSheet b={{ ...estimate, bill_type: "gst" }} shop={DEFAULT_SHOP} format="a5" />);
    expect(gst).not.toContain("APPROVAL CHALLAN"); expect(gst).not.toContain("inv-wm");
    expect(gst).not.toContain("₹"); expect(gst).not.toContain("inv-words");
    const packing = htmlFor("packing");
    expect(packing).not.toContain("APPROVAL CHALLAN"); expect(packing).not.toContain("inv-wm");
    expect(packing).not.toContain("Previous balance");
  });
  it("keeps two-decimal figures and negative round-off without changing account currency formatting", () => {
    expect(billAmount(-25)).toBe("-0.25"); expect(billAmount(2085200)).toBe("20,852.00");
    expect(billAmount(0)).toBe("0.00"); expect(rupees(-25)).toBe("-₹0.25");
  });
  it("shares all item and settlement figures with approval wording and no currency symbol", () => {
    const text = billText(finalEstimate(), DEFAULT_SHOP);
    expect(text).toContain("OWNER-LINE-140"); expect(text).toContain("APPROVAL CHALLAN");
    for (const label of ["Gross:", "Advance:", "Paid:", "Previous balance:", "Total due:", "FINAL REMARKS"])
      expect(text).toContain(label);
    expect(text).not.toContain("₹"); expect(text).not.toContain("Rupees ");
  });
  it("sizes shared images after laying out long descriptions and the full final settlement", async () => {
    const draws: { text: string; y: number }[] = [];
    const g = {
      font: "", fillStyle: "", strokeStyle: "", textAlign: "left",
      measureText: (s: string) => ({ width: Array.from(s).length * 9 }),
      fillText: (text: string, _x: number, y: number) => draws.push({ text, y }),
      fillRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
      save: vi.fn(), restore: vi.fn(), translate: vi.fn(), rotate: vi.fn(),
    };
    const canvas = { width: 0, height: 0, getContext: () => g, toBlob: (cb: (b: Blob) => void) => cb(new Blob(["image"], { type: "image/png" })) };
    vi.stubGlobal("document", { createElement: () => canvas });
    const b = finalEstimate();
    b.items[139].item = "LONG FINAL ITEM ".repeat(20) + "FINAL DESCRIPTION END";
    await billImage(b, DEFAULT_SHOP);
    const text = draws.map(x => x.text).join(" ");
    expect(text.replace(/\s/g, "")).toContain(b.items[139].item.replace(/\s/g, ""));
    for (const label of ["APPROVAL CHALLAN", "ESTIMATE", "Previous balance", "Total due", "FINAL REMARKS"])
      expect(text).toContain(label);
    expect(text).not.toContain("₹");
    expect(canvas.height).toBeGreaterThan(Math.max(...draws.map(x => x.y)) + 20);
  });
});
