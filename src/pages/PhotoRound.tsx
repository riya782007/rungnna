import { lazy, Suspense, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Product } from "../lib/db";
import { findByScan, saveProduct, label } from "../lib/products";
import { getShop } from "../lib/billing";
import { toast } from "../lib/app";
import { Head, Thumb } from "../components/common";
import { WedgeInput } from "../components/Scanner";

const Camera = lazy(() => import("../components/CustomerCamera"));

/* Owner, 24 Oct (voice): "the bangles we've stickered — how do we take their pictures in the workflow, and how do
   we share them with customers?" Two steps on one screen, nothing to set up:
   1. Scan a sticker → the camera opens → one tap saves the photo on that item → scan the next one.
   2. Tick the photographed items → "Share" sends them (photo sheets with style and rate written under each picture)
      straight to WhatsApp from a phone, or saves the sheets on a computer to attach in WhatsApp Web. */
const day = (iso?: string) => (iso || "").slice(0, 10);
const rupees = (p: number) => "₹" + (p / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });

async function photoBlob(p: Product): Promise<Blob | null> {
  if (p.photo_id) { const row = await db.photos.get(p.photo_id); if (row?.blob) return row.blob; }
  if (p.photo_url) { try { const r = await fetch(p.photo_url, { mode: "cors" }); if (r.ok) return await r.blob(); } catch { /* not reachable */ } }
  return null;
}

/** Photo sheets: up to 9 pictures each (3 × 3), the shop's name on top, style · colour · rate under every picture. */
export async function photoSheets(items: Product[], opts: { prices: boolean; shop: string }): Promise<File[]> {
  const out: File[] = [], per = 9, cols = 3, cell = 420, cap = 64, head = 70;
  for (let s = 0; s < items.length; s += per) {
    const group = items.slice(s, s + per), rows = Math.ceil(group.length / cols);
    const c = document.createElement("canvas"); c.width = cols * cell; c.height = head + rows * (cell + cap);
    const g = c.getContext("2d")!;
    g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#0A4034"; g.fillRect(0, 0, c.width, head);
    g.fillStyle = "#F7EED8"; g.font = "bold 30px Arial"; g.textBaseline = "middle";
    g.fillText(opts.shop, 20, head / 2);
    g.font = "20px Arial"; const pg = `${Math.floor(s / per) + 1}/${Math.ceil(items.length / per)}`; g.fillText(pg, c.width - g.measureText(pg).width - 20, head / 2);
    for (let i = 0; i < group.length; i++) {
      const p = group[i], x = (i % cols) * cell, y = head + Math.floor(i / cols) * (cell + cap);
      const blob = await photoBlob(p);
      if (blob) {
        const bmp = await createImageBitmap(blob);
        const k = Math.max(cell / bmp.width, cell / bmp.height), w = bmp.width * k, h = bmp.height * k;   // fill the square
        g.save(); g.beginPath(); g.rect(x + 4, y + 4, cell - 8, cell - 8); g.clip();
        g.drawImage(bmp, x + (cell - w) / 2, y + (cell - h) / 2, w, h); g.restore(); bmp.close?.();
      } else { g.fillStyle = "#F2EADA"; g.fillRect(x + 4, y + 4, cell - 8, cell - 8); }
      g.fillStyle = "#241B2E"; g.font = "bold 22px Arial";
      const line1 = [p.style || p.item, p.color].filter(Boolean).join(" · ").slice(0, 34);
      g.fillText(line1, x + 12, y + cell + 20);
      g.font = "20px Arial"; g.fillStyle = "#3D3346";
      const line2 = [p.item && p.style ? p.item : "", opts.prices && p.rate ? rupees(p.rate) + (p.pack && p.pack > 1 ? ` × ${p.pack}` : "") : ""].filter(Boolean).join("  ");
      g.fillText(line2.slice(0, 36), x + 12, y + cell + 46);
    }
    const blob = await new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error("sheet"))), "image/jpeg", 0.88));
    out.push(new File([blob], `rungnna-photos-${new Date().toISOString().slice(0, 10)}-${Math.floor(s / per) + 1}.jpg`, { type: "image/jpeg" }));
  }
  return out;
}

