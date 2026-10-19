// Pure shared tax allocation: safe in Node server functions and the offline POS.
export function allocate(total: number, weights: number[]) {
  if (!weights.length) return [];
  const w = weights.some(n => n > 0) ? weights.map(n => Math.max(0, n)) : weights.map(() => 1);   // all free lines: share equally
  const sum = w.reduce((a, n) => a + n, 0);
  const out = w.map(n => Math.floor(total * n / sum));
  let left = total - out.reduce((a, n) => a + n, 0);
  for (let i = 0; left > 0; i = (i + 1) % out.length, left--) out[i]++;
  return out;
}
