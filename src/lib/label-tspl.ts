import { orderedLines } from "./label-order";
import { printedCostCode, type CostCodeLook } from "./label-cost-code";
import type { Product } from "./db";
import { qrSvg } from "./qr";
import { labelHeat, type LabelHeat } from "./label-darkness";

/* ===========================================================================
   Direct TSC printing that looks like the on-screen sticker.

   The browser label (Labels.tsx › LabelView) copies the stickers already on the
   shop's packets. This file prints the SAME words, in the SAME arrangement, with
   TSPL commands, so a direct print and a browser print are interchangeable:
     • "shop"  : text block · QR · shop name standing up (the current sticker)
     • "stack" : QR on the left, text on the right
   Every number is millimetres; the printer is 203 dpi (8 dots per mm).
=========================================================================== */

export type LabelShow = { shop: boolean; item: boolean; style: boolean; color: boolean; rate: boolean; tk: boolean; code: boolean; qty: boolean; cost_code: boolean; ref?: boolean; collection?: boolean; material?: boolean };
export type LabelLook = LabelHeat & CostCodeLook & { w: number; h: number; qr: number; font: number; pad: number; offX: number; offY: number; gapY: number; shop: string; layout?: "shop" | "stack"; show: LabelShow; cur?: string };
export type LabelLine = { text: string; big?: boolean; bold?: boolean; small?: boolean; optional?: boolean };   // optional = may be left off a crowded label (the QR carries it anyway)

/** Sticker rate: whole rupees stay whole (₹24), paise always show two places (₹12.50). */
export const labelRate = (paise: number) => { const r = Math.round(paise) / 100; return Number.isInteger(r) ? String(r) : r.toFixed(2); };

/** The words on one sticker, top to bottom, exactly as LabelView shows them. `pack` is the quantity on this label. */
/** What goes before the rate. The shop's old stickers print "9" there ("9320X1PCS" = ₹320): their own code. */
export const rateMark = (look: { cur?: string }) => look.cur ?? "₹";
export function labelLines(look: Pick<LabelLook, "shop" | "layout" | "show" | "cur" | "compactCostCode" | "fakeLetters" | "labelIndex"> & { order?: string[] }, p: Product & { entry_code?: string }, pack: number, rupee = rateMark(look)): LabelLine[] {
  const s = look.show, out: LabelLine[] = [];
  const push = (on: boolean, text: string | undefined | false, o: Omit<LabelLine, "text"> = {}) => { if (on && text) out.push({ text, ...o, bold: true }); };
  const row = (look.layout || "shop") === "shop";
  if (!row) push(s.shop, look.shop, { bold: true, small: true });
  // the words in the owner's chosen order (lib/label-order); the price goes just above the cost code / code
  const lines = orderedLines(look.order, {
    item: s.item ? p.item : "", ref: (s.ref ?? s.style) ? p.entry_code : "", style: s.style ? p.style : "", color: s.color ? p.color : "",
    collection: s.collection ? (p.collection || "").toUpperCase() : "", material: s.material ? (p.material || "").toUpperCase() : "",
    tk: s.tk && p.tk ? "TK " + p.tk : "", cost: s.cost_code ? printedCostCode(p.cost_code, look) : "", code: s.code ? p.code : "",
  }, false);
  let priced = false;
  const price = () => {
    if (priced) return; priced = true;
    if (row) push(s.rate && p.rate > 0, `${rupee}${labelRate(p.rate)}${s.qty ? `X${pack}${p.type || "PCS"}` : ""}`, { big: true, bold: true });
    else { push(s.qty, `${pack} ${p.type || "PCS"}`); push(s.rate && p.rate > 0, `${rupee}${labelRate(p.rate)}`, { big: true, bold: true }); }
  };
  for (const l of lines) {
    if (l.parts[0] === "cost") { price(); push(true, l.text, { bold: true }); continue; }
    if (l.parts[0] === "code") { price(); push(true, l.text, { small: true, optional: true }); continue; }
    push(true, l.text, l.parts[0] === "item" && !row ? { bold: true } : {});
  }
  price();
  return out;
}