export default function PhotoRound() {
  const [current, setCurrent] = useState<Product | null>(null);
  const [cam, setCam] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [prices, setPrices] = useState(true);
  const [busy, setBusy] = useState(false);
  const withPhotos = useLiveQuery(() => db.products.filter(p => !p.deleted && !!(p.photo_id || p.photo_url)).toArray(), [], [] as Product[]);
  const list = useMemo(() => [...withPhotos].sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1)), [withPhotos]);
  const today = day(new Date().toISOString());
  // ticked: what the owner chose, or else everything photographed today
  const chosen = picked ?? new Set(list.filter(p => day(p.updated_at) === today).map(p => p.id));
  const sel = list.filter(p => chosen.has(p.id));

  const onCode = async (raw: string) => {
    const r = raw.trim(); if (!r) return;
    let p = await findByScan(r).catch(() => undefined);
    if (!p) {   // a style typed by hand
      const same = await db.products.filter(x => !x.deleted && (x.style || "").toUpperCase() === r.toUpperCase()).toArray();
      p = same.length === 1 ? same[0] : undefined;
    }
    if (!p) return toast("Not found — scan the item's sticker", true);
    setCurrent(p); setCam(true);
  };
  const savePic = async (photo_id: string) => {
    if (!current) return;
    const fresh = (await db.products.get(current.id)) || current;
    await saveProduct({ ...fresh, photo_id, photo_url: undefined }, true);
    setPicked(s => (s ? new Set([...s, fresh.id]) : s));
    toast(`Photo saved · ${label(fresh)} — scan the next sticker`);
    setCam(false); setCurrent(null);
  };
  const share = async () => {
    if (!sel.length) return toast("Tick the items to send", true);
    setBusy(true);
    try {
      const shop = (await getShop()).name || "RUNGNNA JEWELLERY & CO";
      const files = await photoSheets(sel, { prices, shop });
      const text = `${shop} — ${sel.length} design${sel.length === 1 ? "" : "s"}`;
      if (navigator.canShare?.({ files })) { await navigator.share({ files, text }); return; }
      for (const f of files) { const a = document.createElement("a"); a.href = URL.createObjectURL(f); a.download = f.name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); }
      toast(`${files.length} photo sheet${files.length === 1 ? "" : "s"} saved in Downloads — attach them in WhatsApp`);
    } catch (e: any) { if (!/abort|cancel/i.test(String(e?.name || e?.message))) toast(e.message || "Could not share", true); }
    finally { setBusy(false); }
  };

  return <div className="stack">
    <Head eyebrow="Catalogue" title="Photos → customers" sub="1. Scan a sticker, take the photo. 2. Tick the photos and share them on WhatsApp." />
    <div className="card pad stack">
      <b>1. Take photos</b>
      <WedgeInput onCode={c => void onCode(c)} placeholder="Scan the item's sticker (or type its style) and press Enter" />
      {current && <div className="row" style={{ gap: 10 }}><Thumb photo_id={current.photo_id} url={current.photo_url} text={current.item} size={56} />
        <span className="grow"><b>{label(current)}</b><div className="xs mut">{current.rate ? rupees(current.rate) : ""}</div></span>
        <button className="btn p" onClick={() => setCam(true)}>Take photo</button></div>}
      {cam && current && <Suspense fallback={<div role="status">Opening camera…</div>}>
        <Camera title={`Photo · ${label(current)}`} facing="environment" settingKey="product_camera" onPhoto={id => void savePic(id)} onClose={() => { setCam(false); }} />
      </Suspense>}
    </div>
    <div className="card pad stack">
      <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <b className="grow">2. Send to customers · {sel.length} ticked</b>
        <label className="row xs"><input type="checkbox" checked={prices} onChange={e => setPrices(e.target.checked)} /> Show rates</label>
        <button className="linkbtn" onClick={() => setPicked(new Set(list.map(p => p.id)))}>Tick all</button>
        <button className="linkbtn" onClick={() => setPicked(new Set())}>Untick all</button>
        <button className="btn p" disabled={busy || !sel.length} onClick={() => void share()}>{busy ? "Making…" : "Share on WhatsApp"}</button>
      </div>
      {!list.length && <div className="xs mut">No photos yet — scan a sticker above.</div>}
      <div className="photo-grid">{list.slice(0, 300).map(p => <label key={p.id} className={"photo-tile" + (chosen.has(p.id) ? " on" : "")}>
        <input type="checkbox" checked={chosen.has(p.id)} onChange={e => setPicked(() => { const n = new Set(chosen); e.target.checked ? n.add(p.id) : n.delete(p.id); return n; })} />
        <Thumb photo_id={p.photo_id} url={p.photo_url} text={p.item} size={120} />
        <span className="xs"><b>{p.style || p.item}</b>{p.color ? " · " + p.color : ""}{p.rate ? <> · {rupees(p.rate)}</> : null}</span>
      </label>)}</div>
    </div>
  </div>;
}
