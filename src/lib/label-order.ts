/* Owner, 22 Oct (voice note): "the place of each thing on the sticker should be set here too, so it's clear
   where what is and nobody gets confused reading it". The words on a sticker are parts in an order he chooses.
   Neighbouring Reference / Style (and Colour, on the shop's row sticker) share one line, as they always have. */
export type LabelPart = "item" | "ref" | "style" | "color" | "tk" | "cost" | "code";
export const DEFAULT_ORDER: LabelPart[] = ["item", "ref", "style", "color", "tk", "cost", "code"];
export const PART_NAMES: Record<LabelPart, string> = { item: "Item", ref: "Reference", style: "Style", color: "Colour", tk: "TK", cost: "Cost code / line no.", code: "Code" };

/** A saved order made whole: unknown names dropped, repeats dropped, missing parts added at the end. */
export function labelOrder(saved?: readonly string[] | null): LabelPart[] {
  const out: LabelPart[] = [];
  for (const k of saved || []) if ((DEFAULT_ORDER as string[]).includes(k) && !out.includes(k as LabelPart)) out.push(k as LabelPart);
  for (const k of DEFAULT_ORDER) if (!out.includes(k)) out.push(k);
  return out;
}

/** Move one part up (-1) or down (+1). */
export function movePart(order: readonly string[] | undefined, part: LabelPart, by: -1 | 1): LabelPart[] {
  const o = labelOrder(order), i = o.indexOf(part), j = i + by;
  if (i < 0 || j < 0 || j >= o.length) return o;
  [o[i], o[j]] = [o[j], o[i]];
  return o;
}

/** The lines, top to bottom: each is the parts on it and its words. Empty parts are skipped. */
export function orderedLines(order: readonly string[] | undefined, values: Partial<Record<LabelPart, string>>, joinColour: boolean): { parts: LabelPart[]; text: string }[] {
  const joins = new Set<LabelPart>(joinColour ? ["ref", "style", "color"] : ["ref", "style"]);
  const out: { parts: LabelPart[]; text: string }[] = [];
  for (const k of labelOrder(order)) {
    const v = values[k];
    if (!v) continue;
    const last = out[out.length - 1];
    if (last && joins.has(k) && last.parts.every(p => joins.has(p))) { last.parts.push(k); last.text = [last.text, v].filter(x => x.trim()).join(" "); }
    else out.push({ parts: [k], text: v });
  }
  return out;
}
