import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { prepareZXingModule, readBarcodes } from 'zxing-wasm/reader';
const bundled=createRequire('C:/Users/Riya yadav/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/x.js');
const {chromium}=bundled('playwright'),sharp=bundled('sharp');
prepareZXingModule({overrides:{wasmBinary:await readFile('node_modules/zxing-wasm/dist/reader/zxing_reader.wasm')}});
const browser=await chromium.launch({headless:true,channel:'chrome'});
const context=await browser.newContext({viewport:{width:1366,height:900},serviceWorkers:'block'});
const root=resolve('dist'),base='https://rungnna-quantity.test',errors=[];
const mime={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.wasm':'application/wasm','.woff2':'font/woff2','.webmanifest':'application/manifest+json'};
await context.route('**/*',async route=>{const url=new URL(route.request().url());if(url.origin!==base)return route.abort();const path=resolve(root,'.'+(url.pathname==='/'?'/index.html':decodeURIComponent(url.pathname)));if(!path.startsWith(root+sep))return route.abort();try{await route.fulfill({body:await readFile(path),contentType:mime[extname(path)]||'application/octet-stream'});}catch{await route.fulfill({status:404,body:'Not found'});}});
await context.addInitScript(()=>{
 Object.defineProperty(navigator,'onLine',{get:()=>false});
 if(window===window.top)window.__printTrials=[];
 window.print=function(){const target=document.getElementById('printroot');window.top.__printTrials.push({artwork:target?.querySelectorAll('svg').length||0,svgs:[...(target?.querySelectorAll('svg')||[])].map(s=>s.outerHTML)});setTimeout(()=>window.dispatchEvent(new Event('afterprint')),10);};
});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
const signIn=async()=>{
 await page.getByLabel('Common shop entry code',{exact:true}).fill('rungnna 2026');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByRole('button',{name:/Quantity owner/}).click();await page.getByLabel('Personal PIN for Quantity owner',{exact:true}).fill('2468');await page.getByRole('button',{name:'Sign in',exact:true}).click();
};
const seed=async(update)=>page.evaluate(async update=>{
 const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('rungnna');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
 const tx=db.transaction(['settings','parties','locations'],'readwrite'),at=new Date().toISOString(),store='00000000-0000-4000-8000-00000000b001';
 if(!update){
 tx.objectStore('parties').put({id:'supplier',name:'KAYAN',kind:'supplier',vendor_code:'51',opening_balance:0,updated_at:at});
 tx.objectStore('locations').put({id:'rack',store_id:store,kind:'rack',floor:'1',rack:'1',box:'',code:'F1-R01',name:'',updated_at:at});
 tx.objectStore('settings').put({key:'purchase_label_pack',value:'12',updated_at:at});
 }
 tx.objectStore('settings').put({key:'purchase_photo_draft',value:{store,supplier:'supplier',supplierName:'KAYAN',billNo:update?'NEXT-2':'KAYAN-26',rack:'rack',warnings:'',total:'',rows:Array.from({length:update?1:26},(_,i)=>({item:update?'UNKNOWN CATEGORY':'BALI',style:update?'UNMAPPED-1':'KYN'+(3856+i),color:'G',unit:'PAIR',hsn:'7117',qty:String(12*(1+i%3)),pack:'',stickers:'',cost:'100',rate:'250',ref:'212'}))},updated_at:at});
 await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});db.close();
},update);
const get=async table=>page.evaluate(async table=>{const d=await new Promise(resolve=>{const r=indexedDB.open('rungnna');r.onsuccess=()=>resolve(r.result);});const all=await new Promise(resolve=>{const r=d.transaction(table).objectStore(table).getAll();r.onsuccess=()=>resolve(r.result);});d.close();return all;},table);
try{
 await page.goto(base+'/#/labels/bill');await page.getByLabel('Common shop entry code',{exact:true}).fill('rungnna 2026');await page.getByRole('button',{name:'Continue',exact:true}).click();
 await page.getByLabel("Owner's name").fill('Quantity owner');await page.getByLabel('New 4-digit personal PIN').fill('2468');await page.getByRole('button',{name:'Save PIN & open',exact:true}).click();
 await page.getByRole('heading',{name:'QR labels',exact:true}).waitFor();await page.locator('.purchase-photo[aria-busy="false"]').waitFor();await page.waitForFunction(()=>new Promise(resolve=>{const r=indexedDB.open('rungnna');r.onsuccess=()=>{const d=r.result,q=d.transaction('settings').objectStore('settings').get('purchase_photo_draft');q.onsuccess=()=>{resolve(!!q.result);d.close();};};}));await seed(false);await page.reload();await signIn();await page.getByLabel('pack line 26',{exact:true}).waitFor();
 for(let i=1;i<=26;i++)if(await page.getByLabel('pack line '+i,{exact:true}).inputValue()!=='12')throw Error('Saved packet default not applied to line '+i);
 const before=await page.locator('.purchase-lines input[aria-label^="qty line"]').evaluateAll(inputs=>inputs.map(i=>i.value));
 await page.getByLabel('Pieces per packet for all lines',{exact:true}).fill('6');await page.getByRole('button',{name:'Apply to all 26 lines',exact:true}).click();
 await page.getByText(/26 lines updated · bill quantities kept · X6 per packet · packet default saved/).waitFor();
 const after=await page.locator('.purchase-lines input[aria-label^="qty line"]').evaluateAll(inputs=>inputs.map(i=>i.value));if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Packet-only update overwrote total quantities');
 await page.getByLabel('Total quantity per line (optional)',{exact:true}).fill('12');await page.getByLabel('Pieces per packet for all lines',{exact:true}).fill('12');await page.getByRole('button',{name:'Apply to all 26 lines',exact:true}).click();
 await page.getByText(/26 lines updated · total quantity 12 each · X12 per packet · packet default saved/).waitFor();
 await page.getByLabel('qty line 2',{exact:true}).fill('24');
 await page.getByRole('button',{name:/Approve: draft 26 products & print 27 labels/}).waitFor();
 const layout=await page.locator('.purchase-lines').evaluate(el=>({client:el.clientWidth,scroll:el.scrollWidth}));if(layout.scroll>layout.client+1)throw Error('Purchase table still needs horizontal scrolling: '+JSON.stringify(layout));
 await mkdir('dist/print-trials',{recursive:true});await page.screenshot({path:'dist/print-trials/purchase-quantities-26.png',fullPage:true});
 await page.locator('.purchase-photo .approve-bar input[type="checkbox"]').check();await page.getByRole('button',{name:/Approve: draft 26 products & print 27 labels/}).click();
 await page.waitForFunction(()=>window.__printTrials.length===1);
 const purchases=await get('purchases'),products=await get('products'),stock=await get('stock');
 if(purchases.length!==1||purchases[0].total_qty!==324||products.length!==26||stock.reduce((n,c)=>n+c.qty,0)!==324)throw Error('Wrong saved quantities or duplicate purchase');
 if(!products.every(p=>p.item_code==='5186'&&p.ref==='212'&&p.pack===12))throw Error('Legacy fields or pack were dropped');
 const first=await page.evaluate(()=>window.__printTrials[0]);if(first.artwork!==3)throw Error('First test row did not contain 3 stickers');
 const {data,info}=await sharp(Buffer.from(first.svgs[0]),{density:406}).ensureAlpha().raw().toBuffer({resolveWithObject:true});
 const codes=await readBarcodes({data:new Uint8ClampedArray(data),width:info.width,height:info.height},{tryHarder:true,formats:['QRCode']});
 if(!codes.some(c=>c.isValid&&c.text==='5186~250~12~212~~KYN3856~G'))throw Error('Purchase QR does not carry original legacy identity and X12');
 await page.getByRole('button',{name:'Yes, right: print the other 24',exact:true}).click();await page.waitForFunction(()=>window.__printTrials.length===2);
 const prints=await page.evaluate(()=>window.__printTrials.map(p=>p.artwork));if(JSON.stringify(prints)!=='[3,24]')throw Error('Wrong print batch total');
 await seed(true);await page.reload();await signIn();await page.getByLabel('pack line 1',{exact:true}).waitFor();
 if(await page.getByLabel('pack line 1',{exact:true}).inputValue()!=='12')throw Error('Remembered packet size did not survive reload');
 await page.locator('.purchase-photo .approve-bar input[type="checkbox"]').check();const approve=page.getByRole('button',{name:/Approve: draft 1 product & print 1 label/});
 if(await approve.isEnabled())throw Error('Missing legacy item code did not block approval');
 if((await get('purchases')).length!==1)throw Error('Preflight failure saved another purchase');
 await page.getByLabel('Old software code for UNKNOWN CATEGORY (PAIR)',{exact:true}).fill('203');await page.locator('.purchase-photo .approve-bar input[type="checkbox"]').check();
 if(!await approve.isEnabled())throw Error('Entering the original item code did not enable approval');
 if(errors.length)throw Error(errors.join('\n'));
 const result={rows:26,savedDefaultFillsAllPackets:true,bulkPacketEditPreservesBillTotals:true,bulkTotalAndPacketOneAction:true,individualEditsRetained:true,totalStock:324,labelsPrinted:prints,legacyQrDecoded:true,rememberedDefaultAfterReload:true,missingOldCodeStopsBeforePurchase:true,layout,errors};
 await writeFile('dist/print-trials/purchase-quantities-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));
}catch(error){console.log((await page.locator('body').innerText()).slice(-6000));throw error;}finally{await browser.close();}
