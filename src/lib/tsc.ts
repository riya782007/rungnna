
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
export const directPrintSupported = () => serialSupported() || usbSupported();

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

/* Fire the label. Returns the transport actually used, or throws if none work
   (the caller then falls back to the browser print sheet). */
export async function printTSPL(tspl: string, prompt = true): Promise<"serial" | "usb"> {
  if (serialSupported() && await sendSerial(tspl, false)) return "serial";
  if (usbSupported() && await sendUSB(tspl, false)) return "usb";
  if (prompt && usbSupported() && await sendUSB(tspl, true)) return "usb";
  if (prompt && serialSupported() && await sendSerial(tspl, true)) return "serial";
  throw new Error("Connect a compatible TSC printer on this device first, or choose Browser in label printer settings.");
}
