import { useEffect, useState } from "react";
import { db, recordMovement, stockOf, getSetting, setSetting, type MoveKind, type PersonType, type Product, type StockCell } from "../lib/db";
import { findByScan, label } from "../lib/products";
import { Head, LocationSelect, PhotoButton, Thumb, LOC_PREFIX, useLocations, locName } from "../components/common";
import { WedgeInput, CameraScanner } from "../components/Scanner";
import { useApp, toast, beep } from "../lib/app";

const KINDS: [MoveKind, string, string][] = [
  ["transfer", "Move / transfer", "From one rack to another (or to the counter)"],
  ["damage", "Damaged", "Take it off the floor into quarantine"],
  ["missing", "Missing / stolen", "Could not be found in the count"],
  ["found", "Found", "A missing piece turned up"],
  ["return", "Customer return", "Came back from a customer"],
  ["adjust", "Correction", "Count was wrong — fix it with a reason"],
];

type Line = { p: Product; qty: number; stock: StockCell[] };

export default function Move({ args }: { args: string[] }) {
  const { me } = useApp();
  const locs = useLocations();
  const [kind, setKind] = useState<MoveKind>("transfer");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [ptype, setPtype] = useState<PersonType>("employee");
  const [pname, setPname] = useState("");
  const [photo, setPhoto] = useState<string | undefined>();
  const [note, setNote] = useState("");
  const [cam, setCam] = useState(false);
  const [busy, setBusy] = useState(false);
  const bucket = (code: string) => locs.find(l => l.code === code)?.id || "";

  useEffect(() => { getSetting("move_from", "").then(setFrom); }, []);
  useEffect(() => { if (args[0]) db.products.get(args[0]).then(p => p && addProduct(p)); }, [args[0]]);
  useEffect(() => {
    if (kind === "damage") setTo(bucket("DAMAGED"));
    if (kind === "missing") setTo(bucket("MISSING"));
    if (kind === "found") setFrom(bucket("MISSING"));
  }, [kind, locs.length]);

  const addProduct = async (p: Product) => {
    const stock = await stockOf(p.id);
    setLines(ls => { const i = ls.findIndex(l => l.p.id === p.id); if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], qty: c[i].qty + 1 }; return c; } return [...ls, { p, qty: 1, stock }]; });
    if (!from && stock.length === 1) setFrom(stock[0].loc_id);
  };

  const onCode = async (raw: string) => {
    if (raw.startsWith(LOC_PREFIX)) {
      const l = locs.find(x => x.code === raw.slice(LOC_PREFIX.length));
      if (!l) { beep(false); return; }
      beep(); if (!from) { setFrom(l.id); toast("From: " + l.code); } else { setTo(l.id); toast("To: " + l.code); }
      return;
    }
    const p = await findByScan(raw);
    if (!p) { beep(false); toast("Not in the system — record it on Scan & record first", true); return; }
    beep(); addProduct(p);
  };


  const save = async () => {
    if (!lines.length) { toast("Scan at least one product", true); return; }
    if (kind === "transfer" && (!from || !to || from === to)) { toast("Choose a different From and To", true); return; }
    if (kind === "adjust" && !note.trim()) { toast("Write the reason for the correction", true); return; }
    if (["customer", "supplier", "helper"].includes(ptype) && !pname.trim()) { toast("Write the person's name", true); return; }
    setBusy(true);
    try {
      for (const l of lines) {
        if (l.qty === 0) continue;
        const adjDown = kind === "adjust" && l.qty < 0;
        await recordMovement({
          product_id: l.p.id, kind, qty: Math.abs(l.qty),
          from_loc: kind === "return" ? null : kind === "adjust" ? (adjDown ? from || to : null) : from || null,
          to_loc: kind === "adjust" ? (adjDown ? null : to || from) : to || null,
          person_type: ptype, person_name: pname.trim() || me?.name || "", by_staff: me?.id || "", photo_id: photo, note: note.trim(),
        });
      }
      setSetting("move_from", from);
      toast(`${lines.reduce((a, l) => a + l.qty, 0)} pcs recorded · ${KINDS.find(k => k[0] === kind)![1]}`);
      setLines([]); setNote(""); setPhoto(undefined);
    } finally { setBusy(false); }
  };

  return (
    <div>
      <Head eyebrow="Stock movement" title="Move & transfer" sub="Every piece that changes place leaves a line: what, how many, from where, to where, who carried it, when, and a photo if you want proof." />
      <div className="split">
        <div className="stack">
          <div className="card pad stack">
            <div className="chips">{KINDS.map(([k, t]) => <button key={k} className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{t}</button>)}</div>
            <div className="xs mut">{KINDS.find(k => k[0] === kind)![2]}</div>
            <div className="grid g2">
              {kind !== "return" && <LocationSelect value={from} onChange={setFrom} label={kind === "adjust" ? "Rack" : "From"} />}
              {kind !== "adjust" && <LocationSelect value={to} onChange={setTo} label="To" />}
            </div>
            <WedgeInput onCode={onCode} placeholder="Scan products (and rack stickers for From / To)" />
            <button className="btn sm" onClick={() => setCam(!cam)}>{cam ? "Hide camera" : "Use phone camera"}</button>
            {cam && <CameraScanner onCode={onCode} />}
          </div>
        </div>
        <div className="card">
          <header><h3>Pieces</h3><span className="pill">{lines.reduce((a, l) => a + l.qty, 0)} pcs</span></header>
          <div className="pad stack">
            {!lines.length && <div className="mut sm">Scan the products you are moving.</div>}
            {lines.map((l, i) => (
              <div key={l.p.id} className="item">
                <Thumb photo_id={l.p.photo_id} url={l.p.photo_url} text={l.p.item} size={40} />
                <div className="grow sm"><div className="b">{label(l.p)}</div>
                  <div className="xs mut">{l.stock.map(s => `${locs.find(x => x.id === s.loc_id)?.code || "?"}: ${s.qty}`).join(" · ") || "no stock recorded"}</div></div>
                <input className="in mono" style={{ width: 70 }} inputMode="numeric" value={l.qty}
                  onChange={e => setLines(ls => ls.map((x, k) => k === i ? { ...x, qty: parseInt(e.target.value.replace(/[^\d-]/g, "")) || 0 } : x))} />
                <button className="btn sm bad" onClick={() => setLines(ls => ls.filter((_, k) => k !== i))}>✕</button>
              </div>))}
            {kind === "adjust" && <div className="xs mut">For a correction, a positive number adds pieces to the rack; type a minus (e.g. -3) to take pieces off.</div>}
            <div className="grid g2">
              <label className="f">Who carried / handled it
                <select className="in" value={ptype} onChange={e => setPtype(e.target.value as PersonType)}>
                  <option value="employee">Employee</option><option value="helper">Helper</option><option value="customer">Customer</option><option value="supplier">Supplier</option><option value="owner">Owner</option>
                </select></label>
              <label className="f">Name<input className="in" value={pname} placeholder={me?.name || "Name"} onChange={e => setPname(e.target.value)} /></label>
            </div>
            <label className="f">Note<input className="in" value={note} onChange={e => setNote(e.target.value)} placeholder={kind === "adjust" ? "Reason (required)" : "Optional"} /></label>
            <PhotoButton value={photo} onChange={setPhoto} label="Proof photo" />
            <div className="xs mut">{from && `From ${locName(locs.find(l => l.id === from))}`} {to && ` → ${locName(locs.find(l => l.id === to))}`} · recorded by {me?.name} · {new Date().toLocaleString("en-IN")}</div>
            <button className="btn p big" disabled={busy || !lines.length} onClick={save}>Save movement</button>
          </div>
        </div>
      </div>
    </div>
  );
}
