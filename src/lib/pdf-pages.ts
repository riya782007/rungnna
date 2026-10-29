/* Owner, 24 Oct: "it doesn't scan an uploaded PDF". Suppliers often send the bill as a PDF on WhatsApp. Each PDF
   page is drawn as a sharp picture here on the computer and read like a photo of that page. */
export const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

export async function pdfToImages(file: File, maxPages = 12): Promise<File[]> {
  const pdfjs = await import("pdfjs-dist");
  const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = worker;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const out: File[] = [];
  for (let n = 1; n <= Math.min(doc.numPages, maxPages); n++) {
    const page = await doc.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(4, 2600 / Math.max(base.width, base.height));   // ~2600 px on the long side
    const view = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(view.width); canvas.height = Math.ceil(view.height);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: view }).promise;
    const blob = await new Promise<Blob>((ok, bad) => canvas.toBlob(b => (b ? ok(b) : bad(new Error("Could not draw the PDF page"))), "image/jpeg", 0.92));
    out.push(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-page-${n}.jpg`, { type: "image/jpeg" }));
  }
  await doc.destroy();
  return out;
}

/** Photos stay as they are; every PDF becomes one picture per page. */
export async function expandPdfs(files: File[]): Promise<File[]> {
  const out: File[] = [];
  for (const f of files) out.push(...(isPdf(f) ? await pdfToImages(f) : [f]));
  return out;
}

/** A page photo cut into n strips from top to bottom (each overlapping the next a little, so no line is cut in two). */
export async function splitPage(file: Blob, n = 2, overlap = 0.06): Promise<File[]> {
  const bmp = await createImageBitmap(file);
  const h = bmp.height, step = h / n, pad = Math.round(h * overlap);
  const parts: File[] = [];
  for (let i = 0; i < n; i++) {
    const y0 = Math.max(0, Math.round(i * step) - pad), y1 = Math.min(h, Math.round((i + 1) * step) + pad);
    const c = document.createElement("canvas"); c.width = bmp.width; c.height = y1 - y0;
    c.getContext("2d")!.drawImage(bmp, 0, y0, bmp.width, y1 - y0, 0, 0, bmp.width, y1 - y0);
    const blob = await new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error("crop"))), "image/jpeg", 0.92));
    parts.push(new File([blob], `part-${i + 1}.jpg`, { type: "image/jpeg" }));
  }
  bmp.close?.();
  return parts;
}

type ReadRow = { sr?: unknown; style?: unknown; qty?: unknown; cost?: unknown; item?: unknown };
const key = (r: ReadRow) => [String(r.style ?? "").trim().toUpperCase(), String(r.qty ?? "").trim(), String(r.cost ?? "").trim()].join("|");
const srNum = (r: ReadRow) => { const m = /^(\d{1,4})$/.exec(String(r.sr ?? "").trim()); return m ? Number(m[1]) : NaN; };
/** How many lines the bill's own Sr. numbers say there are (28 … 58 = 31), or 0 when they don't run in order. */
export function srSpan(rows: ReadRow[]): number {
  const ns = rows.map(srNum).filter(Number.isFinite);
  if (ns.length < 3 || ns.length < rows.length * 0.8) return 0;
  const lo = Math.min(...ns), hi = Math.max(...ns);
  return hi - lo + 1 <= 300 ? hi - lo + 1 : 0;
}
/** Lines from several readings of one page, each line once, in the bill's own order.
    parts[0] is the whole-page reading; the rest are close-up strips. Where the readings disagree about what is
    on a Sr. line, most votes win, and a close-up strip beats the whole page (owner, 29 Oct: the whole-page read
    slipped by one line, so "3902" turned up on two Sr. numbers and the real codes of lines 17–18 were lost). */
export function joinParts(parts: ReadRow[][]): ReadRow[] {
  const cands = new Map<string, { r: ReadRow; votes: number; style: string }[]>(), loose: ReadRow[] = [], seenKey = new Set<string>();
  const styleOf = (r: ReadRow) => String(r.style ?? "").trim().toUpperCase().replace(/\s+/g, "");
  parts.forEach((part, p) => {
    const weight = p === 0 && parts.length > 1 ? 1 : 1.5;
    for (const r of part || []) {
      const sr = String(r.sr ?? "").trim();
      if (!sr) { const k = key(r); if (!seenKey.has(k)) { seenKey.add(k); loose.push(r); } continue; }
      const list = cands.get(sr) || [];
      const same = list.find(c => c.style === styleOf(r) && String(c.r.qty ?? "").trim() === String(r.qty ?? "").trim());
      if (same) { same.votes += weight; if (weight > 1) same.r = r; }   // a close-up's own values are kept
      else list.push({ r, votes: weight, style: styleOf(r) });
      cands.set(sr, list);
    }
  });
  const pick = new Map<string, { r: ReadRow; style: string }>();
  for (const [sr, list] of cands) { const best = [...list].sort((a, b) => b.votes - a.votes)[0]; pick.set(sr, best); }
  // one code chosen for two Sr. lines: where another reading of one of those lines saw a code nobody else has, use it
  const used = () => { const m = new Map<string, number>(); for (const v of pick.values()) if (v.style) m.set(v.style, (m.get(v.style) || 0) + 1); return m; };
  for (const [sr, list] of cands) {
    const u = used(), cur = pick.get(sr)!;
    if (!cur.style || (u.get(cur.style) || 0) < 2) continue;
    const alt = list.filter(c => c.style && c.style !== cur.style && !u.has(c.style)).sort((a, b) => b.votes - a.votes)[0];
    if (alt) pick.set(sr, alt);
  }
  const numbered = [...pick.values()].map(v => v.r);
  if (numbered.every(r => Number.isFinite(srNum(r)))) numbered.sort((a, b) => srNum(a) - srNum(b));
  // lines without an Sr. that match a numbered one (same article, qty and rate) are the same line
  const have = new Set(numbered.map(key));
  return [...numbered, ...loose.filter(r => !have.has(key(r)))];
}

/** Lines that carry the same article code on two Sr. numbers — usually one of them misread. */
export function repeatedCodes(rows: { style?: string; color?: string; sr?: string }[]): { style: string; lines: string[] }[] {
  const by = new Map<string, string[]>();
  rows.forEach((r, i) => {
    const s = String(r.style ?? "").trim().toUpperCase(); if (!s) return;
    const k = s + "|" + String(r.color ?? "").trim().toUpperCase();
    by.set(k, [...(by.get(k) || []), String(r.sr ?? "").trim() || String(i + 1)]);
  });
  return [...by].filter(([, l]) => l.length > 1).map(([k, lines]) => ({ style: k.split("|")[0], lines }));
}
/** @deprecated two parts only — kept for older callers */
export const joinHalves = ([top, bottom]: ReadRow[][]) => joinParts([top, bottom]);

/* Owner, 29 Oct: "make sure the AI makes no mistakes". The finished reading is proofread once against the photo.
   What the proofreading may change, line by line (matched by the bill's Sr.):
     • quantity / rate / amount: only when its line then adds up (qty × rate = amount) and the first one did not;
     • code, item, box, pieces per box: taken from the proofreading, and the line is marked so it is looked at;
     • a line it found that was missing: added when it adds up (or the bill shows no amount for it);
     • a line it dropped: dropped only when its code is on another line (a line read twice). */
type ProofRow = ReadRow & { item?: unknown; box?: unknown; pack?: unknown; amount?: unknown; color?: unknown; unit?: unknown; proof?: string };
const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/,/g, "").replace(/[^\d.]/g, "")); return Number.isFinite(n) && n > 0 ? n : 0; };
const addsUp = (r: ProofRow) => { const q = num(r.qty), c = num(r.cost), a = num(r.amount); return !!(q && c && a && Math.abs(q * c - a) < 0.6); };
export function acceptProof(before: ProofRow[], after: ProofRow[]): { rows: ProofRow[]; changes: string[] } {
  const srOf = (r: ProofRow) => String(r.sr ?? "").trim();
  if (!after.length || before.some(r => !srOf(r)) || after.some(r => !srOf(r))) return { rows: before, changes: [] };
  const was = new Map(before.map(r => [srOf(r), r])), now = new Map(after.map(r => [srOf(r), r]));
  const changes: string[] = [], out: ProofRow[] = [];
  const S = (v: unknown) => String(v ?? "").trim();
  for (const [sr, a] of now) {
    const b = was.get(sr);
    if (!b) { if (addsUp(a) || !num(a.amount)) { out.push({ ...a, proof: "line added by proofreading" }); changes.push(`Sr. ${sr} added`); } continue; }
    let r: ProofRow = { ...b }; const notes: string[] = [];
    for (const k of ["style", "item", "box", "pack"] as const) {
      if (S(a[k]) && S(a[k]).toUpperCase() !== S(b[k]).toUpperCase()) { notes.push(`${k === "style" ? "code" : k} ${S(b[k]) || "—"} → ${S(a[k])}`); r = { ...r, [k]: a[k] }; }
    }
    if (!addsUp(b) && addsUp(a) && (S(a.qty) !== S(b.qty) || S(a.cost) !== S(b.cost))) {
      notes.push(`qty × rate ${S(b.qty)} × ${S(b.cost)} → ${S(a.qty)} × ${S(a.cost)}`); r = { ...r, qty: a.qty, cost: a.cost, amount: a.amount };
    }
    if (notes.length) { r.proof = notes.join(", "); changes.push(`Sr. ${sr}: ${r.proof}`); }
    out.push(r);
  }
  const codes = new Set(out.map(r => S(r.style).toUpperCase()).filter(Boolean));
  for (const [sr, b] of was) if (!now.has(sr)) {
    if (S(b.style) && codes.has(S(b.style).toUpperCase())) { changes.push(`Sr. ${sr} removed (its code ${S(b.style)} is on another line)`); continue; }
    out.push(b);
  }
  if (out.every(r => /^\d+$/.test(srOf(r)))) out.sort((x, y) => Number(srOf(x)) - Number(srOf(y)));
  return { rows: out, changes };
}
