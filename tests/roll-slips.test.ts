import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { BagTag, CashSlip, InvoiceSheet, rollSlips } from "../src/components/Invoice";
import { newBill, DEFAULT_SHOP } from "../src/lib/billing";
import { bagLabelJobs, carryBags } from "../src/lib/bag-labels";
import { manualLine } from "../src/lib/pos";
import type { Bill } from "../src/lib/db";

const saved = (over: Partial<Bill> = {}): Bill => ({ ...newBill("o", DEFAULT_SHOP, "estimate"), no: "EST/26/0002", status: "final" as const, party_name: "POONAM JI", party_phone: "9313997376", net: 246100, total_qty: 29, box_count: 2,
  items: [manualLine({ item: "EARING", style: "", color: "", unit: "PAIR", hsn: "7117", qty: "2", rate: "104", box: 1 }), manualLine({ item: "KAMARBELT", style: "", color: "", unit: "PCS", hsn: "7117", qty: "2", rate: "94", box: 2 })], ...over });

describe("roll printer slips after the bill (owner, 26 Oct)", () => {
  it("counts carry bags, not boxes", () => {
    expect(carryBags(saved())).toBe(1);
    expect(carryBags(saved({ carry_bags: 3 }))).toBe(3);
    expect(bagLabelJobs(saved({ carry_bags: 3 }))).toHaveLength(3);
    expect(bagLabelJobs(saved({ carry_bags: 3 }))[0].p.color).toBe("BAG 1 OF 3");
  });
  it("plans bill → one tag per carry bag → cash slip, only on the roll for a saved bill", () => {
    const b = saved({ carry_bags: 2 });
    expect(rollSlips(b, "80mm", { tags: true, cash: true })).toEqual([{ kind: "tag", n: 1 }, { kind: "tag", n: 2 }, { kind: "cash" }]);
    expect(rollSlips(b, "58mm", { tags: false, cash: true })).toEqual([{ kind: "cash" }]);
    expect(rollSlips(b, "a5", { tags: true, cash: true })).toEqual([]);
    expect(rollSlips({ ...b, status: "hold" as const }, "80mm", { tags: true, cash: true })).toEqual([]);
    expect(rollSlips({ ...b, bill_type: "challan" as const }, "80mm", { tags: true, cash: true })).toEqual([{ kind: "tag", n: 1 }, { kind: "tag", n: 2 }]);
  });
  it("bag tag shows bag n of N, the customer and the bill number, measured as its own receipt", () => {
    const html = renderToStaticMarkup(createElement(BagTag, { b: saved({ carry_bags: 2 }), shop: DEFAULT_SHOP, n: 2, feed: 25 }));
    expect(html).toContain("BAG 2 OF 2"); expect(html).toContain("POONAM JI"); expect(html).toContain("EST/26/0002");
    expect(html).toContain('data-thermal-width="80"'); expect(html).toContain("<svg"); expect(html).toContain("height:25mm");
  });
  it("cash slip shows the customer, bill number and the amount to collect", () => {
    const html = renderToStaticMarkup(createElement(CashSlip, { b: saved({ carry_bags: 2 }), shop: DEFAULT_SHOP, width: 58 }));
    expect(html).toContain("CASH COUNTER"); expect(html).toContain("POONAM JI"); expect(html).toContain("EST/26/0002");
    expect(html).toContain("TO COLLECT"); expect(html).toContain("2,461"); expect(html).toContain('data-thermal-width="58"');
  });
  it("the bill mentions the carry bags", () => {
    expect(renderToStaticMarkup(createElement(InvoiceSheet, { b: saved({ carry_bags: 2 }), shop: DEFAULT_SHOP, format: "80mm" }))).toContain("Carry bags:");
  });
});
