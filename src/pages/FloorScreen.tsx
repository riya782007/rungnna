import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, deviceId, type Config, type Product } from "../lib/db";
import { storeStock } from "../lib/stores";
import { useApp, toast } from "../lib/app";
import { can } from "../lib/roles";
import { Head, Thumb } from "../components/common";
import { rupees, when } from "../lib/format";
import { cloudImage } from "../lib/listing";

/* Floor TV (owner's list R-172 … R-179, R-184): open this page on the Android TV's browser,
   sign in once, pick the floor → a full-screen slideshow of fresh arrivals (last 48 hours) and
   designs the owner wants pushed. Shows photo, code, pieces in stock, floor and selling rate —
   never the cost code or the supplier. A design leaves the show the moment its stock is 0.
   Every TV reports in every 2 minutes, so the owner sees which TVs are really on. */

type Playlist = { codes: string; until: string };
const DAY = 86400000;

export default function FloorScreen({ floor }: { floor: string }) {
  const { me } = useApp();
  const owner = can(me, "settings.manage");
  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], [] as Product[]);
  const locs = useLiveQuery(() => db.locations.filter(l => !l.deleted).toArray(), [], []);
  const cells = useLiveQuery(() => storeStock(), [], []);
  const pl = useLiveQuery(() => db.config.get("screen_playlist").then(r => (r?.value || { codes: "", until: "" }) as Playlist), [], { codes: "", until: "" } as Playlist);
  const beats = useLiveQuery(() => db.config.filter(c => c.id.startsWith("screen_beat:") && !c.deleted).toArray(), [], [] as Config[]);
  const [on, setOn] = useState(!!floor);
  const [i, setI] = useState(0);
  const [codes, setCodes] = useState(""); const [until, setUntil] = useState("");
  useEffect(() => { setCodes(pl.codes); setUntil(pl.until); }, [pl.codes, pl.until]);

  const slides = useMemo(() => {
    const floorOf = new Map(locs.map(l => [l.id, l]));
    const qty = new Map<string, { n: number; floors: Set<string> }>();
    for (const c of cells) { const l = floorOf.get(c.loc_id); if (!l || l.kind === "bucket" || c.qty <= 0) continue; const x = qty.get(c.product_id) || { n: 0, floors: new Set<string>() }; x.n += c.qty; if (l.floor) x.floors.add(l.floor); qty.set(c.product_id, x); }
    const pinned = new Set(pl.until && pl.until >= new Date().toISOString().slice(0, 10) ? pl.codes.toUpperCase().split(/[\s,]+/).filter(Boolean) : []);
    return products.filter(p => {
      const q = qty.get(p.id); if (!q || !cloudImage(p) && !p.photo_id) return false;
      if (floor && floor !== "all" && !q.floors.has(floor)) return false;
      return pinned.has((p.code || "").toUpperCase()) || Date.now() - Date.parse(p.created_at) < 2 * DAY;
    }).map(p => ({ p, ...qty.get(p.id)! })).sort((a, z) => z.p.created_at.localeCompare(a.p.created_at));
  }, [products, locs, cells, pl, floor]);

  useEffect(() => { if (!on) return; const t = setInterval(() => setI(x => x + 1), 6000); return () => clearInterval(t); }, [on]);
  useEffect(() => {
    if (!on) return;
    const beat = () => put("config", { id: "screen_beat:" + deviceId(), value: { floor: floor || "all", at: now(), by: me?.name || "" }, updated_at: now() } as Config);
    beat(); const t = setInterval(beat, 120000); return () => clearInterval(t);
  }, [on, floor]);

  if (on) {
    const s = slides.length ? slides[i % slides.length] : null;
    return <div onDoubleClick={() => { document.exitFullscreen?.().catch(() => {}); setOn(false); }} style={{ position: "fixed", inset: 0, zIndex: 9999, background: "#111", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", gap: "4vw", padding: "4vw" }}>
      {s ? <>
        <img src={cloudImage(s.p) || undefined} style={{ maxHeight: "80vh", maxWidth: "55vw", objectFit: "contain", borderRadius: 16, background: "#fff" }} alt="" />
        <div style={{ fontSize: "3.2vw", lineHeight: 1.3 }}>
          <div style={{ color: "#e7c26a", fontSize: "2vw", letterSpacing: 2 }}>NEW ARRIVAL · RUNGNNA</div>
          <div style={{ fontWeight: 700 }}>{s.p.content?.title || s.p.item}</div>
          <div>Code: <b>{s.p.code}</b></div>
          <div>Available: <b>{s.n} pcs</b></div>
          <div>Floor: <b>{[...s.floors].join(", ") || "—"}</b></div>
          {s.p.rate > 0 && <div>Rate: <b>{rupees(s.p.wholesale_rate || s.p.rate)}</b></div>}
          <div style={{ fontSize: "1.2vw", opacity: .6, marginTop: 24 }}>{(i % slides.length) + 1} / {slides.length} · double-tap to close</div>
        </div></> : <div style={{ fontSize: "3vw" }}>No new arrivals in the last 48 hours{floor ? ` on floor ${floor}` : ""}.</div>}
    </div>;
  }

  return <div>
    <Head eyebrow="Stock" title="Floor TV" sub="Open this page on each floor's Smart TV browser, sign in, choose the floor and press Start. New arrivals of the last 48 hours show by themselves; sold-out designs drop off.">
      <a className="btn p" href="#/screen/all" onClick={() => { setOn(true); document.documentElement.requestFullscreen?.().catch(() => {}); }}>Start (all floors)</a>
    </Head>
    <div className="card pad stack" style={{ marginBottom: 12 }}>
      <b className="sm">Start on one floor</b>
      <div className="row">{["G", "1", "2", "3", "4"].map(f => <a key={f} className="btn" href={"#/screen/" + f} onClick={() => { setOn(true); document.documentElement.requestFullscreen?.().catch(() => {}); }}>Floor {f}</a>)}</div>
      <div className="xs mut">{slides.length} designs in the show right now. Only photo, code, pieces, floor and selling rate are shown — never cost code or supplier.</div>
    </div>
    {owner && <div className="card pad stack" style={{ marginBottom: 12 }}>
      <b className="sm">Also show these designs (old stock to push)</b>
      <textarea className="in mono" rows={2} placeholder="Product codes, e.g. RU1023 RU1044" value={codes} onChange={e => setCodes(e.target.value)} />
      <label className="f">Show until (then removed by itself)<input className="in" type="date" value={until} onChange={e => setUntil(e.target.value)} /></label>
      <button className="btn" onClick={async () => { await put("config", { id: "screen_playlist", value: { codes, until }, updated_at: now() } as Config); toast("Saved — TVs pick it up in a minute"); }}>Save</button>
    </div>}
    <div className="card"><header><h3>TVs switched on</h3></header><div className="pad stack" style={{ gap: 6 }}>
      {beats.map(b => { const v = b.value || {}; const live = Date.now() - Date.parse(v.at) < 5 * 60000; return <div key={b.id} className="item sm"><span className={"pill " + (live ? "ok" : "bad")}>{live ? "ON" : "OFF"}</span><span className="grow">Floor {v.floor} · last seen {when(v.at)}</span></div>; })}
      {!beats.length && <div className="xs mut">No TV has opened this page yet.</div>}
    </div></div>
    <div className="list">{slides.slice(0, 30).map(s => <div key={s.p.id} className="item"><Thumb photo_id={s.p.photo_id} url={cloudImage(s.p)} size={40} /><span className="grow sm">{s.p.item} <span className="mono xs">{s.p.code}</span><div className="xs mut">{s.n} pcs · floor {[...s.floors].join(", ")}</div></span></div>)}</div>
  </div>;
}
