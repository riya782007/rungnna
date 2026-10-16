import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, now, type Bill, type BillLine } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { createDesign } from "../src/lib/inventory";
import { finalize, newBill, fixLine, convertToGst, DEFAULT_SHOP } from "../src/lib/billing";
import { purgeAllEstimates, purgeEstimates, allEstimateDocs } from "../src/lib/estimatePurge";

/* "Estimates have to have a permanent delete all button, from wherever they get saved." (owner, 16 Oct) */

let pid = "";
const line = (qty: number): BillLine => fixLine({ id: Math.random().toString(36).slice(2), product_id: pid, code: "X", item: "NECKLACE SET", type: "PCS", style: "K900", color: "GOLD", box_no: 1, pack: 1, pkts: 0, qty, rate: 50000, disc: "", amount: 0 });
const est = async (qty: number, extra: Partial<Bill> = {}) => finalize({ ...newBill("o", DEFAULT_SHOP, "estimate"), party_id: "p1", party_name: "SHREE BALAJI", party_phone: "9876543210", items: [line(qty)], ...extra }, "Delhi");
const onRack = async () => (await db.stock.toArray()).reduce((a, c) => a + c.qty, 0);

beforeEach(async () => {
  setScope(MAIN_STORE, "owner");
  await Promise.all(db.tables.map(t => t.clear()));
  await db.stores.put({ id: MAIN_STORE, name: "Main", code: "MAIN", updated_at: "" } as any);
  await db.locations.put({ id: "r1", name: "F1-A1", kind: "rack", store_id: MAIN_STORE, updated_at: "" } as any);
  await createDesign({ item: "NECKLACE SET", type: "PCS", style: "K900", pack: 1, cost: 0, rate: 50000, rack: "r1", by: "o", variants: [{ color: "GOLD", size: "", qty: 100 }] } as any);
  pid = (await db.products.toArray())[0].id;
});

describe("delete all estimates", () => {
  it("removes every estimate's content everywhere it is kept, and leaves the racks as they are", async () => {
    const a = await est(5, { remarks: "cash, no bill", salesman: "RAMESH" });
    const b = await est(3);
    const held = { ...newBill("o", DEFAULT_SHOP, "estimate"), status: "hold" as const, party_name: "HELD PARTY", items: [line(1)] };
    await db.bills.put(held);
    await db.receipts.put({ id: "r1", no: "RCPT/1", party_id: "p1", party_name: "SHREE BALAJI", amount: 300000, mode: "cash", note: "for EST", allocations: [{ bill_id: a.id, bill_no: a.no, amount: 200000 }, { bill_id: "gst-x", bill_no: "RJ/1", amount: 100000 }], opening_part: 0, unallocated: 0, device: "", by_staff: "", at: now(), updated_at: now(), store_id: MAIN_STORE } as any);
    await db.voice_notes.put({ id: "v1", entity: "bill", entity_id: a.id, seconds: 4, transcript: "give him 5 sets", by_staff: "", at: now(), updated_at: now() } as any);
    const before = await onRack();

    const r = await purgeAllEstimates({ returnStock: false, by: "owner" });
    expect(r.estimates).toBe(3);
    expect(await allEstimateDocs()).toHaveLength(0);

    for (const id of [a.id, b.id, held.id]) {
      const t = (await db.bills.get(id))!;
      expect(t.deleted).toBe(1);
      expect([t.no, t.party_name, t.party_phone, t.remarks, t.salesman]).toEqual(["", "", "", "", ""]);
      expect(t.items).toEqual([]); expect(t.net).toBe(0);
      expect(t.party_id).toBeNull();                         // null, so the cloud's copy is cleared too
    }
    // stock entries stay, saying nothing about whose estimate they were
    const moves = await db.movements.toArray();
    expect(moves.filter(m => m.kind === "sale").length).toBeGreaterThan(0);
    expect(moves.some(m => m.ref_bill === a.id || /EST/.test(m.note) || m.person_name === "SHREE BALAJI")).toBe(false);
    expect(await onRack()).toBe(before);
    // the payment for the estimate came off the receipt; the part for a tax invoice stayed
    const rc = (await db.receipts.get("r1"))!;
    expect(rc.amount).toBe(100000); expect(rc.allocations.map(x => x.bill_no)).toEqual(["RJ/1"]);
    // the voice note is emptied too
    expect((await db.voice_notes.get("v1"))).toMatchObject({ deleted: 1, transcript: "" });
    // and all of it is queued for the cloud and the other counters
    expect((await db.outbox.toArray()).some(o => o.table === "bills" && o.row_id === a.id)).toBe(true);
  });

  it("puts the pieces back on the racks only when told the goods never left", async () => {
    await est(5);
    const out = await onRack();
    const r = await purgeAllEstimates({ returnStock: true, by: "owner" });
    expect(r.backOnRacks).toBe(5);
    expect(await onRack()).toBe(out + 5);
  });

  it("a tax invoice made from an estimate stays, and keeps the stock history", async () => {
    const e = await est(4);
    const g = await convertToGst(e, DEFAULT_SHOP, "o");
    const r = await purgeEstimates([(await db.bills.get(e.id))!], { returnStock: true, by: "owner" });
    expect(r.invoicesKept).toBe(1); expect(r.backOnRacks).toBe(0);  // the goods went out on the invoice
    const inv = (await db.bills.get(g.id))!;
    expect(inv.deleted).toBeFalsy(); expect(inv.net).toBe(g.net); expect(inv.converted_from).toBeNull();
    expect((await db.movements.where("ref_bill").equals(g.id).toArray()).length).toBeGreaterThan(0);
  });

  it("a credit note returning goods from an estimate goes with it", async () => {
    const e = await est(2);
    const cn = { ...newBill("o", DEFAULT_SHOP, "return"), src_type: "estimate" as const, return_of: e.id, return_of_no: e.no, status: "final" as const, no: "ECN/1", items: [line(1)] };
    await db.bills.put(cn);
    const r = await purgeEstimates([(await db.bills.get(e.id))!], { returnStock: false, by: "owner" });
    expect(r.creditNotes).toBe(1);
    expect((await db.bills.get(cn.id))!.deleted).toBe(1);
  });

  it("a staff login can't do it", async () => {
    await est(1);
    setScope(MAIN_STORE, "salesman");
    await expect(purgeAllEstimates({ returnStock: false, by: "x" })).rejects.toThrow();
  });
});
