// Tells the web app it is running as the Windows desktop app (see src/lib/platform.ts).
const { contextBridge, ipcRenderer } = require("electron");
contextBridge.exposeInMainWorld("rungnnaDesktop", { version: ipcRenderer.sendSync("rj-version") });
