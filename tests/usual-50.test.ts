import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { getShop } from "../src/lib/billing";

/* Owner, 14 Nov, 13:57: estimates open at 50% even where the shop profile was saved with that box blank (0). */
describe("usual estimate discount from the shop profile", () => {
  it("is 50% when the profile says 0 or nothing", async () => {
    await db.config.put({ id: "shop", value: { name: "X", est_disc_pct: 0 }, updated_at: "" } as any);
    expect((await getShop()).est_disc_pct).toBe(50);
    await db.config.put({ id: "shop", value: { name: "X" }, updated_at: "" } as any);
    expect((await getShop()).est_disc_pct).toBe(50);
  });
  it("keeps another number the owner saved", async () => {
    await db.config.put({ id: "shop", value: { name: "X", est_disc_pct: 40 }, updated_at: "" } as any);
    expect((await getShop()).est_disc_pct).toBe(40);
  });
});
