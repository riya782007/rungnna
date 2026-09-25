import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type Product } from "../lib/db";
import { label, DEFAULT_TYPES, saveProduct } from "../lib/products";
import { Head, Thumb, PhotoButton, useLocations, locName } from "../components/common";
import { WedgeInput } from "../components/Scanner";
import { findByScan } from "../lib/products";
import { go, toast } from "../lib/app";
import { rupees, toPaise, when } from "../lib/format";
import { describePhoto } from "../lib/ai";
import { VoiceNotes } from "../components/Voice";

export default function Products({ args }: { args: string[] }) {
  if (args[0]) return <ProductDetail id={args[0]} />;
  return <ProductList />;
}

function ProductList() {
  const [q, setQ] = useState("");
  const [item, setItem] = useState("");
  const [limit, setLimit] = useState(60);
  const all = useLiveQuery(() => db.products.orderBy("updated_at").reverse().toArray(), [], []);
  const cells = useLiveQuery(() => db.stock.toArray(), [], []);
  const qty = useMemo(() => { const m = new Map<string, number>(); cells.forEach(c => m.set(c.product_id, (m.get(c.product_id) || 0) + c.qty)); return m; }, [cells]);
  const items = useMemo(() => [...new Set(all.filter(p => !p.deleted).map(p => p.item).filter(Boolean))].sort(), [all]);
  const list = useMemo(() => {
    const t = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
    return all.filter(p => !p.deleted && (!item || p.item === item) &&
      t.every(w => (p.code + " " + p.item + " " + p.style + " " + p.color + " " + p.tk + " " + p.barcodes.join(" ")).toUpperCase().includes(w)));
  }, [all, q, item]);
  return (
    <div>
      <Head eyebrow="Catalogue" title="Products" sub={`${all.filter(p => !p.deleted).length} products recorded`}>
        <button className="btn p" onClick={() => go("scan")}>Scan & record</button>
      </Head>
      <div className="card pad stack" style={{ marginBottom: 12 }}>
        <input className="in" placeholder="Search style, colour, item, code…" value={q} onChange={e => setQ(e.target.value)} />
        <WedgeInput autoFocus={false} placeholder="…or scan a label to open it" onCode={async raw => { const p = await findByScan(raw); p ? go("product/" + p.id) : toast("Not found", true); }} />
        <div className="chips"><button className="chip" aria-pressed={!item} onClick={() => setItem("")}>All</button>
          {items.map(i => <button key={i} className="chip" aria-pressed={item === i} onClick={() => setItem(i)}>{i}</button>)}</div>
      </div>
      <div className="stack" style={{ gap: 6 }}>
        {list.slice(0, limit).map(p => (
          <a key={p.id} className="item" href={"#/product/" + p.id}>
            <Thumb photo_id={p.photo_id} url={p.photo_url} text={p.item || p.style} />
            <div className="grow"><div className="b sm">{label(p)}</div><div className="xs mut mono">{p.code}{p.tk ? " · TK " + p.tk : ""}</div></div>
            <div style={{ textAlign: "right" }}><div className="mono b">{qty.get(p.id) || 0}</div><div className="xs mut">{p.rate ? rupees(p.rate) : "no rate"}</div></div>
          </a>))}
        {list.length > limit && <button className="btn" onClick={() => setLimit(limit + 100)}>Show more ({list.length - limit})</button>}
        {!list.length && <div className="card pad mut">Nothing matches.</div>}
      </div>
    </div>
  );
}

