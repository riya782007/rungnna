import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function client() {
  let active = false;
  const qz = {
    websocket: {
      isActive: vi.fn(() => active),
      connect: vi.fn(async () => { active = true; }),
    },
    security: { setCertificatePromise: vi.fn(), setSignaturePromise: vi.fn() },
    printers: { find: vi.fn(async () => ["TSC TTP-244 Pro", "Office printer"]) },
    configs: { create: vi.fn((printer, options) => ({ printer, options })) },
    print: vi.fn(async () => undefined),
  };
  vi.stubGlobal("window", { qz });
  return qz;
}

beforeEach(() => { vi.resetModules(); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("QZ Tray transport", () => {
  it("lists exact installed names and connects once in unsigned approval mode", async () => {
    const qz = client();
    qz.printers.find.mockResolvedValue(["TSC TTP-244 Pro", "Office printer", "TSC TTP-244 Pro", ""]);
    const { listQzPrinters } = await import("../src/lib/qz");
    expect(await listQzPrinters()).toEqual(["Office printer", "TSC TTP-244 Pro"]);
    await listQzPrinters();
    expect(qz.websocket.connect).toHaveBeenCalledTimes(1);
    expect(qz.websocket.connect).toHaveBeenCalledWith({ retries: 0 });
    expect(qz.security.setCertificatePromise).toHaveBeenCalledTimes(1);
    const resolve = vi.fn();
    qz.security.setCertificatePromise.mock.calls[0][0](resolve);
    expect(resolve).toHaveBeenCalledWith(null);
    expect(qz.print).not.toHaveBeenCalled();
  });

  it("sends all binary byte values as one base64 raw command job to the chosen printer", async () => {
    const qz = client();
    const { printQzTSPL } = await import("../src/lib/qz");
    const bytes = Uint8Array.from({ length: 100000 }, (_, i) => i % 256);
    await printQzTSPL("TSC TTP-244 Pro (Copy 2)", bytes);
    expect(qz.configs.create).toHaveBeenCalledTimes(1);
    expect(qz.configs.create).toHaveBeenCalledWith("TSC TTP-244 Pro (Copy 2)", { copies: 1, jobName: "Rungnna stickers" });
    expect(qz.print).toHaveBeenCalledTimes(1);
    const [config, data] = qz.print.mock.calls[0];
    expect(config).toEqual(qz.configs.create.mock.results[0].value);
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ type: "raw", format: "command", flavor: "base64" });
    expect(Uint8Array.from(atob(data[0].data), c => c.charCodeAt(0))).toEqual(bytes);
    expect(qz.printers.find).not.toHaveBeenCalled();
  });

  it("snapshots a byte view before waiting for approval", async () => {
    const qz = client();
    let approve!: () => void;
    qz.websocket.connect.mockImplementation(() => new Promise<void>(resolve => { approve = resolve; }));
    const { printQzTSPL } = await import("../src/lib/qz");
    const source = new Uint8Array([99, 0, 128, 255, 99]);
    const printing = printQzTSPL("TSC", source.subarray(1, 4));
    await vi.waitFor(() => expect(approve).toBeTypeOf("function"));
    source.fill(1);
    approve(); await printing;
    expect(qz.print.mock.calls[0][1][0].data).toBe("AID/");
  });

  it("shares a pending trust handshake even after the WebSocket opens", async () => {
    const qz = client();
    let approve!: () => void;
    qz.websocket.connect.mockImplementation(() => new Promise<void>(resolve => { approve = resolve; }));
    const { listQzPrinters } = await import("../src/lib/qz");
    const first = listQzPrinters();
    await vi.waitFor(() => expect(approve).toBeTypeOf("function"));
    qz.websocket.isActive.mockReturnValue(true);
    const second = listQzPrinters();
    await Promise.resolve();
    expect(qz.printers.find).not.toHaveBeenCalled();
    approve(); await Promise.all([first, second]);
    expect(qz.websocket.connect).toHaveBeenCalledTimes(1);
    expect(qz.printers.find).toHaveBeenCalledTimes(2);
  });

  it("never substitutes the default printer or sends an empty job", async () => {
    const qz = client();
    const { printQzTSPL } = await import("../src/lib/qz");
    await expect(printQzTSPL("  ", new Uint8Array([1]))).rejects.toThrow("Choose the TSC");
    await expect(printQzTSPL("TSC", new Uint8Array())).rejects.toThrow("no stickers");
    expect(qz.websocket.connect).not.toHaveBeenCalled();
    expect(qz.print).not.toHaveBeenCalled();
  });

  it("gives an actionable error when QZ Tray is not running and allows a later user attempt", async () => {
    const qz = client();
    qz.websocket.connect.mockRejectedValueOnce(new Error("Unable to establish connection with QZ"));
    const { listQzPrinters } = await import("../src/lib/qz");
    await expect(listQzPrinters()).rejects.toThrow("Install and open QZ Tray");
    expect(qz.printers.find).not.toHaveBeenCalled();
    expect(await listQzPrinters()).toContain("TSC TTP-244 Pro");
    expect(qz.websocket.connect).toHaveBeenCalledTimes(2);
  });

  it("explains denied native or browser access", async () => {
    const qz = client();
    qz.websocket.connect.mockRejectedValue(new Error("Connection attempt denied by Local Network Access restrictions"));
    const { listQzPrinters } = await import("../src/lib/qz");
    await expect(listQzPrinters()).rejects.toThrow("Site Manager and the browser's local network permissions");
    expect(qz.print).not.toHaveBeenCalled();
  });

  it("does not retry or fall back after an unconfirmed spool submission", async () => {
    const qz = client();
    qz.print.mockRejectedValue(new Error("Connection closed before response received"));
    const { printQzTSPL } = await import("../src/lib/qz");
    await expect(printQzTSPL("TSC", new Uint8Array([0, 255]))).rejects.toThrow("Check the printer and Windows queue");
    expect(qz.print).toHaveBeenCalledTimes(1);
  });

  it("loads the vendored same-origin connector once and clears a failed load for a user retry", async () => {
    const qz = client();
    const browser = {} as { qz?: typeof qz };
    vi.stubGlobal("window", browser);
    const scripts: any[] = [];
    vi.stubGlobal("document", {
      createElement: vi.fn(() => ({ remove: vi.fn() })),
      head: { appendChild: vi.fn(script => { scripts.push(script); }) },
    });
    const { listQzPrinters } = await import("../src/lib/qz");
    const failed = listQzPrinters();
    expect(scripts[0].src).toBe("/vendor/qz-tray/qz-tray-2.3.0.js");
    scripts[0].onerror();
    await expect(failed).rejects.toThrow("connector could not load");
    const first = listQzPrinters(), second = listQzPrinters();
    expect(scripts).toHaveLength(2);
    browser.qz = qz; scripts[1].onload();
    await Promise.all([first, second]);
    expect(qz.websocket.connect).toHaveBeenCalledTimes(1);
  });
});
