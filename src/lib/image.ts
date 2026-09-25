import { db, uid, now } from "./db";

/* Photos are shrunk on the device before they are stored or sent:
   longest side 900px, WebP (JPEG fallback), stepping quality down until under ~90 KB.
   A thousand photos a day then costs ~90 MB, not 3 GB. */
export async function compress(file: Blob, maxSide = 900, targetBytes = 90_000): Promise<{ blob: Blob; w: number; h: number }> {
  const bmp = await createImageBitmap(file).catch(async () => {
    const img = new Image(); img.src = URL.createObjectURL(file); await img.decode(); return img as any;
  });
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * scale), h = Math.round(bmp.height * scale);
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d")!; g.drawImage(bmp, 0, 0, w, h);
  const type = c.toDataURL("image/webp").startsWith("data:image/webp") ? "image/webp" : "image/jpeg";
  let q = 0.82, blob: Blob | null = null;
  for (let i = 0; i < 6; i++) {
    blob = await new Promise<Blob | null>(r => c.toBlob(r, type, q));
    if (blob && blob.size <= targetBytes) break;
    q -= 0.12;
  }
  return { blob: blob!, w, h };
}

export async function savePhoto(file: Blob): Promise<string> {
  const { blob, w, h } = await compress(file);
  const id = uid();
  await db.photos.put({ id, blob, w, h, bytes: blob.size, uploaded: 0, created_at: now() });
  return id;
}

const cache = new Map<string, string>();
export async function photoSrc(photo_id?: string, url?: string): Promise<string> {
  if (photo_id) {
    if (cache.has(photo_id)) return cache.get(photo_id)!;
    const p = await db.photos.get(photo_id);
    if (p) { const u = URL.createObjectURL(p.blob); cache.set(photo_id, u); return u; }
  }
  return url || "";
}
