// Isolated print regression: renders finalized estimates without opening shop data.
// Run with PRINT_PLAYWRIGHT_MODULE pointing to Playwright when it is not installed locally.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PRINT_PLAYWRIGHT_MODULE || 'playwright');
const vite = await createServer({ appType: 'custom', server: { host: '127.0.0.1', port: 0 } });
vite.middlewares.use((req, res, next) => {
  if (req.url !== '/__estimate-print-check') return next();
  res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><html><head></head><body></body></html>');
});
await vite.listen();
const url = 'https://rungnna-print.test';
console.log('Preparing browser for finalized estimate print checks');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const output = 'tmp/pdfs/estimate-print-check';
await mkdir(output, { recursive: true });
try {
  console.log('Loading invoice source modules');
  const { InvoiceSheet } = await vite.ssrLoadModule('/src/components/Invoice.tsx');
  const { DEFAULT_SHOP, newBill, totals } = await vite.ssrLoadModule('/src/lib/billing.ts');
  const { manualLine } = await vite.ssrLoadModule('/src/lib/pos.ts');
  const css = await readFile('src/styles.css', 'utf8');
  const b = totals({ ...newBill('print-check', DEFAULT_SHOP, 'estimate'), no: 'EST/PRINT-CHECK/1', status: 'final',
    party_name: 'LONG ESTIMATE PRINT CUSTOMER', party_address: 'WHOLESALE APPROVAL DELIVERY ADDRESS',
    remarks: 'FINAL PRINT REMARKS: every approved item and the total must survive printing.',
    packing: 500, advance: 1000, prev_due: 10000, payments: [{ mode: 'cash', amount: 2000 }],
    items: Array.from({ length: 140 }, (_, i) => manualLine({ item: 'OWNER-LINE-' + String(i + 1).padStart(3, '0'), style: 'K521011/P', color: 'WXZ/13', unit: 'PCS', hsn: '7117', qty: '3', rate: '100.25', box: i % 4 + 1 })),
  }, 'Delhi');
  const results = [];
  for (const format of ['a5', 'a4', '80mm', '58mm']) {
    console.log('Checking print format ' + format);
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.route('**/*', async route => {
      const target = new URL(route.request().url());
      if (target.hostname !== 'rungnna-print.test') return route.abort();
      if (target.pathname === '/__estimate-print-check') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body></body></html>' });
      try {
        const transformed = await vite.transformRequest(target.pathname + target.search);
        if (transformed) return route.fulfill({ contentType: 'application/javascript', body: transformed.code });
        return route.fulfill({ status: 404, body: 'Not found' });
      } catch (error) { return route.fulfill({ status: 500, body: String(error) }); }
    });
    await context.addInitScript(() => { window.print = () => { window.top.__printCount = (window.top.__printCount || 0) + 1; }; });
    const page = await context.newPage();
    await page.goto(url + '/__estimate-print-check');
    const body = renderToStaticMarkup(createElement(InvoiceSheet, { b, shop: DEFAULT_SHOP, format }));
    await page.setContent('<!doctype html><html><head><style>' + css + '</style></head><body><div id="printroot">' + body + '</div></body></html>');
    await page.evaluate(async () => {
      const { printDocument } = await import('/src/lib/printing.ts');
      window.__cleanPrint = await printDocument(document, () => new Promise(r => requestAnimationFrame(r)));
      // Finalizing/resetting a live bill must not erase the snapshot being printed.
      document.getElementById('printroot').replaceChildren();
    });
    const printFrame = page.frames().find(f => f !== page.mainFrame());
    if (!printFrame) throw new Error(format + ': missing isolated print document');
    const text = await printFrame.locator('#printroot').innerText();
    for (let i = 1; i <= 140; i++) {
      const marker = 'OWNER-LINE-' + String(i).padStart(3, '0');
      if (!text.includes(marker)) throw new Error(format + ': lost ' + marker);
    }
    for (const marker of ['APPROVAL CHALLAN', 'FINAL PRINT REMARKS', 'Previous balance', 'Total due', 'Advance', 'Paid'])
      if (!text.includes(marker)) throw new Error(format + ': lost ' + marker);
    if (text.includes('₹') || text.includes('Rupees ')) throw new Error(format + ': printed forbidden currency presentation');
    const printed = await page.evaluate(() => window.__printCount);
    if (printed !== 1) throw new Error(format + ': printed ' + printed + ' times');
    const html = await printFrame.locator('html').innerHTML();
    await writeFile(output + '/snapshot-' + format + '.html', '<!doctype html><html>' + html + '</html>');
    const before = await printFrame.locator('.inv').evaluate(el => ({ height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width, bodyMargin: getComputedStyle(document.body).margin, mode: document.compatMode, page: document.querySelector('style[data-thermal-width]')?.textContent }));
    const proof = await context.newPage();
    const printableMM = { a5: 132, a4: 194, '80mm': 76, '58mm': 54 }[format];
    await proof.setViewportSize({ width: Math.ceil(printableMM * 96 / 25.4), height: 900 });
    await proof.goto(url + '/__estimate-print-check');
    await proof.setContent('<!doctype html><html>' + html + '</html>');
    await proof.emulateMedia({ media: 'print' });
    await proof.evaluate(() => document.fonts.ready);
    await proof.pdf({ path: output + '/estimate-' + format + '.pdf', preferCSSPageSize: true, printBackground: true });
    const overflow = await proof.locator('.inv').evaluate(el => ({ contentWidth: el.scrollWidth, pageWidth: el.clientWidth }));
    if (overflow.contentWidth > overflow.pageWidth + 1) throw new Error(format + ': invoice overflows horizontally');
    if (before.mode !== 'CSS1Compat') throw new Error(format + ': print document did not use standards mode');
    const after = await proof.locator('.inv').evaluate(el => ({ height: el.getBoundingClientRect().height, width: el.getBoundingClientRect().width, bodyMargin: getComputedStyle(document.body).margin }));
    results.push({ format, before, after, items: 140, printCalls: printed, snapshotSurvivedBillReset: true, ...overflow });
    await page.evaluate(() => window.__cleanPrint());
    await context.close();
  }
  await writeFile(output + '/browser-results.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results, null, 2));
} finally { await browser.close(); await vite.close(); }
