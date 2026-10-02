import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, getSetting, setSetting, type StockCell } from "../lib/db";
import { label } from "../lib/products";
import { countReport, isRfidTag, normTag, TagSet } from "../lib/rfid";
import { parseRackScan } from "../lib/rackLabel";
import { useScannerGun, WedgeInput } from "../components/Scanner";
import { Head, LocationSelect, LOC_PREFIX, useLocations } from "../components/common";
import { LinkRfid } from "../components/LinkRfid";
import { beep, toast } from "../lib/app";
import { currentStore, storeStock } from "../lib/stores";

/* RFID count: choose a rack, wave the UHF reader (USB keyboard mode) over it.
   Expected = what the stock book says is in that rack; found = distinct tags read.
   Missing pieces are red, tags that belong to sold pieces are flagged, unknown tags are listed. */
export default function RfidCount() {
  const locs = useLocations();
  const [loc, setLoc] = useState("");
  const [reads, setReads] = useState<string[]>([]);
  const [link, setLink] = useState<false | { tag?: string }>(false);
  const seen = useRef(new TagSet());
  /* a long count survives leaving the page or a closed tab (this device only) */
  const [ready, setReady] = useState(false);
  useEffect(() => { getSetting<{ loc: string; reads: string[] } | null>("rfid_count_" + currentStore(), null).then(d => {
    if (d) { setLoc(d.loc || ""); setReads(d.reads || []); seen.current = new TagSet(d.reads || []); }
    setReady(true);
  }); }, []);
  useEffect(() => { if (ready) setSetting("rfid_count_" + currentStore(), { loc, reads }); }, [ready, loc, reads]);
  const products = useLiveQuery(() => db.products.toArray(), [], []);
  const cells = useLiveQuery<StockCell[], StockCell[]>(() => (loc ? storeStock().then(rows => rows.filter(c => c.loc_id === loc)) : []), [loc], []);
  const pmap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);

  const expected = useMemo(() => new Map(cells.filter(c => c.qty > 0).map(c => [c.product_id, c.qty])), [cells]);
  const rep = useMemo(() => countReport(expected, reads, products), [expected, reads, products]);

  function onCode(raw: string) {
    const r = raw.trim(); if (!r) return;
    const rack = parseRackScan(r, locs);
    if (rack || r.startsWith(LOC_PREFIX)) {
      if (rack) { if (rack.id !== loc) { setLoc(rack.id); restart(); } beep(); toast("Counting rack " + rack.code); } else { beep(false); toast("Unknown rack label", true); }
      return;
    }
    if (!isRfidTag(r)) { beep(false); toast("Not an RFID tag — this page counts tags only", true); return; }
    if (!seen.current.add(r)) return;          // same tag again: counted once
    setReads(x => [...x, normTag(r)]);
  }
  function restart() { seen.current = new TagSet(); setReads([]); }
  useScannerGun(c => onCode(c), { enabled: !link });

  const rack = locs.find(l => l.id === loc);
  return (
    <div>
      <Head title="RFID count" sub="Choose the rack, then wave the reader slowly over every box. Each tag counts once.">
        <button className="btn" onClick={() => setLink({})}>Link RFID tag</button>
      </Head>
      <div className="split">
        <div className="stack">
          <div className="card pad stack">
            <LocationSelect value={loc} onChange={v => { setLoc(v); restart(); }} label="Rack being counted (or scan the rack's QR)" buckets={false} />
            {!loc && <div className="note warn sm">Pick the rack first — the count compares the tags read with what that rack should hold.</div>}
            <WedgeInput onCode={onCode} placeholder="Reader output lands here (or anywhere on this page)" autoFocus={!link} />
            <div className="row"><button className="btn sm" onClick={() => (reads.length < 5 || confirm("Clear the tags read so far?")) && restart()} disabled={!reads.length}>Start again</button><span className="xs mut">{reads.length} distinct tag{reads.length === 1 ? "" : "s"} read</span></div>
          </div>

          {loc && <div className="card tw"><table>
            <thead><tr><th>Product</th><th className="r">Expected</th><th className="r">Found</th><th className="r">Missing</th></tr></thead>
            <tbody>
              {rep.rows.map(r => {
                const p = pmap.get(r.product_id), miss = Math.max(0, r.expected - r.found);
                return (
                  <tr key={r.product_id} style={miss ? { color: "var(--bad)" } : undefined}>
                    <td><a href={"#/product/" + r.product_id} style={{ color: "inherit" }}><b className="sm">{p ? label(p) : r.product_id}</b></a>
                      {!r.expected && r.found > 0 && <span className="pill warn" style={{ marginLeft: 6 }}>not booked in this rack</span>}
                      {!r.tagged && r.expected > 0 && <span className="pill" style={{ marginLeft: 6 }}>no tags linked</span>}
                      {r.sold.map(s => <div key={s.tag} className="xs"><span className="pill bad">sold</span> <span className="mono">{s.tag}</span> on {s.bill}</div>)}</td>
                    <td className="r mono">{r.expected}</td>
                    <td className="r mono">{r.found}</td>
                    <td className="r mono b">{miss || ""}</td>
                  </tr>);
              })}
              {!rep.rows.length && <tr><td colSpan={4} className="mut" style={{ padding: 24, textAlign: "center" }}>Nothing booked in this rack yet, and no tags read.</td></tr>}
            </tbody>
          </table></div>}
        </div>

        <aside className="stack">
          <div className="card pad stack">
            <div className="row between"><span className="mut sm">Rack</span><b>{rack ? rack.code : "—"}</b></div>
            <div className="row between"><span className="mut sm">Expected</span><b className="mono">{rep.expectedTotal}</b></div>
            <div className="row between"><span className="mut sm">Found</span><b className="mono">{rep.foundTotal}</b></div>
            <div className="net" style={rep.missing ? { color: "var(--bad)" } : undefined}><span>MISSING</span><b>{rep.missing}</b></div>
            {rep.soldTotal > 0 && <div className="row between" style={{ color: "var(--bad)" }}><span className="sm">Sold tags still here</span><b className="mono">{rep.soldTotal}</b></div>}
          </div>
          {rep.unknown.length > 0 && <div className="card pad stack">
            <b className="sm">Unknown tags ({rep.unknown.length})</b>
            <div className="xs mut">Read here but not linked to any product. Tap Link, then scan that piece's QR.</div>
            <div className="stack" style={{ gap: 4 }}>{rep.unknown.map(t => <div key={t} className="row between" style={{ flexWrap: "nowrap" }}>
              <span className="mono xs" style={{ wordBreak: "break-all" }}>{t}</span><button className="btn sm" onClick={() => setLink({ tag: t })}>Link</button></div>)}</div>
          </div>}
        </aside>
      </div>
      {link && <LinkRfid tag={link.tag} onClose={() => setLink(false)} />}
    </div>
  );
}
