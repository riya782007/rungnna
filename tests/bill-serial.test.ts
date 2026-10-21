import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, now } from "../src/lib/db";
import { newParty } from "../src/lib/billing";
import { combineRepeatedRows, savePhotoPurchase, type PhotoRow } from "../src/lib/purchase-photo";
import { purchaseLabelJobs } from "../src/lib/purchase-labels";
import { renderLabelSvg } from "../src/lib/label-artwork";
import { DEFAULT_CFG } from "../src/pages/Labels";
import { MAIN_STORE, setScope } from "../src/lib/scope";

/* Owner, 21 Oct (Invock bill: "1-1 … 1-15" = box 1, line 1…15): the number in the sticker's box must be the
   supplier bill's own serial, so a packet is matched to its bill line even after repeated lines are combined. */
beforeEach(async () => {
  await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner");
  await db.parties.put({ ...newParty("SUPPLIER"), id: "s", kind: "supplier" });
  await db.locations.put({ id: "rack", floor: "1", rack: "1", box: "", kind: "rack", code: "F1-R01", name: "", updated_at: now() });
});
const row = (sr: string, o: Partial<PhotoRow> = {}): PhotoRow => ({ item: "01 PIK DAMMI", style: "104208", color: "", unit: "PCS", hsn: "7117", qty: "3", cost: "92", rate: "230", sr, ...o });

describe("supplier bill serial on stickers", () => {
  it("a combined line keeps both serials", () => {
    const { rows, combined } = combineRepeatedRows([row("1-4", { style: "100171", rate: "768", cost: "307" }), row("1-5"), row("1-13", { style: "100171", rate: "768", cost: "307" })]);
    expect(combined).toBe(1);
    expect(rows.map(r => r.sr)).toEqual(["1-4+1-13", "1-5"]);
  });
  it("is saved with the purchase and printed in the sticker's box", async () => {
    const pur = await savePhotoPurchase([row("1-10"), row("", { style: "104207", rate: "254" })], { by: "o", rack: "rack", supplierId: "s", billNo: "B1", note: "" });
    expect(pur.items.map(l => l.bill_sr)).toEqual(["1-10", undefined]);
    const jobs = purchaseLabelJobs(pur, await db.products.toArray());
    expect(jobs.map(j => j.line)).toEqual(["1-10", 2]);          // no serial read: the line's position, as before
    const svg = renderLabelSvg({ ...DEFAULT_CFG, show: { ...DEFAULT_CFG.show, style: true, rate: true, qty: true, line: true } }, jobs[0].p, jobs[0].qtyOnLabel, jobs[0].line);
    expect(svg).toContain(">1-10<");
  });
});