function ProductDetail({ id }: { id: string }) {
  const locs = useLocations();
  const p0 = useLiveQuery(() => db.products.get(id), [id]);
  const stock = useLiveQuery(() => db.stock.where("product_id").equals(id).toArray(), [id], []);
  const moves = useLiveQuery(() => db.movements.where("product_id").equals(id).reverse().sortBy("at"), [id], []);
  const staff = useLiveQuery(() => db.staff.toArray(), [], []);
  const [p, setP] = useState<Product | null>(null);
  useEffect(() => { if (p0) setP({ ...p0 }); }, [p0?.updated_at]);
  if (!p) return <div className="card pad">Loading…</div>;
  const set = (k: keyof Product, v: any) => setP({ ...p, [k]: v });
  const total = stock.reduce((a, c) => a + c.qty, 0);
  const locOf = (x: string | null) => (x ? locs.find(l => l.id === x)?.code || "?" : "");
  return (
    <div>
      <Head eyebrow={p.code} title={label(p)} sub={`${total} pieces in the building`}>
        <button className="btn" onClick={() => go("move/" + p.id)}>Move</button>
        <button className="btn g" onClick={() => go("labels/" + p.id)}>Print QR</button>
      </Head>
      <div className="split">
        <div className="card pad stack">
          <div className="row"><Thumb photo_id={p.photo_id} url={p.photo_url} text={p.item} size={96} /><PhotoButton value={p.photo_id} onChange={v => set("photo_id", v)} />
            {(p.photo_id || p.photo_url) && <button className="btn sm" onClick={async () => {
              try {
                const blob = p.photo_id ? (await db.photos.get(p.photo_id))?.blob : await (await fetch(p.photo_url!)).blob();
                if (!blob) return;
                toast("Looking at the photo…");
                const r = await describePhoto(blob);
                setP(x => x && ({ ...x, item: x.item || (r.item || "").toUpperCase(), color: x.color || (r.color || "").toUpperCase(),
                  notes: [x.notes, r.description, r.tags?.length ? "Tags: " + r.tags.join(", ") : ""].filter(Boolean).join("\n") }));
                toast("Filled from photo — check and Save");
              } catch (e: any) { toast(e.message, true); }
            }}>✨ Fill from photo</button>}</div>
          <div className="grid g2">
            <label className="f">Item<input className="in" value={p.item} onChange={e => set("item", e.target.value.toUpperCase())} /></label>
            <label className="f">Type<select className="in" value={p.type} onChange={e => set("type", e.target.value)}>{[...new Set([p.type, ...DEFAULT_TYPES])].map(t => <option key={t}>{t}</option>)}</select></label>
            <label className="f">Style<input className="in mono" value={p.style} onChange={e => set("style", e.target.value.toUpperCase())} /></label>
            <label className="f">Color<input className="in mono" value={p.color} onChange={e => set("color", e.target.value.toUpperCase())} /></label>
            <label className="f">TK<input className="in" value={p.tk} onChange={e => set("tk", e.target.value)} /></label>
            <label className="f">Rate ₹<input className="in hi mono" inputMode="decimal" value={p.rate ? String(p.rate / 100) : ""} onChange={e => set("rate", toPaise(e.target.value))} /></label>
            <label className="f">MRP ₹<input className="in mono" inputMode="decimal" value={p.mrp ? String(p.mrp / 100) : ""} onChange={e => set("mrp", toPaise(e.target.value))} /></label>
            <label className="f">Category<input className="in" value={p.category} onChange={e => set("category", e.target.value)} /></label>
            <label className="f">Pieces per packet<input className="in mono" inputMode="numeric" value={p.pack || ""} onChange={e => set("pack", parseInt(e.target.value.replace(/\D/g, "")) || undefined)} /></label>
            <label className="f">Item code (old software)<input className="in mono" inputMode="numeric" value={p.item_code || ""} onChange={e => set("item_code", e.target.value.replace(/\D/g, "") || undefined)} /></label>
          </div>
          <label className="f">Notes<textarea className="in" rows={2} value={p.notes} onChange={e => set("notes", e.target.value)} /></label>
          <div className="xs mut">Scans that open this product: <span className="mono">{p.barcodes.join(" · ")}</span></div>
          <div className="row">
            <button className="btn p" onClick={async () => { await saveProduct({ ...p }); toast("Saved"); }}>Save changes</button>
            <button className="btn bad" onClick={async () => { if (confirm("Hide this product? Its history stays.")) { await put("products", { ...p, deleted: 1 }); go("products"); } }}>Hide product</button>
          </div>
          <VoiceNotes entity="product" entityId={p.id} />
        </div>
        <div className="stack">
          <div className="card"><header><h3>Where it is</h3></header>
            <div className="pad stack" style={{ gap: 6 }}>
              {stock.filter(c => c.qty).map(c => <div key={c.key} className="row between sm"><span>{locName(locs.find(l => l.id === c.loc_id))}</span><b className="mono">{c.qty}</b></div>)}
              {!stock.some(c => c.qty) && <div className="mut sm">No stock recorded.</div>}
            </div></div>
          <div className="card"><header><h3>History</h3><span className="pill">{moves.length}</span></header>
            <div className="pad stack" style={{ gap: 8 }}>
              {moves.map(m => (
                <div key={m.id} className="row sm" style={{ alignItems: "flex-start" }}>
                  {m.photo_id || m.photo_url ? <Thumb photo_id={m.photo_id} url={m.photo_url} size={36} /> : null}
                  <div className="grow">
                    <b>{m.kind}</b> {m.qty} pcs {locOf(m.from_loc) && "from " + locOf(m.from_loc)} {locOf(m.to_loc) && "→ " + locOf(m.to_loc)}
                    <div className="xs mut">{when(m.at)} · {m.person_type} {m.person_name} · by {staff.find(s => s.id === m.by_staff)?.name || "—"}{m.note ? " · " + m.note : ""}</div>
                  </div>
                </div>))}
            </div></div>
        </div>
      </div>
    </div>
  );
}
