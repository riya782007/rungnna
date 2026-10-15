/* ===========================================================================
   Printing stickers in small batches, so a wrong print can be stopped.

   Windows holds a whole print job in its queue. Switching the TSC printer off
   only pauses it: on power-up (or USB reconnect) Windows sends the rest again,
   so 1000 stickers ordered by mistake still come out. The old barcode software
   avoided this because the printer, not Windows, held the job.

   So the app never hands Windows more than one batch:
     • a long run starts with ONE ROW, a test, so a wrong size or a wrong
       quantity is seen after 3 stickers, not 300;
     • then batches of `perBatch` stickers (default 60 = 20 rows of 3);
     • between batches the app waits for "Print next" — "Stop" drops the rest.
   The most a mistake can waste is the batch already sent.
=========================================================================== */

export type LabelBatch = { from: number; to: number };   // [from, to) into the flat sticker list

export const DEFAULT_BATCH = 60;

/** Split `total` stickers into batches of whole rows (roll) or whole pages (sheet). */
export function labelBatches(total: number, unit: number, perBatch = DEFAULT_BATCH, testFirst = true): LabelBatch[] {
  if (!Number.isSafeInteger(total) || total <= 0) return [];
  const u = Math.max(1, Math.floor(unit) || 1);
  // 0 or less means "all at once"; otherwise round up to whole rows so a batch never ends mid-row
  const size = perBatch > 0 ? Math.max(u, Math.ceil(perBatch / u) * u) : total;
  if (total <= size) return [{ from: 0, to: total }];          // one batch: nothing to stop between
  const out: LabelBatch[] = [];
  let at = 0;
  if (testFirst) { out.push({ from: 0, to: Math.min(u, total) }); at = out[0].to; }
  for (; at < total; at += size) out.push({ from: at, to: Math.min(total, at + size) });
  return out;
}

/** Consecutive identical stickers as [item, count] runs: one TSPL PRINT per run instead of per sticker. */
export function runsOf<T>(list: T[]): { item: T; n: number }[] {
  const out: { item: T; n: number }[] = [];
  for (const x of list) { const last = out[out.length - 1]; if (last && last.item === x) last.n++; else out.push({ item: x, n: 1 }); }
  return out;
}
