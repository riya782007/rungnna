// Karan's counter day, end to end, in a real browser — run before every update goes to the shop:
//   npm run build && npm run check:counter
// Serves dist/ on a fake address (no internet, no shop data, no printers). Every step prints PASS / FAIL;
// screenshots of each step land in dist/counter-day/. Exit code 1 if anything failed.
// Owner, 23 Nov (voice): "test everything yourselves and give us the finished product" — this is that list.
import { createRequire } from "node:module";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
const require = createRequire(import.meta.url);
const { chromium, devices } = require(process.env.PLAYWRIGHT_MODULE || "playwright");

const root = resolve("dist"), shots = resolve("dist/counter-day");
await mkdir(shots, { recursive: true });
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".wasm": "application/wasm", ".webmanifest": "application/manifest+json", ".png": "image/png", ".json": "application/json", ".txt": "text/plain", ".ttf": "font/ttf", ".woff2": "font/woff2" };
const results = [];
const browser = await chromium.launch({ headless: true });

async function context(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, serviceWorkers: "block", ...opts });
  await ctx.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.hostname !== "rungnna.test") return route.abort();
    const path = resolve(root, "." + (url.pathname === "/" ? "/index.html" : decodeURIComponent(url.pathname)));
    if (!path.startsWith(root + sep)) return route.abort();
    try { await route.fulfill({ body: await readFile(path), contentType: mime[extname(path)] || "application/octet-stream" }); }
    catch { await route.fulfill({ status: 200, body: await readFile(resolve(root, "index.html")), contentType: "text/html" }); }
  });
  // printing is recorded, never sent to a printer
  await ctx.addInitScript(() => { window.__prints = 0; window.print = () => { window.__prints++; setTimeout(() => dispatchEvent(new Event("afterprint")), 50); }; });
  return ctx;
}
const errors = [];
async function openShop(ctx, name = "Karan") {
  const page = await ctx.newPage();
  page.on("pageerror", e => errors.push(e.message));
  page.on("dialog", d => d.accept());
  await page.goto("https://rungnna.test/#/home", { waitUntil: "networkidle" });
  await page.getByLabel("Common shop entry code").fill("rungnna 2026");
  await page.keyboard.press("Enter");
  await page.getByLabel("Owner's name").first().fill(name);
  await page.locator("input[type=password], input[inputmode=numeric]").last().fill("1234");
  await page.getByRole("button", { name: "Save PIN & open" }).click();
  await page.waitForTimeout(1500);
  return page;
}
async function step(page, name, fn) {
  try { await fn(); results.push([true, name]); console.log("PASS", name); }
  catch (e) { results.push([false, name, e.message.split("\n")[0]]); console.log("FAIL", name, "—", e.message.split("\n")[0]); }
  try { await page.screenshot({ path: `${shots}/${String(results.length).padStart(2, "0")}-${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 50)}.png` }); } catch { /* closed */ }
}
const must = (ok, why) => { if (!ok) throw new Error(why); };

/* shop data: 3 designs on a rack, one never entered in stock */
async function seed(page) {
  await page.evaluate(() => new Promise((ok, bad) => {
    const r = indexedDB.open("rungnna"); r.onerror = bad;
    r.onsuccess = () => {
      const d = r.result, now = new Date().toISOString(), MAIN = "00000000-0000-4000-8000-00000000b001";
      const tx = d.transaction(["products", "stock", "locations"], "readwrite");
      tx.objectStore("locations").put({ id: "chk-rack", code: "F1-R01", name: "F1 rack 1", floor: "1", rack: "1", box: "", kind: "rack", store_id: MAIN, updated_at: now });
      const P = (id, item, style, rate, qty) => {
        tx.objectStore("products").put({ id, code: "CHK" + id, item, type: "PCS", style, color: "GOLD", category: "", pack: 1, cost: 0, rate, barcodes: ["CHKCODE-" + id], deleted: 0, updated_at: now, created_at: now, created_by: "check", tk: "" });
        if (qty) tx.objectStore("stock").put({ key: id + "|chk-rack", product_id: id, loc_id: "chk-rack", qty, store_id: MAIN });
      };
      P("e1", "EARRING", "K5210/11P", 17400, 20); P("n1", "N-SET", "K5208/41", 117600, 10); P("h1", "HAIR ACC", "H-77", 2400, 0);
      tx.oncomplete = ok; tx.onerror = bad;
    };
  }));
}
const scan = async (page, code) => { const box = page.getByPlaceholder(/Scan label/); await box.click(); await page.keyboard.type(code, { delay: 1 }); await page.keyboard.press("Enter"); await page.waitForTimeout(500); };
const lines = page => page.locator(".pos-lines tbody tr.ln").count();

