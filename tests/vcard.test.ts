import { describe, expect, it } from "vitest";
import { newParty } from "../src/lib/billing";
import { vcards, contactPhone } from "../src/lib/vcard";

/* Owner, 13 Nov (voice): customers' numbers into the phone's contacts. */
describe("customers as phone contacts", () => {
  it("writes one contact per mobile number with the name, shop and city", () => {
    const a = { ...newParty("MANSI JI", "8586914768"), alt_name: "MANSI COLLECTION", city: "DELHI" };
    const b = { ...newParty("MANSI JI COPY", "+91 85869 14768") };   // same number twice
    const c = newParty("NO NUMBER", "");
    const { text, count } = vcards([a, b, c]);
    expect(count).toBe(1);
    expect(text).toContain("FN:MANSI JI MANSI COLLECTION DELHI");
    expect(text).toContain("TEL;TYPE=CELL:+918586914768");
    expect(text.match(/BEGIN:VCARD/g)).toHaveLength(1);
  });
  it("keeps the country code right", () => {
    expect(contactPhone("98111 11111")).toBe("+919811111111");
    expect(contactPhone("919811111111")).toBe("+919811111111");
    expect(contactPhone("12")).toBe("");
  });
});
