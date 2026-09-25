import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { recordMovement, getSetting, setSetting, stockOf, type Product, type StockCell } from "../lib/db";
import { parseLabel, FIELDS, type Parsed, type Pattern, type Field, guessSep, splitTokens } from "../lib/parse";
import { findByScan, fromParsed, saveProduct, patterns, label, DEFAULT_ITEMS, DEFAULT_TYPES, distinct, itemNameFor } from "../lib/products";
import { CameraScanner, WedgeInput } from "../components/Scanner";
import { LocationSelect, PhotoButton, Thumb, Head, LOC_PREFIX, locName, useLocations } from "../components/common";
import { useApp, toast, beep, go } from "../lib/app";
import { toPaise, when } from "../lib/format";
import { uid } from "../lib/db";

type Hit = { raw: string; parsed: Parsed; product?: Product; isNew: boolean };

export default function Scan() {
  const { me } = useApp();
  const locs = useLocations();
  const [loc, setLoc] = useState("");
  const [cam, setCam] = useState(true);
  const [auto, setAuto] = useState(false);            // +1 on every scan of a known product
  const [hit, setHit] = useState<Hit | null>(null);
  const [session, setSession] = useState<{ id: string; text: string; qty: number; at: string }[]>([]);

  useEffect(() => { getSetting("scan_loc", "").then(setLoc); getSetting("scan_cam", true).then(setCam); }, []);
  useEffect(() => { setSetting("scan_loc", loc); }, [loc]);

  const log = (text: string, qty: number) => setSession(s => [{ id: uid(), text, qty, at: new Date().toISOString() }, ...s].slice(0, 30));

  const onCode = async (raw: string) => {
    if (raw.startsWith(LOC_PREFIX)) {
      const l = locs.find(x => x.code === raw.slice(LOC_PREFIX.length));
      if (l) { setLoc(l.id); beep(); toast("Location set: " + l.code); } else { beep(false); toast("Unknown rack label " + raw, true); }
      return;
    }
    const parsed = parseLabel(raw, await patterns());
    const product = await findByScan(raw, parsed);
    beep(!!product || parsed.how !== "unknown");
    if (product && auto && loc) {
      await recordMovement({ product_id: product.id, kind: "intake", qty: 1, from_loc: null, to_loc: loc, person_type: "employee", person_name: me?.name || "", by_staff: me?.id || "", note: "scan count" });
      log(label(product), 1); toast("+1 " + label(product));
      return;
    }
    setHit({ raw, parsed, product, isNew: !product });
  };

  return (
    <div>
      <Head eyebrow="Stock intake" title="Scan & record" sub="Scan the label already on the packet. The details fill themselves; add the count, the rack and a photo, and save. Works without internet." />
      <div className="split">
        <div className="stack">
          <div className="card pad stack">
            <LocationSelect value={loc} onChange={setLoc} label="Putting stock into (scan a rack label to switch)" />
            {!loc && <div className="note warn">Pick the rack or box you are standing at. Every piece you record goes there.</div>}
            <div className="row">
              <label className="row sm" style={{ gap: 6 }}><input type="checkbox" checked={auto} onChange={e => setAuto(e.target.checked)} /> Count mode: every scan of a known product adds 1</label>
            </div>
            {cam && <CameraScanner onCode={onCode} paused={!!hit} />}
            <div className="row">
              <button className="btn sm" onClick={() => { setCam(!cam); setSetting("scan_cam", !cam); }}>{cam ? "Hide camera (using a gun)" : "Use phone camera"}</button>
            </div>
            <WedgeInput onCode={onCode} autoFocus={!hit} />
          </div>
          {session.length > 0 && (
            <div className="card">
              <header><h3>This session</h3><span className="pill ok">{session.reduce((a, s) => a + s.qty, 0)} pcs</span></header>
              <div className="pad stack" style={{ gap: 6 }}>
                {session.map(s => <div key={s.id} className="row between sm"><span className="grow">{s.text}</span><span className="mono b">+{s.qty}</span><span className="xs mut">{when(s.at)}</span></div>)}
              </div>
            </div>
          )}
        </div>
        <div>
          {hit ? <HitPanel key={hit.raw + hit.isNew + hit.parsed.how} hit={hit} loc={loc} setLoc={setLoc}
            onDone={(text, qty) => { if (qty) log(text, qty); setHit(null); }}
            onRetry={async () => onCode(hit.raw)} />
            : <div className="card pad mut sm">Waiting for a scan… {locs.length <= 3 && <>First time? <a href="#/racks">Set up your floors &amp; racks</a> so stock has somewhere to go.</>}</div>}
        </div>
      </div>
    </div>
  );
}

