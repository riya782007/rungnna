import { describe, expect, it } from "vitest";
import { byRollNo, findRollNo, supplierInfo } from "../src/components/SupplierNo";

/* The shop's vendor list (Vendor 26-10-11 PDF): suppliers are known by roll number, not by name. */
const codes = ["10", "1", "201", "3B", "L10", "2", "V1", "3", "3A", "94", "L9", "M1", "238", "4", "R1", "71", "", "64"];
const sups = codes.map((c, i) => ({ id: "s" + i, name: "S" + i, vendor_code: c || undefined }));

describe("supplier roll numbers", () => {
  it("are listed in ascending order the way the shop numbers them", () => {
    expect([...sups].sort(byRollNo).map(s => s.vendor_code || "—")).toEqual(
      ["1", "2", "3", "3A", "3B", "4", "10", "64", "71", "94", "201", "238", "L9", "L10", "M1", "R1", "V1", "—"]);
  });
  it("a typed number finds the supplier, whatever the case or spaces", () => {
    expect(findRollNo(sups, " 3a ")?.vendor_code).toBe("3A");
    expect(findRollNo(sups, "l9")?.vendor_code).toBe("L9");
    expect(findRollNo(sups, "5")).toBeUndefined();
    expect(findRollNo(sups, "")).toBeUndefined();
  });
  it("shows the supplier's details once the number is right", () => {
    expect(supplierInfo({ id: "x", name: "SOLANKI", vendor_code: "51", rate_divisor: 1.2, less_pct: 0, city: "" })).toBe("SOLANKI · rate ÷ 1.2");
  });
});
