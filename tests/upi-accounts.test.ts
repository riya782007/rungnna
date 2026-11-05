import { describe, it, expect } from "vitest";
import { upiAccounts, qrAccount, upiLink, NO_QR } from "../src/lib/upi";
import { eodReport } from "../src/lib/eod";
import type { Bill } from "../src/lib/db";

const shop = { upi: "rungnna@okaxis", upi2: "ram@ybl", upi2_name: "Karigar" };
describe("whose UPI QR prints on the bill (owner, 5 Nov)", () => {
  it("GST bills default to the shop, estimates to the karigar, and the counter can switch or remove it", () => {
    expect(upiAccounts(shop).map(a => a.name)).toEqual(["Shop", "Karigar"]);
    expect(qrAccount({ bill_type: "gst" }, shop)?.upi).toBe("rungnna@okaxis");
    expect(qrAccount({ bill_type: "estimate" }, shop)?.upi).toBe("ram@ybl");
    expect(qrAccount({ bill_type: "estimate", pay_to: "Shop" }, shop)?.upi).toBe("rungnna@okaxis");
    expect(qrAccount({ bill_type: "gst", pay_to: NO_QR }, shop)).toBeUndefined();
  });
  it("never puts the shop's own UPI on an estimate by itself", () => {
    expect(qrAccount({ bill_type: "estimate" }, { upi: "rungnna@okaxis" })).toBeUndefined();
    expect(qrAccount({ bill_type: "gst" }, { upi: "" })).toBeUndefined();
  });
  it("the QR carries the amount and the bill no., in the karigar's name for his account", () => {
    const link = upiLink({ name: "Karigar", upi: "ram@ybl" }, "RUNGNNA", 4364700, "EST/26/12");
    expect(link).toBe("upi://pay?pa=ram%40ybl&pn=Karigar&am=43647.00&cu=INR&tn=EST%2F26%2F12");
  });
});

describe("End of day: UPI split by account", () => {
  it("adds each UPI payment to the account it went to", () => {
    const at = "2026-11-05T08:00:00.000Z";
    const bill = (id: string, payments: Bill["payments"]) => ({ id, bill_type: "gst", status: "final", at, net: 100000, advance: 0, paid: 0, total_qty: 1, payments, items: [] }) as unknown as Bill;
    const r = eodReport([
      bill("a", [{ mode: "upi", amount: 30000, at, recipient: "Shop" }, { mode: "cash", amount: 10000, at }]),
      bill("b", [{ mode: "upi", amount: 50000, at, recipient: "Karigar" }, { mode: "upi", amount: 5000, at }]),
    ], [], "2026-11-05", 0, true);
    expect(r.upiBy).toEqual({ Shop: 30000, Karigar: 50000, "Not tagged": 5000 });
    expect(r.cashIn).toBe(10000);
  });
});
