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
