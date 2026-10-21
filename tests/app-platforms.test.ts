import { afterEach, describe, expect, it } from "vitest";
import { bluetoothSupported, connectBluetooth, printTSPL } from "../src/lib/tsc";
import { apiUrl, isNativeApp, publicOrigin, WEB_ORIGIN } from "../src/lib/platform";

const g = globalThis as any;
afterEach(() => { delete g.window; });

function fakePhone() {
  const writes: string[] = [];
  const BluetoothLe = {
    initialize: async () => {},
    requestDevice: async () => ({ deviceId: "AA:BB", name: "TSC Alpha-3R" }),
    connect: async () => {},
    disconnect: async () => {},
    getServices: async () => ({ services: [
      { uuid: "0000180a-0000-1000-8000-00805f9b34fb", characteristics: [{ uuid: "info", properties: { read: true } }] },
      { uuid: "000018f0-0000-1000-8000-00805f9b34fb", characteristics: [{ uuid: "00002af1-0000-1000-8000-00805f9b34fb", properties: { writeWithoutResponse: true } }] },
    ] }),
    writeWithoutResponse: async (o: { service: string; characteristic: string; value: string }) => { writes.push(o.value); },
  };
  g.window = { Capacitor: { isNativePlatform: () => true, Plugins: { BluetoothLe } } };
  return writes;
}

describe("Bluetooth label printing (phone app)", () => {
  it("connects to the printer's writable channel and sends the whole TSPL job in small chunks", async () => {
    const writes = fakePhone();
    expect(bluetoothSupported()).toBe(true);
    expect(await connectBluetooth()).toBe("TSC Alpha-3R");
    const tspl = "SIZE 50 mm,25 mm\r\nGAP 2.6 mm,0\r\n" + "TEXT 10,10,\"2\",0,1,1,\"EARING\"\r\n".repeat(20) + "PRINT 1\r\n";
    expect(await printTSPL(tspl)).toBe("bluetooth");
    expect(writes.length).toBeGreaterThan(1);
    expect(writes.every(w => w.length <= 360)).toBe(true);          // ≤180 bytes each, hex-encoded
    const sent = Buffer.from(writes.join(""), "hex").toString("latin1");
    expect(sent).toBe(tspl);
  });
});

describe("server addresses per platform", () => {
  it("uses the same site on the web and the live site inside the phone app", () => {
    expect(apiUrl("ai")).toBe("/api/ai");
    fakePhone();
    expect(isNativeApp()).toBe(true);
    expect(apiUrl("purchase-photo")).toBe(WEB_ORIGIN + "/api/purchase-photo");
    expect(publicOrigin()).toBe(WEB_ORIGIN);
  });
});
