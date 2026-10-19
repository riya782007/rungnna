/** Printed disguise only: never change the saved cost, price or QR identity. */
export type CostCodeLook = { compactCostCode?: boolean; fakeLetters?: string; labelIndex?: number };
export const fakeLetterPool = (value = "Z") => [...new Set(value.toUpperCase().replace(/[^A-Z]/g, ""))].join("");
export function printedCostCode(raw: string | undefined, look: CostCodeLook, labelIndex = look.labelIndex ?? 0): string {
  if (!raw || !look.compactCostCode) return raw || "";
  const [, core, suffix] = raw.match(/^(.*?)(X\d+[A-Z]+)$/i) || ["", raw, ""];
  const seen = new Set<string>();
  const compact = core.replace(/[A-Z]/gi, letter => {
    const key = letter.toUpperCase();
    if (seen.has(key)) return "-";
    seen.add(key); return key;
  });
  const pool = [...fakeLetterPool(look.fakeLetters)];
  // A stable shuffled cycle keeps preview, reprints and resumed batches identical.
  let seed = 2166136261;
  for (const ch of core) seed = Math.imul(seed ^ ch.charCodeAt(0), 16777619) >>> 0;
  for (let i = pool.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1); [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const index = Number.isSafeInteger(labelIndex) && labelIndex >= 0 ? labelIndex : 0;
  return compact + (pool.length ? pool[index % pool.length] : "") + suffix;
}
