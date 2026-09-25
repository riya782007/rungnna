import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { Head, useLocations } from "../components/common";
import { useApp, go } from "../lib/app";
import { rupees, when } from "../lib/format";
import { label } from "../lib/products";

/* The owner's one-glance screen: how much is recorded, where it sits, what moved today. */
export default function Home() {
  const { me } = useApp();
  const locs = useLocations();
  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], []);
  const cells = useLiveQuery(() => db.stock.toArray(), [], []);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = useLiveQuery(() => db.movements.where("at").aboveOrEqual(start.toISOString()).toArray(), [], []);
  const recent = useLiveQuery(() => db.movements.orderBy("at").reverse().limit(12).toArray(), [], []);
  const staff = useLiveQuery(() => db.staff.toArray(), [], []);

  const s = useMemo(() => {
    const bucketIds = new Set(locs.filter(l => l.kind === "bucket").map(l => l.id));
    const rate = new Map(products.map(p => [p.id, p.rate]));
    let pcs = 0, value = 0, flagged = 0;
    const floor = new Map<string, number>();
    const perProd = new Map<string, number>();
    cells.forEach(c => {
      if (bucketIds.has(c.loc_id)) { flagged += c.qty; return; }
      pcs += c.qty; value += c.qty * (rate.get(c.product_id) || 0);
      const f = locs.find(l => l.id === c.loc_id)?.floor || "?";
      floor.set(f, (floor.get(f) || 0) + c.qty);
      perProd.set(c.product_id, (perProd.get(c.product_id) || 0) + c.qty);
    });
    const noPhoto = products.filter(p => !p.photo_id && !p.photo_url).length;
    const noRate = products.filter(p => !p.rate).length;
    const noStock = products.filter(p => !(perProd.get(p.id) || 0)).length;
    const newToday = products.filter(p => p.created_at >= start.toISOString()).length;
    const pcsToday = today.filter(m => m.kind === "intake").reduce((a, m) => a + m.qty, 0);
    const byStaff = new Map<string, number>();
    today.forEach(m => byStaff.set(m.by_staff, (byStaff.get(m.by_staff) || 0) + m.qty));
    return { pcs, value, flagged, floor, noPhoto, noRate, noStock, newToday, pcsToday, byStaff };
  }, [cells, products, locs, today]);

  const pName = (id: string) => products.find(p => p.id === id);
  const locCode = (id: string | null) => (id ? locs.find(l => l.id === id)?.code || "" : "");
  const maxF = Math.max(1, ...s.floor.values());

  return (
    <div>
      <Head eyebrow={new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })} title={`Namaste${me ? ", " + me.name : ""}`}>
        <button className="btn p big" onClick={() => go("scan")}>▥ Scan & record</button>
      </Head>
      <div className="grid g4" style={{ marginBottom: 12 }}>
        <div className="tile"><div className="k">Products recorded</div><div className="v">{products.length.toLocaleString("en-IN")}</div><div className="xs mut">+{s.newToday} today</div></div>
        <div className="tile"><div className="k">Pieces on racks</div><div className="v">{s.pcs.toLocaleString("en-IN")}</div><div className="xs mut">+{s.pcsToday} recorded today</div></div>
        <div className="tile"><div className="k">Stock value at rate</div><div className="v">{rupees(s.value)}</div><div className="xs mut">{s.noRate} products have no rate</div></div>
        <div className="tile"><div className="k">Damaged / missing</div><div className="v" style={{ color: s.flagged ? "var(--rose)" : undefined }}>{s.flagged}</div><div className="xs mut">pieces in status buckets</div></div>
      </div>
      <div className="split">
        <div className="stack">
          <div className="card"><header><h3>Pieces by floor</h3></header>
            <div className="pad stack">
              {[...s.floor.entries()].sort().map(([f, n]) => (
                <div key={f} className="row" style={{ flexWrap: "nowrap" }}>
                  <span className="sm" style={{ width: 70 }}>{f === "G" ? "Ground" : f === "GD" ? "Godown" : "Floor " + f}</span>
                  <span className="grow" style={{ background: "var(--cream)", borderRadius: 6, height: 14, overflow: "hidden" }}>
                    <span style={{ display: "block", height: "100%", width: (n / maxF) * 100 + "%", background: "var(--em)", borderRadius: 6 }} /></span>
                  <b className="mono sm" style={{ width: 64, textAlign: "right" }}>{n.toLocaleString("en-IN")}</b>
                </div>))}
              {!s.floor.size && <div className="mut sm">Nothing on racks yet. <a href="#/racks">Create racks</a>, then <a href="#/scan">scan</a>.</div>}
            </div></div>
          <div className="card"><header><h3>Needs attention</h3></header>
            <div className="pad stack" style={{ gap: 6 }}>
              <a className="item" href="#/products"><span className="grow sm">Products without a photo</span><b className="mono">{s.noPhoto}</b></a>
              <a className="item" href="#/products"><span className="grow sm">Products without a rate</span><b className="mono">{s.noRate}</b></a>
              <a className="item" href="#/products"><span className="grow sm">Products with zero stock</span><b className="mono">{s.noStock}</b></a>
            </div></div>
          <div className="card"><header><h3>Recorded today, by person</h3></header>
            <div className="pad stack" style={{ gap: 6 }}>
              {[...s.byStaff.entries()].map(([id, n]) => <div key={id} className="row between sm"><span>{staff.find(x => x.id === id)?.name || "—"}</span><b className="mono">{n} pcs</b></div>)}
              {!s.byStaff.size && <div className="mut sm">No activity yet today.</div>}
            </div></div>
        </div>
        <div className="card"><header><h3>Latest movements</h3><a className="btn sm" style={{ marginLeft: "auto" }} href="#/activity">All</a></header>
          <div className="pad stack" style={{ gap: 8 }}>
            {recent.map(m => { const p = pName(m.product_id); return (
              <a key={m.id} className="row sm" href={"#/product/" + m.product_id} style={{ color: "inherit", textDecoration: "none", flexWrap: "nowrap" }}>
                <span className="pill">{m.kind}</span>
                <span className="grow" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p ? label(p) : "…"} <span className="mut">{locCode(m.from_loc)}{m.from_loc && m.to_loc ? " → " : ""}{locCode(m.to_loc)}</span></span>
                <b className="mono">{m.qty}</b><span className="xs mut" style={{ whiteSpace: "nowrap" }}>{when(m.at)}</span>
              </a>); })}
            {!recent.length && <div className="mut sm">Nothing yet.</div>}
          </div></div>
      </div>
    </div>
  );
}
