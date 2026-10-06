import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { InvoiceSheet } from "../src/components/Invoice";
import { LabelView, DEFAULT_CFG } from "../src/pages/Labels";
import { DEFAULT_SHOP, newBill, totals } from "../src/lib/billing";
import { manualLine } from "../src/lib/pos";
import { blankProduct } from "../src/lib/products";

const css = readFileSync("src/styles.css", "utf8");
const bill = totals({ ...newBill("print-demo", DEFAULT_SHOP, "gst"), no: "PRINT-TRIAL", party_name: "Demo customer", items: [
  manualLine({ item: "BALI", style: "K5209", color: "GOLD", unit: "PAIR", hsn: "7117", qty: "4", rate: "100", box: 1 }),
  manualLine({ item: "BRACELET", style: "K5206", color: "SILVER", unit: "PCS", hsn: "7117", qty: "5", rate: "132", box: 2 }),
] });
const product = { ...blankProduct("print-demo"), item: "BALI", code: "PRINT-DEMO", type: "PAIR", style: "K5209", color: "GOLD", rate: 10000, pack: 12 };
mkdirSync("dist/print-trials", { recursive: true });
function save(name: string, body: string) {
  writeFileSync(`dist/print-trials/${name}.html`, `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Print trial</title><style>${css}</style><style>#printroot{display:block;width:max-content;max-width:100%;margin:16px auto}</style></head><body><div id="printroot">${body}</div><script type="module">import { preparePrint } from '/src/lib/printing.ts'; await preparePrint(document, () => new Promise(r => requestAnimationFrame(r)));</script></body></html>`);
}
for (const format of ["80mm", "58mm"] as const) save(`receipt-${format}`, renderToStaticMarkup(createElement(InvoiceSheet, { b: bill, shop: DEFAULT_SHOP, format })));
save("label-50x20", renderToStaticMarkup(createElement(LabelView, { cfg: DEFAULT_CFG, p: product, qtyOnLabel: 1 })));
console.log("Rendered non-production receipt and sticker samples in dist/print-trials");
