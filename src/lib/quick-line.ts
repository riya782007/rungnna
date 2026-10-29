/* Owner, 29 Oct (voice): "make typing by hand so good that I can take the stickers out fast — half an hour gone and
   not one carton matched". One box, one line of the bill typed the way it is printed, Enter:

     TIKA 19430 12 51        item TIKA · code 19430 · 12 pcs · cost ₹51
     19016 12 67             same item as the line before
     NATH-470 12 47          "WORD-code" is split into item and code
     TIKA 19020 4x12 53      4 boxes of 12 = 48 pcs, 4 stickers marked X12
     SET 8500-1 TO 8500-12 13x12 470
     CHOTI 24 273            no code on the bill: the app builds one (CHOTI-273)

   The last one or two numbers are the quantity and the cost; everything before them is item and code. */

export type QuickLine = { item: string; style: string; qty: string; cost: string; pack?: string; stickers?: string };
export type QuickResult = { ok: true; line: QuickLine; carried: boolean } | { ok: false; error: string };

const NUM = /^\d+(?:\.\d{1,2})?$/;
const BOXES = /^(\d{1,4})x(\d{1,5})$/;
const WORD = /^[A-Z][A-Z.&']*$/;   // an item word: letters only
const NOT_ITEM = new Set(["TO", "X"]);
/** Above this a number is not a quantity of one line but an article code (19430). */
const MAX_QTY = 1500;

/** prevItem: the item of the line above (carried when a line starts with its code). expectCode: the bill's lines
    so far have codes, so "TIKA 340 12" is code 340 · 12 pcs, not 340 pcs at ₹12. */
export function parseQuickLine(text: string, prevItem = "", expectCode = false): QuickResult {
  let t = String(text || "").toUpperCase().replace(/₹|RS\.?(?=\s*\d)/g, " ").replace(/,/g, " ");
  t = t.replace(/(\d)\s*[X×*]\s*(\d)/g, "$1x$2");                       // 4 X 12 → 4x12 (only between digits)
  t = t.replace(/(\d)\s*(?:PCS|PC|PIECES?|NOS?)\b/g, "$1");             // 12PC → 12
  t = t.replace(/\s+-\s+/g, " ").trim();                                // "TIKA - 19430"
  if (!t) return { ok: false, error: "" };
  const all = t.split(/\s+/).flatMap(w => {
    const m = /^([A-Z]{3,})-(.+)$/.exec(w);                              // NATH-470, SET-360 (not Z-128)
    return m ? [m[1], m[2]] : [w];
  });
  const isQty = (v?: string) => !!v && (BOXES.test(v) || (/^\d+$/.test(v) && Number(v) > 0 && Number(v) <= MAX_QTY));
  const read = (twoNumbers: boolean): QuickResult => {
    const n = all.length, last = all[n - 1], second = all[n - 2];
    let qtyTok = "", cost = "";
    if (BOXES.test(last)) qtyTok = last;
    else if (twoNumbers && NUM.test(last) && n >= 3 && isQty(second)) { qtyTok = second; cost = last; }
    else if (isQty(last) && n >= 2) qtyTok = last;
    if (!qtyTok) return { ok: false, error: "End the line with the quantity (and the cost): e.g. TIKA 19430 12 51" };
    const tokens = all.slice(0, n - (cost ? 2 : 1));
    // what is left: item words first, then the code
    let i = 0; const words: string[] = [];
    while (i < tokens.length && WORD.test(tokens[i]) && !NOT_ITEM.has(tokens[i]) && tokens[i].length >= 2) words.push(tokens[i++]);
    let item = words.join(" "), carried = false;
    const style = tokens.slice(i).join(" ");
    if (!item) { item = prevItem.trim().toUpperCase(); carried = !!item; }
    if (!item && !style) return { ok: false, error: "Type the item and code first: e.g. TIKA 19430 12 51" };
    if (!item) return { ok: false, error: `Type the item name once at the start: e.g. TIKA ${style} …` };
    const boxes = BOXES.exec(qtyTok);
    const line: QuickLine = boxes
      ? { item, style, qty: String(Number(boxes[1]) * Number(boxes[2])), cost, pack: String(Number(boxes[2])), stickers: String(Number(boxes[1])) }
      : { item, style, qty: String(Number(qtyTok)), cost };
    return { ok: true, line, carried };
  };
  const first = read(true);
  // a bill whose lines carry codes: a reading that leaves this line without one is the wrong reading
  if (first.ok && !first.line.style && expectCode) { const other = read(false); if (other.ok && other.line.style) return other; }
  return first;
}

/** "1-5, 8 11" → [1,2,3,4,5,8,11]: the Sr. numbers in a carton, typed the quick way. */
export function parseSrList(text: string, max = 300): number[] {
  const out = new Set<number>();
  for (const part of String(text || "").split(/[\s,;+]+/).filter(Boolean)) {
    const m = /^(\d{1,4})(?:-(\d{1,4}))?$/.exec(part);
    if (!m) continue;
    const a = Number(m[1]), b = m[2] ? Number(m[2]) : a;
    for (let k = Math.min(a, b); k <= Math.max(a, b) && out.size < max; k++) out.add(k);
  }
  return [...out].sort((x, y) => x - y);
}
