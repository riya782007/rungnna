import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type StoreTransfer } from "../lib/db";
import { createStore, currentStore, inStore, dispatchTransfer, receiveTransfer } from "../lib/stores";
import { findByScan } from "../lib/products";
import { isRfidTag, normTag } from "../lib/rfid";
import { useApp, toast } from "../lib/app";
import { Head, LocationSelect } from "../components/common";
import { CameraScanner } from "../components/Scanner";
export default function Stores() {
  const { me } = useApp(); const owner = me?.role === "owner";
  const stores = useLiveQuery(() => db.stores.filter(s => !s.deleted && !!s.active).toArray(), [], []);
  const staff = useLiveQuery(() => db.staff.filter(s => !s.deleted).toArray(), [], []);
  const transfers = useLiveQuery(() => db.store_transfers.filter(t => !t.deleted && (t.from_store === currentStore() || t.to_store === currentStore())).reverse().sortBy("at"), [], []);
  const [name, setName] = useState(""), [code, setCode] = useState(""), [dest, setDest] = useState(""), [rack, setRack] = useState(""), [items, setItems] = useState<StoreTransfer["items"]>([]), [scan, setScan] = useState(false), [raw, setRaw] = useState(""), [busy, setBusy] = useState(false), [racks, setRacks] = useState<Record<string, string>>({});
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const add = async (raw: string) => { if (!rack) throw new Error("Choose source rack first"); const tag = isRfidTag(raw) ? normTag(raw) : "", p = await findByScan(raw); if (!p) throw new Error("Item not found"); setItems(rows => { if (tag && rows.some(r => r.tags?.includes(tag))) return rows; const old = rows.find(r => r.product_id === p.id && r.from_loc === rack); return old ? rows.map(r => r === old ? { ...r, qty: r.qty + 1, tags: tag ? [...(r.tags || []), tag] : r.tags } : r) : [...rows, { product_id: p.id, qty: 1, from_loc: rack, tags: tag ? [tag] : undefined }]; }); setRaw(""); };
  const products = useLiveQuery(() => db.products.toArray(), [], []);
  return <div className="stack"><Head title={owner ? "Stores & transfers" : "Stock transfers"} />
    {owner && <section className="stack"><h3>Branches</h3><div className="grid g3"><input className="in" aria-label="Branch name" placeholder="Branch name" value={name} onChange={e => setName(e.target.value)} /><input className="in" aria-label="Branch code" placeholder="Code" maxLength={4} value={code} onChange={e => setCode(e.target.value.toUpperCase())} /><button className="btn p" disabled={busy} onClick={() => run(async () => { await createStore(name, code); setName(""); setCode(""); toast("Branch created"); })}>Add branch</button></div>
      {stores.map(s => <div className="row" key={s.id}><b>{s.code} · {s.name}</b><input className="in grow" aria-label={`${s.name} address`} defaultValue={s.address} onBlur={e => put("stores", { ...s, address: e.target.value })} /></div>)}
      <h3>Staff assignments</h3>{staff.map(s => <label className="row" key={s.id}><span className="grow">{s.name} · {s.role}</span><select className="in" value={s.store_id || stores.find(s => s.code === "MAIN")?.id || ""} onChange={e => put("staff", { ...s, store_id: e.target.value })}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>)}
    </section>}
    <section className="stack"><h3>Transfer out</h3><label className="f">Destination store<select className="in" value={dest} onChange={e => setDest(e.target.value)}><option value="">Choose branch</option>{stores.filter(s => s.id !== currentStore()).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <LocationSelect value={rack} onChange={setRack} buckets={false} label="Source rack" />
      <form className="row" onSubmit={e => { e.preventDefault(); run(() => add(raw)); }}><input className="in grow" value={raw} onChange={e => setRaw(e.target.value)} placeholder="Item barcode / RFID" /><button className="btn" disabled={busy || !raw}>Add</button><button type="button" className="btn" onClick={() => setScan(true)}>Scan</button></form>
      {items.map((item, i) => <div className="row" key={i}><span className="grow">{products.find(p => p.id === item.product_id)?.item} · {products.find(p => p.id === item.product_id)?.code}</span><input aria-label="Pieces" className="in" style={{ width: 90 }} type="number" min={1} disabled={!!item.tags?.length} value={item.qty} onChange={e => setItems(items.map((x, j) => j === i ? { ...x, qty: Number(e.target.value) } : x))} /><button className="btn" onClick={() => setItems(items.filter((_, j) => j !== i))}>Remove</button></div>)}
      <button className="btn p" disabled={busy || !dest || !items.length} onClick={() => run(async () => { await dispatchTransfer(dest, items, me!.id); setItems([]); toast("Stock in transit"); })}>Dispatch transfer</button>
    </section>
    <section className="stack"><h3>Transfers</h3>{transfers.map(t => <div className="stack transfer-row" key={t.id}><div className="row"><b>{t.no}</b><span>{stores.find(s => s.id === t.from_store)?.name} → {stores.find(s => s.id === t.to_store)?.name}</span><span className="pill">{t.status.replace(/_/g, " ")}</span></div>
      {t.status === "in_transit" && t.to_store === currentStore() && <>{t.items.map((x, i) => <LocationSelect key={i} value={racks[t.id + i] || ""} onChange={v => setRacks({ ...racks, [t.id + i]: v })} label={`${products.find(p => p.id === x.product_id)?.item || "Item"} · ${x.qty} pcs`} buckets={false} />)}<button className="btn p" disabled={busy || t.items.some((_, i) => !racks[t.id + i])} onClick={() => run(async () => { await receiveTransfer(t.id, Object.fromEntries(t.items.map((_, i) => [String(i), racks[t.id + i]])), me!.id); toast("Stock received"); })}>Receive into racks</button></>}
    </div>)}</section>
    {scan && <section className="stack"><CameraScanner onCode={r => run(() => add(r))} paused={busy} /><button className="btn" onClick={() => setScan(false)}>Close camera</button></section>}
  </div>;
}
