import type { PhotoRow } from "./purchase-photo";

/* ===========================================================================
   Checking a read bill against itself, so the owner checks only what's in doubt.

   A handwritten estimate form carries its own proof. Every line shows quantity,
   rate AND the amount, and the amounts add up to the Net at the bottom. The
   AI reads the handwriting; this file does the arithmetic, which the AI must
   never be trusted with.

     1. Ditto marks ("11", 〃, do) become the item above, written out.
     2. Each line: qty × rate must equal the amount written. When it doesn't
        and exactly one reading makes it right (amount ÷ rate is a whole number
        of pieces), that reading is used and the line is flagged. Otherwise the
        line is flagged for the owner and nothing is guessed.
     3. The lines must add up to the bill's Net. When they do, the owner can
        approve with confidence. When they don't, the difference is shown.

   Everything is in paise, so ₹24,939 is 2493900 and no rupee is ever lost to
   floating point.
=========================================================================== */

export type ReadRow = PhotoRow & { amount?: string; box?: string };
export type LineFix = { line: number; field: "qty" | "cost"; from: string; to: string; why: string };
export type BillCheck = {
  rows: ReadRow[];
  fixes: LineFix[];                 // changed, and why: shown and highlighted
  doubts: { line: number; why: string }[];   // could not be settled: the owner decides
  factor?: number;                  // every Amount on this bill is factor × Qty × Rate (see below)
  sum: number;                      // paise, after fixes
  net?: number;                     // paise, as the bill states it
  addsUp: boolean | null;           // null when the bill states no total
  pieces: number;
};