function HitPanel({ hit, loc, setLoc, onDone, onRetry }: { hit: Hit; loc: string; setLoc: (s: string) => void; onDone: (text: string, qty: number) => void; onRetry: () => void }) {
  const { me } = useApp();
  const [p, setP] = useState<Product>(() => hit.product || fromParsed(hit.parsed, me?.id || ""));
  // shop labels carry the packet size (X12PCS): count packets, pieces = packets × pack
  const [qty, setQty] = useState(hit.parsed.qty && hit.parsed.how !== "shop label" ? String(parseInt(hit.parsed.qty) || 1) : "1");
  const [stock, setStock] = useState<StockCell[]>([]);
  const [teach, setTeach] = useState(hit.parsed.how === "unknown");
  const [busy, setBusy] = useState(false);
  const qtyRef = useRef<HTMLInputElement>(null);
  const items = useLiveQuery(() => distinct("item"), [], []);
  const locs = useLocations();

  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hit.product) stockOf(hit.product.id).then(setStock);
    setTimeout(() => { if (innerWidth < 960) box.current?.scrollIntoView({ behavior: "smooth", block: "start" }); qtyRef.current?.focus({ preventScroll: innerWidth < 960 }); qtyRef.current?.select(); }, 60);
  }, [hit.product]);

  useEffect(() => {
    if (!hit.product && !p.item && p.item_code) itemNameFor(p.item_code).then(nm => nm && setP(x => (x.item ? x : { ...x, item: nm })));
  }, []);

  const set = (k: keyof Product, v: any) => setP(x => ({ ...x, [k]: v }));
  const pack = Math.max(1, p.pack || 1);
  const n = Math.max(0, parseInt(qty) || 0) * pack;

  const save = async () => {
    if (busy) return;
    if (!hit.product && !p.item && !p.style) { toast("Give it at least an item or a style", true); return; }
    if (n > 0 && !loc) { toast("Choose where this stock is kept", true); return; }
    setBusy(true);
    try {
      const saved = await saveProduct({ ...p });
      if (n > 0) await recordMovement({
        product_id: saved.id, kind: "intake", qty: n, from_loc: null, to_loc: loc,
        person_type: "employee", person_name: me?.name || "", by_staff: me?.id || "", note: hit.isNew ? "first scan" : "", photo_id: undefined,
      });
      toast((hit.isNew ? "Saved new · " : "Added · ") + label(saved) + (n ? ` · ${n} pcs` : ""));
      onDone(label(saved), n);
    } finally { setBusy(false); }
  };

  const total = stock.reduce((a, c) => a + c.qty, 0);
  return (
    <div className="card" ref={box} style={{ scrollMarginTop: 60 }} onKeyDown={e => { if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "TEXTAREA" && !teach) { e.preventDefault(); save(); } }}>
      <header>
        <Thumb photo_id={p.photo_id} url={p.photo_url} text={p.item || p.style} />
        <div className="grow"><h3>{hit.isNew ? "New product" : label(p)}</h3>
          <div className="xs mut mono">{p.code} · read as {hit.parsed.how}</div></div>
        {hit.isNew ? <span className="pill warn">not in system yet</span> : <span className="pill ok">{total} in stock</span>}
      </header>
      <div className="pad stack">
        {teach && <TeachPattern raw={hit.raw} onSaved={() => { setTeach(false); onRetry(); }} onSkip={() => setTeach(false)} />}
        {hit.isNew && p.item_code && !p.item && <div className="note warn sm">First time this label's item code <b className="mono">{p.item_code}</b> is seen — type the item name once (e.g. F-RING) and every later label with {p.item_code} fills it in.</div>}
        {!hit.isNew && stock.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            {stock.map(c => <div key={c.key} className="row between sm"><span>{locName(locs.find(l => l.id === c.loc_id))}</span><span className="mono b">{c.qty}</span></div>)}
          </div>
        )}
        <div className="grid g2">
          <label className="f">Item
            <input className="in" list="items" value={p.item} onChange={e => set("item", e.target.value.toUpperCase())} />
            <datalist id="items">{[...new Set([...items, ...DEFAULT_ITEMS])].map(i => <option key={i} value={i} />)}</datalist>
          </label>
          <label className="f">Type
            <select className="in" value={p.type} onChange={e => set("type", e.target.value)}>
              {[...new Set([p.type, ...DEFAULT_TYPES])].filter(Boolean).map(t => <option key={t}>{t}</option>)}
            </select>
          </label>
          <label className="f">Style<input className="in mono" value={p.style} onChange={e => set("style", e.target.value.toUpperCase())} /></label>
          <label className="f">Color<input className="in mono" value={p.color} onChange={e => set("color", e.target.value.toUpperCase())} /></label>
          <label className="f">TK<input className="in" value={p.tk} onChange={e => set("tk", e.target.value)} /></label>
          <label className="f">Rate ₹<input className="in hi mono" inputMode="decimal" value={p.rate ? String(p.rate / 100) : ""} onChange={e => set("rate", toPaise(e.target.value))} /></label>
          <label className="f">Pieces per packet<input className="in mono" inputMode="numeric" value={p.pack || ""} placeholder="1" onChange={e => set("pack", parseInt(e.target.value.replace(/\D/g, "")) || undefined)} /></label>
          <label className="f">Item code (old software)<input className="in mono" inputMode="numeric" value={p.item_code || ""} onChange={e => set("item_code", e.target.value.replace(/\D/g, "") || undefined)} /></label>
        </div>
        <div className="grid g2">
          <label className="f">{pack > 1 ? `Packets going in now (× ${pack} = ${n} pcs)` : "Pieces going in now"}<input ref={qtyRef} className="in mono" inputMode="numeric" value={qty} onChange={e => setQty(e.target.value.replace(/\D/g, ""))} /></label>
          <LocationSelect value={loc} onChange={setLoc} label="Into" buckets={false} />
        </div>
        <PhotoButton value={p.photo_id} onChange={v => set("photo_id", v)} label="Product photo" />
        <details className="sm"><summary className="mut">Raw label text</summary><code className="mono xs" style={{ wordBreak: "break-all" }}>{hit.raw}</code>
          {!teach && hit.parsed.tokens.length > 1 && <div><button className="btn sm" onClick={() => setTeach(true)}>Teach this label layout</button></div>}</details>
        <div className="row">
          <button className="btn p big grow" onClick={save} disabled={busy}>{hit.isNew ? "Save product" : "Save"}{n ? ` + ${n} pcs` : ""} ↵</button>
          <button className="btn big" onClick={() => onDone("", 0)}>Skip</button>
        </div>
        {!hit.isNew && <div className="row">
          <button className="btn sm" onClick={() => go("product/" + p.id)}>Open product</button>
          <button className="btn sm" onClick={() => go("move/" + p.id)}>Move / transfer</button>
          <button className="btn sm" onClick={() => go("labels/" + p.id)}>Print new QR</button>
        </div>}
      </div>
    </div>
  );
}