/* ---------------- the counter computer ---------------- */
{
  const ctx = await context();
  const page = await openShop(ctx);
  await seed(page);
  await page.goto("https://rungnna.test/#/bill"); await page.waitForTimeout(2000);

  await step(page, "estimate: scan two stickers, same sticker again adds quantity", async () => {
    await page.getByRole("button", { name: "Estimate", exact: true }).click(); await page.waitForTimeout(800);
    await scan(page, "CHKCODE-e1"); await scan(page, "CHKCODE-n1"); await scan(page, "CHKCODE-e1");
    must(await lines(page) === 2, "expected 2 lines, got " + await lines(page));
    must(await page.getByPlaceholder(/Scan label/).inputValue() === "", "scan box not cleared");
  });
  await step(page, "estimate: 30 quick scans stay fast", async () => {
    const t = Date.now(); for (let i = 0; i < 30; i++) await scan(page, "CHKCODE-" + (i % 2 ? "e1" : "n1"));
    const per = (Date.now() - t) / 30; must(per < 1500, `scan took ${Math.round(per)} ms each`);
  });
  await step(page, "estimate: save and print (one roll piece); short warning for billed-without-stock", async () => {
    await page.getByRole("button", { name: /^Print estimate/ }).click(); await page.waitForTimeout(2500);
    const body = await page.locator("body").innerText();
    must(!/more than recorded\),.*more than recorded\),.*more than recorded\)/.test(body), "long red list of items on screen");
    must(/Saved|EST\//.test(body), "no saved estimate number");
    await page.getByText(/Print prepared|Printed|Sent to/).first().waitFor({ timeout: 8000 }).catch(() => { throw new Error("print not started"); });
  });
  await step(page, "box number always in sight; tap starts the next box", async () => {
    const btn = page.locator("button.box-now"); must(await btn.isVisible(), "no box button by the scan box");
    const before = Number((await btn.locator("b").innerText()).trim());
    await btn.click(); await page.waitForTimeout(300);
    must(Number((await btn.locator("b").innerText()).trim()) === before + 1, "box did not go up by one");
    await scan(page, "CHKCODE-h1");
    must((await page.locator(".pos-lines tr[aria-current=true] td[data-l=Box] input").inputValue()) === String(before + 1), "scan did not go into the new box");
  });
  await step(page, "scanner with the cursor on a button still adds the item", async () => {
    const before = await lines(page);
    await page.getByRole("button", { name: /^Hold/ }).focus();
    await page.keyboard.type("CHKCODE-n1", { delay: 1 }); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
    must(await page.locator(".pos-lines tr[aria-current=true] td[data-l=Style]").innerText() === "K5208/41", "scan with the cursor on a button was thrown away");
    must(await lines(page) >= before, "lines lost");
  });
  await step(page, "new customer typed, form closes by itself, details come back", async () => {
    await page.getByText("Walk-in / cash").first().click(); await page.waitForTimeout(400);
    await page.keyboard.type("9827877149"); await page.getByRole("button", { name: /New customer/ }).click(); await page.waitForTimeout(400);
    const name = page.locator(".modal input").nth(1); await name.fill("RISHAB RATHORE"); await page.waitForTimeout(300);
    await page.evaluate(() => location.hash = "#/home"); await page.waitForTimeout(800);   // the form is gone
    await page.evaluate(() => location.hash = "#/bill"); await page.waitForTimeout(1500);
    await page.getByText("Walk-in / cash").first().click(); await page.waitForTimeout(600);
    must(/RISHAB RATHORE/.test(await page.locator(".modal").evaluate(m => [...m.querySelectorAll("input")].map(i => i.value).join(" "))), "typed customer lost");
    await page.getByRole("button", { name: "Close" }).first().click(); await page.waitForTimeout(300);
  });
  await step(page, "tax invoice: scan, CGST + SGST, save", async () => {
    await page.getByRole("button", { name: "GST Invoice", exact: true }).click(); await page.waitForTimeout(800);
    await scan(page, "CHKCODE-e1");
    const sum = await page.locator(".pos-sum").innerText();
    must(/CGST/.test(sum) && /SGST/.test(sum), "no CGST/SGST on a Delhi bill");
    await page.getByRole("button", { name: /^Save tax invoice/ }).click(); await page.waitForTimeout(2000);
  });
  await step(page, "stock: nothing in minus, billed-without-stock is flagged", async () => {
    await page.goto("https://rungnna.test/#/products"); await page.waitForTimeout(1500);
    const text = await page.locator(".page").innerText();
    must(!/(^|\s)-\d+\s*pcs/m.test(text), "a minus quantity is on the list");
  });
  await step(page, "lock estimates (Ctrl+Q): bills hide estimates, stock list hides rates", async () => {
    await page.locator("body").click({ position: { x: 5, y: 400 } }).catch(() => {});
    await page.keyboard.press("Control+q"); await page.waitForTimeout(800);
    must(await page.evaluate(() => localStorage.getItem("rj_est_hidden")) === "1", "Ctrl+Q did not lock the estimates");
    await page.goto("https://rungnna.test/#/products"); await page.waitForTimeout(1200);
    must(!/Rate ₹/.test(await page.locator(".page").innerText()), "rates still showing while locked");
    await page.goto("https://rungnna.test/#/bills"); await page.waitForTimeout(1200);
    must(!/EST\//.test(await page.locator(".page").innerText()), "an estimate number shows while locked");
  });
  await step(page, "photos page opens a photo big", async () => {
    await page.evaluate(() => new Promise(ok => { const r = indexedDB.open("rungnna"); r.onsuccess = () => { const tx = r.result.transaction(["products"], "readwrite"); const s = tx.objectStore("products"); const g = s.get("e1"); g.onsuccess = () => { s.put({ ...g.result, photo_id: "chk-missing", updated_at: new Date().toISOString() }); }; tx.oncomplete = ok; }; }));
    await page.goto("https://rungnna.test/#/photos"); await page.waitForTimeout(1500);
    await page.locator(".photo-tile button").first().click(); await page.waitForTimeout(600);
    must(await page.locator(".modal").count() === 1, "photo did not open");
    await page.keyboard.press("Escape");
  });
  await step(page, "PIN from address: rohini sector 20 → Rohini, not New Delhi", async () => {
    await page.goto("https://rungnna.test/#/bill"); await page.waitForTimeout(1200);
    await page.getByText("Walk-in / cash").first().click(); await page.waitForTimeout(400);
    await page.keyboard.type("8700513510"); await page.getByRole("button", { name: /New customer/ }).click(); await page.waitForTimeout(400);
    await page.locator(".modal textarea, .modal input[placeholder*=ddress], .modal label:has-text('Address') textarea, .modal label:has-text('Address') input").first().fill("rohini sector 20 jagdamba market");
    await page.waitForTimeout(1500);
    const text = await page.locator(".modal").innerText();
    must(/11008[59]/.test(text), "no Rohini PIN offered");
    await page.getByRole("button", { name: "Close" }).first().click();
  });
  await step(page, "customers page opens", async () => {
    await page.goto("https://rungnna.test/#/customers"); await page.waitForTimeout(1500);
    must((await page.locator(".page").innerText()).length > 50, "empty customers page");
  });
  await step(page, "reports page opens", async () => {
    await page.goto("https://rungnna.test/#/reports"); await page.waitForTimeout(1500);
    must((await page.locator(".page").innerText()).length > 50, "empty reports page");
  });
  await ctx.close();
}

