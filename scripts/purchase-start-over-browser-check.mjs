import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
const bundled = createRequire('C:/Users/Riya yadav/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/x.js');
const { chromium } = bundled('playwright');
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ serviceWorkers: 'block' });
const root = resolve('dist'), base = 'https://rungnna-reset.test', errors = [];
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.wasm': 'application/wasm', '.woff2': 'font/woff2' };
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) return route.abort();
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(root + sep)) return route.abort();
  try { await route.fulfill({ body: await readFile(path), contentType: mime[extname(path)] || 'application/octet-stream' }); }
  catch { await route.fulfill({ status: 404, body: 'Not found' }); }
});
await context.addInitScript(() => Object.defineProperty(navigator, 'onLine', { get: () => false }));
const page = await context.newPage();
page.on('pageerror', e => errors.push(e.message));
const signIn = async () => {
  await page.getByLabel('Common shop entry code', { exact: true }).fill('rungnna 2026');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByRole('button', { name: /Reset owner/ }).click();
  await page.getByLabel('Personal PIN for Reset owner', { exact: true }).fill('2468');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
};
const draft = () => page.evaluate(async () => {
  const db = await new Promise(resolve => { const r = indexedDB.open('rungnna'); r.onsuccess = () => resolve(r.result); });
  const result = await new Promise(resolve => { const r = db.transaction('settings').objectStore('settings').get('purchase_photo_draft'); r.onsuccess = () => resolve(r.result?.value); });
  db.close(); return result;
});
try {
  await page.goto(base + '/#/labels/bill');
  await page.getByLabel('Common shop entry code', { exact: true }).fill('rungnna 2026');
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await page.getByLabel("Owner's name").fill('Reset owner');
  await page.getByLabel('New 4-digit personal PIN').fill('2468');
  await page.getByRole('button', { name: 'Save PIN & open', exact: true }).click();
  await page.locator('.purchase-photo[aria-busy="false"]').waitFor();
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('rungnna'); r.onsuccess = () => resolve(r.result); });
    const tx = db.transaction('settings', 'readwrite');
    tx.objectStore('settings').put({ key: 'purchase_photo_draft', updated_at: new Date().toISOString(), value: {
      store: '00000000-0000-4000-8000-00000000b001', supplier: 'previous-supplier', supplierName: 'OLD SUPPLIER',
      billNo: 'RESET-5494', autoBillNo: true, rack: '', warnings: 'Previous bill warning', total: '100', photoId: 'old-photo',
      rows: Array.from({ length: 5 }, (_, i) => ({ item: 'BALI', style: 'RESET-' + (i + 1), color: 'G', unit: 'PCS', qty: '12', pack: '6', stickers: '', cost: '100', rate: '250' })),
    } });
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  });
  await page.reload(); await signIn();
  await page.getByLabel('item line 1', { exact: true }).waitFor();
  const pack = line => page.getByLabel('pack line ' + line, { exact: true });
  await pack(1).fill('1'); await pack(1).press('Enter');
  assert.equal(await pack(2).inputValue(), '1');
  assert.equal(await pack(2).evaluate(el => el === document.activeElement), true);
  assert.equal(await pack(3).inputValue(), '6');
  await page.keyboard.press('Enter');
  assert.equal(await pack(3).inputValue(), '1');
  // The carried value is selected, so typing replaces it without having to clear it.
  await page.keyboard.type('2'); await page.keyboard.press('Enter');
  assert.equal(await pack(3).inputValue(), '2'); assert.equal(await pack(4).inputValue(), '2');
  await page.keyboard.press('Enter'); assert.equal(await pack(5).inputValue(), '2');
  await page.keyboard.press('Enter'); assert.equal(await pack(5).evaluate(el => el === document.activeElement), true);
  assert.equal(await page.getByLabel('item line 6', { exact: true }).count(), 0);
  assert.deepEqual((await draft()).rows.map(r => r.pack), ['1', '1', '2', '2', '2']);
  assert.deepEqual((await draft()).rows.map(r => r.qty), Array(5).fill('12'));
  for (const invalid of ['0', '-1', '1.5', '10001', '']) {
    await pack(2).fill(invalid); await pack(2).press('Enter');
    assert.equal(await pack(2).evaluate(el => el === document.activeElement), true);
    assert.equal(await pack(3).inputValue(), '2');
  }
  await pack(2).fill('1'); await pack(2).press('Tab');
  assert.equal(await pack(3).inputValue(), '2');
  await page.reload(); await signIn(); await pack(5).waitFor();
  assert.deepEqual((await draft()).rows.map(r => r.pack), ['1', '1', '2', '2', '2']);
  const reset = page.getByRole('button', { name: 'Start over', exact: true });
  await reset.click();
  const confirm = page.getByRole('dialog', { name: 'Confirm deletion', exact: true });
  await confirm.waitFor();
  assert.equal(await confirm.getByRole('button', { name: 'No', exact: true }).evaluate(el => el === document.activeElement), true);
  await confirm.getByRole('button', { name: 'No', exact: true }).click();
  assert.equal(await page.getByLabel('item line 1', { exact: true }).inputValue(), 'BALI');
  assert.equal((await draft()).billNo, 'RESET-5494');
  await reset.click(); await confirm.getByRole('button', { name: 'Yes', exact: true }).click();
  await page.getByRole('button', { name: 'Take photo of the bill', exact: true }).waitFor();
  const cleared = await draft();
  for (const field of ['supplier', 'supplierName', 'billNo', 'total', 'warnings']) assert.equal(cleared[field], '');
  assert.deepEqual(cleared.rows, []); assert.equal(cleared.photoId, undefined); assert.equal(cleared.autoBillNo, undefined);
  await page.reload(); await signIn();
  await page.getByRole('button', { name: 'Take photo of the bill', exact: true }).waitFor();
  assert.deepEqual((await draft()).rows, []);
  await page.getByRole('button', { name: 'Type the lines instead', exact: true }).click();
  await page.getByLabel('item line 1', { exact: true }).waitFor();
  assert.equal((await draft()).supplier, '');
  await reset.focus(); await page.keyboard.press('Enter'); await confirm.waitFor();
  await page.keyboard.press('Escape');
  await confirm.waitFor({ state: 'detached' });
  assert.equal(await page.getByLabel('item line 1', { exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: Enter carries packet sizes 1,1,2,2,2; selects the next cell; rejects invalid counts; preserves quantities and reloads; Start over confirmation and keyboard behavior.');
} finally { await browser.close(); }
