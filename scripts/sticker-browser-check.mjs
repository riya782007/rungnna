// Run after npm run build. Set LABEL_PLAYWRIGHT_MODULE if Playwright is not in node_modules.
// All requests use local dist files; QZ is intercepted and no physical job is sent.
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
await context.addInitScript(() => {
  window.__labelJobs = [];
  window.qz = {
    websocket: { isActive: () => true, connect: async () => {} },
    security: { setCertificatePromise() {}, setSignaturePromise() {} },
    printers: { find: async () => ['TSC TEST'] },
    configs: { create: (printer, options) => ({ printer, options }) },
    print: async (config, data) => { window.__labelJobs.push({ config, data }); },
  };
});
const page = await context.newPage();
page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
try {
  await page.goto('https://rungnna.test/#/labels', { waitUntil: 'networkidle' });
  await page.getByLabel("Owner's name").fill('Sticker trial');
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('heading', { name: 'QR labels', exact: true }).waitFor();
  await page.getByText('Printer settings', { exact: true }).click();
  await page.getByLabel(/^Print labels using/).selectOption('qz');
  await page.getByRole('button', { name: 'Find Windows printers', exact: true }).click();
  await page.getByLabel(/^TSC printer/).selectOption('TSC TEST');
  await page.getByLabel('ITEM', { exact: true }).fill('F-RING');
  await page.getByLabel('STYLE', { exact: true }).fill('K521011/P');
  await page.getByLabel('COLOR', { exact: true }).fill('WXZ/13');
  await page.getByLabel(/^RATE/).fill('9146');
  await page.getByLabel(/^QTY \(/).fill('1');
  await page.getByLabel(/^PRINT QTY/).fill('4');
  await page.getByRole('button', { name: 'Add to queue', exact: true }).click();
  await page.getByRole('button', { name: 'Print 4 labels', exact: true }).waitFor();
  await mkdir('dist/print-trials', { recursive: true });
  await page.waitForFunction(() => !document.querySelector('.toast')?.textContent);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'dist/print-trials/sticker-desktop.png', fullPage: true });
  await page.locator('.labelprev').first().screenshot({ path: 'dist/print-trials/sticker-row.png', scale: 'css' });
  await page.getByRole('button', { name: 'Print 4 labels', exact: true }).click();
  await page.getByRole('button', { name: 'Yes, right: print the other 1', exact: true }).waitFor();
  await page.getByLabel(/^PRINT QTY/).press('Enter');
  if (await page.getByRole('heading', { name: 'Print queue', exact: true }).locator('..').locator('..').locator('input').count() !== 1) throw new Error('Enter changed queue during check');
  await page.getByRole('button', { name: 'Yes, right: print the other 1', exact: true }).click();
  await page.waitForFunction(() => window.__labelJobs.length === 2);
  const jobs = await page.evaluate(() => window.__labelJobs);
  for (const job of jobs) {
    const bytes = Buffer.from(job.data[0].data, 'base64');
    const program = bytes.toString('latin1');
    if (job.config.printer !== 'TSC TEST' || !program.startsWith('SIZE 104 mm,15 mm\r\nGAP 2.6 mm,0 mm')) throw new Error('Wrong printer or row dimensions');
    if (program.split('\r\nPRINT 1,1\r\n').length !== 2) throw new Error('Expected exactly one physical row per job');
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForFunction(() => !document.querySelector('.toast')?.textContent);
  await page.evaluate(() => scrollTo(0, 0));
  await page.screenshot({ path: 'dist/print-trials/sticker-mobile.png', fullPage: true });
  console.log('PASS: production UI rendered; check row printed once; accepted 3 removed; remaining 1 printed; exact 104x15mm +2.6mm gap; Enter guard; desktop/mobile screenshots.');
} catch (error) { console.log((await page.locator('body').innerText()).slice(-6000)); throw error; } finally { await browser.close(); }
