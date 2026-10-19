import { renderLabelSvg } from "../src/lib/label-artwork";
import { DEFAULT_CFG } from "../src/pages/Labels";
import { describe, it, expect } from "vitest";
import { entryReference, checkedEntryReference } from "../src/lib/entry-reference";
import { labelLines } from "../src/lib/label-tspl";
import { blankProduct } from "../src/lib/products";
import { purchaseLabelJobs } from "../src/lib/purchase-labels";
import { draftLabelProducts } from "../src/lib/purchase-photo";
import { DEFAULT_RULE } from "../src/lib/pricing";

describe("editable purchase maker/date reference", () => {
  it("uses the real maker initial and Indian date", () => {
    expect(entryReference("Karan", new Date("2026-10-19T20:00:00Z"))).toBe("K201026");
    expect(entryReference("Anita", new Date("2026-10-25T06:00:00Z"))).toBe("A251026");
    expect(entryReference("", new Date())).toBe("");
  });
  it("allows corrections and explicit clearing without inventing price encoding", () => {
    expect(checkedEntryReference(" k5209/11-p ")).toBe("K5209/11-P");
    expect(checkedEntryReference("")).toBe("");
    expect(() => checkedEntryReference("K<script>")).toThrow();
    expect(() => checkedEntryReference("K".repeat(25))).toThrow();
  });
  it("carries the purchase snapshot into labels, preserving product style and legacy QR reference", () => {
    const p = { ...blankProduct("staff"), id: "p", item: "EARRING", style: "SH11", ref: "legacy", rate: 5000 };
    const purchase = { status: "final", items: [{ product_id: "p", qty: 3, pack: 3, entry_code: "K201026" }] } as any;
    const job = purchaseLabelJobs(purchase, [p])[0];
    const lines = labelLines({ shop: "Shop", show: { item: true, style: true } as any }, job.p, 3);
    expect(lines.map(l => l.text)).toEqual(["EARRING", "K201026 SH11"]);
    expect(renderLabelSvg({ ...DEFAULT_CFG, format: "rungnna" }, job.p, 3)).toContain("K201026 SH11");
    expect(job.p.ref).toBe("legacy");
    expect(job.p.style).toBe("SH11");
    const old = purchaseLabelJobs({ ...purchase, items: [{ ...purchase.items[0], entry_code: undefined }] }, [p])[0];
    expect(labelLines({ shop: "Shop", show: { style: true } as any }, old.p, 3)[0].text).toBe("SH11");
  });
  it("previews the same code before saving", () => {
    const p = draftLabelProducts([{ item: "EARRING", style: "SH11", unit: "PCS", color: "", hsn: "", qty: "3", cost: "25", rate: "50", entry_code: "K201026" }], "staff", DEFAULT_RULE)[0];
    expect(labelLines({ shop: "Shop", show: { style: true } as any }, p, 1)[0].text).toBe("K201026 SH11");
  });
});
