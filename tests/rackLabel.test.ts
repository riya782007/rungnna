import { describe, it, expect } from "vitest";
import {
  renderTemplate, varsFor, payloadFor, parseRackScan, normalizeCfg, sheetOverflow, sortLocs,
  DEFAULT_RACK_CFG, LOC_PREFIX, toUnit, fromUnit,
} from "../src/lib/rackLabel";

const rack = { id: "a", code: "F1-R01", floor: "1", rack: "1", box: "", name: "Main aisle", kind: "rack" as const };
const box = { id: "b", code: "F1-R01-B02", floor: "1", rack: "1", box: "2", name: "", kind: "rack" as const };
const g = { id: "c", code: "G-R12", floor: "G", rack: "12", box: "", name: "", kind: "rack" as const };
const bucket = { id: "d", code: "DAMAGED", floor: "", rack: "", box: "", name: "Damaged", kind: "bucket" as const };
const locs = [rack, box, g, bucket];

describe("rack sticker templates", () => {
  const v = varsFor(rack, { org: "RUNGNNA" });
  it("fills variables", () => {
    expect(renderTemplate("{floor_code}-{rack_number}", v)).toBe("F1-R01");
    expect(renderTemplate("{floor_name} · {name}", v)).toBe("Floor 1 · Main aisle");
    expect(renderTemplate("RUNGNNA · RACK", v)).toBe("RUNGNNA · RACK");
  });
  it("tidies joiners left by empty fields", () => {
    expect(renderTemplate("{floor_code}-{rack_number}-{box_number}", v)).toBe("F1-R01");
    expect(renderTemplate("{name}", varsFor(box, { org: "" }))).toBe("");
  });
  it("leaves unknown {tokens} untouched", () => {
    expect(renderTemplate("{zone}", v)).toBe("{zone}");
  });
});

describe("QR payloads", () => {
  it("classic matches the original stickers", () => {
    expect(payloadFor(rack, DEFAULT_RACK_CFG)).toBe(LOC_PREFIX + "F1-R01");
  });
  it("plain applies prefix and suffix", () => {
    expect(payloadFor(rack, { ...DEFAULT_RACK_CFG, payload: "plain", prefix: "DELHI-WH1-", suffix: "-A" })).toBe("DELHI-WH1-F1-R01-A");
  });
  it("json is structured", () => {
    const j = JSON.parse(payloadFor(rack, { ...DEFAULT_RACK_CFG, payload: "json" }));
    expect(j).toEqual({ org: "RUNGNNA", type: "RACK", floor: 1, rack: "R01", id: "F1-R01" });
    const jb = JSON.parse(payloadFor(box, { ...DEFAULT_RACK_CFG, payload: "json" }));
    expect(jb.type).toBe("BOX"); expect(jb.box).toBe("B02");
  });
});

describe("reading rack stickers back", () => {
  it("reads every format", () => {
    for (const payload of ["classic", "plain", "json"] as const) {
      for (const [prefix, suffix] of [["", ""], ["DELHI-WH1-", ""], ["RUNGNNA.RACK.", "-FRONT"]]) {
        const cfg = { ...DEFAULT_RACK_CFG, payload, prefix, suffix };
        for (const l of [rack, box, g]) expect(parseRackScan(payloadFor(l, cfg), locs)?.id).toBe(l.id);
      }
    }
  });
  it("prefers the longest code (box over its rack)", () => {
    expect(parseRackScan("WH-F1-R01-B02", locs)?.id).toBe("b");
  });
  it("never mistakes a product label for a rack", () => {
    expect(parseRackScan("202~24~12~183~~K5208/K-LT~W/LP/B", locs)).toBeNull();
    expect(parseRackScan("RJ1|RAB12|F-RING|PCS|F1-R01|W||24", locs)).toBeNull();
    expect(parseRackScan("XF1-R01", locs)).toBeNull();
    expect(parseRackScan("DAMAGED", locs)?.id).toBe("d"); // exact code still works
    expect(parseRackScan('{"type":"PRODUCT","id":"F1-R01"}', locs)).toBeNull();
  });
});

describe("settings safety", () => {
  it("clamps unprintable values", () => {
    const c = normalizeCfg({ w: -5, h: 9999, cols: 0, copies: 99, qrPct: 5, payload: "nope" as any });
    expect(c.w).toBe(10); expect(c.h).toBe(300); expect(c.cols).toBe(1); expect(c.copies).toBe(20); expect(c.qrPct).toBe(20); expect(c.payload).toBe("classic");
  });
  it("flags sheet layouts that overflow the paper", () => {
    expect(sheetOverflow({ ...DEFAULT_RACK_CFG, mode: "sheet", sheet: "a4", w: 70, h: 37, cols: 3, rows: 8, marginTop: 0.5, marginLeft: 0, gapX: 0, gapY: 0 })).toBeNull();
    expect(sheetOverflow({ ...DEFAULT_RACK_CFG, mode: "sheet", sheet: "a4", w: 70, h: 37, cols: 4, rows: 8, marginTop: 0, marginLeft: 0, gapX: 0, gapY: 0 })).toMatch(/width/);
  });
  it("converts inches", () => {
    expect(toUnit(101.6, "in")).toBe(4); expect(fromUnit(2, "in")).toBeCloseTo(50.8);
  });
  it("sorts floors G, 1..5, godown", () => {
    expect(sortLocs([g, box, rack]).map(l => l.code)).toEqual(["G-R12", "F1-R01", "F1-R01-B02"]);
  });
});
