import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ManualItems } from "../src/components/PosTools";

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
