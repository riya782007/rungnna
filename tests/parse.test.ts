import { describe, it, expect } from "vitest";
import { parseLabel, ownPayload, type Pattern } from "../src/lib/parse";

describe("label decoder", () => {
  it("reads our own QR", () => {
    const raw = ownPayload({ code: "RAB12CD3EF", item: "CHAIN", type: "PCS", style: "K5209/59SH", color: "K/GBN", tk: "", rate: 9600 });
    const p = parseLabel(raw);
    expect(p.how).toBe("rungnna");
    expect(p).toMatchObject({ code: "RAB12CD3EF", item: "CHAIN", type: "PCS", style: "K5209/59SH", color: "K/GBN", rate: "96" });
  });
  it("reads key:value labels", () => {
    const p = parseLabel("ITEM:CHAIN TYPE:PCS STYLE:K5209/59SH COLOR:K/GBN RATE:96");
    expect(p.how).toBe("keys");
    expect(p).toMatchObject({ item: "CHAIN", type: "PCS", style: "K5209/59SH", color: "K/GBN", rate: "96" });
  });
  it("reads JSON", () => {
    expect(parseLabel('{"Item":"CHAIN","Style":"K5209/59SH","Rate":"96"}')).toMatchObject({ how: "json", item: "CHAIN", style: "K5209/59SH", rate: "96" });
  });
  it("hands back unknown multi-piece labels for teaching", () => {
    const p = parseLabel("CHAIN|PCS|K5209/59SH|K/GBN||96");
    expect(p.how).toBe("unknown"); expect(p.tokens.length).toBe(6);
  });
  it("applies a taught pattern (rate in paise)", () => {
    const pat: Pattern = { id: "1", name: "old", sep: "|", count: 6, prefix: "", map: ["item", "type", "style", "color", "tk", "rate"], rateDiv: 100 };
    expect(parseLabel("CHAIN|PCS|K5209/59SH|K/GBN||9600", [pat])).toMatchObject({ item: "CHAIN", style: "K5209/59SH", color: "K/GBN", rate: "96" });
  });
  it("reads the shop's real sticker (old software)", () => {
    const p = parseLabel("202~24~12~183~~K5208/K-LT~W/LP/B");
    expect(p).toMatchObject({ how: "shop label", icode: "202", rate: "24", qty: "12", ref: "183", tk: "", style: "K5208/K-LT", color: "W/LP/B" });
  });
  it("writes new labels in the same format the old software reads", () => {
    const raw = ownPayload({ code: "X", item: "F-RING", type: "PCS", style: "K5208/K-LT", color: "W/LP/B", tk: "", rate: 2400, item_code: "202", pack: 12, ref: "183" });
    expect(raw).toBe("202~24~12~183~~K5208/K-LT~W/LP/B");
  });
  it("treats a single token as a code", () => {
    expect(parseLabel("  BR108696 ")).toMatchObject({ how: "code", code: "BR108696" });
  });
});
