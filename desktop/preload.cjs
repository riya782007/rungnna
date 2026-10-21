// Tells the web app it is running as the Windows desktop app (see src/lib/platform.ts),
// and carries the automatic-update messages between the screens and the app.
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("rungnnaDesktop", {
  version: ipcRenderer.sendSync("rj-version"),
  build: () => ipcRenderer.sendSync("rj-build"),
  onUpdateReady: cb => { ipcRenderer.on("rj-update-ready", () => cb()); },
  applyUpdate: () => ipcRenderer.invoke("rj-apply-update"),
  started: () => ipcRenderer.send("rj-started"),
});