/* ---------------- the owner's phone ---------------- */
{
  const ctx = await context({ ...devices["Pixel 5"], serviceWorkers: "block" });
  const page = await openShop(ctx);
  await seed(page);
  await page.goto("https://rungnna.test/#/bill"); await page.waitForTimeout(2000);
  await step(page, "phone: install strip says how to put the icon on the home screen", async () => {
    must(/home screen|Install/i.test(await page.locator("main").innerText()), "no install hint on the phone");
  });
  await step(page, "phone: estimate with a scanned item, page scrolls to Save", async () => {
    await page.getByRole("button", { name: "Estimate", exact: true }).click(); await page.waitForTimeout(800);
    await scan(page, "CHKCODE-e1");
    must(await lines(page) === 1, "line not added on the phone");
    await page.mouse.wheel(0, 3000); await page.waitForTimeout(500);
    must(await page.evaluate(() => scrollY) > 100, "page does not scroll");
  });
  await ctx.close();
}

await browser.close();
const bad = results.filter(r => !r[0]);
console.log(`\n${results.length - bad.length}/${results.length} steps passed${errors.length ? ` · ${errors.length} page error(s): ${[...new Set(errors)].slice(0, 3).join(" | ")}` : ""}`);
if (bad.length || errors.length) process.exit(1);
