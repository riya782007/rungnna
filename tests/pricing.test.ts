import { describe, it, expect } from "vitest";
import { sellFromCost, costCode, decodeCostCode, priceFromCost, validateKey, DEFAULT_RULE, type PricingRule } from "../src/lib/pricing";

const rule = (p: Partial<PricingRule["margin"]> = {}, c: Partial<PricingRule["code"]> = {}): PricingRule => ({
  margin: { ...DEFAULT_RULE.margin, ...p },
  code: { ...DEFAULT_RULE.code, ...c },
});

describe("cost-code encryption engine", () => {
  it("same cost always gives the same code (deterministic)", () => {
    const r = rule();
    expect(costCode(12000, r)).toBe(costCode(12000, r));
    expect(costCode(12000, r, 12, "PCS")).toBe(costCode(12000, r, 12, "PCS"));
  });

  it("different costs give different codes (₹12 vs ₹120)", () => {
    const r = rule();
    expect(costCode(1200, r)).not.toBe(costCode(12000, r));
  });

  it("letters method spells the rupee cost with the secret key", () => {
    // key MONEYBAGSX -> 0=M 1=O 2=N 3=E 4=Y 5=B 6=A 7=G 8=S 9=X
    const r = rule({}, { method: "letters", key: "MONEYBAGSX", suffix_pack: false, prefix: "" });
    expect(costCode(12000, r)).toBe("ONM");   // 120 -> O N M
    expect(costCode(9500, r)).toBe("XB");     // 95  -> X B
  });

  it("appends the packing suffix like the shop's current labels", () => {
    const r = rule({}, { method: "letters", key: "MONEYBAGSX", suffix_pack: true });
    expect(costCode(12000, r, 12, "PCS")).toBe("ONMX12PCS");
    expect(costCode(12000, r, 1, "PCS")).toBe("ONMX1PCS");
  });

  it("owner can read the cost back out of the code (round-trip)", () => {
    for (const method of ["letters", "shift", "plain"] as const) {
      const r = rule({}, { method, key: "MONEYBAGSX", mult: 3, add: 7, suffix_pack: true });
      for (const cost of [1200, 9500, 12000, 25000, 100000]) {
        const code = costCode(cost, r, 12, "PCS");
        expect(decodeCostCode(code, r)).toBe(cost);
      }
    }
  });

  it("sell price: multiply, divide, percent + rounding", () => {
    expect(sellFromCost(10000, rule({ mode: "multiply", factor: 2.5, round_to: 5 }))).toBe(25000);   // 100*2.5=250
    expect(sellFromCost(10000, rule({ mode: "percent", percent: 150, round_to: 5 }))).toBe(25000);   // +150% = 250
    expect(sellFromCost(20000, rule({ mode: "divide", factor: 0.5, round_to: 0 }))).toBe(40000);     // 200/0.5=400
  });

  it("rounds the sell price to the nearest / up to N rupees", () => {
    expect(sellFromCost(9700, rule({ mode: "multiply", factor: 2, round_to: 10, round_dir: "nearest" }))).toBe(19000); // 194 -> 190
    expect(sellFromCost(9700, rule({ mode: "multiply", factor: 2, round_to: 10, round_dir: "up" }))).toBe(20000);      // 194 -> 200
  });

  it("priceFromCost returns both the sell rate and the encrypted code", () => {
    const r = rule({ mode: "multiply", factor: 2.5, round_to: 5 }, { method: "letters", key: "MONEYBAGSX", suffix_pack: true });
    const out = priceFromCost(12000, r, 12, "PCS");
    expect(out.rate).toBe(30000);            // 120 * 2.5 = 300
    expect(out.cost_code).toBe("ONMX12PCS"); // cost 120 hidden
  });

  it("validates the 10-letter secret key", () => {
    expect(validateKey("MONEYBAGSX")).toBeNull();
    expect(validateKey("SHORT")).toMatch(/10 letters/);
    expect(validateKey("AABCDEFGHI")).toMatch(/different/);
    expect(validateKey("MONEY12345")).toMatch(/A–Z/);
  });
});
