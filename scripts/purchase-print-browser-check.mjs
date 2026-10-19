// Run against a local production build. All data is isolated at rungnna.test.
// Only native window.print is replaced; app save, validation, batching and print preparation run normally.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LABEL_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
const store = '00000000-0000-4000-8000-00000000b001';
const cfg = {
  output: 'browser', preset: 'rjrow', mode: 'roll', driverPaper: true,
  w: 33, h: 15, cols: 3, gapX: 2.5, gapY: 2.6, sheetW: 104, sheetH: 152.4,
  top: 0, left: 0, rows: 9, edgeR: 104, qr: 9, font: 5.5, rateScale: 1.8,
  pad: 0.6, offX: 0, offY: 0, shop: 'RUNGNNA', format: 'shop', layout: 'shop', cur: '9',
  show: { shop: true, item: true, style: true, color: true, rate: true, tk: false, code: false, qty: true, cost_code: true, line: true },
};
const results = [];
async function rows(page, table) {
  return page.evaluate(table => new Promise((resolve, reject) => {
    const req = indexedDB.open('rungnna');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction(table), read = tx.objectStore(table).getAll();
      read.onsuccess = () => resolve(read.result); read.onerror = () => reject(read.error);
      tx.oncomplete = () => db.close();
    };
  }), table);
}
async function trial(name, output, stale = false) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== 'rungnna.test') return route.abort();
    const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
    if (!path.startsWith(root + sep)) return route.abort();
    try { await route.fulfill({ body: await readFile(path), contentType: mime[extname(path)] || 'application/octet-stream' }); }
    catch { await route.fulfill({ status: 404, body: 'Not found' }); }
  });
  await context.addInitScript(() => {
    if (window === window.top) window.__purchasePrintCalls = [];
    window.print = function () {
      const content = document.getElementById('printroot');
      window.top.__purchasePrintCalls.push({ frame: window === window.top ? 'top' : 'iframe', text: content?.textContent || '', artwork: content?.querySelectorAll('svg').length || 0, html: content?.innerHTML || '' });
      setTimeout(() => window.dispatchEvent(new Event('afterprint')), 10);
    };
  });
  const page = await context.newPage();
  const errors = [], dialogs = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', async dialog => { dialogs.push(dialog.message()); await dialog.accept(); });
  try {
    await page.goto('https://rungnna.test/#/labels/bill', { waitUntil: 'networkidle' });
    await page.getByLabel("Owner's name").fill('Purchase trial');
    await page.getByRole('button', { name: 'Start', exact: true }).click();
    await page.getByRole('heading', { name: 'QR labels', exact: true }).waitFor();
    await page.evaluate(async ({ store, config }) => {
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('rungnna'); req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result, tx = db.transaction(['parties', 'locations', 'settings'], 'readwrite');
          const at = new Date().toISOString();
          tx.objectStore('parties').put({ id: 'trial-supplier', name: 'TRIAL SUPPLIER', kind: 'supplier', vendor_code: 'T1', phone: '', opening: 0, updated_at: at });
          tx.objectStore('locations').put({ id: 'trial-rack', store_id: store, floor: '1', rack: '1', box: '', kind: 'rack', code: 'F1-R01', name: '', updated_at: at });
          tx.objectStore('settings').put({ key: 'label_cfg', value: config, updated_at: at });
          tx.objectStore('settings').put({ key: 'label_printer_ok', value: '', updated_at: at });
          tx.objectStore('settings').put({ key: 'purchase_photo_draft', value: {
            store, rows: [{ item: 'F-RING', style: 'K521011/P', color: 'WXZ/13', unit: 'PCS', hsn: '7117', qty: '4', pack: '1', stickers: '4', cost: '73', rate: '146' }],
            supplier: 'trial-supplier', billNo: 'TRIAL-1', rack: 'trial-rack', warnings: '', total: '',
          }, updated_at: at });
          tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
        };
      });
    }, { store, config: { ...cfg, output } });
    await page.reload({ waitUntil: 'networkidle' });
    await page.getByLabel('item line 1', { exact: true }).waitFor();
    if (stale) {
      await page.getByText('Printer settings', { exact: true }).click();
      await page.getByLabel(/^Print labels using/).selectOption('browser');
    }
    await page.locator('.purchase-photo').getByRole('checkbox').check();
    const approve = page.getByRole('button', { name: /^Approve: draft 1 product & print 4 labels$/ });
    await approve.click();
    await page.waitForTimeout(2000);
    const purchases = await rows(page, 'purchases');
    const prints = await page.evaluate(() => window.__purchasePrintCalls);
    const body = await page.locator('body').innerText();
    const first = { name, purchases: purchases.length, printCalls: prints.length, printedArtwork: prints.map(p => p.artwork), errors, dialogs, text: body.slice(-2500) };
    console.log(JSON.stringify(first));
    if (purchases.length !== 1) throw new Error(`${name}: approval did not commit exactly one purchase`);
    if (output !== 'qz' || stale) {
      if (prints.length !== 1 || prints[0].frame !== 'iframe' || prints[0].artwork !== 3 || !prints[0].html.includes('F-RING')) throw new Error(`${name}: approval did not print the first 3-label row in an iframe`);
      await page.getByRole('button', { name: 'Yes, right: print the other 1', exact: true }).click();
      await page.waitForFunction(() => window.__purchasePrintCalls.length === 2);
      await page.getByRole('button', { name: 'Print again', exact: true }).click();
      await page.waitForFunction(() => window.__purchasePrintCalls.length === 3);
      if ((await rows(page, 'purchases')).length !== 1) throw new Error(`${name}: Print again committed another purchase`);
      console.log(`PASS ${name}: approve saved once, printed 3 then 1, Print again printed without another purchase`);
    } else {
      if (prints.length !== 0) throw new Error('Missing QZ selection unexpectedly used native browser print');
      console.log(`DIAGNOSTIC ${name}: ${/saved.*opening the label print sheet/i.test(body) ? 'reports print success although no print was started' : 'no false browser success message'}`);
    }
    await mkdir('dist/print-trials', { recursive: true });
    await page.screenshot({ path: `dist/print-trials/purchase-${name}.png`, fullPage: true });
    results.push({ name, ok: true });
  } catch (error) {
    console.log(`FAIL ${name}: ${error.message}`);
    console.log((await page.locator('body').innerText()).slice(-3500));
    results.push({ name, ok: false, error: error.message });
  } finally { await context.close(); }
}
try {
  const only = process.argv[2];
  if (!only || only === 'browser') await trial('browser', 'browser');
  if (!only || only === 'legacy-tspl') await trial('legacy-tspl', 'tspl');
  if (!only || only === 'missing-qz') await trial('missing-qz', 'qz');
  if (!only || only === 'stale-settings') await trial('stale-settings', 'qz', true);
  console.log(JSON.stringify(results));
  if (results.some(r => !r.ok)) process.exitCode = 1;
} finally { await browser.close(); }
