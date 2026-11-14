import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { db, now, type Party } from "../lib/db";
import { useApp, toast } from "../lib/app";
import { Head, Modal, PhotoButton, Thumb } from "../components/common";
import { SpeakText } from "../components/Voice";
import { balances } from "../lib/ledger";
import { customerStats, type CustomerStat } from "../lib/customerRank";
import { allGeo, saveGeo, lookup, here, planTour, mapsLinks, km, SHOP, saveTour, listTours, type Geo, type Tour, type Pt } from "../lib/tour";
import { rupees, when } from "../lib/format";
import { can } from "../lib/roles";
import { waShare } from "../lib/listing";

/* Map of customers + AI-style tour planner (owner's list R-108, R-109, R-110, R-201). */
export default function TourPage() {
  const { me } = useApp();
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted && p.kind !== "supplier").toArray(), [], [] as Party[]);
  const staff = useLiveQuery(() => db.staff.filter(s => !s.deleted && s.active === 1 && s.login !== "role").toArray(), [], []);
  const geoStamp = useLiveQuery(() => db.config.filter(c => c.id.startsWith("geo:") || c.id.startsWith("tour:")).toArray().then(r => r.map(x => x.updated_at).join()), [], "");
  const [geo, setGeo] = useState<Map<string, Geo>>(new Map());
  const [stats, setStats] = useState<Map<string, CustomerStat>>(new Map());
  const [due, setDue] = useState<Map<string, number>>(new Map());
  const [tours, setTours] = useState<Tour[]>([]);
  const [f, setF] = useState({ q: "", state: "", city: "", grade: "", dues: false, gone: false });
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [plan, setPlan] = useState<{ order: Pt[]; km: number } | null>(null);
  const [finding, setFinding] = useState("");
  const [open, setOpen] = useState<Tour | null>(null);
  useEffect(() => { allGeo().then(setGeo); listTours().then(setTours); }, [geoStamp]);
  useEffect(() => { customerStats().then(r => setStats(new Map(r.map(x => [x.party_id, x])))); balances().then(setDue); }, [parties.length]);

  const states = useMemo(() => [...new Set(parties.map(p => p.state).filter(Boolean))].sort(), [parties]);
  const cities = useMemo(() => [...new Set(parties.filter(p => !f.state || p.state === f.state).map(p => (p.city || "").toUpperCase()).filter(Boolean))].sort(), [parties, f.state]);
  const list = useMemo(() => parties.filter(p => {
    const s = stats.get(p.id);
    return (!f.q || `${p.name} ${p.phone} ${p.city} ${p.address} ${p.pin} ${s?.top.join(" ") || ""}`.toLowerCase().includes(f.q.toLowerCase()))
      && (!f.state || p.state === f.state) && (!f.city || (p.city || "").toUpperCase() === f.city)
      && (!f.grade || s?.grade === f.grade) && (!f.dues || (due.get(p.id) || 0) > 0) && (!f.gone || s?.notReturning);
  }).sort((a, z) => (stats.get(a.id)?.rank || 1e9) - (stats.get(z.id)?.rank || 1e9)), [parties, f, stats, due]);
  const onMap = list.filter(p => geo.has(p.id));
  const noPlace = list.filter(p => !geo.has(p.id) && (p.pin || p.city));

  const findAll = async () => {
    let ok = 0;
    for (const [i, p] of noPlace.slice(0, 200).entries()) {
      setFinding(`Finding ${i + 1} of ${Math.min(noPlace.length, 200)} · ${p.name}`);
      const g = await lookup(p); if (g) { await saveGeo(p.id, g); ok++; }
    }
    setFinding(""); toast(`${ok} customers put on the map`); setGeo(await allGeo());
  };
  const doPlan = () => {
    const stops = [...pick].map(id => geo.get(id) && { id, lat: geo.get(id)!.lat, lng: geo.get(id)!.lng }).filter(Boolean) as Pt[];
    if (stops.length < 1) return toast("Tick customers that are on the map", true);
    setPlan(planTour(stops));
  };
  const byId = new Map(parties.map(p => [p.id, p]));
  const tourText = (order: Pt[], dist: number) => `Tour · ${order.length} stops · about ${Math.round(dist * 1.3)} km\n` +
    order.map((x, i) => `${i + 1}. ${byId.get(x.id)?.name} — ${byId.get(x.id)?.city || ""} ${byId.get(x.id)?.phone || ""}`).join("\n") + "\n\nMap: " + mapsLinks(order).join("\n");

  return <div>
    <Head eyebrow="Customers" title="Map & tour" sub={`${onMap.length} of ${list.length} shown customers are on the map. Tick customers → Plan tour → best order + Google Maps route.`}>
      {noPlace.length > 0 && <button className="btn" disabled={!!finding} onClick={findAll}>Put {Math.min(noPlace.length, 200)} on map (from PIN)</button>}
    </Head>
    {finding && <div className="note sm" style={{ marginBottom: 8 }}>{finding}</div>}
    <div className="split">
      <div className="stack">
        <div className="card pad stack">
          <input className="in" placeholder="Search name, mobile, area, PIN, item they buy" value={f.q} onChange={e => setF({ ...f, q: e.target.value })} />
          <div className="grid g3">
            <select className="in" value={f.state} onChange={e => setF({ ...f, state: e.target.value, city: "" })}><option value="">All states</option>{states.map(s => <option key={s}>{s}</option>)}</select>
            <select className="in" value={f.city} onChange={e => setF({ ...f, city: e.target.value })}><option value="">All cities</option>{cities.map(s => <option key={s}>{s}</option>)}</select>
            <select className="in" value={f.grade} onChange={e => setF({ ...f, grade: e.target.value })}><option value="">All ranks</option><option>A</option><option>B</option><option>C</option><option>New</option></select>
          </div>
          <div className="row">
            {can(me, "customers.dues") && <button className="chip" aria-pressed={f.dues} onClick={() => setF({ ...f, dues: !f.dues })}>With dues</button>}
            <button className="chip" aria-pressed={f.gone} onClick={() => setF({ ...f, gone: !f.gone })}>Not coming back</button>
            <span className="grow" />
            <button className="linkbtn" onClick={() => setPick(new Set(onMap.map(p => p.id)))}>Tick all on map</button>
            <button className="linkbtn" onClick={() => { setPick(new Set()); setPlan(null); }}>Clear</button>
          </div>
          <button className="btn p" disabled={!pick.size} onClick={doPlan}>Plan tour ({pick.size})</button>
        </div>
        <div className="list" style={{ maxHeight: 420, overflow: "auto" }}>
          {list.slice(0, 400).map(p => { const s = stats.get(p.id), g = geo.get(p.id); return (
            <label key={p.id} className="item" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={pick.has(p.id)} disabled={!g} onChange={() => { const n = new Set(pick); n.has(p.id) ? n.delete(p.id) : n.add(p.id); setPick(n); setPlan(null); }} />
              <span className="grow sm"><b>{p.name}</b> {s && <span className="pill">{s.grade}</span>}
                <div className="xs mut">{[p.city, p.state, p.pin].filter(Boolean).join(" · ") || "no address"}{(due.get(p.id) || 0) > 0 && can(me, "customers.dues") ? ` · due ${rupees(due.get(p.id)!)}` : ""}{g ? "" : " · not on map"}</div></span>
              <button className="linkbtn xs" onClick={async e => { e.preventDefault(); try { const h = await here(); await saveGeo(p.id, { ...h, src: "gps" }); toast(`${p.name}: exact spot saved`); setGeo(await allGeo()); } catch (x: any) { toast(x.message, true); } }}>I am here</button>
            </label>); })}
        </div>
      </div>
      <div className="stack">
        <CustomerMap points={onMap.map(p => ({ id: p.id, name: p.name, g: geo.get(p.id)!, grade: stats.get(p.id)?.grade || "", picked: pick.has(p.id) }))} route={plan?.order} />
        {plan && <div className="card pad stack">
          <b>Best order · {plan.order.length} stops · about {Math.round(plan.km * 1.3)} km by road (from the shop and back)</b>
          <ol className="sm" style={{ margin: 0, paddingLeft: 18 }}>{plan.order.map((x, i) => <li key={x.id}>{byId.get(x.id)?.name} <span className="xs mut">{byId.get(x.id)?.city} · {(km(i ? plan.order[i - 1] : SHOP, x) * 1.3).toFixed(1)} km</span></li>)}</ol>
          <div className="row">
            {mapsLinks(plan.order).map((u, i, a) => <a key={u} className="btn g" href={u} target="_blank" rel="noopener">Google Maps{a.length > 1 ? ` part ${i + 1}` : ""}</a>)}
            <a className="btn" href={waShare(tourText(plan.order, plan.km))} target="_blank" rel="noopener">Send on WhatsApp</a>
            <button className="btn p" onClick={async () => {
              const who = (document.getElementById("tour-who") as HTMLSelectElement)?.value || me?.name || "";
              const t: Tour = { id: crypto.randomUUID(), name: `${plan.order.length} stops · ${[...new Set(plan.order.map(x => byId.get(x.id)?.city).filter(Boolean))].slice(0, 3).join(", ")}`, date: new Date().toISOString().slice(0, 10), salesman: who, stops: plan.order.map(x => x.id), km: plan.km, created_at: now(), visits: [] };
              await saveTour(t); toast("Tour saved — open it on the phone during the visit"); setTours(await listTours());
            }}>Save tour</button>
            <select id="tour-who" className="in" style={{ width: "auto" }} defaultValue={me?.name}>{staff.map(s => <option key={s.id}>{s.name}</option>)}</select>
          </div>
        </div>}
        <div className="card"><header><h3>Saved tours</h3></header><div className="pad stack" style={{ gap: 6 }}>
          {tours.slice(0, 20).map(t => <div key={t.id} className="item"><span className="grow sm"><b>{t.name}</b><div className="xs mut">{t.date} · {t.salesman} · {t.visits.length}/{t.stops.length} visited</div></span><button className="btn sm" onClick={() => setOpen(t)}>Open</button></div>)}
          {!tours.length && <div className="xs mut">No tours yet.</div>}
        </div></div>
      </div>
    </div>
    {open && <TourView tour={open} parties={byId} onClose={() => { setOpen(null); listTours().then(setTours); }} />}
  </div>;
}

