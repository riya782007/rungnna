import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, getSetting, setSetting, type Purchase, type PurchaseLine, type Product } from "../lib/db";
import { newPurchase, sum, lineOf, resolveScan, finalizePurchase, lineQty } from "../lib/stockin";
import { newParty } from "../lib/billing";
import { useApp, toast, beep, go } from "../lib/app";
import { can } from "../lib/roles";
import { rupees, toPaise, when } from "../lib/format";
import { CameraScanner } from "../components/Scanner";
import { Head, LocationSelect, PhotoButton, Modal, LOC_PREFIX, useLocations } from "../components/common";
import { Icon } from "../components/Icon";

/* Stock in: stand at a rack, scan packet after packet, save once.
   Every scan is +1 packet. Labels the system hasn't seen become products on the spot.
   With a supplier and bill no. it doubles as the purchase entry. Works offline; the draft survives a closed tab. */
export default function StockIn({ args }: { args: string[] }) {
  if (args[0]) return <StockInView id={args[0]} />;
  return <StockInSession />;
}

function StockInSession() {
  const { me } = useApp();
  const seeCost = can(me, "rates");
  const locs = useLocations();
  const [p, setP] = useState<Purchase | null>(null);
  const [cam, setCam] = useState(false);
  const [q, setQ] = useState("");
  const [flash, setFlash] = useState("");
  const [supOpen, setSupOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLInputElement>(null);
  const products = useLiveQuery(() => db.products.filter(x => !x.deleted).toArray(), [], []);
  const recent = useLiveQuery(() => db.purchases.where("status").equals("final").reverse().sortBy("at"), [], []);

  useEffect(() => { (async () => {
    const d = await getSetting<Purchase | null>("draft_stockin", null);
    setP(d && d.status === "draft" ? d : newPurchase(me?.id || "", await getSetting("scan_loc", "")));
    setCam(await getSetting("stockin_cam", false));
  })(); }, []);
  useEffect(() => { if (p) setSetting("draft_stockin", p); }, [p]);
  const t = useMemo(() => (p ? sum(p) : null), [p]);

  function add(prod: Product, created = false) {
    setP(x => {
      if (!x) return x;
      const same = x.items.find(l => l.product_id === prod.id);
      if (same) return { ...x, items: [{ ...same, ...(same.pack > 1 ? { pkts: same.pkts + 1 } : { qty: same.qty + 1 }) }, ...x.items.filter(l => l.id !== same.id)] };
      return { ...x, items: [lineOf(prod, created), ...x.items] };
    });
    setFlash(prod.id); setTimeout(() => setFlash(""), 600);
  }
  async function onCode(raw: string) {
    const r = raw.trim(); if (!r) return;
    if (r.startsWith(LOC_PREFIX)) {
      const l = locs.find(x => x.code === r.slice(LOC_PREFIX.length));
      if (l) { setP(x => x && { ...x, loc_id: l.id }); beep(); toast("Rack: " + l.code); } else { beep(false); toast("Unknown rack label", true); }
      return;
    }
    const { product, created } = await resolveScan(r, me?.id || "");
    if (!product) {
      const hits = products.filter(x => (x.style + " " + x.code + " " + x.item).toUpperCase().includes(r.toUpperCase()));
      if (hits.length === 1) { beep(); add(hits[0]); setQ(""); return; }
      beep(false); toast("Not recognised — use Scan & record for this one", true); return;
    }
    beep(true); add(product, created); setQ("");
    if (created) toast("New product: " + [product.item, product.style, product.color].filter(Boolean).join(" · "));
  }
  const setLine = (id: string, patch: Partial<PurchaseLine>) => setP(x => x && { ...x, items: x.items.map(l => (l.id === id ? { ...l, ...patch } : l)) });
  async function save() {
    if (!p || !t) return;
    if (!p.loc_id) return toast("Choose the rack this stock goes into", true);
    if (!t.items.length) return toast("Nothing scanned yet", true);
    setBusy(true);
    try {
      const done = await finalizePurchase(p);
      toast(`Saved ${done.no} · ${done.total_qty} pcs into ${locs.find(l => l.id === done.loc_id)?.code || "rack"}`);
      await setSetting("draft_stockin", null);
      setP(newPurchase(me?.id || "", p.loc_id));
      go("stockin/" + done.id);
    } finally { setBusy(false); }
  }

  if (!p || !t) return <div className="skel" style={{ height: 240 }} />;
  const rack = locs.find(l => l.id === p.loc_id);
  return (
    <div>
      <Head title="Stock in" sub="Stand at the rack, scan every packet, save once. New labels become products by themselves." />
      <div className="split">
        <div className="stack">
          <div className="card pad stack">
            <LocationSelect value={p.loc_id} onChange={v => setP({ ...p, loc_id: v })} label="Into rack / box (or scan the rack's QR)" buckets={false} />
            <div className="row scanrow">
              <div className="wedge grow">
                <Icon n="scan" size={20} />
                <input ref={box} autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Scan packet label (gun or camera)"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); onCode(q); } }} />
              </div>
              <button className={"btn " + (cam ? "p" : "")} onClick={() => { setCam(!cam); setSetting("stockin_cam", !cam); }}><Icon n="camera" size={18} />{cam ? "Camera on" : "Camera"}</button>
            </div>
            {cam && <CameraScanner onCode={c => onCode(c)} gap={1200} />}
            {!p.loc_id && <div className="note warn sm">Pick the rack first — every packet you scan goes there.</div>}
          </div>

          <div className="list">
            {t.items.map(l => (
              <div key={l.id} className="li" style={{ background: flash === l.product_id ? "var(--gold-l)" : undefined, transition: "background .4s" }}>
                <span className="grow" style={{ minWidth: 0 }}>
                  <b className="sm">{l.item || "—"}</b> <span className="mono sm">{l.style}</span> <span className="mut sm">{l.color}</span>
                  {l.isNew && <span className="pill gold" style={{ marginLeft: 6 }}>new</span>}
                  <div className="xs mut">{l.rate ? "sells " + rupees(l.rate) : "no rate yet"}{l.pack > 1 ? ` · ${l.pack} pcs / packet` : ""}</div>
                </span>
                {l.pack > 1
                  ? <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                      <button className="x" onClick={() => setLine(l.id, { pkts: Math.max(0, l.pkts - 1) })} aria-label="One less">−</button>
                      <input className="cell r" style={{ width: 52 }} inputMode="numeric" value={l.pkts} onChange={e => setLine(l.id, { pkts: parseInt(e.target.value) || 0 })} />
                      <span className="xs mut">pkt</span></span>
                  : <input className="cell r" style={{ width: 60 }} inputMode="numeric" value={l.qty} onChange={e => setLine(l.id, { qty: parseInt(e.target.value) || 0 })} />}
                <b className="mono" style={{ width: 56, textAlign: "right" }}>{lineQty(l)}</b>
                {seeCost && <input className="cell r" style={{ width: 70 }} inputMode="decimal" placeholder="cost" value={l.cost ? l.cost / 100 : ""} onChange={e => setLine(l.id, { cost: toPaise(e.target.value) })} />}
                <button className="x" aria-label="Remove" onClick={() => setP({ ...p, items: p.items.filter(x => x.id !== l.id) })}><Icon n="x" size={16} /></button>
              </div>))}
            {!t.items.length && <div className="empty"><b>Scan the first packet</b>Each scan adds one packet. Scan the same label again for the next packet.</div>}
          </div>
        </div>

        <aside className="stack">
          <div className="card pad stack">
            <div className="row between"><span className="mut sm">Into</span><b>{rack ? rack.code : "—"}</b></div>
            <div className="row between"><span className="mut sm">Lines</span><b className="mono">{t.items.length}</b></div>
            <div className="net"><span>PIECES</span><b>{t.total_qty.toLocaleString("en-IN")}</b></div>
            {seeCost && t.total_cost > 0 && <div className="row between"><span className="mut sm">Cost</span><b className="mono">{rupees(t.total_cost)}</b></div>}
            <button className="btn p big" disabled={busy} onClick={save}>Save stock in</button>
            <button className="btn" onClick={() => { if (confirm("Clear this list?")) setP(newPurchase(me?.id || "", p.loc_id)); }}>Clear</button>
          </div>
          <div className="card pad stack">
            <b className="sm">From a supplier? <span className="mut">(optional)</span></b>
            <button className="pos-cust" onClick={() => setSupOpen(true)}><span className="xs mut">Supplier</span><b>{p.supplier_name || "Choose supplier"}</b></button>
            <input className="in" placeholder="Supplier bill no." value={p.supplier_bill} onChange={e => setP({ ...p, supplier_bill: e.target.value })} />
            <PhotoButton value={p.photo_id} onChange={v => setP({ ...p, photo_id: v })} label="Photo of supplier bill" />
            <input className="in" placeholder="Note" value={p.note} onChange={e => setP({ ...p, note: e.target.value })} />
          </div>
          {recent.length > 0 && <div>
            <div className="eyebrow" style={{ margin: "0 4px 8px" }}>Recent stock-ins</div>
            <div className="list">{recent.slice(0, 6).map(r => (
              <a key={r.id} href={"#/stockin/" + r.id}><span className="grow"><b className="mono sm">{r.no}</b><div className="xs mut">{when(r.at)}{r.supplier_name ? " · " + r.supplier_name : ""}</div></span><b className="mono">{r.total_qty}</b><Icon n="chev" size={16} /></a>))}</div>
          </div>}
        </aside>
      </div>
      {supOpen && <SupplierPicker onPick={(id, name) => { setP({ ...p, supplier_id: id, supplier_name: name }); setSupOpen(false); box.current?.focus(); }} onClose={() => setSupOpen(false)} />}
    </div>
  );
}

function SupplierPicker({ onPick, onClose }: { onPick: (id: string | undefined, name: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const list = useLiveQuery(() => db.parties.filter(x => !x.deleted && x.kind === "supplier").toArray(), [], []);
  const shown = list.filter(x => !q || x.name.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Supplier" onClose={onClose}>
      <div className="stack">
        <input className="in" autoFocus placeholder="Supplier name" value={q} onChange={e => setQ(e.target.value)} />
        <div className="list">{shown.map(s => <button key={s.id} onClick={() => onPick(s.id, s.name)}><span className="grow b sm">{s.name}</span><span className="xs mut">{s.phone}</span></button>)}
          {!shown.length && <div className="empty">No supplier yet.</div>}</div>
        <div className="row">
          {q && <button className="btn p" onClick={async () => { const s = { ...newParty(q.toUpperCase()), kind: "supplier" as const }; await put("parties", s); onPick(s.id, s.name); }}>+ Add “{q.toUpperCase()}”</button>}
          <button className="btn" onClick={() => onPick(undefined, "")}>No supplier</button>
        </div>
      </div>
    </Modal>
  );
}

function StockInView({ id }: { id: string }) {
  const { me } = useApp();
  const p = useLiveQuery(() => db.purchases.get(id), [id]);
  const locs = useLocations();
  if (!p) return <div className="skel" style={{ height: 200 }} />;
  const created = p.items.filter(l => l.isNew);
  return (
    <div>
      <Head title={p.no} sub={`${when(p.at)} · into ${locs.find(l => l.id === p.loc_id)?.code || "—"}${p.supplier_name ? " · from " + p.supplier_name : ""}${p.supplier_bill ? " · bill " + p.supplier_bill : ""}`}>
        <button className="btn p" onClick={() => go("stockin")}><Icon n="plus" size={18} />New stock in</button>
      </Head>
      <div className="hero three">
        <div><span className="k">Pieces in</span><b>{p.total_qty.toLocaleString("en-IN")}</b><span className="xs">{p.items.length} lines</span></div>
        <div><span className="k">New products</span><b>{created.length}</b></div>
        <div><span className="k">{can(me, "rates") ? "Cost" : "Supplier"}</span><b style={{ fontSize: 20 }}>{can(me, "rates") ? rupees(p.total_cost) : p.supplier_name || "—"}</b></div>
      </div>
      <div className="list">{p.items.map(l => (
        <div key={l.id} className="li">
          <a className="grow" href={"#/product/" + l.product_id} style={{ textDecoration: "none" }}><b className="sm">{l.item}</b> <span className="mono sm">{l.style}</span> <span className="mut sm">{l.color}</span>{l.isNew && <span className="pill gold" style={{ marginLeft: 6 }}>new</span>}
            <div className="xs mut">{l.pack > 1 ? `${l.pkts} pkt × ${l.pack}` : `${l.qty} pcs`}</div></a>
          <b className="mono">{l.qty}</b>
          {l.isNew && <a className="btn sm" href={"#/labels/" + l.product_id}><Icon n="print" size={15} />Label</a>}
        </div>))}</div>
    </div>
  );
}
