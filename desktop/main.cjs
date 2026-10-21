/* Rungnna Shop OS — Windows desktop app.

   The whole billing app (the same build as the website) is packed inside this
   program and served from app://rungnna, so it opens and bills with NO internet:
   nothing is downloaded at start-up, and every bill is written to this computer
   first (IndexedDB in %APPDATA%\Rungnna Shop OS), then synced to the cloud when
   the internet is back.

   Online-only features (AI bill reading, Ask, GST e-invoice, photo upload) are
   passed through to the live server at WEB_ORIGIN when the internet is on. */
const { app, BrowserWindow, protocol, net, session, shell, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const WEB_ORIGIN = "https://rungnnashopos.vercel.app";
const RELEASES = "https://api.github.com/repos/riya782007/rungnna/releases/latest";
const WEB_DIR = path.join(__dirname, "web");
const HOME = "app://rungnna/";

// Billing speed: never slow the app down when its window is behind another one.
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.setAppUserModelId("in.rungnna.shopos");

protocol.registerSchemesAsPrivileged([{ scheme: "app", privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }]);

// One copy only: a second click on the icon brings the open window forward
// (two copies writing the same bills would fight over the drafts).
if (!app.requestSingleInstanceLock()) app.quit();

const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".wasm": "application/wasm", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp",
  ".ico": "image/x-icon", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };

// The website's public pages live on the server; inside the app they open in the browser.
const SERVER_PAGES = /^\/(shop|trade|dealer)(\/|$)|^\/(p|c)\/|^\/(sitemap\.xml|robots\.txt)$/;

