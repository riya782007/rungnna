import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/* The shop floor in Sadar Bazar is bright and the staff read these screens all day, so the
   status pills and the focus ring have to be legible — not merely on-brand. These ratios were
   measured, found short, and fixed; this keeps them fixed. */

const css = readFileSync(new URL("../src/styles.css", import.meta.url).pathname, "utf8");
const root = css.slice(css.indexOf(":root{"), css.indexOf("}", css.indexOf(":root{")));

function token(name: string): string {
  const m = root.match(new RegExp("--" + name + "\\s*:\\s*(#[0-9A-Fa-f]{6}|var\\(--[\\w-]+\\))"));
  if (!m) throw new Error(`token --${name} not found in :root`);
  const v = m[1];
  return v.startsWith("var(") ? token(v.slice(6, -1)) : v;
}

const lin = (c: number) => (c /= 255, c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const lum = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
};
const ratio = (a: string, b: string) => {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

describe("theme contrast", () => {
  const WHITE = "#FFFFFF";

  it.each([
    // [what, foreground token, background token, minimum]
    ["body text",        "ink",      "bg",     4.5],
    ["muted text",       "muted",    "bg",     4.5],
    ["ok pill",          "ok",       "ok-l",   4.5],
    ["bad pill",         "bad",      "bad-l",  4.5],
    ["warn pill",        "warn",     "warn-l", 4.5],
    ["gold pill",        "gold-ink", "gold-l", 4.5],
  ])("%s meets AA for small text", (_what, fg, bg, min) => {
    expect(ratio(token(fg), token(bg))).toBeGreaterThanOrEqual(min as number);
  });

  it("the focus ring meets the 3:1 non-text minimum on both surfaces", () => {
    expect(ratio(token("focus"), WHITE)).toBeGreaterThanOrEqual(3);
    expect(ratio(token("focus"), token("bg"))).toBeGreaterThanOrEqual(3);
  });

  it("the POS names its own accent instead of redefining --gold", () => {
    const pos = css.slice(css.indexOf(".billing-shell{"), css.indexOf("}", css.indexOf(".billing-shell{")));
    expect(pos).toContain("--pos-accent");
    expect(pos).not.toMatch(/--gold\s*:/);      // "primary" must keep one meaning
  });

  it("bills and labels still print black on white, with no theme colour leaking in", () => {
    const start = css.indexOf("@media print");
    expect(start).toBeGreaterThan(-1);
    // take exactly the @media print block, not everything after it
    let depth = 0, end = start;
    for (let i = css.indexOf("{", start); i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) { end = i + 1; break; }
    }
    const print = css.slice(start, end);
    expect(print.length).toBeGreaterThan(40);
    expect(print).not.toMatch(/var\(--(gold|emerald|bad|warn|pos-accent)/);
  });
});
