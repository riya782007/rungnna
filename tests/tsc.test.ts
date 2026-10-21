import { expect, it, describe } from "vitest";
import { printTSPL, directPrintSupported, serialSupported, usbSupported } from "../src/lib/tsc";

/* lib/tsc is the TRANSPORT only. The TSPL itself has exactly one builder — labelTSPL in
   lib/label-tspl, covered by label-tspl.test.tsx. The second builder this file used to test
   (buildTSPL) was dead code whose geometry had drifted from the real sticker, so it is gone;
   these tests pin the contract that replaced it. */

describe("direct printing transport", () => {
  it("reports no direct printing when the browser has neither Web Serial nor WebUSB", () => {
    // jsdom has neither, which is the iOS Safari case the UI must fall back from
    expect(serialSupported()).toBe(false);
    expect(usbSupported()).toBe(false);
    expect(directPrintSupported()).toBe(false);
  });

  it("asks the caller to fall back to browser printing instead of failing silently", async () => {
    await expect(printTSPL("SIZE 50 mm, 20 mm\r\nPRINT 1,1\r\n")).rejects.toThrow(/TSC printer|Browser/i);
  });

  it("exports no label builder — label geometry lives in one place only", async () => {
    const mod: Record<string, unknown> = await import("../src/lib/tsc");
    expect(Object.keys(mod).sort()).toEqual(
      ["bluetoothPrinterName", "bluetoothSupported", "connectBluetooth", "connectSerial", "connectUSB", "directPrintSupported", "printTSPL", "serialSupported", "usbSupported"],
    );
  });
});
