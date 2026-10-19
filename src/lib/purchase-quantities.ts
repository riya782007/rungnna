import type { PhotoRow } from "./purchase-photo";

/** Normalize visible counts without confusing pieces, packets and sticker copies. */
export function readCount(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (raw.includes(",") && !/^\d{1,3}(?:,\d{3})+(?:\.0+)?$/.test(raw)) return raw;
  const numeric = raw.replace(/,/g, "");
  if (!/^\d+(?:\.0+)?$/.test(numeric)) return raw;
  const n = Number(numeric);
  return Number.isSafeInteger(n) && n > 0 ? String(n) : raw;
}
export function readPacketSize(value: unknown): string {
  const raw = String(value ?? "").trim();
  const dozen = /^(\d+(?:\.0+)?)\s*(?:DOZ(?:EN)?S?\.?|DZN)$/i.exec(raw);
  if (dozen) return readCount(String(Number(dozen[1]) * 12));
  const count = /^(?:X\s*)?(\d[\d,]*(?:\.0+)?)(?:\s*(?:PCS?|PIECES?|PAIR|SET)(?:\s*(?:\/|PER)\s*(?:BOX|PACKET|PKT|PACK))?)?$/i.exec(raw);
  return readCount(count?.[1] ?? raw);
}
function requiredCount(value: string, title: string, max: number) {
  const s = readCount(value), n = Number(s);
  if (!/^\d+$/.test(s) || !Number.isSafeInteger(n) || n < 1 || n > max) throw new Error(title + " must be a whole number from 1 to " + max);
  return String(n);
}
/** Blank fields preserve existing quantities; explicit values replace every review line. */
export function applyPhotoQuantities(rows: PhotoRow[], quantity: string, packetSize: string): PhotoRow[] {
  if (!quantity.trim() && !packetSize.trim()) throw new Error("Enter a total quantity or packet size first");
  const qty = quantity.trim() ? requiredCount(quantity, "Total quantity", 1000000) : undefined;
  const pack = packetSize.trim() ? requiredCount(packetSize, "Pieces per packet", 10000) : undefined;
  return rows.map(row => ({ ...row, ...(qty ? { qty } : {}), ...(pack ? { pack, packSource: "manual" as const } : {}) }));
}

export type RepeatedCountField = "qty" | "pack" | "stickers";
/** Enter commits this count and carries it only to the next line in the same column. */
export function repeatPhotoCount(rows: PhotoRow[], index: number, field: RepeatedCountField, input: string): PhotoRow[] {
  if (!rows[index]) return rows;
  let value: string;
  if (field === "stickers") {
    const raw = input.trim();
    const n = Number(raw);
    if (raw && (!/^\d+$/.test(raw) || !Number.isSafeInteger(n) || n < 0 || n > 5000)) throw new Error("Stickers must be a whole number from 0 to 5000, or blank for one per packet");
    value = raw ? String(n) : "";
  } else {
    value = requiredCount(input, field === "qty" ? "Total quantity" : "Pieces per packet", field === "qty" ? 1000000 : 10000);
  }
  return rows.map((row, i) => i === index || i === index + 1
    ? { ...row, [field]: value, ...(field === "pack" ? { packSource: "manual" as const } : {}) }
    : row);
}