function CustomerMap({ points, route }: { points: { id: string; name: string; g: Geo; grade: string; picked: boolean }[]; route?: Pt[] }) {
  const el = useRef<HTMLDivElement>(null), map = useRef<L.Map | null>(null), layer = useRef<L.LayerGroup | null>(null);
  useEffect(() => {
    if (!el.current || map.current) return;
    map.current = L.map(el.current).setView([SHOP.lat, SHOP.lng], 5);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map.current);
    layer.current = L.layerGroup().addTo(map.current);
    return () => { map.current?.remove(); map.current = null; };
  }, []);
  useEffect(() => {
    const m = map.current, g = layer.current; if (!m || !g) return;
    g.clearLayers();
    L.circleMarker([SHOP.lat, SHOP.lng], { radius: 9, color: "#7a1f2b", fillOpacity: 1 }).bindTooltip("Rungnna — shop").addTo(g);
    const col: Record<string, string> = { A: "#1f8a4c", B: "#c99a2e", C: "#888", New: "#2f6fd6" };
    for (const p of points) L.circleMarker([p.g.lat, p.g.lng], { radius: p.picked ? 9 : 6, color: p.picked ? "#000" : col[p.grade] || "#888", weight: p.picked ? 3 : 1, fillColor: col[p.grade] || "#888", fillOpacity: 0.85 }).bindTooltip(`${p.name}${p.grade ? " · " + p.grade : ""}${p.g.src === "gps" ? " · exact" : ""}`).addTo(g);
    if (route?.length) L.polyline([[SHOP.lat, SHOP.lng], ...route.map(x => [x.lat, x.lng] as [number, number]), [SHOP.lat, SHOP.lng]], { color: "#7a1f2b", weight: 3, dashArray: "6 6" }).addTo(g);
    const all = [...points.map(p => [p.g.lat, p.g.lng] as [number, number])];
    if (all.length) m.fitBounds(L.latLngBounds([[SHOP.lat, SHOP.lng], ...all]).pad(0.15), { maxZoom: 13 });
  }, [points, route]);
  return <div ref={el} className="card" style={{ height: 420, zIndex: 0 }} />;
}