async function serve(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/")) return proxy(request, url);
  if (SERVER_PAGES.test(url.pathname)) { void shell.openExternal(WEB_ORIGIN + url.pathname + url.search); return new Response("", { status: 204 }); }
  let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
  let file = path.normalize(path.join(WEB_DIR, rel));
  if (!file.startsWith(WEB_DIR) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(WEB_DIR, "index.html");
  const body = await fs.promises.readFile(file);
  return new Response(body, { headers: { "content-type": MIME[path.extname(file).toLowerCase()] || "application/octet-stream", "cache-control": "no-cache" } });
}

async function proxy(request, url) {
  try {
    const headers = new Headers(request.headers);
    for (const h of ["host", "origin", "referer", "content-length"]) headers.delete(h);
    const init = { method: request.method, headers, redirect: "follow" };
    if (!["GET", "HEAD"].includes(request.method)) init.body = Buffer.from(await request.arrayBuffer());
    const r = await net.fetch(WEB_ORIGIN + url.pathname + url.search, init);
    const out = new Headers(r.headers); out.delete("content-encoding"); out.delete("content-length");
    return new Response(await r.arrayBuffer(), { status: r.status, statusText: r.statusText, headers: out });
  } catch {
    return new Response(JSON.stringify({ error: "No internet — this needs the internet. Billing keeps working offline." }), { status: 503, headers: { "content-type": "application/json" } });
  }
}

function permissions(ses) {
  // camera (scan / photos), label printer on USB or COM port, clipboard, notifications
  const allowed = new Set(["media", "mediaKeySystem", "clipboard-read", "clipboard-sanitized-write", "notifications", "fullscreen", "serial", "usb", "hid", "bluetooth", "speaker-selection"]);
  ses.setPermissionRequestHandler((_wc, perm, cb) => cb(allowed.has(perm)));
  ses.setPermissionCheckHandler((_wc, perm) => allowed.has(perm));
  ses.setDevicePermissionHandler(d => ["serial", "usb", "hid", "bluetooth"].includes(d.deviceType));
  // the label printer: pick it without a browser chooser (TSC printers first)
  ses.on("select-serial-port", (event, ports, _wc, cb) => {
    event.preventDefault();
    const pick = ports.find(p => /tsc|print|usb/i.test(`${p.displayName || ""} ${p.portName || ""}`)) || ports[0];
    cb(pick ? pick.portId : "");
  });
  ses.on("select-usb-device", (event, details, cb) => {
    event.preventDefault();
    const pick = details.deviceList.find(d => d.vendorId === 0x1203) || details.deviceList[0];
    cb(pick ? pick.deviceId : undefined);
  });
}

let win;
function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 900, minHeight: 600, show: false,
    backgroundColor: "#FAF6EF", title: "Rungnna Shop OS", autoHideMenuBar: true,
    icon: path.join(__dirname, "build", "icon.png"),
    webPreferences: { preload: path.join(__dirname, "preload.cjs"), contextIsolation: true, sandbox: true, backgroundThrottling: false, spellcheck: false },
  });
  win.removeMenu();   // no menu: F2–F12 and Ctrl shortcuts all belong to billing
  win.once("ready-to-show", () => { win.maximize(); win.show(); });
  win.loadURL(HOME + "#/home");

  // WhatsApp, bank and every outside link open in the normal browser / WhatsApp app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(https?|mailto|tel|whatsapp):/i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(HOME)) { e.preventDefault(); if (/^(https?|mailto|tel|whatsapp):/i.test(url)) void shell.openExternal(url); }
  });

  // Bluetooth label printer: list nearby devices for a few seconds, then let the user pick one
  let btPick = null;
  win.webContents.on("select-bluetooth-device", (event, devices, cb) => {
    event.preventDefault();
    if (!btPick) {
      btPick = { cb, devices };
      setTimeout(async () => {
        const { cb: done, devices: found } = btPick; btPick = null;
        const named = found.filter(d => d.deviceName);
        if (!named.length) { done(""); return; }
        const list = named.slice(0, 8);
        const { response } = await dialog.showMessageBox(win, { type: "question", title: "Bluetooth printer",
          message: "Pick the label printer", buttons: [...list.map(d => d.deviceName), "Cancel"], cancelId: list.length });
        done(response < list.length ? list[response].deviceId : "");
      }, 4000);
    } else btPick.devices = devices;
  });

  // never stay on a frozen or crashed screen at the counter: the bill is already saved on disk
  win.webContents.on("render-process-gone", (_e, d) => { if (d.reason !== "clean-exit") setTimeout(() => win && !win.isDestroyed() && win.reload(), 500); });
  win.on("unresponsive", async () => {
    const { response } = await dialog.showMessageBox(win, { type: "warning", buttons: ["Wait", "Reload"], defaultId: 0, title: "Rungnna Shop OS",
      message: "The app is busy.", detail: "Your bills are saved on this computer. Reload if it does not recover." });
    if (response === 1 && win && !win.isDestroyed()) win.reload();
  });
  // Ctrl+Shift+I opens the developer tools for support; Ctrl+0/+/- zoom for small screens
  win.webContents.on("before-input-event", (e, i) => {
    if (i.type !== "keyDown" || !i.control) return;
    if (i.shift && i.key.toLowerCase() === "i") { win.webContents.toggleDevTools(); e.preventDefault(); }
    else if (i.key === "0") { win.webContents.setZoomLevel(0); e.preventDefault(); }
    else if (i.key === "=" || i.key === "+") { win.webContents.setZoomLevel(Math.min(3, win.webContents.getZoomLevel() + 0.5)); e.preventDefault(); }
    else if (i.key === "-") { win.webContents.setZoomLevel(Math.max(-3, win.webContents.getZoomLevel() - 0.5)); e.preventDefault(); }
  });
}

// A newer desktop version on GitHub: say so once, never interrupt a bill or download on its own.
async function checkForUpdate() {
  try {
    const r = await net.fetch(RELEASES, { headers: { "user-agent": "rungnna-desktop", accept: "application/vnd.github+json" } });
    if (!r.ok) return;
    const rel = await r.json();
    const latest = String(rel.tag_name || "").replace(/^desktop-v/, "");
    const newer = (a, b) => { const x = a.split(".").map(Number), y = b.split(".").map(Number); for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); return false; };
    if (!latest || !newer(latest, app.getVersion())) return;
    const { response } = await dialog.showMessageBox(win, { type: "info", buttons: ["Download now", "Later"], defaultId: 1, title: "Update available",
      message: `Rungnna Shop OS ${latest} is ready.`, detail: "Finish the current bill, download the new version and run it. Your bills and settings stay on this computer." });
    if (response === 0) void shell.openExternal(rel.html_url);
  } catch { /* offline: try next time */ }
}

ipcMain.on("rj-version", e => { e.returnValue = app.getVersion(); });
app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.whenReady().then(() => {
  protocol.handle("app", serve);
  permissions(session.defaultSession);
  createWindow();
  setTimeout(checkForUpdate, 20_000);
});
app.on("window-all-closed", () => app.quit());
