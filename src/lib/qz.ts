/** Local QZ Tray transport. TSPL generation and printer geometry live elsewhere. */
type ResolveText = (value: string | null) => void;
export interface QzClient {
  websocket: {
    isActive(): boolean;
    connect(options: { retries: number }): Promise<unknown>;
  };
  security: {
    setCertificatePromise(handler: (resolve: ResolveText) => void): void;
    setSignaturePromise(handler: () => (resolve: ResolveText) => void): void;
  };
  printers: { find(): Promise<string[] | string> };
  configs: { create(printer: string, options: { copies: number; jobName: string }): unknown };
  print(config: unknown, data: Array<{ type: "raw"; format: "command"; flavor: "base64"; data: string }>): Promise<unknown>;
}

const CLIENT_PATH = `${import.meta.env.BASE_URL}vendor/qz-tray/qz-tray-2.3.0.js`;
let clientLoad: Promise<QzClient> | undefined;
let connection: Promise<void> | undefined;
const configured = new WeakSet<QzClient>();

function clientGlobal() {
  return typeof window === "undefined" ? undefined : (window as Window & { qz?: QzClient }).qz;
}

function loadClient(): Promise<QzClient> {
  const existing = clientGlobal();
  if (existing) return Promise.resolve(existing);
  if (typeof document === "undefined") return Promise.reject(new Error("Direct label printing needs a browser on the printer computer."));
  if (!clientLoad) {
    clientLoad = new Promise<QzClient>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = CLIENT_PATH;
      script.async = true;
      const cleanup = () => { clearTimeout(timer); script.onload = null; script.onerror = null; };
      const fail = () => {
        cleanup(); script.remove(); clientLoad = undefined;
        reject(new Error("The QZ Tray connector could not load. Reload the app and try again."));
      };
      const timer = setTimeout(fail, 15000);
      script.onload = () => {
        const qz = clientGlobal();
        if (!qz) { fail(); return; }
        cleanup(); resolve(qz);
      };
      script.onerror = fail;
      document.head.appendChild(script);
    });
  }
  return clientLoad;
}

function detail(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown QZ Tray error");
}

function qzError(error: unknown, stage: "connect" | "list" | "print") {
  const reason = detail(error);
  const denied = /denied|declined|blocked|not allowed|permission|certificate|cancelled by user|canceled by user/i.test(reason);
  if (denied) return new Error(`QZ Tray access was not allowed. Choose Allow in QZ Tray's request for this app. If it was blocked, allow this site in QZ Tray's Site Manager and the browser's local network permissions. ${stage === "print" ? "Check the printer queue before trying again. " : ""}Details: ${reason}`);
  if (stage === "connect") return new Error(`Could not connect to QZ Tray. Install and open QZ Tray on this computer, then allow this app's connection request. Details: ${reason}`);
  if (stage === "list") return new Error(`Could not read printers from QZ Tray. Check that the TSC printer is installed in Windows and QZ Tray is running. Details: ${reason}`);
  // A lost response can occur after the spooler accepts a job. Never retry or
  // fall back to browser printing: that could print the same stickers twice.
  return new Error(`QZ Tray did not confirm the print job. Check the printer and Windows queue before trying again to avoid duplicate stickers. Details: ${reason}`);
}

async function connectedClient() {
  const qz = await loadClient();
  if (!configured.has(qz)) {
    // This app has no QZ signing service. Use QZ's supported unsigned mode:
    // its native Allow/Block dialogs remain visible; no private key is shipped.
    qz.security.setCertificatePromise(resolve => resolve(null));
    qz.security.setSignaturePromise(() => resolve => resolve(null));
    configured.add(qz);
  }
  // A WebSocket may become active while QZ is still awaiting user approval.
  // All callers must await that same handshake before using printer APIs.
  if (!connection && !qz.websocket.isActive()) {
    connection = Promise.resolve().then(() => qz.websocket.connect({ retries: 0 })).then(() => undefined)
      .catch(error => { throw qzError(error, "connect"); })
      .finally(() => { connection = undefined; });
  }
  if (connection) await connection;
  return qz;
}

/** List installed printers, preserving their exact names for explicit selection. */
export async function listQzPrinters(): Promise<string[]> {
  const qz = await connectedClient();
  try {
    const result = await qz.printers.find();
    const printers = Array.isArray(result) ? result : [result];
    return [...new Set(printers.filter(name => typeof name === "string" && name.trim()))].sort((a, b) => a.localeCompare(b));
  } catch (error) { throw qzError(error, "list"); }
}

function base64(bytes: Uint8Array) {
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192) chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
  return btoa(chunks.join(""));
}

/**
 * Submit exactly one raw spool job to the explicitly selected Windows printer.
 * Resolution confirms submission, not that paper has physically printed.
 */
export async function printQzTSPL(printer: string, bytes: Uint8Array): Promise<void> {
  if (!printer.trim()) throw new Error("Choose the TSC label printer in Printer settings first.");
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error("There are no stickers to print.");
  // Snapshot before awaiting QZ's user approval; caller changes cannot alter a job.
  const data = base64(bytes);
  const qz = await connectedClient();
  try {
    const config = qz.configs.create(printer, { copies: 1, jobName: "Rungnna stickers" });
    await qz.print(config, [{ type: "raw", format: "command", flavor: "base64", data }]);
  } catch (error) { throw qzError(error, "print"); }
}
