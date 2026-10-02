import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { bankDate, bankMap, parseBankRows, importBank, matchScore, acceptMatch, voucherFromBank, bankCandidates } from "../src/lib/bank";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { saveVoucher } from "../src/lib/vouchers";
import { newParty } from "../src/lib/billing";
beforeEach(async () => { setScope(MAIN_STORE, "owner"); await Promise.all(db.tables.map(t => t.clear())); });
const parsed = () => parseBankRows([["02/10/2026", "UPI/RAVI/123456789012", "", "1,000.50", "123456789012"]], { date: 0, narration: 1, debit: 2, credit: 3, ref: 4 }, "HDFC 1234");
describe("bank reconciliation", () => {
  it("detects SBI and HDFC headers", () => { expect(bankMap(["Txn Date", "Description", "Debit", "Credit", "Ref No."])).toMatchObject({ date: 0, narration: 1, debit: 2, credit: 3 }); expect(bankMap(["Date", "Narration", "Withdrawal Amt.", "Deposit Amt.", "Chq./Ref.No."])).toMatchObject({ date: 0, narration: 1, debit: 2, credit: 3, ref: 4 }); });
  it("parses Indian dates, month names and Excel dates; rejects impossible dates", () => { expect(bankDate("02-Oct-26")).toBe("2026-10-02"); expect(bankDate(45932)).toBe("2025-10-02"); expect(() => bankDate("31/02/2026")).toThrow("Invalid"); });
  it("does not import the same statement twice", async () => { expect(await importBank(parsed())).toBe(1); expect(await importBank(parsed())).toBe(0); expect(await db.bank_lines.count()).toBe(1); });
  it("matches exact paise, direction, date window and reference", async () => { await importBank(parsed()); const l = (await db.bank_lines.toArray())[0], c = { key: "r", table: "receipts" as const, id: "r", amount: 100050, credit: true, name: "RAVI", ref: "123456789012", no: "RC/1", at: "2026-10-05T12:00:00Z" }; expect(matchScore(l, c)).toBeGreaterThan(100); expect(matchScore(l, { ...c, amount: 100000 })).toBe(0); expect(matchScore(l, { ...c, at: "2026-10-06T12:00:00Z" })).toBe(0); });
  it("refuses matching a voucher twice", async () => { const v = await saveVoucher({ type: "receipt", mode: "bank", amount: 100050, by: "o", at: "2026-10-02T12:00:00Z" }); await importBank([...parsed(), { ...parsed()[0], fingerprint: "second", narration: "Another line" }]); const lines = await db.bank_lines.toArray(); await acceptMatch(lines[0].id, "vouchers:" + v.id); await expect(acceptMatch(lines[1].id, "vouchers:" + v.id)).rejects.toThrow("already reconciled"); });
  it("creates a dated receipt and reconciliation together", async () => { await importBank(parsed()); const p = newParty("Ravi"); await db.parties.put(p); const l = (await db.bank_lines.toArray())[0]; const v = await voucherFromBank(l.id, "receipt", "o", p); expect(v.at.slice(0, 10)).toBe("2026-10-02"); expect((await db.bank_lines.get(l.id))?.match_key).toBe("receipts:" + v.id); expect((await bankCandidates())[0].amount).toBe(100050); });
  it("rolls back voucher creation when the bank line cannot be saved", async () => { await importBank([{ ...parsed()[0], debit: 100050, credit: 0 }]); const l = (await db.bank_lines.toArray())[0]; const hook = () => { throw new Error("disk failure"); }; db.bank_lines.hook("updating", hook); try { await expect(voucherFromBank(l.id, "expense", "o")).rejects.toThrow("disk failure"); } finally { db.bank_lines.hook("updating").unsubscribe(hook); } expect(await db.vouchers.count()).toBe(0); expect((await db.bank_lines.get(l.id))?.match_key).toBeUndefined(); });
});
