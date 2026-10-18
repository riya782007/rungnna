import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { ensureRack, rackCode } from "../src/components/RackPicker";

/* Owner, 18 Oct: "the location only shows floor 1 — make it all three floors, and customisable for racks and floors". */
beforeEach(async () => { setScope(MAIN_STORE, "owner"); await Promise.all(db.tables.map(t => t.clear())); });

describe("picking where goods go", () => {
  it("writes codes the way the Racks page does", () => {
    expect(rackCode("2", "7", "")).toBe("F2-R07");
    expect(rackCode("1", "3", "2")).toBe("F1-R03-B02");
    expect(rackCode("G", "1", "")).toBe("G-R01");
  });
  it("adds a rack on floor 2 or 3 the first time it is used, and reuses it after", async () => {
    const a = await ensureRack("2", "7");
    expect(a).toMatchObject({ code: "F2-R07", floor: "2", rack: "7", kind: "rack" });
    const b = await ensureRack("2", "07");
    expect(b.id).toBe(a.id);
    expect(await db.locations.count()).toBe(1);
  });
  it("brings back a rack that was removed instead of failing on its code", async () => {
    const a = await ensureRack("3", "1");
    await db.locations.put({ ...a, deleted: 1 });
    const b = await ensureRack("3", "1");
    expect(b.id).toBe(a.id); expect(b.deleted).toBeFalsy();
  });
  it("needs a floor and a rack number", async () => {
    await expect(ensureRack("2", " ")).rejects.toThrow(/rack number/);
  });
});
