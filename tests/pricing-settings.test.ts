import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { DEFAULT_RULE, evenRate, getRule, priceSteps, saveRule, sellFromCost } from "../src/lib/pricing";
import { MAIN_STORE, setScope } from "../src/lib/scope";

beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); });

describe("pricing settings the owner controls (18 Oct)", () => {
  it("shows each step from cost to sticker rate", () => {
    const rule = { ...DEFAULT_RULE, margin: { ...DEFAULT_RULE.margin, factor: 2.5, round_to: 1 as const, round_dir: "up" as const } };
    expect(priceSteps(39000, rule)).toEqual({ raw: 97500, rounded: 97500, final: 97600 });   // 390 × 2.5 = 975 → even 976
    expect(sellFromCost(39000, rule)).toBe(97600);
    expect(priceSteps(39000, { ...rule, even_rate: false }).final).toBe(97500);
  });
  it("the even-rate switch reaches every sticker once saved, and is on by default", async () => {
    expect((await getRule()).even_rate).toBe(true);
    expect(evenRate(97500)).toBe(97600);
    await saveRule({ ...DEFAULT_RULE, even_rate: false });
    expect(evenRate(97500)).toBe(97500);
    expect((await getRule()).even_rate).toBe(false);
    await saveRule({ ...DEFAULT_RULE, even_rate: true });
    expect(evenRate(97500)).toBe(97600);
  });
});
