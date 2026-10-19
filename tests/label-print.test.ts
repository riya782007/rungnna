import { expect, it, vi } from "vitest";
import { DEFAULT_CFG, validateLabelPrint, runBatches, printerSig, PrintSheet, upgradeLabelCfg, useLabelPrint, type LabelCfg } from "../src/pages/Labels";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blankProduct } from "../src/lib/products";
const jobs = [{ p: { ...blankProduct("owner"), item: "BALI" }, qtyOnLabel: 1, copies: 4 }];
it("accepts the shop's default label format", () => { expect(() => validateLabelPrint(DEFAULT_CFG, jobs)).not.toThrow(); });
it("rejects broken roll dimensions rather than looping or spooling blank paper", () => {
  for (const change of [{ cols: 0 }, { cols: 1.5 }, { w: NaN }, { h: 0 }, { gapY: -1 }]) expect(() => validateLabelPrint({ ...DEFAULT_CFG, ...change }, jobs)).toThrow();
});
it("counts a checked row once, then prints the remaining labels", () => {
  expect(runBatches(4, 3, 60, true, false)).toEqual([{ from: 0, to: 3 }, { from: 3, to: 4 }]);
  expect(runBatches(2, 3, 60, true, false)).toEqual([{ from: 0, to: 2 }]);
});
it("requires another check after changing printer or alignment", () => {
  const key = printerSig(DEFAULT_CFG);
  expect(printerSig({ ...DEFAULT_CFG, offX: DEFAULT_CFG.offX + 0.5 })).not.toBe(key);
  expect(printerSig({ ...DEFAULT_CFG, output: "qz", qzPrinter: "TSC" })).not.toBe(key);
  expect(printerSig({ ...DEFAULT_CFG, output: "qz", qzPrinter: "TSC2" })).not.toBe(printerSig({ ...DEFAULT_CFG, output: "qz", qzPrinter: "TSC" }));
});
it("prints 3-across browser pages with stock dimensions managed by the driver", () => {
  const html = renderToStaticMarkup(createElement(PrintSheet, { cfg: DEFAULT_CFG, jobs: Array.from({ length: 4 }, () => jobs[0]) }));
  expect(html).toContain("@page{margin:0}");
  expect(html.match(/class="lbl"/g)).toHaveLength(4);
  expect(html.match(/page-break-after:always/g)).toHaveLength(1);
});
it("rejects an oversized QR before it can print an error message on a sticker", () => {
  expect(() => validateLabelPrint({ ...DEFAULT_CFG, h: 5 }, jobs)).toThrow("QR");
});
it("checks sheet fit, product names and the total batch before printing", () => {
  expect(() => validateLabelPrint({ ...DEFAULT_CFG, mode: "sheet", cols: 20, rows: 20 }, jobs)).toThrow("fit");
  expect(() => validateLabelPrint(DEFAULT_CFG, [{ ...jobs[0], copies: 5001 }])).toThrow("5000");
  expect(() => validateLabelPrint(DEFAULT_CFG, [{ ...jobs[0], p: { ...jobs[0].p, item: "" } }])).toThrow("names");
});

it("migrates legacy USB settings that no longer match the three-across roll", () => {
  const old = { ...DEFAULT_CFG, output: "tspl" as const, preset: "rj", w: 50, h: 20, cols: 1 };
  expect(upgradeLabelCfg(old)).toMatchObject({ preset: "rjrow", cols: 3, output: "browser" });
  expect(upgradeLabelCfg({ ...DEFAULT_CFG, output: "tspl" })).toMatchObject({ cols: 3, output: "browser" });
  expect(upgradeLabelCfg({ ...DEFAULT_CFG, output: "tspl", preset: "custom", cols: 1 })).toMatchObject({ cols: 1, output: "tspl" });
});

// Rendering the hook on the server exposes its preflight entry point without
// creating a browser, spooler, or actual print job. Rejected starts never set run.
function captureStart(config: LabelCfg) {
  let start!: ReturnType<typeof useLabelPrint>["start"];
  function Capture() { start = useLabelPrint(config).start; return null; }
  renderToStaticMarkup(createElement(Capture));
  return start;
}

it("reports missing QZ setup to the caller instead of claiming print started", () => {
  const result = captureStart({ ...DEFAULT_CFG, output: "qz", gapY: 2.6 })(jobs);
  expect(result).toEqual({ started: false, message: "Choose the TSC label printer in Printer settings first." });
});

it("uses the latest printer override for preflight, including a newly chosen QZ output", () => {
  const result = captureStart(DEFAULT_CFG)(jobs, false, true, { ...DEFAULT_CFG, output: "qz", gapY: 2.6 });
  expect(result).toEqual({ started: false, message: "Choose the TSC label printer in Printer settings first." });
});

it("returns an explicit cancellation using the override's browser transport", () => {
  const confirm = vi.fn(() => false); vi.stubGlobal("confirm", confirm);
  try {
    const result = captureStart({ ...DEFAULT_CFG, output: "qz" })(jobs, false, true, DEFAULT_CFG);
    expect(result).toMatchObject({ started: false, cancelled: true });
    expect(confirm).toHaveBeenCalledOnce();
  } finally { vi.unstubAllGlobals(); }
});

it("reports invalid queue or incompatible direct output as a failed start", () => {
  expect(captureStart(DEFAULT_CFG)([])).toMatchObject({ started: false, message: expect.stringContaining("quantities") });
  expect(captureStart(DEFAULT_CFG)(jobs, true)).toMatchObject({ started: false, message: expect.stringContaining("QZ Tray") });
});
