import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { Head, LocationSelect, PhotoButton, MoneyInput } from "../components/common";
import { useApp, toast, go } from "../lib/app";
import { can } from "../lib/roles";
import { rupees } from "../lib/format";
import { DEFAULT_ITEMS, UNITS } from "../lib/products";
import { getTaxonomy, addColour, addTo, type Taxonomy } from "../lib/taxonomy";
import { getRule, priceFromCost, type PricingRule } from "../lib/pricing";
import { createDesign, validateDesign, variantGrid, type DesignInput, type Variant } from "../lib/inventory";

/* Add inventory — a design and all its colours/sizes in one screen, priced by the shop's rule,
   put on a rack and sent to label printing. (Bulk sheets: the Import tab.) */

const empty = (by: string): DesignInput => ({ item: "", type: "PCS", style: "", pack: 1, cost: 0, rate: 0, rack: "", by, variants: [] });

export default function AddInventory() {
  const { me } = useApp();
  const seeCost = can(me, "rates.view");
  const [d, setD] = useState<DesignInput>(() => empty(me?.id || ""));
  const [colours, setColours] = useState<string[]>([]), [sizes, setSizes] = useState<string[]>([]);
  const [tax, setTax] = useState<Taxonomy | null>(null), [rule, setRule] = useState<PricingRule | null>(null);
  const [busy, setBusy] = useState(false), [newColour, setNewColour] = useState(""), [newSize, setNewSize] = useState("");
  const lock = useRef(false);
  const vendors = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);
  const items = useLiveQuery(async () => [...new Set([...DEFAULT_ITEMS, ...(await db.products.filter(p => !p.deleted && !!p.item).toArray()).map(p => p.item)])].sort(), [], DEFAULT_ITEMS);
  useEffect(() => { getTaxonomy().then(setTax); getRule().then(setRule); }, []);
  const set = (patch: Partial<DesignInput>) => setD(x => ({ ...x, ...patch }));
  useEffect(() => { setD(x => ({ ...x, variants: variantGrid(colours, sizes, x.variants) })); }, [colours.join("|"), sizes.join("|")]);
  const setVar = (i: number, patch: Partial<Variant>) => setD(x => ({ ...x, variants: x.variants.map((v, k) => (k === i ? { ...v, ...patch } : v)) }));

  const suggested = rule && d.cost ? priceFromCost(d.cost, rule, d.pack, d.type) : null;
  const sortedVendors = useMemo(() => [...vendors].sort((a, z) => (a.vendor_code || "~").localeCompare(z.vendor_code || "~", "en", { numeric: true })), [vendors]);
  const pieces = d.variants.reduce((n, v) => n + (v.qty || 0), 0);
  const labels = d.variants.reduce((n, v) => n + (d.pack > 1 ? Math.floor(v.qty / d.pack) + (v.qty % d.pack) : v.qty), 0);
  const problem = validateDesign({ ...d, variants: d.variants.length ? d.variants : [{ color: "", size: "", qty: 0 }] });

  const toggle = (list: string[], v: string, setList: (x: string[]) => void) => setList(list.includes(v) ? list.filter(x => x !== v) : [...list, v]);
  const save = async (print: boolean) => {
    if (lock.current) return;
    const input = { ...d, variants: d.variants.length ? d.variants : [{ color: "", size: "", qty: 0 }] };
    const why = validateDesign(input); if (why) return toast(why, true);
    lock.current = true; setBusy(true);
    try {
      const r = await createDesign(input);
      toast(`${r.products.length} design${r.products.length > 1 ? "s" : ""} saved${r.purchase ? ` · ${r.purchase.total_qty} pieces on the rack (${r.purchase.no})` : ""}`);
      if (print && r.purchase) go("labels/purchase/" + r.purchase.id);
      else { setD({ ...empty(me?.id || ""), item: d.item, type: d.type, rack: d.rack, vendor_id: d.vendor_id, vendor_name: d.vendor_name, pack: d.pack }); setColours([]); setSizes([]); }
    } catch (e: any) { toast(e.message || "Could not save", true); } finally { lock.current = false; setBusy(false); }
  };

  return <div className="add-inv">
    <Head eyebrow="Inventory" title="Add inventory" sub="One design, every colour and size, priced by your rule and put on the rack — then print its stickers.">
      {can(me, "import.data") && <a className="btn" href="#/import">Bulk / sheet import</a>}
    </Head>
    <div className="split">
      <div className="stack">
        <section className="card"><header><h3>1 · Design</h3></header><div className="pad grid g3">
          <label className="f">Item *<input className="in" list="add-items" value={d.item} onChange={e => set({ item: e.target.value.toUpperCase() })} placeholder="e.g. NECKLACE SET" /></label>
          <datalist id="add-items">{items.map(i => <option key={i} value={i} />)}</datalist>
          <label className="f">Style / design no. *<input className="in mono" value={d.style} onChange={e => set({ style: e.target.value.toUpperCase() })} placeholder="e.g. K5209" /></label>
          <label className="f">Unit<select className="in" value={d.type} onChange={e => set({ type: e.target.value })}>{UNITS.map(u => <option key={u}>{u}</option>)}</select></label>
          <label className="f">Vendor<select className="in" value={d.vendor_id || ""} onChange={e => { const v = vendors.find(x => x.id === e.target.value); set({ vendor_id: v?.id, vendor_name: v?.name }); }}>
            <option value="">—</option>{sortedVendors.map(v => <option key={v.id} value={v.id}>{v.vendor_code ? v.vendor_code + " · " : ""}{v.name}</option>)}</select></label>
          <label className="f">Category<select className="in" value={d.category || ""} onChange={e => set({ category: e.target.value })}><option value="">—</option>{tax?.categories.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="f">Collection / style<select className="in" value={d.collection || ""} onChange={e => set({ collection: e.target.value })}><option value="">—</option>{tax?.styles.map(c => <option key={c}>{c}</option>)}</select></label>
          <label className="f">HSN<input className="in mono" inputMode="numeric" value={d.hsn || ""} onChange={e => set({ hsn: e.target.value.replace(/\D/g, "").slice(0, 8) })} placeholder="shop default" /></label>
          <label className="f">GST %<input className="in mono" inputMode="decimal" value={d.gst_rate ?? ""} onChange={e => set({ gst_rate: e.target.value === "" ? null : Number(e.target.value) })} placeholder="shop rate" /></label>
          <div className="f"><span>Photo</span><PhotoButton value={d.photo_id} onChange={v => set({ photo_id: v })} label="Design photo" /></div>
        </div></section>

        <section className="card"><header><h3>2 · Price</h3></header><div className="pad grid g3">
          {seeCost && <label className="f">Cost per piece ₹<MoneyInput className="in mono" paise={d.cost} onPaise={v => set({ cost: v })} /></label>}
          <label className="f">Wholesale rate ₹<MoneyInput className="in hi mono" paise={d.rate} onPaise={v => set({ rate: v })} placeholder={suggested ? (suggested.rate / 100).toFixed(2) + " (from rule)" : ""} /></label>
          <label className="f">Retail rate ₹<MoneyInput className="in mono" paise={d.retail_rate || 0} onPaise={v => set({ retail_rate: v })} /></label>
          <label className="f">MRP ₹<MoneyInput className="in mono" paise={d.mrp || 0} onPaise={v => set({ mrp: v })} /></label>
          <label className="f">Pieces per packet<input className="in mono" inputMode="numeric" value={d.pack} onChange={e => set({ pack: Math.max(1, parseInt(e.target.value) || 1) })} /></label>
          {seeCost && suggested && <div className="f"><span>Cost code on sticker</span><b className="mono">{suggested.cost_code}</b></div>}
        </div></section>

        <section className="card"><header><h3>3 · Colours &amp; sizes</h3><span className="grow" /><span className="xs mut">pick all that you have — each becomes its own product</span></header><div className="pad stack">
          <div className="chips">{tax?.colours.map(c => <button key={c.name} className="chip" aria-pressed={colours.includes(c.name.toUpperCase())} onClick={() => toggle(colours, c.name.toUpperCase(), setColours)}>{c.name}</button>)}</div>
          <div className="row"><input className="in" style={{ maxWidth: 220 }} placeholder="Other colour, e.g. K/GBN" value={newColour} onChange={e => setNewColour(e.target.value)} />
            <button className="btn" disabled={!newColour.trim()} onClick={async () => { const n = newColour.trim().toUpperCase(); if (!colours.includes(n)) setColours([...colours, n]); if (!/\//.test(n)) setTax(await addColour(newColour.trim())); setNewColour(""); }}>Add colour</button></div>
          <div className="chips">{tax?.sizes.map(s => <button key={s} className="chip" aria-pressed={sizes.includes(s)} onClick={() => toggle(sizes, s, setSizes)}>{s}</button>)}</div>
          <div className="row"><input className="in" style={{ maxWidth: 220 }} placeholder="Other size" value={newSize} onChange={e => setNewSize(e.target.value)} />
            <button className="btn" disabled={!newSize.trim()} onClick={async () => { const n = newSize.trim(); if (!sizes.includes(n)) setSizes([...sizes, n]); setTax(await addTo("sizes", n)); setNewSize(""); }}>Add size</button></div>
          <div className="tw"><table><thead><tr><th>Colour</th><th>Size</th><th className="r">Pieces</th><th className="r">Rate ₹ (if different)</th></tr></thead><tbody>
            {(d.variants.length ? d.variants : [{ color: "", size: "", qty: 0 }]).map((v, i) => <tr key={v.color + "|" + v.size}>
              <td>{v.color || <span className="mut">no colour</span>}</td><td>{v.size || "—"}</td>
              <td className="r"><input className="cell r" style={{ width: 70 }} inputMode="numeric" value={v.qty || ""} placeholder="0"
                onChange={e => { const q = Math.max(0, parseInt(e.target.value) || 0); if (!d.variants.length) set({ variants: [{ color: "", size: "", qty: q }] }); else setVar(i, { qty: q }); }} /></td>
              <td className="r"><MoneyInput className="cell r" style={{ width: 80 }} paise={v.rate || 0} placeholder={d.rate ? (d.rate / 100).toFixed(2) : suggested ? (suggested.rate / 100).toFixed(2) : ""}
                onPaise={r => { if (!d.variants.length) set({ variants: [{ color: "", size: "", qty: 0, rate: r || undefined }] }); else setVar(i, { rate: r || undefined }); }} /></td>
            </tr>)}</tbody></table></div>
        </div></section>
      </div>

      <aside className="stack">
        <section className="card"><header><h3>4 · Where it goes</h3></header><div className="pad stack">
          <LocationSelect buckets={false} value={d.rack} onChange={rack => set({ rack })} label="Rack" />
          <div className="hero three add-sum"><div><span className="k">Designs</span><b>{Math.max(1, d.variants.length)}</b></div><div><span className="k">Pieces</span><b>{pieces}</b></div><div><span className="k">Stickers</span><b>{labels}</b></div></div>
          {!!pieces && (d.rate || suggested) && <div className="xs mut">Stock value at wholesale ≈ {rupees(pieces * (d.rate || suggested?.rate || 0))}</div>}
          {problem && <div className="note warn sm">{problem}</div>}
          <button className="btn p big" disabled={busy || !!problem} onClick={() => save(true)}>{busy ? "Saving…" : pieces ? `Save & print ${labels} stickers` : "Save design"}</button>
          {!!pieces && <button className="btn" disabled={busy || !!problem} onClick={() => save(false)}>Save, add another</button>}
          <div className="xs mut">Same style + colour + size from the same vendor updates the existing product instead of making a copy.</div>
        </div></section>
      </aside>
    </div>
  </div>;
}