function TourView({ tour, parties, onClose }: { tour: Tour; parties: Map<string, Party>; onClose: () => void }) {
  const { me } = useApp();
  const [t, setT] = useState(tour);
  const [cur, setCur] = useState<string | null>(null);
  const [note, setNote] = useState(""); const [photo, setPhoto] = useState<string | undefined>();
  const visit = async () => {
    if (!cur) return;
    let pos: { lat: number; lng: number } | undefined; try { pos = await here(); } catch { /* location off: save without it */ }
    const p = parties.get(cur);
    const v = { at: now(), by: me?.name || "", party_id: cur, party_name: p?.name || "", note: note.trim(), photo_id: photo, ...pos };
    const n = { ...t, visits: [...t.visits, v] }; await saveTour(n); setT(n);
    if (pos && p) await saveGeo(cur, { ...pos, src: "gps" });
    setCur(null); setNote(""); setPhoto(undefined); toast("Visit saved");
  };
  return <Modal title={t.name} onClose={onClose}>
    <div className="stack">
      <div className="xs mut">{t.date} · {t.salesman} · about {Math.round(t.km * 1.3)} km</div>
      {t.stops.map((id, i) => { const p = parties.get(id), vs = t.visits.filter(v => v.party_id === id); return (
        <div key={id} className="item" style={{ flexWrap: "wrap" }}>
          <span className="grow sm"><b>{i + 1}. {p?.name}</b> {vs.length > 0 && <span className="pill ok">visited</span>}
            <div className="xs mut">{[p?.address, p?.city, p?.pin].filter(Boolean).join(", ")} {p?.phone}</div>
            {vs.map((v, j) => <div key={j} className="xs">{v.photo_id && <Thumb photo_id={v.photo_id} size={32} />} {when(v.at)} · {v.by}: {v.note}</div>)}</span>
          {p?.phone && <a className="btn sm" href={`tel:${p.phone}`}>Call</a>}
          <button className="btn sm p" onClick={() => setCur(id)}>Visit</button>
        </div>); })}
      {cur && <div className="card pad stack">
        <b className="sm">Visit · {parties.get(cur)?.name}</b>
        <textarea className="in" rows={2} placeholder="Remarks of the visit: order taken, payment, what they want…" value={note} onChange={e => setNote(e.target.value)} />
        <div className="row"><SpeakText onText={x => setNote(n => (n ? n + " " : "") + x)} /><PhotoButton value={photo} onChange={setPhoto} label="Shop photo" /></div>
        <button className="btn p" onClick={visit}>Save visit (saves this spot on the map)</button>
      </div>}
    </div>
  </Modal>;
}
