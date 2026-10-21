
/* ===========================================================================
   TSC thermal label printer integration (TSPL / TSPL2).

   Compatible TSC printers speak TSPL — a plain-text command language. This module is the
   TRANSPORT only: it sends a ready TSPL program straight to the printer over the Web Serial
   API (or WebUSB), so pressing "Print" fires the label with no OS print dialog.

   The TSPL itself is built in ONE place — lib/label-tspl.ts `labelTSPL` — which lays the
   sticker out exactly as the on-screen label does. This file used to carry a second, cruder
   builder as well; it drifted (it printed "Rs.12.5" for ₹12.50 and could place the QR at a
   negative X on a tall label) and nothing used it, so it is gone. One label, one geometry.

   When a browser has no Web Serial/USB (e.g. iOS Safari), the caller falls back
   to the existing on-screen print sheet (Labels.tsx window.print()), which still
   produces a correctly-sized label. So printing always works; direct-to-printer
   is the fast path where the browser allows it.

   Units: TSPL positions here are in millimetres (we send SIZE/GAP in mm and use
   the printer's dot math at 203 dpi = 8 dots/mm for X/Y placement).
=========================================================================== */

const DPMM = 8; // TSC TTP-244 Pro is 203 dpi ≈ 8 dots/mm
const mm = (v: number) => Math.round(v * DPMM);



