import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, type Payment } from "../src/lib/db";
import { billNarration, paymentNarration } from "../src/lib/payment-narration";
import { newBill, DEFAULT_SHOP, billText } from "../src/lib/billing";
import { ledger } from "../src/lib/ledger";
import { newParty } from "../src/lib/billing";
import { MAIN_STORE, setScope, setCompanyKind } from "../src/lib/scope";

beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); setCompanyKind(undefined); });

describe("UPI recipient narration", () => {
  const payments: Payment[] = [{ mode: "upi", amount: 200000, recipient: " Karan " }, { mode: "upi", amount: 50000, recipient: "Raj" }];
  it("follows split amounts and recipients while keeping typed remarks", () => {
    expect(billNarration({ remarks: "Transport\nMarka 7", payments })).toBe("Transport\nMarka 7\nUPI 2,000.00 received by Karan; UPI 500.00 received by Raj");
    expect(paymentNarration([{ ...payments[0], amount: 125000 }])).toBe("UPI 1,250.00 received by Karan");
    expect(paymentNarration([])).toBe("");
  });
  it("does not invent a recipient or describe blank/zero/cash payments as UPI", () => {
    expect(paymentNarration([{ mode: "upi", amount: 0, recipient: "Raj" }, { mode: "upi", amount: 50000 }, { mode: "cash", amount: 10000, recipient: "Raj" }])).toBe("");
    expect(billNarration({ remarks: "Keep this", payments: [] })).toBe("Keep this");
  });
  it("survives saving and appears in the shared bill and customer account without changing balances", async () => {
    const party = newParty("Customer", "");
    const bill = { ...newBill("owner", DEFAULT_SHOP, "gst"), party_id: party.id, party_name: party.name, status: "final" as const, no: "INV/TEST/1", total_qty: 2, net: 300000, paid: 250000, payments, remarks: "Marka 7" };
    await db.bills.put(bill);
    const saved = (await db.bills.get(bill.id))!;
    expect(saved.payments[0].recipient).toBe(" Karan ");
    expect(billText(saved, DEFAULT_SHOP)).toContain("UPI 2,000.00 received by Karan");
    const account = await ledger(party);
    expect(account.balance).toBe(50000);
    expect(account.entries.find(e => e.kind === "bill")?.note).toContain("Marka 7");
    expect(account.entries.find(e => e.kind === "paid")?.note).toContain("UPI 500.00 received by Raj");
  });
});
