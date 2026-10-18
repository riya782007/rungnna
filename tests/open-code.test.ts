import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { DEFAULT_OPEN_CODE, codeMatches, normCode, getOpenCode, setOpenCode } from "../src/lib/openCode";

/* One phrase opens the counter. The old screen asked for a cloud email + password,
   then a person, then that person's PIN — three walls before the first bill. */

describe("the shop passcode", () => {
  beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); });

  it("opens with the phrase the owner asked for", () => {
    expect(codeMatches("rungnna 2026")).toBe(true);
    expect(DEFAULT_OPEN_CODE).toBe("rungnna 2026");
  });

  it("forgives the way a tired thumb types it", () => {
    for (const typed of ["Rungnna 2026", "RUNGNNA 2026", "  rungnna   2026  ", "rungnna  2026", "rungnna2026", "RUNGNNA2026"])
      expect(codeMatches(typed), typed).toBe(true);
  });

  it("does not open on a near miss, or on nothing at all", () => {
    for (const typed of ["", "   ", "rungnna", "2026", "rungnna 2025", "rungna 2026", "rungnna20266"])
      expect(codeMatches(typed), JSON.stringify(typed)).toBe(false);
  });

  it("uses the shop's own phrase once one is set, and not the default", async () => {
    await setOpenCode("Matke Wali 5827");
    const saved = await getOpenCode();
    expect(codeMatches("matke wali 5827", saved)).toBe(true);
    expect(codeMatches("rungnna 2026", saved)).toBe(false);   // the default stops working
  });

  it("a blank passcode restores the default instead of locking the shop out of its own counter", async () => {
    await setOpenCode("Matke Wali 5827");
    const back = await setOpenCode("   ");
    expect(back).toBe(DEFAULT_OPEN_CODE);
    expect(codeMatches("rungnna 2026", await getOpenCode())).toBe(true);
  });

  it("stores it the same way it compares it, so saving 'Rungnna 2026' still opens with 'rungnna 2026'", async () => {
    await setOpenCode("  Rungnna   2026 ");
    expect(await getOpenCode()).toBe("rungnna 2026");
    expect(normCode("  Rungnna   2026 ")).toBe("rungnna 2026");
  });

  it("falls back to the default before anything has been saved", async () => {
    expect(await getOpenCode()).toBe(DEFAULT_OPEN_CODE);
  });
});