/* The owner shows the app, once, which piece of an unfamiliar label is which. */
function TeachPattern({ raw, onSaved, onSkip }: { raw: string; onSaved: () => void; onSkip: () => void }) {
  const [sep, setSep] = useState(guessSep(raw));
  const tokens = splitTokens(raw, sep);
  const guess = (i: number): Field | "" => (["item", "type", "style", "color", "tk", "rate"] as Field[])[i] || "";
  const [map, setMap] = useState<(Field | "")[]>(() => tokens.map((_, i) => guess(i)));
  const [div, setDiv] = useState(1);
  const save = async () => {
    const list = await getSetting<Pattern[]>("patterns", []);
    const pat: Pattern = { id: uid(), name: "Label " + (list.length + 1), sep, count: tokens.length, prefix: "", map: tokens.map((_, i) => map[i] || ""), rateDiv: div };
    await setSetting("patterns", [...list, pat]);
    toast("Label layout learnt — every label like this now fills itself");
    onSaved();
  };
  const seps: [string, string][] = [["|", "|"], [",", ","], [";", ";"], ["\\s", "space"], ["\t", "tab"], ["~", "~"], ["*", "*"], ["#", "#"], ["-", "-"], ["/", "/"], ["\n", "new line"]];
  return (
    <div className="note warn stack">
      <b>This label layout is new to me. Tell me once which piece is which.</b>
      <label className="f">Pieces are separated by
        <select className="in" value={sep} onChange={e => { setSep(e.target.value); setMap(splitTokens(raw, e.target.value).map((_, i) => guess(i))); }}>
          {seps.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
        </select></label>
      {tokens.map((t, i) => (
        <div key={i} className="row">
          <code className="mono grow" style={{ background: "#fff", padding: "6px 8px", borderRadius: 8 }}>{t || "(empty)"}</code>
          <select className="in" style={{ width: 130 }} value={map[i] || ""} onChange={e => { const m = [...map]; m[i] = e.target.value as Field; setMap(m); }}>
            <option value="">ignore</option>{FIELDS.map(f => <option key={f} value={f}>{f.toUpperCase()}</option>)}
          </select>
        </div>
      ))}
      <label className="row sm"><input type="checkbox" checked={div === 100} onChange={e => setDiv(e.target.checked ? 100 : 1)} /> Rate on the label is in paise (e.g. 9600 means ₹96)</label>
      <div className="row"><button className="btn p sm" onClick={save}>Save this layout</button><button className="btn sm" onClick={onSkip}>Fill by hand this time</button></div>
    </div>
  );
}