/* Escape a string for a TSPL quoted argument. */
const q = (s: string) => `"${String(s || "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/* -------------------------- transports --------------------------------- */

export function serialSupported() { return typeof navigator !== "undefined" && "serial" in navigator; }
export function usbSupported() { return typeof navigator !== "undefined" && "usb" in navigator; }
/* Bluetooth (BLE) label printers: Web Bluetooth (Chrome on Android, desktop app) or, inside the
   Android/iOS app, the native Bluetooth LE plugin (window.Capacitor.Plugins.BluetoothLe). */
const nativeBle = (): any => (typeof window !== "undefined" ? (window as any).Capacitor?.Plugins?.BluetoothLe : undefined);
export function bluetoothSupported() { return !!nativeBle() || (typeof navigator !== "undefined" && "bluetooth" in navigator); }
export const directPrintSupported = () => serialSupported() || usbSupported() || bluetoothSupported();

let serialPort: any = null; // remembered across prints in one session

/* Ask the user to pick the printer once (must be called from a click). */
export async function connectSerial(): Promise<boolean> {
  if (!serialSupported()) return false;
  const nav: any = navigator;
  serialPort = await nav.serial.requestPort();
  await serialPort.open({ baudRate: 9600 }); // TSC USB-virtual-serial default
  return true;
}

async function sendSerial(tspl: string, prompt: boolean): Promise<boolean> {
  const nav: any = navigator;
  if (!serialPort) {
    const ports = await nav.serial.getPorts();
    serialPort = ports[0];
    if (!serialPort && !prompt) return false;
    if (!serialPort) serialPort = await nav.serial.requestPort();
  }
  // a printer that was switched off / unplugged comes back closed: reopen instead of failing
  if (!serialPort.writable) { try { await serialPort.open({ baudRate: 9600 }); } catch (e: any) { if (!/already open/i.test(e?.message || "")) { serialPort = null; throw e; } } }
  const writer = serialPort.writable.getWriter();
  try { await writer.write(new TextEncoder().encode(tspl)); }
  finally { writer.releaseLock(); }
  return true;
}

export async function connectUSB(): Promise<boolean> {
  if (!usbSupported()) return false;
  await (navigator as any).usb.requestDevice({ filters: [{ vendorId: 0x1203 }] });
  return true;
}

async function sendUSB(tspl: string, prompt: boolean): Promise<boolean> {
  const nav: any = navigator;
  const known = await nav.usb.getDevices();
  let dev = known.find((d: any) => d.vendorId === 0x1203);
  if (!dev && !prompt) return false;
  if (!dev) dev = await nav.usb.requestDevice({ filters: [{ vendorId: 0x1203 }] });
  await dev.open();
  try {
  if (dev.configuration === null) await dev.selectConfiguration(1);
  // find the first bulk-OUT endpoint
  const iface = dev.configuration.interfaces.find((i: any) =>
    i.alternate.endpoints.some((e: any) => e.direction === "out" && e.type === "bulk"));
  if (!iface) throw new Error("Printer has no compatible bulk output endpoint");
  await dev.claimInterface(iface.interfaceNumber);
  const ep = iface.alternate.endpoints.find((e: any) => e.direction === "out" && e.type === "bulk");
  const bytes = new TextEncoder().encode(tspl);
  const result = await dev.transferOut(ep.endpointNumber, bytes);
  if (result.status !== "ok" || result.bytesWritten !== bytes.length) throw new Error("Printer did not accept the complete job");
  } finally { await dev.close(); }
  return true;
}

/* ---- Bluetooth LE ----
   Printers expose one "write" characteristic; its service UUID differs by maker, so we ask for
   the common ones and pick the first writable characteristic. Data goes in small chunks (BLE
   packets are ~20–180 bytes) with a short pause so cheap printers' buffers never overflow. */
const BLE_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", "0000ff00-0000-1000-8000-00805f9b34fb", "0000ffe0-0000-1000-8000-00805f9b34fb",
  "0000fee7-0000-1000-8000-00805f9b34fb", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
  "0000ae30-0000-1000-8000-00805f9b34fb", "0000ff12-0000-1000-8000-00805f9b34fb",
];
const BLE_CHUNK = 180, BLE_PAUSE_MS = 12;
type BleLink = { name: string; write: (chunk: Uint8Array) => Promise<void>; close: () => Promise<void> };
let ble: BleLink | null = null;
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const hex = (b: Uint8Array) => Array.from(b, x => x.toString(16).padStart(2, "0")).join("");

async function webBluetoothLink(): Promise<BleLink> {
  const dev = await (navigator as any).bluetooth.requestDevice({ acceptAllDevices: true, optionalServices: BLE_SERVICES });
  const server = await dev.gatt.connect();
  for (const svc of await server.getPrimaryServices()) {
    for (const ch of await svc.getCharacteristics()) {
      if (!ch.properties.write && !ch.properties.writeWithoutResponse) continue;
      const fast = ch.properties.writeWithoutResponse;
      return { name: dev.name || "Bluetooth printer",
        write: c => fast && ch.writeValueWithoutResponse ? ch.writeValueWithoutResponse(c) : ch.writeValue(c),
        close: async () => { try { dev.gatt.disconnect(); } catch { /* gone */ } } };
    }
  }
  try { dev.gatt.disconnect(); } catch { /* gone */ }
  throw new Error("This Bluetooth device has no printer channel. Pick the label printer, not a phone or speaker.");
}

async function nativeBluetoothLink(): Promise<BleLink> {
  const B = nativeBle();
  await B.initialize({ androidNeverForLocation: true });
  const { deviceId, name } = await B.requestDevice({ optionalServices: BLE_SERVICES });
  await B.connect({ deviceId });
  const { services } = await B.getServices({ deviceId });
  for (const svc of services || []) for (const ch of svc.characteristics || []) {
    const p = ch.properties || {};
    if (!p.write && !p.writeWithoutResponse) continue;
    const method = p.writeWithoutResponse ? "writeWithoutResponse" : "write";
    return { name: name || "Bluetooth printer",
      write: c => B[method]({ deviceId, service: svc.uuid, characteristic: ch.uuid, value: hex(c) }),
      close: async () => { try { await B.disconnect({ deviceId }); } catch { /* gone */ } } };
  }
  try { await B.disconnect({ deviceId }); } catch { /* gone */ }
  throw new Error("This Bluetooth device has no printer channel. Pick the label printer, not a phone or speaker.");
}

/** Pick and connect the Bluetooth label printer (must be called from a tap). */
export async function connectBluetooth(): Promise<string> {
  if (!bluetoothSupported()) throw new Error("Bluetooth printing isn't available here. Use Chrome on Android, or the Rungnna app.");
  if (ble) { await ble.close(); ble = null; }
  ble = nativeBle() ? await nativeBluetoothLink() : await webBluetoothLink();
  return ble.name;
}
export const bluetoothPrinterName = () => ble?.name || "";

async function sendBluetooth(bytes: Uint8Array) {
  if (!ble) throw new Error("Bluetooth printer not connected");
  try {
    for (let i = 0; i < bytes.length; i += BLE_CHUNK) { await ble.write(bytes.slice(i, i + BLE_CHUNK)); await sleep(BLE_PAUSE_MS); }
  } catch (e) { ble = null; throw new Error("Bluetooth printer disconnected. Tap “Connect Bluetooth printer” and print the remaining labels."); }
}

/* Fire the label. Returns the transport actually used, or throws if none work
   (the caller then falls back to the browser print sheet). A connected Bluetooth printer
   is used first: it was chosen on purpose for this session. */
export async function printTSPL(tspl: string | Uint8Array, prompt = true): Promise<"serial" | "usb" | "bluetooth"> {
  const bytes = typeof tspl === "string" ? new TextEncoder().encode(tspl) : tspl;
  if (ble) { await sendBluetooth(bytes); return "bluetooth"; }
  if (typeof tspl !== "string") tspl = new TextDecoder("latin1").decode(tspl);
  if (serialSupported() && await sendSerial(tspl, false)) return "serial";
  if (usbSupported() && await sendUSB(tspl, false)) return "usb";
  if (prompt && usbSupported() && await sendUSB(tspl, true)) return "usb";
  if (prompt && serialSupported() && await sendSerial(tspl, true)) return "serial";
  if (prompt && bluetoothSupported()) { await connectBluetooth(); await sendBluetooth(bytes); return "bluetooth"; }
  throw new Error("Connect a compatible TSC printer on this device first, or choose Browser in label printer settings.");
}
