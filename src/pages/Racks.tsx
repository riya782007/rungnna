import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, uid, now, type Location } from "../lib/db";
import { Head, LOC_PREFIX, useLocations, locName, Thumb, Modal } from "../components/common";
import { qrSvg } from "../lib/qr";
import { toast, go } from "../lib/app";
import { label } from "../lib/products";

const FLOORS = [["G", "Ground"], ["1", "Floor 1"], ["2", "Floor 2"], ["3", "Floor 3"], ["4", "Floor 4 (backend)"], ["GD", "Godown"]];

export const codeFor = (floor: string, rack: string, box: string) =>
  [floor === "G" ? "G" : floor === "GD" ? "GD" : "F" + floor, rack && "R" + rack.padStart(2, "0"), box && "B" + box.padStart(2, "0")].filter(Boolean).join("-");

export default function Racks({ args }: { args: string[] }) {
  const locs = useLocations();
  const cells = useLiveQuery(() => db.stock.toArray(), [], []);
  const [floor, setFloor] = useState("1");
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("12");
  const [boxes, setBoxes] = useState("0");
  const [name, setName] = useState("");
  const [printSel, setPrintSel] = useState<Location[] | null>(null);
  const open = args[0] ? locs.find(l => l.id === args[0]) : undefined;

  const qtyAt = useMemo(() => { const m = new Map<string, number>(); cells.forEach(c => m.set(c.loc_id, (m.get(c.loc_id) || 0) + c.qty)); return m; }, [cells]);

  const create = async () => {
    const a = parseInt(from) || 1, b = parseInt(to) || a, nb = parseInt(boxes) || 0;
    if (b - a > 60 || nb > 40) { toast("That is a lot of racks — create them in smaller groups", true); return; }
    let made = 0;
    for (let r = a; r <= b; r++) {
      const list = nb ? Array.from({ length: nb }, (_, i) => String(i + 1)) : [""];
      for (const bx of list) {
        const code = codeFor(floor, String(r), bx);
        if (await db.locations.where("code").equals(code).first()) continue;
        await put("locations", { id: uid(), code, floor, rack: String(r), box: bx, name, kind: floor === "GD" ? "godown" : "rack", updated_at: now() } as Location);
        made++;
      }
    }
    toast(made ? `${made} locations created` : "They already exist");
  };

  const byFloor = FLOORS.map(([f, n]) => ({ f, n, list: locs.filter(l => l.floor === f && l.kind !== "bucket") })).filter(x => x.list.length);
  const buckets = locs.filter(l => l.kind === "bucket");

  return (
    <div>
      <Head eyebrow="Shop floor" title="Floors & racks" sub="Every rack and box gets a code and its own QR sticker. Scan the rack sticker first, then the products — the app knows exactly where each piece sits.">
        {locs.length > 3 && <button className="btn" onClick={() => setPrintSel(locs.filter(l => l.kind !== "bucket"))}>Print all rack QR stickers</button>}
      </Head>
      <div className="split">
        <div className="stack">
          {byFloor.length === 0 && <div className="card pad mut">No racks yet. Create them on the right — e.g. Floor 1, racks 1 to 12.</div>}
          {byFloor.map(g => (
            <div key={g.f} className="card">
              <header><h3>{g.n}</h3><span className="pill">{g.list.length} places</span>
                <span className="pill ok">{g.list.reduce((a, l) => a + (qtyAt.get(l.id) || 0), 0)} pcs</span>
                <button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setPrintSel(g.list)}>Print stickers</button></header>
              <div className="pad" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(104px,1fr))", gap: 8 }}>
                {g.list.map(l => (
                  <button key={l.id} className="item" style={{ flexDirection: "column", alignItems: "flex-start", gap: 2 }} onClick={() => go("racks/" + l.id)}>
                    <span className="mono b">{l.code}</span>
                    <span className="xs mut">{qtyAt.get(l.id) || 0} pcs{l.name ? " · " + l.name : ""}</span>
                  </button>))}
              </div>
            </div>))}
          <div className="card">
            <header><h3>Status buckets</h3></header>
            <div className="pad stack" style={{ gap: 6 }}>
              {buckets.map(l => <button key={l.id} className="item" onClick={() => go("racks/" + l.id)}><span className="grow">{l.name}</span><span className="mono b">{qtyAt.get(l.id) || 0}</span></button>)}
            </div>
          </div>
        </div>
        <div className="card">
          <header><h3>Add racks / boxes</h3></header>
          <div className="pad stack">
            <label className="f">Floor<select className="in" value={floor} onChange={e => setFloor(e.target.value)}>{FLOORS.map(([f, n]) => <option key={f} value={f}>{n}</option>)}</select></label>
            <div className="grid g3">
              <label className="f">Rack from<input className="in mono" value={from} inputMode="numeric" onChange={e => setFrom(e.target.value)} /></label>
              <label className="f">Rack to<input className="in mono" value={to} inputMode="numeric" onChange={e => setTo(e.target.value)} /></label>
              <label className="f">Boxes per rack<input className="in mono" value={boxes} inputMode="numeric" onChange={e => setBoxes(e.target.value)} /></label>
            </div>
            <label className="f">Name (optional)<input className="in" value={name} placeholder="Bridal wall, bangle wall…" onChange={e => setName(e.target.value)} /></label>
            <div className="note">Will create codes like <b className="mono">{codeFor(floor, from || "1", parseInt(boxes) ? "1" : "")}</b> … <b className="mono">{codeFor(floor, to || "1", parseInt(boxes) ? boxes : "")}</b></div>
            <button className="btn p" onClick={create}>Create</button>
          </div>
        </div>
      </div>
      {open && <LocationDetail loc={open} onClose={() => go("racks")} />}
      {printSel && <RackStickers list={printSel} onDone={() => setPrintSel(null)} />}
    </div>
  );
}

