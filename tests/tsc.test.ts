import { expect, it } from "vitest";
import { buildTSPL, type TscLabel } from "../src/lib/tsc";
const label: TscLabel = { wmm: 50, hmm: 20, gapmm: 2, qr: "RG|BALI|1", lines: ["BALI", "100X1PAIR"], copies: 4 };
it("prints the exact reviewed number of stickers and declares paper / gap dimensions", () => {
  const command = buildTSPL(label); expect(command).toContain("SIZE 50 mm, 20 mm"); expect(command).toContain("GAP 2 mm"); expect(command).toContain("PRINT 1,4\r\n");
});
it("does not accept invalid dimensions, counts or unsupported Unicode fonts", () => {
  for (const change of [{ copies: 0 }, { copies: 1.5 }, { wmm: NaN }, { hmm: 0 }, { gapmm: -1 }, { lines: ["\u0939\u093f\u0928\u094d\u0926\u0940"] }]) expect(() => buildTSPL({ ...label, ...change })).toThrow();
});
it("does not let text read from an invoice become extra printer commands", () => {
  expect(buildTSPL({ ...label, lines: ["BALI\r\nPRINT 1,5000"] }).match(/\r\nPRINT /g)).toHaveLength(1);
});
