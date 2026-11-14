import { expect, it } from "vitest";
import { planPicks } from "../src/lib/picking";
import { tallyXml } from "../src/lib/tally";
import { parseScale, piecesFromWeight } from "../src/lib/scale";

it("splits a bill by floor and rack, taking the rack that can give it all", () => {
  const locs = [{ id: "a", floor: "1", rack: "4", box: "2", code: "F1-R4-B2", kind: "rack" }, { id: "b", floor: "2", rack: "1", box: "1", code: "F2-R1-B1", kind: "rack" }, { id: "d", floor: "", code: "DAMAGED", kind: "bucket" }] as any;
  const cells = [{ product_id: "p1", loc_id: "a", qty: 5 }, { product_id: "p1", loc_id: "b", qty: 20 }, { product_id: "p2", loc_id: "a", qty: 3 }, { product_id: "p2", loc_id: "d", qty: 50 }];
  const plan = planPicks([{ product_id: "p1", code: "A", item: "BANGLE", qty: 12 }, { product_id: "p2", code: "B", item: "RING", qty: 5 }], cells, locs);
  expect(plan.get("2")).toEqual([expect.objectContaining({ code: "A", qty: 12, rack: "2".replace("2", "1") })]);
  expect(plan.get("1")?.map(x => [x.code, x.qty])).toEqual([["B", 3]]);
  expect(plan.get("?")?.map(x => [x.code, x.qty])).toEqual([["B", 2]]);   // the damaged bucket is never picked from
});

it("makes a balanced Tally file without estimates", () => {
  const bill = (no: string, type: string, net: number, cgst: number) => ({ id: no, no, bill_type: type, status: "final", at: "2026-11-14T06:00:00Z", party_name: "CUST A & SONS", net, cgst, sgst: cgst, igst: 0, total_qty: 5, payments: [{ mode: "cash", amount: 50000 }] }) as any;
  const r = tallyXml({ bills: [bill("INV/1", "gst", 103000, 1500), bill("EST/1", "estimate", 50000, 0)], receipts: [], vouchers: [{ type: "expense", category: "tea", amount: 5000, mode: "cash", no: "EX/1", at: "2026-11-14T06:00:00Z", note: "" }] as any, purchases: [], parties: [] });
  expect(r.count).toBe(3); expect(r.skipped).toBe(1);
  expect(r.xml).toContain("CUST A &amp; SONS"); expect(r.xml).not.toContain("EST/1");
  for (const v of r.xml.split("<VOUCHER ").slice(1)) {
    const sum = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((a, m) => a + Number(m[1]), 0);
    expect(Math.abs(sum)).toBeLessThan(0.001);
  }
  expect(r.xml).toContain("<LEDGERNAME>Sales GST 3%</LEDGERNAME><ISDEEMEDPOSITIVE>No</ISDEEMEDPOSITIVE><AMOUNT>1000.00</AMOUNT>");
});

it("reads scale lines and counts pieces by weight", () => {
  expect(parseScale("ST,GS,+  1.234kg")).toMatchObject({ grams: 1234, stable: true });
  expect(parseScale("US,GS,+  0.500kg")).toMatchObject({ grams: 500, stable: false });
  expect(parseScale("   812 g")?.grams).toBe(812);
  expect(piecesFromWeight(4012, 4)).toMatchObject({ pieces: 1003, sure: true });
  expect(piecesFromWeight(4100, 4, 100)).toMatchObject({ pieces: 1000, sure: true });
  expect(piecesFromWeight(1002, 4).sure).toBe(false);
});

import { pinsForAddress } from "../src/lib/pincode";
it("suggests no PIN code when only the state is known", () => {
  const t = { byWord: new Map([["delhi", [0]]]), rows: [] } as any;
  expect(pinsForAddress(t, "", 4, "Delhi")).toEqual([]);
});
