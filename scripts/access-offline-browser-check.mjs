// Isolated production PWA trial. No shop database or external service is used.
// Build first; set LABEL_PLAYWRIGHT_MODULE if Playwright is not installed locally.
import { createRequire } from 'node:module';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.LABEL_PLAYWRIGHT_MODULE || 'playwright');
const root = resolve('dist');
const types = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.ttf': 'font/ttf' };
const base = 'https://rungnna-access.test';
const browser = await chromium.launch({ headless: true, channel: 'chrome' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, serviceWorkers: 'block' });
const errors = [], requests = [];
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin !== base) { requests.push(url.origin + url.pathname); await route.abort(); return; }
  const path = resolve(root, '.' + (url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(root + sep)) return route.abort();
  try { await route.fulfill({ body: await readFile(path), contentType: types[extname(path)] || 'application/octet-stream' }); }
  catch { await route.fulfill({ status: 404, body: 'Missing build asset' }); }
});
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
const output = 'dist/print-trials/access-offline';
await mkdir(output, { recursive: true });
const stamp = () => new Date().toISOString();
const ownerId = '00000000-0000-4000-8000-00000000a001', personalId = '00000000-0000-4000-8000-00000000aa01';
const roleId = '00000000-0000-4000-8000-00000000aa02', loginId = '00000000-0000-4000-8000-00000000aa03';
const nextLoginId = '00000000-0000-4000-8000-00000000aa04';
const role = { id: roleId, name: 'Stock view only', base: 'manager', perms: ['stock.view'], passcode: 'ABC234', login_id: loginId };
const writeRows = async rows => page.evaluate(async rows => {
  const database = await new Promise((resolve, reject) => { const request = indexedDB.open('rungnna'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
  const stores = [...new Set(rows.map(row => row.table))];
  const transaction = database.transaction(stores, 'readwrite');
  for (const row of rows) transaction.objectStore(row.table).put(row.value);
  await new Promise((resolve, reject) => { transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error); transaction.onerror = () => reject(transaction.error); });
  database.close();
  // Native IDB fixture writes notify the live queries as another app window does.
  dispatchEvent(new CustomEvent('x-storagemutated-1', { detail: { all: { d: 1, from: -Infinity, to: [[]] } } }));
}, rows);
const enterShop = async () => { await page.getByLabel('Common shop entry code', { exact: true }).fill('counter common 2026'); await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.getByLabel('Your role passcode', { exact: true }).waitFor(); };
const lock = async () => { await page.locator('.railfoot .me').click(); await page.getByLabel('Common shop entry code', { exact: true }).waitFor(); };
const signRole = async code => { await page.getByLabel('Your role passcode', { exact: true }).fill(code); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); };
const signPerson = async (name, pin) => { await page.getByRole('button', { name: new RegExp(name) }).click(); await page.getByLabel('Personal PIN for ' + name, { exact: true }).fill(pin); await page.getByRole('button', { name: 'Sign in', exact: true }).click(); };
try {
  await page.goto(base + '/#/bill');
  await page.getByLabel('Common shop entry code', { exact: true }).waitFor();
  const at = stamp();
  await writeRows([
    { table: 'staff', value: { id: ownerId, name: 'Access owner', role: 'owner', pin: '2468', phone: '', active: 1, updated_at: at } },
    { table: 'staff', value: { id: personalId, name: 'Personal stock clerk', role: 'manager', role_id: roleId, pin: '2356', phone: '', active: 1, updated_at: at } },
    { table: 'staff', value: { id: loginId, name: role.name, role: 'manager', role_id: roleId, login: 'role', pin: '', phone: '', active: 1, updated_at: at } },
    { table: 'config', value: { id: 'roles', value: { roles: [role] }, updated_at: at } },
    { table: 'config', value: { id: 'open_code', value: { code: 'counter common 2026' }, updated_at: at } },
  ]);
  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterShop();
  if (await page.locator('.shell').count()) throw new Error('Common entry code granted access before personal identity');
  await signPerson('Personal stock clerk', '2356');
  await page.getByText('Not available for your role', { exact: true }).waitFor();
  if (await page.locator('.rail a[aria-label="Sell"]').count()) throw new Error('Restricted personal PIN exposed selling');
  await page.goto(base + '/#/products');
  await page.locator('.shell').waitFor();
  await page.goto(base + '/#/settings');
  const syncBox = page.getByRole('checkbox', { name: 'Cloud sync enabled on this computer, including GST bills' });
  await syncBox.waitFor();
  if (!await syncBox.isDisabled() || !await syncBox.isChecked()) throw new Error('Restricted user could change cloud sync or normal online sync default was lost');
  if (await page.getByRole('heading', { name: 'Printing', exact: true }).count()) throw new Error('Restricted user could change printer settings');
  await page.goto(base + '/#/roles');
  await page.getByText('Not available for your role', { exact: true }).waitFor();
  await lock(); await enterShop(); await signRole(role.passcode);
  await page.locator('.shell').waitFor();
  const nextRole = { ...role, passcode: 'JKM789', login_id: nextLoginId };
  await writeRows([{ table: 'config', value: { id: 'roles', value: { roles: [nextRole] }, updated_at: stamp() } }]);
  await page.getByLabel('Common shop entry code', { exact: true }).waitFor();
  await enterShop(); await signRole(role.passcode);
  await page.getByRole('alert').getByText(/Passcode or PIN not recognised/).waitFor();
  await writeRows([{ table: 'staff', value: { id: nextLoginId, name: role.name, role: 'manager', role_id: roleId, login: 'role', pin: '', phone: '', active: 1, updated_at: stamp() } }]);
  await signRole(nextRole.passcode); await page.locator('.shell').waitFor();
  await writeRows([{ table: 'staff', value: { id: nextLoginId, name: role.name, role: 'manager', role_id: roleId, login: 'role', pin: '', phone: '', active: 0, deleted: 1, updated_at: stamp() } }]);
  await page.getByLabel('Common shop entry code', { exact: true }).waitFor();
  await enterShop(); await signPerson('Access owner', '2468'); await page.locator('.shell').waitFor();
  await page.goto(base + '/#/settings'); await syncBox.waitFor();
  if (await syncBox.isDisabled() || !await syncBox.isChecked()) throw new Error('Owner sync checkbox unavailable or normal sync default was lost');
  await syncBox.click();
  await page.waitForFunction(() => [...document.querySelectorAll('label')].find(label => label.textContent.includes('Cloud sync enabled on this computer'))?.querySelector('input')?.checked === false);
  if (await syncBox.isChecked()) throw new Error('Owner could not pause cloud sync');
  await page.getByRole('link', { name: 'Roles & permissions', exact: true }).click();
  await page.getByRole('heading', { name: 'Roles & Permissions', exact: true }).waitFor();
  await page.getByText('The common code never grants owner access.', { exact: false }).waitFor();
  await page.screenshot({ path: output + '/owner-roles-offline.png', fullPage: true });
  await page.goto(base + '/#/bill');
  const scan = page.getByPlaceholder('Scan label, or type style / item (F7)');
  await scan.fill('RJ1|RELOAD-DRAFT|DRAFT KEEP|PCS|STYLE-DRAFT|GOLD||10|2'); await scan.press('Enter');
  await page.locator('.pos-lines tbody tr[aria-current="true"]').waitFor();
  await page.waitForFunction(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('rungnna'); request.onsuccess = () => resolve(request.result); });
    const draft = await new Promise(resolve => { const request = database.transaction('settings').objectStore('settings').get('draft_bill'); request.onsuccess = () => resolve(request.result?.value); }); database.close();
    return draft?.items?.some(line => line.item === 'DRAFT KEEP' && line.qty === 2);
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByLabel('Common shop entry code', { exact: true }).waitFor();
  if (await page.locator('.shell').count()) throw new Error('Saved owner identity bypassed fresh entry');
  await enterShop(); await signPerson('Access owner', '2468');
  await page.locator('.pos-lines tbody tr').filter({ has: page.locator('input[value="DRAFT KEEP"]') }).waitFor();
  await page.screenshot({ path: output + '/draft-after-reauthentication.png', fullPage: true });
  await page.goto(base + '/#/labels');
  await page.locator('summary').filter({ hasText: 'Printer settings' }).click();
  const darkness = page.getByLabel('Print darkness (0–15)', { exact: true });
  const speed = page.getByLabel('Print speed (1–6)', { exact: true });
  if (await darkness.inputValue() !== '10' || await speed.inputValue() !== '2') throw new Error('Label print defaults did not load as darkness 10 / speed 2');
  await darkness.fill('12'); await darkness.blur();
  await page.waitForFunction(async () => {
    const database = await new Promise(resolve => { const request = indexedDB.open('rungnna'); request.onsuccess = () => resolve(request.result); });
    const config = await new Promise(resolve => { const request = database.transaction('settings').objectStore('settings').get('label_cfg'); request.onsuccess = () => resolve(request.result?.value); }); database.close();
    return config?.density === 12 && config?.speed === 2;
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await enterShop(); await signPerson('Access owner', '2468');
  await page.locator('summary').filter({ hasText: 'Printer settings' }).click();
  if (await darkness.inputValue() !== '12' || await speed.inputValue() !== '2') throw new Error('Label darkness/speed did not survive reauthentication');
  await page.screenshot({ path: output + '/label-darkness-after-reauthentication.png', fullPage: true });
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));
  const result = { navigatorOfflineLocalMode: true, installedPwaColdReloadVerified: false, commonCodeSeparatesIdentity: true, reloadRequiresFreshIdentity: true, reloadPreservesBillingDraft: true, personalPinRestricted: true, rolePasscodeRestricted: true, regeneratedRoleRevokesBeforeStaffSync: true, disabledRoleSignsOut: true, rolesIndexNavigable: true, cloudSyncOwnerOnly: true, normalOnlineSyncDefault: true, ownerCanPauseSync: true, labelDarknessDefaultsVerified: true, labelDarknessPersistsAcrossReload: true, externalRequestsAttempted: requests.length, errors };
  await writeFile(output + '/result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { await context.close(); await browser.close(); }
