import { json, requireShop } from "./_lib.js";
import { r2Put, r2Configured, fromB64 } from "./_r2.js";

/* Image upload → Cloudflare R2. The only way images leave a shop device.
   Body: { data: base64, mime: "image/webp" | "image/jpeg" | "image/png", key?: "products/<id>.webp" }
   Photos are already compressed on the device (<100 KB), well under the function body limit. */

const TYPES: Record<string, string> = { "image/webp": "webp", "image/jpeg": "jpg", "image/png": "png" };
const MAX = 4 * 1024 * 1024;

export async function GET() {
  return json({ r2: r2Configured() });
}

export async function POST(req: Request) {
  const who = await requireShop(req);
  if (who instanceof Response) return who;
  if (!r2Configured()) return json({ error: "Cloudflare R2 is not set up yet", code: "no_r2" }, 503);
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const mime = String(b.mime || "").split(";")[0].toLowerCase();
  const ext = TYPES[mime];
  if (!ext) return json({ error: "Only WebP, JPEG or PNG images" }, 415);
  let bytes: Uint8Array;
  try { bytes = fromB64(String(b.data || "")); } catch { return json({ error: "Image data is not valid base64" }, 400); }
  if (!bytes.length) return json({ error: "Empty image" }, 400);
  if (bytes.length > MAX) return json({ error: "Image too large (max 4 MB)" }, 413);
  // keys are always namespaced + sanitised: a caller can never write outside media/
  const want = String(b.key || "").replace(/[^a-zA-Z0-9/_.-]/g, "").replace(/\.\.+/g, ".").replace(/^\/+/, "");
  const base = want ? want.replace(/\.(webp|jpe?g|png)$/i, "") : `uploads/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}`;
  const key = `media/${base}.${ext}`;
  try {
    const url = await r2Put(key, bytes, mime);
    return json({ ok: true, url, key });
  } catch (e: any) {
    return json({ error: e?.message || "Upload failed" }, e?.status || 502);
  }
}
