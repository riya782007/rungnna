import { describe, it, expect, vi, afterEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSheet } from "../src/components/Invoice";
import { billText, billImage, DEFAULT_SHOP, newBill, totals } from "../src/lib/billing";
import { manualLine } from "../src/lib/pos";
import { documentAmount, documentDiscount } from "../src/lib/estimate-display";
const make = () => totals({ ...newBill("owner", DEFAULT_SHOP, "estimate"), no: "EST/1", prev_due: 10000, packing: 500, advance: 1000,
  payments: [{ mode: "upi" as const, amount: 2000, recipient: "Karan" }],
  items: [manualLine({ item: "NATH", style: "", color: "", unit: "PCS", hsn: "", qty: "48", rate: "124", box: 1 })], discount_pct: 50 }, "Delhi");
afterEach(() => vi.unstubAllGlobals());
describe("estimate presentation", () => {
  it("scales only displayed estimate figures and preserves exact small amounts", () => {
    expect(documentAmount({bill_type:"estimate"},12400)).toBe("12.40");
    expect(documentAmount({bill_type:"estimate"},10025)).toBe("10.025");
    expect(documentAmount({bill_type:"estimate"},-25)).toBe("-0.025");
    expect(documentDiscount({bill_type:"estimate"},"12.50")).toBe("1.25");
    expect(documentDiscount({bill_type:"estimate"},"50%")).toBe("50%");
    for(const bill_type of ["gst","challan","return"] as const) expect(documentAmount({bill_type},12400)).toBe("124.00");
  });
  it("prints and shares the same figures without changing the saved bill or adding a payment link", () => {
    const b=make(), before=JSON.stringify(b), shop={...DEFAULT_SHOP,upi:"shop@example"};
    for(const format of ["a4","a5","80mm","58mm"] as const) {
      const html=renderToStaticMarkup(<InvoiceSheet b={b} shop={shop} format={format}/>);
      expect(html).toContain("12.40"); expect(html).toContain("595.20");
      expect(html).toContain("297.60"); expect(html).toContain("UPI 2.00 received by Karan");
      expect(html).not.toContain("upi://"); expect(html).not.toContain("÷10"); expect(html).not.toContain("5,952.00");
    }
    const text=billText(b,shop);
    expect(text).toContain("48 × 12.40 = 595.20"); expect(text).toContain("Discount: -297.60");
    expect(text).toContain("Packing: 0.50"); expect(text).toContain("Advance: -1.00");
    expect(text).toContain("UPI 2.00 received by Karan"); expect(text).not.toContain("upi://");
    expect(JSON.stringify(b)).toBe(before);
    const gst=renderToStaticMarkup(<InvoiceSheet b={{...b,bill_type:"gst"}} shop={DEFAULT_SHOP} format="a5"/>);
    expect(gst).toContain("124.00"); expect(gst).toContain("5,952.00");
  });
  it("uses the same display amounts in shared receipt images", async () => {
    const texts:string[]=[];
    const g={font:"",fillStyle:"",strokeStyle:"",textAlign:"",measureText:(s:string)=>({width:s.length*8}),fillText:(s:string)=>texts.push(s),fillRect:vi.fn(),beginPath:vi.fn(),moveTo:vi.fn(),lineTo:vi.fn(),stroke:vi.fn(),save:vi.fn(),restore:vi.fn(),translate:vi.fn(),rotate:vi.fn()};
    vi.stubGlobal("document",{createElement:()=>({width:0,height:0,getContext:()=>g,toBlob:(cb:(b:Blob)=>void)=>cb(new Blob(["image"]))})});
    await billImage(make(),DEFAULT_SHOP);
    expect(texts.join(" ")).toContain("rate 12.40");expect(texts).toContain("595.20");expect(texts).toContain("-297.60");
  });
});
