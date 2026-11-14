import { db, put, now, type Config } from "./db";

/* Weighing-scale counting (owner's list R-158, R-159): one piece of a design always weighs the same,
   so pieces = packet weight ÷ one piece. The scale plugs into the computer's USB (serial) port; most
   shop scales keep sending their reading as text ("ST,GS,+  1.234kg", "   1234 g"). Without a scale
   the weights can be typed in — the counting works the same. */

export type Reading = { grams: number; stable: boolean; raw: string };

/** Turn one line from the scale into grams. */
export function parseScale(line: string): Reading | null {
  const raw = line.trim(); if (!raw) return null;
  const m = raw.replace(/,(?=\d{3}\b)/g, "").match(/([-+]?\s*\d+(?:\.\d+)?)\s*(kg|g|gm|gms|lb)?/i);
  if (!m) return null;
  let n = Number(m[1].replace(/\s/g, "")); const unit = (m[2] || "").toLowerCase();
  if (!Number.isFinite(n)) return null;
  if (unit === "kg") n *= 1000; else if (unit === "lb") n *= 453.592;
  else if (!unit && /\d\.\d{3}\b/.test(m[1])) n *= 1000;      // "1.234" with no unit is kilograms on most scales
  return { grams: Math.round(n * 100) / 100, stable: !/\bUS\b|unstable|motion|\?/i.test(raw), raw };
}

/** How many pieces, and how sure: the packet should weigh close to a whole number of pieces. */
export function piecesFromWeight(total: number, perPiece: number, tare = 0): { pieces: number; off: number; sure: boolean } {
  const net = Math.max(0, total - tare);
  if (!(perPiece > 0)) return { pieces: 0, off: 1, sure: false };
  const exact = net / perPiece, pieces = Math.round(exact), off = Math.abs(exact - pieces);
  return { pieces, off, sure: pieces > 0 && off <= 0.25 };
}

export type Scale = { stop: () => void };
export async function connectScale(onRead: (r: Reading) => void, baud = 9600): Promise<Scale> {
  const serial = (navigator as any).serial;
  if (!serial) throw new Error("This browser can't reach a scale. Use Chrome / Edge or the Windows app, or type the weights.");
  (window as any).rungnnaDesktop?.serialFor?.("scale");
  const port = await serial.requestPort();
  await port.open({ baudRate: baud });
  let stop = false, buf = "";
  const reader = port.readable.getReader();
  (async () => {
    const dec = new TextDecoder();
    try {
      while (!stop) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split(/[\r\n]+/); buf = parts.pop() || "";
        for (const p of parts) { const r = parseScale(p); if (r) onRead(r); }
        if (buf.length > 200) buf = buf.slice(-100);
      }
    } catch { /* unplugged */ } finally { try { reader.releaseLock(); await port.close(); } catch { /* closed */ } }
  })();
  return { stop: () => { stop = true; reader.cancel().catch(() => {}); } };
}

/** One piece's weight, remembered per design (all computers). */
export async function pieceWeight(productId: string): Promise<number> {
  const r = await db.config.get("pieceweight:" + productId);
  return r && !r.deleted ? Number(r.value?.grams) || 0 : 0;
}
export async function savePieceWeight(productId: string, grams: number, by: string) {
  await put("config", { id: "pieceweight:" + productId, value: { grams, by, at: now() }, updated_at: now() } as Config);
}
