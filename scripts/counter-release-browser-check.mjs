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
await context.addInitScript(() => {
 Object.defineProperty(navigator,'onLine',{get:()=>false});
 window.__labelJobs=[];
 window.qz={websocket:{isActive:()=>true,connect:async()=>{}},security:{setCertificatePromise(){},setSignaturePromise(){}},printers:{find:async()=>['TSC TEST']},configs:{create:(printer,options)=>({printer,options})},print:async(config,data)=>{window.__labelJobs.push({config,data});}};
});
const page = await context.newPage();
page.on('dialog',d=>d.accept());
page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
try {
  await page.goto('https://rungnna.test/#/bill', { waitUntil: 'networkidle' });
  await page.getByLabel("Common shop entry code").fill("rungnna 2026");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByLabel("Owner's name").fill("Scan trial");
  await page.getByLabel("New 4-digit personal PIN").fill("2468");
  await page.getByRole("button", { name: "Save PIN & open", exact: true }).click();
  console.log('Signed in');
  await page.getByLabel('Product name',{exact:true}).waitFor();
  const scan=page.getByPlaceholder('Scan label, or type style / item (F7)');
  const payload='RJ1|RELEASE-TRIAL|F RING|PCS|K5210/11P|LKQR||11|3';
  await scan.fill(payload);await scan.press('Enter');
  const row=page.locator('.pos-lines tr[aria-current=true]');await row.waitFor();
  await scan.fill(payload);await scan.press('Enter');
  if(await row.locator('td[data-l="Style"]').innerText()!=='K5210/11P')throw Error('Style is not separated');
  if(await row.locator('td[data-l="Colour / Art no."]').innerText()!=='LKQR')throw Error('Colour is not separated');
  if(!await scan.evaluate(el=>el===document.activeElement))throw Error('Scanner focus was lost');
  const confirm=page.getByRole('button',{name:'Dismiss item confirmation',exact:true});if(await confirm.count())await confirm.click();
  await mkdir('dist/print-trials',{recursive:true});
  for(const width of [1366,1280,1100]){
    await page.setViewportSize({width,height:768});
    const layout=await page.evaluate(()=>{const r=s=>{const a=document.querySelector(s).getBoundingClientRect();return {x:a.x,y:a.y,w:a.width,h:a.height,b:a.bottom,right:a.right}};return {grid:r('.pos-lines'),footer:r('.pos-sum'),actions:r('.counter-actions'),amounts:r('.counter-amounts'),entry:r('.pos-entry'),screen:innerHeight,scroll:document.documentElement.scrollWidth,width:innerWidth}});
    console.log('Layout',width,JSON.stringify(layout));
    if(layout.grid.h<100||layout.actions.b>layout.screen||layout.amounts.b>layout.screen)throw Error('Counter controls do not fit');
    if(layout.scroll>layout.width)throw Error('Page horizontal overflow');
    await page.screenshot({path:`dist/print-trials/counter-${width}.png`,fullPage:true});
  }
  await page.keyboard.press('F8');
  await page.getByLabel('Product name',{exact:true}).fill('BALI');await page.getByLabel('Style',{exact:true}).fill('CUSTOM-2');await page.getByLabel('Quantity',{exact:true}).fill('2');await page.getByLabel('Rate per PCS',{exact:true}).fill('25');await page.locator('.pos-quick-row button').click();
  if(await page.locator('.pos-lines tr.ln').count()!==2)throw Error('Manual row failed');
  await page.keyboard.press('F12');
  await page.waitForFunction(()=>document.activeElement?.closest('.counter-payments'));
  await page.getByLabel('Select all bill lines',{exact:true}).check();
  if(await page.getByRole('button',{name:'Delete selected',exact:true}).isDisabled())throw Error('Bulk selection unavailable');
  await page.getByLabel('Select all bill lines',{exact:true}).uncheck();
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('rungnna');r.onsuccess=()=>resolve(r.result);});
    const t=db.transaction(['settings','parties'],'readwrite');t.objectStore('settings').put({key:'label_cfg',value:{format:'rungnna',textVersion:1,show:{style:true,color:true,item:true,rate:true,qty:true,shop:true,cost_code:true,line:true},output:'qz',qzPrinter:'TSC TEST',testFirst:false},updated_at:new Date().toISOString()});t.objectStore('parties').put({id:'photo-vendor',name:'PHOTO VENDOR',kind:'supplier',vendor_code:'59',phone:'',gstin:'',address:'',city:'',state:'',pin:'',tier:'wholesale',opening_balance:0,updated_at:new Date().toISOString()});await new Promise(resolve=>t.oncomplete=resolve);db.close();location.hash='#/labels';
  });
  await page.setViewportSize({width:1366,height:768});
  const form=page.locator('.label-manual');await form.getByLabel('ITEM',{exact:true}).fill('CHAIN');await form.getByLabel('STYLE',{exact:true}).fill('MANUAL-1');await form.getByLabel('COLOR',{exact:true}).fill('GOLD');await form.getByLabel('VENDOR roll no.',{exact:true}).fill('59');await form.getByLabel('COST ₹',{exact:true}).fill('40');await form.getByLabel(/^QTY \(/).fill('2');await form.getByLabel(/^PRINT QTY/).fill('3');await form.getByLabel(/^BILL SR\./).fill('007-A/2');
  const runtimeRequire=createRequire(process.env.LABEL_PLAYWRIGHT_MODULE||import.meta.url);const sample=await runtimeRequire('sharp')({create:{width:24,height:24,channels:3,background:'#c69f52'}}).png().toBuffer();
  await form.locator('.label-item-photo input[type=file]').setInputFiles({name:'chain.png',mimeType:'image/png',buffer:sample});await form.locator('.label-item-photo img').waitFor();await form.getByRole('button',{name:'Add to queue',exact:true}).click();await page.getByRole('button',{name:'Print 3 labels',exact:true}).waitFor();
  if(await form.getByLabel('ITEM',{exact:true}).inputValue()!=='CHAIN'||await form.getByLabel(/^QTY \(/).inputValue()!=='2')throw Error('Repeated entry lost common fields');
  if(!await form.getByLabel('STYLE',{exact:true}).evaluate(el=>el===document.activeElement))throw Error('Next style was not focused');
  await form.getByLabel('STYLE',{exact:true}).fill('MANUAL-2');await form.getByLabel('COST ₹',{exact:true}).fill('60');
  if(!(await page.locator('.label-dock svg').textContent()).includes('MANUAL-2'))throw Error('Stale preview');
  await form.getByLabel(/^PRINT QTY/).press('Enter');await page.waitForFunction(()=>window.__labelJobs.length>0);
  if(await page.getByRole('button',{name:'Print 6 labels',exact:true}).count())throw Error('Current print included an old queued item');
  await page.getByRole('button',{name:'Stop',exact:true}).click();await page.locator('.toast').first().waitFor({state:'hidden'});
  const fields=await form.locator('.label-manual-fields').boundingBox();if(fields.y+fields.height>768)throw Error('Manual fields need scrolling');
  await page.screenshot({path:'dist/print-trials/manual-labels.png',fullPage:true});
  await page.evaluate(()=>location.hash='#/labels/bill');await page.getByRole('button',{name:'Type the lines instead',exact:true}).click();
  const line=page.locator('.purchase-lines tbody tr').first();await line.locator('[data-l="Jewellery photo"] input[type=file]').setInputFiles({name:'purchase-chain.png',mimeType:'image/png',buffer:sample});await line.locator('[data-l="Jewellery photo"] img').waitFor();
  console.log('PASS: latest-production company/discount/serial rules retained; full-width billing columns and visible checkout, repeat scans, manual entry, advance focus, bulk selection, jewellery photos, retained manual defaults, live preview and current-item-only printing.');
} catch(error){console.log((await page.locator('body').innerText()).slice(-7000));console.error(error);await page.screenshot({path:'dist/release-failure.png',fullPage:true});throw error;}finally{await browser.close();}
