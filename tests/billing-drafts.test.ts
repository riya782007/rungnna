import "fake-indexeddb/auto";
import { afterEach, beforeEach, expect, it } from "vitest";
import { db, deviceId } from "../src/lib/db";
import { DEFAULT_SHOP, newBill, fixLine } from "../src/lib/billing";
import { parkBillingDraft, resumeBillingDraft } from "../src/lib/billing-drafts";
import { setCode, unlock, lockNow } from "../src/lib/privacy";
import { MAIN_STORE, setScope } from "../src/lib/scope";

beforeEach(async () => {
  setScope(MAIN_STORE, "owner");
  lockNow();
  await Promise.all([db.bills.clear(), db.settings.clear(), db.config.clear(), db.outbox.clear()]);
  await setCode("draft-test", "", 1);
});
afterEach(() => lockNow());
const draft = (type: "estimate" | "gst") => ({ ...newBill("owner", DEFAULT_SHOP, type), party_name: type === "estimate" ? "Estimate customer" : "Tax customer", items: [fixLine({ id: type + "-line", code: "P", item: "BALI", style: "S1", color: "G", type: "PCS", box_no: 3, pack: 1, pkts: 0, qty: 2, rate: 10000, disc: "", amount: 0 })] });
it("recovers the same estimate after locking and working on a separate invoice", async () => {
  await unlock("draft-test");
  const estimate = draft("estimate");
  await parkBillingDraft(estimate, 7, DEFAULT_SHOP);
  lockNow();
  expect(await resumeBillingDraft("estimate")).toBeNull();
  const invoice = draft("gst");
  await parkBillingDraft(invoice, 2, DEFAULT_SHOP);
  expect(await resumeBillingDraft("gst")).toMatchObject({ id: invoice.id, bill_type: "gst", selected_box: 2 });
  await unlock("draft-test");
  expect(await resumeBillingDraft("estimate")).toMatchObject({ id: estimate.id, party_name: "Estimate customer", bill_type: "estimate", selected_box: 7, items: estimate.items });
  expect((await db.bills.get(invoice.id))?.items).toEqual(invoice.items);
});
it("recovers a legacy held estimate on this counter but excludes other stores and devices", async () => {
  const legacy = draft("estimate");
  await db.bills.put(legacy);
  await db.bills.put({ ...draft("estimate"), device: "another-counter", updated_at: "9999" });
  await db.bills.put({ ...draft("estimate"), store_id: "other-store", updated_at: "9999" });
  await unlock("draft-test");
  expect(await resumeBillingDraft("estimate")).toMatchObject({ id: legacy.id, device: deviceId(), selected_box: 3 });
});
it("does not reopen a finalized or discarded draft", async () => {
  const invoice = draft("gst");
  await parkBillingDraft(invoice, 2, DEFAULT_SHOP);
  await db.bills.update(invoice.id, { status: "final", no: "RJ/TEST" });
  expect(await resumeBillingDraft("gst")).toBeNull();
  await db.bills.update(invoice.id, { status: "hold", no: "", deleted: 1 });
  expect(await resumeBillingDraft("gst")).toBeNull();
});
it("updates held content before switching and refuses to overwrite a final document", async () => {
  const invoice = draft("gst");
  await parkBillingDraft(invoice, 2, DEFAULT_SHOP);
  await parkBillingDraft({ ...invoice, party_name: "Changed customer", items: invoice.items.map(l => ({ ...l, qty: 4 })) }, 5, DEFAULT_SHOP);
  expect(await resumeBillingDraft("gst")).toMatchObject({ id: invoice.id, party_name: "Changed customer", selected_box: 5, total_qty: 4 });
  await db.bills.update(invoice.id, { status: "final", no: "RJ/TEST" });
  await expect(parkBillingDraft(invoice, 2, DEFAULT_SHOP)).rejects.toThrow("Final documents");
});