/** "1,044" "1044.00" "₹ 1044" → 104400 paise. Anything unreadable is undefined, never 0. */
export function paise(v: unknown): number | undefined {
  const s = String(v ?? "").replace(/[₹,\s]/g, "").replace(/\/-$/, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return undefined;
  const [r, p = ""] = s.split(".");
  return Number(r) * 100 + Number((p + "00").slice(0, 2));
}
const rupees = (p: number) => (p % 100 ? (p / 100).toFixed(2) : String(p / 100));
const wholeQty = (v: unknown) => { const n = Number(String(v ?? "").trim()); return Number.isSafeInteger(n) && n > 0 ? n : undefined; };

/** Marks that mean "same as above" on Indian handwritten bills. */
const DITTO = /^\s*(11|〃|"|''|”|“|do\.?|-do-|ditto)\s*(.*)$/i;

/** Write ditto marks out as the item above. The rest of the text (a size, a variant) is kept. */
export function resolveDitto(rows: ReadRow[]): ReadRow[] {
  /* `base` is the last item actually written out. A ditto copies THAT, never the line above it:
     "KAMAR BELT", "11 3-2", "11 4" is KAMAR BELT 3-2 then KAMAR BELT 4, not KAMAR BELT 3-2 4. */
  let base = "";
  return rows.map(r => {
    const m = r.item.match(DITTO);
    const rest = m ? m[2].trim().replace(/\.$/, "") : "";
    // "11" is also how a size starts ("11 MM PEARL", "11 INCH MALA"): followed by a unit it is a
    // measurement, not a ditto. Anything else after it ("1", "3-2", "GOLD") is the variant of the
    // item above, which is how these bills are written. 〃, " and "do" are always dittos.
    const measurement = m?.[1] === "11" && /^(MM|CM|INCH|INCHES|IN|LINE|LINES|LAYER|LAYERS|STEP|STEPS|NO|NOS)\b/i.test(rest);
    const isDitto = !!m && !!base && !measurement;
    if (isDitto) return { ...r, item: rest ? `${base} ${rest}` : base };
    if (r.item.trim()) base = r.item.trim();
    return r;
  });
}

/** Check every line and the total. Returns corrected rows plus what changed and what's in doubt. */
/* Owner, 24 Oct (call): "the bill says 24, 11, 12 … but the software shows 120, 55, 60". On that supplier's bill
   every Amount is 5 × Qty × Rate (its own group totals use Qty × Rate), so "fixing" each quantity from its amount
   multiplied all of them by 5. When most lines share one whole-number factor like that, it is the bill's way of
   pricing, not a misread: the printed Qty and Rate are kept and the owner is told once. */
export function sharedFactor(rows: ReadRow[]): number | undefined {
  const ks = rows.map(r => { const q = wholeQty(r.qty), c = paise(r.cost), a = paise(r.amount); return q && c && a ? a / (q * c) : NaN; }).filter(k => Number.isFinite(k));
  if (ks.length < 3) return undefined;
  const counts = new Map<number, number>();
  for (const k of ks) if (Number.isInteger(k) && k >= 2 && k <= 100) counts.set(k, (counts.get(k) || 0) + 1);
  const [best, n] = [...counts].sort((a, b) => b[1] - a[1])[0] || [0, 0];
  return best && n >= 3 && n / ks.length >= 0.6 ? best : undefined;
}
export function checkBill(input: ReadRow[], netTotal?: string): BillCheck {
  const fixes: LineFix[] = [], doubts: { line: number; why: string }[] = [];
  const resolved = resolveDitto(input), factor = sharedFactor(resolved);
  const rows = resolved.map((r, i): ReadRow => {
    const line = i + 1;
    const qty = wholeQty(r.qty), cost = paise(r.cost), amount = paise(r.amount);
    if (amount === undefined || amount === 0) return r;            // the bill gave no amount to check against
    if (qty && cost && qty * cost === amount) return r;            // agrees with itself
    if (factor && qty && cost && qty * cost * factor === amount) return r;   // the bill's own ×factor pricing
    // exactly one sensible reading fixes the line: take it, and say so
    if (cost && amount % cost === 0 && wholeQty(amount / cost)) {
      const to = String(amount / cost);
      fixes.push({ line, field: "qty", from: r.qty || "blank", to, why: `${rupees(amount)} ÷ ₹${rupees(cost)} = ${to} pieces` });
      return { ...r, qty: to };
    }
    if (qty && amount % qty === 0) {
      const to = rupees(amount / qty);
      fixes.push({ line, field: "cost", from: r.cost || "blank", to, why: `${rupees(amount)} ÷ ${qty} pieces = ₹${to}` });
      return { ...r, cost: to };
    }
    doubts.push({ line, why: `${r.qty || "?"} × ₹${r.cost || "?"} does not make the ₹${rupees(amount)} written on the bill` });
    return r;
  });

  let sum = 0, pieces = 0;
  for (const r of rows) {
    const q = wholeQty(r.qty), c = paise(r.cost);
    if (q) pieces += q;
    if (q && c) sum += q * c;
  }
  const net = paise(netTotal);
  const addsUp = net === undefined ? null : sum === net || (!!factor && sum * factor === net);
  return { rows, fixes, doubts, sum, net, addsUp, pieces, ...(factor ? { factor } : {}) };
}

/** The one line the owner reads before approving. */
export function checkSummary(c: BillCheck): string {
  if (c.factor) return `${c.rows.length} lines · ${c.pieces} as printed in the Qty column · on this bill every Amount is ${c.factor} × Qty × Rate, so quantities and rates are kept exactly as printed. If one Qty means a set of ${c.factor}, set the packet to ${c.factor}${c.doubts.length ? ` · ${c.doubts.length} line${c.doubts.length > 1 ? "s" : ""} to check` : ""}`;
  const total = `₹${(c.sum / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  if (c.addsUp === true && !c.doubts.length)
    return `${c.rows.length} lines · ${c.pieces} pieces · adds up to ${total}, the bill's own total${c.fixes.length ? ` (after ${c.fixes.length} correction${c.fixes.length > 1 ? "s" : ""} shown below)` : ""}`;
  if (c.addsUp === false)
    return `Lines add up to ${total}, but the bill says ₹${((c.net || 0) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })} (difference ₹${(Math.abs(c.sum - (c.net || 0)) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}). Check the highlighted lines`;
  return `${c.rows.length} lines · ${c.pieces} pieces · ${total}${c.doubts.length ? ` · ${c.doubts.length} line${c.doubts.length > 1 ? "s" : ""} to check` : " · the bill shows no total to check against"}`;
}

/* ---------------- supplier and bill number ---------------- */

const SHOPWORDS = /\b(JEWELLERS?|JEWELLERY|JEWELERS?|JEW|JEWEL|AND|CO|COMPANY|TRADERS?|ENTERPRISES?|MS|M\/S|SONS?)\b/g;
const supKey = (s: string) => (s || "").toUpperCase().replace(/[.&/,'-]/g, " ").replace(SHOPWORDS, " ").replace(/[^A-Z0-9]/g, "");

/** Find the supplier a bill names, forgiving "Suhag Jew." for "SUHAG JEWELLERS". Never a guess between two. */
export function matchSupplier<T extends { id: string; name: string; vendor_code?: string }>(name: string, suppliers: T[]): T | undefined {
  // the shop's own short codes ("51" for Solanki) are exact or nothing
  const code = name.trim().toUpperCase();
  const byCode = suppliers.filter(s => !!s.vendor_code && s.vendor_code.toUpperCase() === code);
  if (byCode.length === 1) return byCode[0];
  const k = supKey(name);
  if (k.length < 3) return undefined;
  // every supplier the name could mean: the same name, or one a prefix of the other ("SUHAG" / "SUHAGJEW")
  const could = suppliers.filter(s => { const sk = supKey(s.name); return sk === k || (sk.length >= 4 && (sk.startsWith(k) || k.startsWith(sk))); });
  return could.length === 1 ? could[0] : undefined;      // two candidates is a guess, and a wrong supplier owes the wrong money
}

/** Estimate forms carry no bill number. Date + total identifies the bill, so uploading it twice is still caught. */
export function fallbackBillNo(date: string, net?: number) {
  const d = (date || "").trim().replace(/\s+/g, "") || new Date().toLocaleDateString("en-GB");
  return `EST ${d}${net ? ` ₹${net / 100}` : ""}`;
}
