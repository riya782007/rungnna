import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ManualItems } from "../src/components/PosTools";
import { manualLine, repeatedPosLine } from "../src/lib/pos";

it("opens Add item in custom mode with stock entry still available", () => {
  const html = renderToStaticMarkup(createElement(ManualItems, {
    products: [], box: 1, level: "wholesale", canRates: true, inline: true,
    onProduct: () => {}, onCustom: () => {}, onClose: () => {},
  }));
  expect(html).toContain('aria-pressed="true">Custom item');
  expect(html).toContain('aria-pressed="false">Stock item');
  expect(html).toContain("Product name");
  expect(html).toContain("Add to bill");
  expect(html).not.toContain("Search products");
});

it("keeps persistent entry available without a close button", () => {
  const html = renderToStaticMarkup(createElement(ManualItems, {
    products: [], box: 1, level: "wholesale", canRates: true, inline: true, persistent: true,
    onProduct: () => {}, onCustom: () => {}, onClose: () => {},
  }));
  expect(html).toContain('id="pos-item-entry"');
  expect(html).toContain("Add to bill");
  expect(html).not.toContain("Close item entry");
  expect(html).not.toContain("Add &amp; next");
  expect(html).not.toContain("autofocus");
});

it("identifies repeat custom entries without confusing different boxes or prices", () => {
  const line = manualLine({ item: "BALI", style: "K5209", color: "GOLD", unit: "PAIR", hsn: "7117", qty: "1", rate: "100", box: 1 });
  expect(repeatedPosLine([line], { ...line, id: "new", item: " bali " })).toBe(true);
  expect(repeatedPosLine([line], { ...line, box_no: 2 })).toBe(false);
  expect(repeatedPosLine([line], { ...line, rate: 20000 })).toBe(false);
  expect(repeatedPosLine([{ ...line, product_id: "stock" }], line)).toBe(false);
});
