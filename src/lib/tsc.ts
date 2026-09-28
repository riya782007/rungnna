import type { Product } from "./db";

/* ===========================================================================
   TSC thermal label printer integration (TSPL / TSPL2).

   The shop prints on a TSC TTP-244 Pro. That printer speaks TSPL — a plain-text
   command language. This module:
     • builds the TSPL for one label (QR + item/category + model/SKU + the
       encrypted cost code), and
     • sends it straight to the printer over the Web Serial API (or WebUSB),
       so pressing "Print" fires the label with no OS print dialog.

   When a browser has no Web Serial/USB (e.g. iOS Safari), the caller falls back
   to the existing on-screen print sheet (Labels.tsx window.print()), which still
   produces a correctly-sized label. So printing always works; direct-to-printer
   is the fast path where the browser allows it.

   Units: TSPL positions here are in millimetres (we send SIZE/GAP in mm and use
   the printer's dot math at 203 dpi = 8 dots/mm for X/Y placement).
=========================================================================== */

const DPMM = 8; // TSC TTP-244 Pro is 203 dpi ≈ 8 dots/mm
const mm = (v: number) => Math.round(v * DPMM);

export interface TscLabel {
  wmm: number; hmm: number; gapmm: number;   // label size + gap between labels
  qr: string;                                 // QR payload (usually ownPayload(p))
  lines: string[];                            // text lines, top → bottom
  costCode?: string;                          // encrypted cost code (printed bold)
  copies: number;
  offXmm?: number; offYmm?: number;           // fine nudge
  density?: number;                           // 0–15 (heat); 8 is a good default
  speed?: number;                             // ips; 3–4 for small labels
}

/* Escape a string for a TSPL quoted argument. */
const q = (s: string) => `"${String(s || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

/* Build the TSPL program for one label design × N copies. */
export function buildTSPL(l: TscLabel): string {
  const wDots = mm(l.wmm), hMm = l.hmm;
  const ox = mm(l.offXmm || 0), oy = mm(l.offYmm || 0);
  const cmds: string[] = [];
  cmds.push(`SIZE ${l.wmm} mm, ${l.hmm} mm`);
  cmds.push(`GAP ${l.gapmm ?? 2} mm, 0 mm`);
  cmds.push(`DIRECTION 1`);
  cmds.push(`DENSITY ${clamp(l.density ?? 8, 0, 15)}`);
  cmds.push(`SPEED ${clamp(l.speed ?? 3, 1, 6)}`);
  cmds.push(`CLS`);

  // QR on the right side, vertically centred-ish.
  const qrCell = l.hmm >= 20 ? 4 : 3;                 // module size in dots
  const qrXmm = l.wmm - (l.hmm * 0.9);                // roughly square block on the right
  cmds.push(`QRCODE ${mm(qrXmm) + ox},${mm(1) + oy},M,${qrCell},A,0,${q(l.qr)}`);

  // Text block on the left. y steps down per line.
  let y = mm(1) + oy;
  const x = mm(1) + ox;
  const lineH = mm(Math.max(2.6, hMm / 7));
  for (const line of l.lines) {
    if (!line) { y += lineH; continue; }
    cmds.push(`TEXT ${x},${y},"2",0,1,1,${q(line)}`);   // font "2" ≈ small crisp
    y += lineH;
  }
  // Encrypted cost code — printed bigger/bold at the bottom-left so the owner
  // reads it at a glance but it means nothing to a customer.
  if (l.costCode) {
    cmds.push(`TEXT ${x},${mm(hMm) - lineH - oy},"3",0,1,1,${q(l.costCode)}`);
  }

  cmds.push(`PRINT 1,${Math.max(1, l.copies)}`);
  return cmds.join("\r\n") + "\r\n";
}

function clamp(n: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, n)); }

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

async function sendSerial(tspl: string): Promise<void> {
  const nav: any = navigator;
  if (!serialPort) {
    const ports = await nav.serial.getPorts();
    serialPort = ports[0] || (await nav.serial.requestPort());
    if (!serialPort.readable) await serialPort.open({ baudRate: 9600 });
  }
  const writer = serialPort.writable.getWriter();
  try { await writer.write(new TextEncoder().encode(tspl)); }
  finally { writer.releaseLock(); }
}

async function sendUSB(tspl: string): Promise<void> {
  const nav: any = navigator;
  const dev = await nav.usb.requestDevice({ filters: [{ vendorId: 0x1203 }] }); // TSC vendor id
  await dev.open();
  if (dev.configuration === null) await dev.selectConfiguration(1);
  // find the first bulk-OUT endpoint
  const iface = dev.configuration.interfaces.find((i: any) =>
    i.alternate.endpoints.some((e: any) => e.direction === "out" && e.type === "bulk"));
  await dev.claimInterface(iface.interfaceNumber);
  const ep = iface.alternate.endpoints.find((e: any) => e.direction === "out" && e.type === "bulk");
  await dev.transferOut(ep.endpointNumber, new TextEncoder().encode(tspl));
  await dev.close();
}

/* Fire the label. Returns the transport actually used, or throws if none work
   (the caller then falls back to the browser print sheet). */
export async function printTSPL(tspl: string): Promise<"serial" | "usb"> {
  if (serialSupported()) { await sendSerial(tspl); return "serial"; }
  if (usbSupported()) { await sendUSB(tspl); return "usb"; }
  throw new Error("This browser can't talk to the printer directly. Use Chrome/Edge on a computer, or use the on-screen print.");
}

/* Convenience: build a label straight from a product + the encrypted code. */
export function labelFromProduct(p: Product, opts: { qr: string; costCode?: string; wmm: number; hmm: number; gapmm?: number; copies?: number; offXmm?: number; offYmm?: number; density?: number; speed?: number }): TscLabel {
  const lines = [
    p.item,                                   // category / item name
    [p.model || p.style, p.color].filter(Boolean).join("  "),
    p.rate ? `Rs.${p.rate / 100}${p.pack ? `x${p.pack}${p.type || "PCS"}` : ""}` : "",
    p.code,                                   // our SKU under the QR
  ].filter(Boolean) as string[];
  return {
    wmm: opts.wmm, hmm: opts.hmm, gapmm: opts.gapmm ?? 2,
    qr: opts.qr, lines, costCode: opts.costCode,
    copies: opts.copies ?? 1, offXmm: opts.offXmm, offYmm: opts.offYmm,
    density: opts.density, speed: opts.speed,
  };
}
