import { describe, it, expect } from "vitest";
import fs from "fs";
import { parsePins, pinsForAddress, placeOfPin } from "../src/lib/pincode";

const t = parsePins(fs.readFileSync("public/pincodes.txt", "utf8"));

/* Owner, 10 Nov (voice): many customers don't know their PIN code — take it from the address. */
describe("PIN code from the address", () => {
  it("finds the shop's own street", () => {
    expect(pinsForAddress(t, "5827 Gali Matke Wali, Sadar Bazar, Delhi")[0].pin).toBe("110006");
  });
  it("prefers the shop's state when the address names no city", () => {
    expect(pinsForAddress(t, "Sadar Bazar", 4, "07")[0].pin).toBe("110006");
  });
  it("uses the city to choose between places with the same name", () => {
    const r = pinsForAddress(t, "Main market, Karol Bagh New Delhi");
    expect(r[0].pin).toBe("110005");
  });
  it("finds a town elsewhere in India", () => {
    const r = pinsForAddress(t, "Station road, Meerut City, UP");
    expect(r.map(x => x.state)).toContain("Uttar Pradesh");
  });
  it("says nothing for words that name no place", () => {
    expect(pinsForAddress(t, "near main road shop no 4")).toEqual([]);
  });
  it("fills district and state from a typed PIN code, Telangana included", () => {
    expect(placeOfPin(t, "110006")).toMatchObject({ state: "Delhi", stateCode: "07" });
    expect(placeOfPin(t, "500001")?.state).toBe("Telangana");
  });
});

describe("PIN code from the address, another state (owner, 15 Nov)", () => {
  it("keeps to the state the address names", () => {
    expect(pinsForAddress(t, "shop no 7 guru kripa market ROHTAK haryana", 4, "07")[0].pin).toBe("124001");
    expect(pinsForAddress(t, "KAROL BAGH Delhi", 4, "07").every(p => p.state === "Delhi")).toBe(true);
  });
});

describe("area with a different sector number (owner, 25 Nov: rohini sector 20 → 110001)", () => {
  it("offers Rohini's PIN, not New Delhi's", async () => {
    const { readFileSync } = await import("node:fs");
    const { parsePins, pinsForAddress } = await import("../src/lib/pincode");
    const t = parsePins(readFileSync("public/pincodes.txt", "utf8"));
    const hits = pinsForAddress(t, "rohini sector 20 jagdamba market, Delhi", 4, "07").map(p => p.pin);
    expect(hits[0]).toMatch(/^1100(85|89)$/);
    expect(hits.indexOf("110001")).not.toBe(0);
  });
});

describe("no state typed: the shop's own state first (owner, 25 Nov)", () => {
  it("rohini sector 20 with no state → Delhi's Rohini", async () => {
    const { readFileSync } = await import("node:fs");
    const { parsePins, pinsForAddress } = await import("../src/lib/pincode");
    const t = parsePins(readFileSync("public/pincodes.txt", "utf8"));
    expect(pinsForAddress(t, "rohini sector 20 jagdamba market", 4, "07")[0].pin).toMatch(/^1100(85|89)$/);
  });
});