const DPMM = 8;
const dots = (mm: number) => Math.round(mm * DPMM);
/* TSC resident fonts: name → [width, height] in dots */
const FONTS: [string, number, number][] = [["1", 8, 12], ["2", 12, 20], ["3", 16, 24], ["4", 24, 32], ["5", 32, 48]];
function fontFor(pt: number) {
  const want = pt * 0.3528 * DPMM;                     // point size → dots tall
  let best = FONTS[0];
  for (const f of FONTS) if (f[2] <= want * 1.15) best = f;
  return { name: best[0], w: best[1], h: best[2] };
}
const q = (s: string) => `"${String(s || "").replace(/[\x00-\x1f\x7f]/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const fit = (s: string, maxChars: number) => (s.length > maxChars ? s.slice(0, Math.max(1, maxChars)) : s);   // only for the standing shop name

/** TSPL for one product × copies, matching the on-screen sticker. Throws with a plain message when it can't print it correctly. */
export function labelTSPL(look: LabelLook, p: Product, pack: number, copies: number, qrText: string, opts: { density?: number; speed?: number } = {}): string {
  const heat = labelHeat({ density: opts.density ?? look.density, speed: opts.speed ?? look.speed });
  const { w, h, pad } = look;
  if (![w, h, pad, look.qr, look.font, look.offX, look.offY].every(Number.isFinite) || w < 10 || w > 200 || h < 8 || h > 300) throw new Error("Check label size in printer settings");
  if (!Number.isSafeInteger(copies) || copies < 1 || copies > 5000) throw new Error("Print quantity must be 1–5000");
  const lines = labelLines(look, p, pack, /^[\x20-\x7e]*$/.test(rateMark(look)) ? rateMark(look) : "Rs.");
  if ([...lines.map(l => l.text), look.shop].some(s => /[^\x00-\x7f]/.test(s || ""))) throw new Error("Hindi / Unicode text can't go to the TSC printer directly — use browser printing for this label");
  const ox = dots(look.offX), oy = dots(look.offY), W = dots(w), H = dots(h), P = dots(pad);
  const qrMm = Math.min(look.qr, h - pad * 2), qrDots = dots(qrMm);
  const modules = qrSvg(qrText).modules + 2;           // + 1-module quiet zone each side
  // 3-dot squares when the sticker's height allows, as on the screen/browser sticker (owner, 24 Oct: one scan, every time)
  const room = dots(h - 0.6);   // owner, 23 Oct: "a bigger QR is no problem", so it may use the sticker's full height
  const cell = Math.min(Math.floor(room / modules), Math.max(3, Math.floor(qrDots / modules)));
  if (cell < 2) throw new Error("QR is too small for a 203 dpi printer — make the QR size bigger in label settings");
  const qrReal = cell * modules;
  const base = fontFor(look.font), big = fontFor(look.font * 1.35), small = fontFor(look.font * 0.85);
  const fontOf = (l: LabelLine) => (l.big ? big : l.small ? small : base);
  const shopOn = (look.layout || "shop") === "shop" && look.show.shop && !!look.shop;
  const shopFont = fontFor(look.font * 0.95);

  const cmds = [`SIZE ${w} mm, ${h} mm`, `GAP ${look.gapY > 0 ? look.gapY : 2} mm, 0 mm`, "DIRECTION 1", "REFERENCE 0,0",
    `DENSITY ${heat.density}`, `SPEED ${heat.speed}`, "CLS"];
  let textX: number, textW: number, qrX: number;
  if ((look.layout || "shop") === "shop") {
    const shopW = shopOn ? shopFont.h + P : 0;
    qrX = W - P - shopW - qrReal;
    textX = P; textW = qrX - P - textX;
    if (shopOn) cmds.push(`TEXT ${W - P + ox},${P + oy},${q(shopFont.name)},90,1,1,${q(fit(look.shop, Math.floor((H - 2 * P) / shopFont.w)))}`);
  } else {
    qrX = P; textX = P + qrReal + P; textW = W - P - textX;
  }
  if (textW < base.w * 3) throw new Error("Not enough room for text beside the QR — make the QR smaller or the label wider");
  cmds.push(`QRCODE ${qrX + ox},${Math.max(P, Math.round((H - qrReal) / 2)) + oy},M,${cell},A,0,${q(qrText)}`);
  // Each line: step the fixed-width font down until it fits; if even the small font can't hold it, wrap it onto a
  // second row (as the screen sticker does). A price, quantity, style or cost code is never cut short.
  const gap = 2, smallest = FONTS[1];
  type Row = { text: string; f: { name: string; w: number; h: number }; bold?: boolean; optional?: boolean };
  const blocks: Row[][] = lines.map(l => {
    let f = fontOf(l);
    for (let i = FONTS.findIndex(x => x[0] === f.name); i > 1 && l.text.length * f.w > textW; i--) f = { name: FONTS[i - 1][0], w: FONTS[i - 1][1], h: FONTS[i - 1][2] };
    if (l.text.length * f.w <= textW) return [{ text: l.text, f, bold: l.bold, optional: l.optional }];
    const sf = { name: smallest[0], w: smallest[1], h: smallest[2] }, per = Math.floor(textW / sf.w);
    if (l.text.length > per * 2) {
      if (l.optional) return [];
      throw new Error(`"${l.text}" doesn't fit this label — use a wider label, a smaller QR, or browser printing`);
    }
    return [{ text: l.text.slice(0, per), f: sf, bold: l.bold, optional: l.optional }, { text: l.text.slice(per), f: sf, bold: l.bold, optional: l.optional }];
  });
  const height = (bs: Row[][]) => bs.flat().reduce((a, r) => a + r.f.h + gap, 0);
  // too tall: leave off optional lines from the bottom; if the essentials still don't fit, refuse rather than print half a label
  for (let i = blocks.length - 1; i >= 0 && height(blocks) > H - 2 * P; i--) if (blocks[i].every(r => r.optional)) blocks[i] = [];
  if (height(blocks) > H - 2 * P) throw new Error("Too much text for this label height — switch off a field (e.g. TK or CODE) or use a taller label");
  let y = Math.max(P, Math.round((H - height(blocks)) / 2));
  for (const r of blocks.flat()) {
    cmds.push(`TEXT ${textX + ox},${y + oy},${q(r.f.name)},0,1,1,${q(r.text)}`);
    if (r.bold) cmds.push(`TEXT ${textX + ox + 1},${y + oy},${q(r.f.name)},0,1,1,${q(r.text)}`); // double strike = bold on resident fonts
    y += r.f.h + gap;
  }
  cmds.push(`PRINT 1,${copies}`);
  return cmds.join("\r\n") + "\r\n";
}
