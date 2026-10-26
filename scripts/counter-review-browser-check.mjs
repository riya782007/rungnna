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

  await page.getByLabel('Product name',{exact:true}).waitFor();
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('rungnna');r.onsuccess=()=>resolve(r.result);});
    const t=db.transaction('config','readwrite');t.objectStore('config').put({id:'shop',value:{name:'COUNTER TRIAL',address:'Test shop',gstin:'07ABCDE1234F1Z5',state:'Delhi'},updated_at:new Date().toISOString()});await new Promise(resolve=>t.oncomplete=resolve);db.close();location.hash='#/home';
  });
  await page.locator('.pos').waitFor({state:'detached'});await page.evaluate(()=>location.hash='#/bill');
  await page.getByRole('button',{name:'Estimate',exact:true}).click();
  await page.getByRole('button',{name:'Save estimate',exact:true}).waitFor();
  const showMenu=page.getByRole('button',{name:'Show menu',exact:true});if(await showMenu.count())await showMenu.click();
  const scan=page.getByPlaceholder('Scan label, or type style / item (F7)');
  for(let i=1;i<=12;i++){
    await scan.fill(`RJ1|COUNTER-${i}|F RING|PCS|K5210/${i}|GOLD||100|1`);await scan.press('Enter');
    await page.waitForFunction(n=>document.querySelectorAll('.pos-lines tr.ln').length===n,i);
    if(i<=7){const row=page.locator('.pos-lines tr[aria-current=true]');await row.locator('td[data-l="Box"] input').fill(String(i));await row.locator('td[data-l="Box"] input').blur();}
  }
  await mkdir('dist/print-trials',{recursive:true});
  for(const [width,height] of [[1366,768],[1280,768],[1100,768],[1366,720]]){
    await page.setViewportSize({width,height});
    const layout=await page.evaluate(()=>{
      const r=s=>{const x=document.querySelector(s).getBoundingClientRect();return {x:x.x,y:x.y,w:x.width,h:x.height,b:x.bottom,right:x.right}};
      const grid=r('.pos-lines'),row=r('.pos-lines tr.ln'),head=r('.pos-lines thead');
      return {grid,row,head,actions:r('.counter-actions'),totals:r('.counter-amounts'),rail:r('.rail'),visibleRows:Math.floor((grid.h-head.h)/row.h),pageOverflow:document.documentElement.scrollWidth>innerWidth,boxScroll:document.querySelector('.pos-box-totals').scrollHeight>document.querySelector('.pos-box-totals').clientHeight};
    });
    console.log('Counter review',width,height,JSON.stringify(layout));
    if(layout.visibleRows<8||layout.totals.b>height||layout.actions.x<layout.grid.right||layout.pageOverflow||layout.boxScroll)throw Error('Counter review layout does not fit');
    await page.screenshot({path:`dist/print-trials/review-${width}-${height}.png`,fullPage:true});
  }
  await page.setViewportSize({width:1366,height:768});
  await page.keyboard.press('F3');
  if(!await page.getByLabel('Remarks',{exact:true}).evaluate(el=>el===document.activeElement))throw Error('Hold without remarks was not blocked');
  await page.getByRole('button',{name:'+ UPI',exact:true}).click();
  const amount=page.getByLabel('UPI payment 1 amount',{exact:true});await amount.waitFor();
  if(await amount.inputValue()!=='')throw Error('UPI assumed the full balance');
  await page.getByRole('button',{name:'Save estimate',exact:true}).click();
  if(await page.locator('.pos-lines tr.ln').count()!==12)throw Error('An empty payment was saved');
  await amount.fill('200');await page.getByLabel('UPI payment 1 received by',{exact:true}).fill('Raj');
  if(!(await page.getByLabel('Automatic payment narration').innerText()).includes('200.00 received by Raj'))throw Error('UPI narration missing');
  await amount.fill('250');
  if(!(await page.getByLabel('Automatic payment narration').innerText()).includes('250.00 received by Raj'))throw Error('UPI narration became stale');
  await page.getByRole('button',{name:'+ CASH',exact:true}).click();
  if(await page.getByLabel('CASH payment 2 amount',{exact:true}).inputValue()!=='')throw Error('Cash assumed the balance');
  await page.getByRole('button',{name:/^Use balance /}).click();
  if(await page.getByLabel('CASH payment 2 amount',{exact:true}).inputValue()!=='950')throw Error('Explicit balance shortcut is wrong');
  await page.getByLabel('Remarks',{exact:true}).fill('Raj customer\nAwaiting packing');await page.keyboard.press('F3');
  await page.waitForFunction(()=>document.querySelectorAll('.pos-lines tr.ln').length===0);
  await page.keyboard.press('F4');await page.getByText('Awaiting packing',{exact:false}).waitFor();await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('.pos-lines tr.ln').length===12);
  if(await page.getByLabel('UPI payment 1 received by',{exact:true}).inputValue()!=='Raj')throw Error('Hold lost the payment recipient');
  // A person named Owner with a staff role still needs the screen code. No permission is bypassed by name.
  await page.evaluate(async()=>{
    const db=await new Promise(resolve=>{const r=indexedDB.open('rungnna');r.onsuccess=()=>resolve(r.result);});const t=db.transaction('staff','readwrite'),s=t.objectStore('staff');
    const staff=await new Promise(resolve=>{const r=s.getAll();r.onsuccess=()=>resolve(r.result)});const owner=staff.find(x=>x.role==='owner'&&x.pin);s.put({...owner,name:'Owner',role:'salesman',perms:['billing.sell','sales.today','estimates.open'],updated_at:new Date(Date.now()+1000).toISOString()});await new Promise(resolve=>t.oncomplete=resolve);db.close();location.hash='#/bills';
  });
  await page.reload({waitUntil:'networkidle'});
  await page.getByLabel('Common shop entry code',{exact:true}).fill('rungnna 2026');await page.getByRole('button',{name:'Continue',exact:true}).click();
  await page.getByLabel('Your name',{exact:true}).fill('Owner');await page.getByLabel('Your password (PIN)',{exact:true}).fill('2468');await page.getByRole('button',{name:'Sign in',exact:true}).click();
  await page.getByLabel('Screen access code',{exact:true}).waitFor();await page.getByLabel('Screen access code',{exact:true}).fill('999');await page.getByRole('button',{name:'Open',exact:true}).click();await page.getByRole('alert').filter({hasText:'Screen access code not recognised'}).waitFor();
  await page.getByLabel('Screen access code',{exact:true}).fill('777');await page.getByRole('button',{name:'Open',exact:true}).click();await page.getByLabel('Screen access code',{exact:true}).waitFor({state:'detached'});
  console.log('PASS: expanded narrow navigation, at least 8 visible lines, actions right, visible box quantities, manual cash/UPI amounts and explicit balance, recipient narration, required Hold remarks and resume, screen-code retry with unchanged role protection.');
}catch(error){console.error(error);console.log((await page.locator('body').innerText()).slice(-6000));await page.screenshot({path:'dist/review-failure.png',fullPage:true});throw error;}finally{await browser.close();}
