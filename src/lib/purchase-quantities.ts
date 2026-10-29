import type { PhotoRow } from "./purchase-photo";

/** Normalize visible counts without confusing pieces, packets and sticker copies. */
export function readCount(value: unknown): string {
  // printed bills write the quantity with its unit: "48PC", "12 PCS", "24 Pcs." (owner's TIKA/NATH bill, 29 Oct)
  const raw = String(value ?? "").trim().replace(/^(\d[\d,]*(?:\.0+)?)\s*(?:PCS?|PIECES?|NOS?)\.?$/i, "$1");
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

/** Owner, 21 Oct: "We do need more stickers on one item, keep it in option." Stickers on each packet:
    1 = the automatic count (one per packet, the Stickers box left blank); 2, 3… print that many for every
    packet of the line. Only the given lines change (all lines when none are given); each line stays editable. */
export function stickersPerPacket(rows: PhotoRow[], per: number, only?: Set<string>): PhotoRow[] {
  if (!Number.isSafeInteger(per) || per < 1 || per > 20) throw new Error("Stickers on each packet must be 1 to 20");
  return rows.map(row => {
    if (only && only.size && !only.has(row.review_id || "")) return row;
    if (per === 1) return { ...row, stickers: "" };
    const qty = Number(row.qty), pack = Number(row.pack || "1");
    if (!(Number.isSafeInteger(qty) && qty > 0 && Number.isSafeInteger(pack) && pack > 0)) return row;   // no quantity yet: left as it is
    return { ...row, stickers: String(Math.min(5000, Math.ceil(qty / pack) * per)) };
  });
}

/** Owner, 27 Oct: typing a 30-line slip by hand meant writing the style and the pieces again on every line.
    Enter on the last line adds the next one already filled in from it: item, unit, style, colour, HSN, quantity,
    pieces per packet, cost and selling rate (and the reference code). Only what differs is typed over. The
    bill serial goes up by one when it is a plain number; stickers and the photo start empty. */
export function copyLineBelow(rows: PhotoRow[], index: number, id: string): PhotoRow[] {
  const from = rows[index];
  if (!from) return rows;
  const sr = /^\d+$/.test(from.sr?.trim() || "") ? String(Number(from.sr) + 1) : "";
  const line: PhotoRow = {
    review_id: id, item: from.item, style: from.style, color: from.color, unit: from.unit, hsn: from.hsn,
    qty: from.qty, cost: from.cost, rate: from.rate, pack: from.pack, packSource: from.packSource,
    entry_code: from.entry_code, collection: from.collection, material: from.material,
    // the copied cost already has the supplier's terms in it: never divide it again
    termsDone: from.termsDone, billCost: from.billCost,
    sr, stickers: "",
  };
  return [...rows.slice(0, index + 1), line, ...rows.slice(index + 1)];
}