function LocationDetail({ loc, onClose }: { loc: Location; onClose: () => void }) {
  const rows = useLiveQuery(async () => {
    const cells = (await db.stock.where("loc_id").equals(loc.id).toArray()).filter(c => c.qty !== 0);
    const prods = await db.products.bulkGet(cells.map(c => c.product_id));
    return cells.map((c, i) => ({ c, p: prods[i] })).filter(x => x.p);
  }, [loc.id], []);
  const [nm, setNm] = useState(loc.name);
  return (
    <Modal title={locName(loc)} onClose={onClose}>
      <div className="stack">
        <div className="row"><input className="in grow" value={nm} onChange={e => setNm(e.target.value)} placeholder="Name this place" />
          <button className="btn sm" onClick={async () => { await put("locations", { ...loc, name: nm }); toast("Saved"); }}>Save name</button></div>
        <div className="xs mut">{rows.length} products · {rows.reduce((a, r) => a + r.c.qty, 0)} pieces</div>
        {rows.map(({ c, p }) => (
          <button key={c.key} className="item" onClick={() => go("product/" + p!.id)}>
            <Thumb photo_id={p!.photo_id} url={p!.photo_url} text={p!.item} size={40} />
            <span className="grow sm">{label(p!)}</span><span className="mono b">{c.qty}</span>
          </button>))}
      </div>
    </Modal>
  );
}

function RackStickers({ list, onDone }: { list: Location[]; onDone: () => void }) {
  // 50 × 25 mm stickers — big QR + big code, readable from a metre away
  useEffect(() => { const t = setTimeout(() => { window.print(); onDone(); }, 150); return () => clearTimeout(t); }, []);
  return createPortal(<>
    <style>{`@page{size:50mm 25mm;margin:0}`}</style>
    {list.map(l => (
      <div key={l.id} style={{ width: "50mm", height: "25mm", display: "flex", alignItems: "center", gap: "2mm", padding: "1.5mm", pageBreakAfter: "always", fontFamily: "Arial" }}>
        <div style={{ width: "22mm", height: "22mm" }} dangerouslySetInnerHTML={{ __html: qrSvg(LOC_PREFIX + l.code, "Q").svg.replace("<svg ", '<svg width="100%" height="100%" ') }} />
        <div><div style={{ fontSize: "7pt", letterSpacing: ".1em" }}>RUNGNNA · RACK</div><div style={{ fontSize: "15pt", fontWeight: 800 }}>{l.code}</div>
          {l.name && <div style={{ fontSize: "7pt" }}>{l.name}</div>}</div>
      </div>))}
  </>, document.getElementById("printroot")!);
}
