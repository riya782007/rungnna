// Run after npm run build. Set LABEL_PLAYWRIGHT_MODULE if Playwright is not in node_modules.
// Isolated account and local dist files only; no shop data or physical hardware is used.
import { createRequire } from 'node:module';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LABEL_PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: 'block' });
const root = resolve('dist');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.webmanifest': 'application/manifest+json' };
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.hostname !== 'rungnna.test') return route.abort();
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(root + sep)) return route.abort();
  try { await route.fulfill({ body: await readFile(path), contentType: mime[extname(path)] || 'application/octet-stream' }); }
  catch { await route.fulfill({ status: 404, body: 'Not found' }); }
});
const page = await context.newPage();
page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
try {
  await page.goto('https://rungnna.test/#/bill', { waitUntil: 'networkidle' });
  await page.getByLabel("Common shop entry code").fill("rungnna 2026");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Owner's name").fill("Scan trial");
  await page.getByLabel("New 4-digit personal PIN").fill("2468");
  await page.getByRole("button", { name: "Save PIN & open", exact: true }).click();
  const scan = page.getByPlaceholder('Scan label, or type style / item (F7)');
  await scan.waitFor();
  const notice = page.locator('.bill-scan-notice');
  const first = 'RJ1|SCAN-DEMO-1|H-CLUTCH|PCS|K5210/11P|LKQR||20|3';
  const second = 'RJ1|SCAN-DEMO-2|N CHAIN|PAIR|NC-1|GOLD||80|1';
  const read = async payload => { await scan.fill(payload); await scan.press('Enter'); };
  await read(first);
  await notice.getByText('Item added · +3 PCS', { exact: true }).waitFor();
  await notice.getByText('Quantity now 3 PCS', { exact: false }).waitFor();
  const firstSequence = await notice.getAttribute('data-scan-sequence');
  const activeRow = page.locator('.pos-lines tbody tr[aria-current="true"]');
  const yellow = async () => {
    if (await activeRow.count() !== 1) throw new Error('Latest scanned row is not uniquely identified');
    const color = await activeRow.locator('td').first().evaluate(el => getComputedStyle(el).backgroundColor);
    if (!['rgb(253, 230, 138)', 'rgb(255, 243, 176)'].includes(color)) throw new Error('Scanned row is not yellow: ' + color);
  };
  await yellow();
  if (!await scan.evaluate(el => document.activeElement === el)) throw new Error('First addition stole scan focus');
  await read(first);
  await notice.getByText('Repeated item added · +3 PCS', { exact: true }).waitFor();
  await notice.getByText('Quantity now 6 PCS', { exact: false }).waitFor();
  await yellow();
  if (await notice.getAttribute('data-scan-sequence') === firstSequence) throw new Error('Repeat did not renew feedback');
  if (!await scan.evaluate(el => document.activeElement === el)) throw new Error('Repeat stole scan focus');
  await mkdir('dist/print-trials', { recursive: true });
  await notice.screenshot({ path: 'dist/print-trials/scan-repeat-confirmation.png' });
  await page.screenshot({ path: 'dist/print-trials/scanned-row-yellow.png', fullPage: true });
  await read(second);
  await notice.getByText('Item added · +1 PAIR', { exact: true }).waitFor();
  await notice.getByText('N CHAIN', { exact: true }).waitFor();
  if (await page.locator('.pos-lines tbody tr').count() !== 2) throw new Error('Repeat unexpectedly created a new bill row');
  await page.setViewportSize({ width: 390, height: 844 });
  await notice.screenshot({ path: 'dist/print-trials/scan-new-confirmation-mobile.png' });
  await read(first.replace('|20|3', '|20|1'));
  await notice.getByText('Repeated item added · +1 PCS', { exact: true }).waitFor();
  await notice.getByText('Quantity now 1 PCS', { exact: false }).waitFor();
  if (await page.locator('.pos-lines tbody tr').count() !== 3) throw new Error('Remainder sticker did not retain its packet size');
  await read('UNKNOWN-NO-SUCH-ITEM-8172');
  await notice.waitFor({ state: 'detached' });
  if (await page.locator('.pos-lines tbody tr').count() !== 3) throw new Error('Unknown scan added a row');
  await read(first);
  await notice.getByText('Quantity now 9 PCS', { exact: false }).waitFor();
  await notice.waitFor({ state: 'detached', timeout: 5000 });
  await yellow();
  if (!await activeRow.locator('input[aria-label="Product name for line 1"]').count()) throw new Error('Latest scan did not return to the existing packet row');
  // Hold a database transaction so the next label resolves after the following box scan.
  await read('bb');
  const holdLookup = async () => page.evaluate(async () => {
    const open = indexedDB.open('rungnna');
    const database = await new Promise((done, fail) => { open.onsuccess = () => done(open.result); open.onerror = () => fail(open.error); });
    const transaction = database.transaction(['settings', 'products', 'config', 'outbox'], 'readwrite');
    window.releaseScanLookup = false;
    const keepAlive = () => {
      const request = transaction.objectStore('settings').get('__scan_test_hold__');
      request.onsuccess = () => { if (!window.releaseScanLookup) keepAlive(); };
    };
    transaction.oncomplete = () => database.close();
    keepAlive();
  });
  await holdLookup();
  await read(first);
  if (await scan.inputValue() !== '') throw new Error('A pending lookup left its payload in the scanner input');
  await read(first);
  if (await scan.inputValue() !== '') throw new Error('A repeated pending scan did not release the input');
  await page.evaluate(() => { window.releaseScanLookup = true; });
  await notice.getByText('Quantity now 15 PCS', { exact: false }).waitFor();
  await holdLookup();
  const boxed = 'RJ1|SCAN-BOX-RACE|BALI|PAIR|BOX-TEST|GOLD||10|2';
  await read(boxed);
  await read('bb');
  await page.evaluate(() => { window.releaseScanLookup = true; });
  await notice.getByText('Box 1 · Quantity now 2 PAIR', { exact: true }).waitFor();
  await read(boxed);
  await notice.getByText('Box 2 · Quantity now 2 PAIR', { exact: true }).waitFor();
  if (await page.locator('.pos-lines tbody tr').count() !== 5) throw new Error('Asynchronous scans changed boxes or merged separate boxes');
  await holdLookup();
  await read('RJ1|SCAN-OLD-BILL|BALI|PAIR|STALE-TEST|GOLD||10|1');
  await page.keyboard.press('F2');
  await page.evaluate(() => { window.releaseScanLookup = true; });
  await page.getByText('Bill changed or saving — scan this label again', { exact: true }).waitFor();
  if (await page.locator('.pos-lines tbody tr.ln').count() !== 0) throw new Error('A delayed scan leaked into a new bill');
  console.log('PASS: new item, repeated scan, next new item, exact packet totals3/6/9 plus separate X1 remainder, separate packet rows, unique popup refresh, retained scanner focus, unknown scan refusal, mobile display, automatic dismissal, persistent yellow row and rapid double scans without lost input, exact box routing during delayed lookup and visible refusal of a stale scan after changing bill.');
} catch (error) { console.log((await page.locator('body').innerText()).slice(-7000)); throw error; } finally { await browser.close(); }
