import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Product } from "../lib/db";
import { Head, Thumb, Modal, Switch } from "../components/common";
import { useApp, toast, go } from "../lib/app";
import { can } from "../lib/roles";
import { rupees } from "../lib/format";
import { label } from "../lib/products";
import { slugify } from "../../api/_listing";
import {
  publishBlockers, shopUrl, tradeUrl, catalogueUrl, productUrl, waShare, copy, randomKey,
  getTradePortal, saveTradePortal, listCatalogues, saveCatalogue, deleteCatalogue,
  type TradePortal, type CatalogueRow,
} from "../lib/listing";

/* The online catalogue in one place: what's live, the retail shop link, the
   private trade portal link, and collections to send to any buyer. */
export default function Catalogue() {
  const { me } = useApp();
  const admin = can(me, "settings");
  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], [] as Product[]);
  const cfgStamp = useLiveQuery(() => db.config.filter(c => c.id === "trade_portal" || c.id.startsWith("catalogue:")).toArray().then(r => r.map(x => x.updated_at + (x.deleted || "")).join()), [], "");
  const [portal, setPortal] = useState<TradePortal | null>(null);
  const [cats, setCats] = useState<CatalogueRow[]>([]);
  const [edit, setEdit] = useState<CatalogueRow | null>(null);
  const [filter, setFilter] = useState<"live" | "ready" | "draft">("live");
  useEffect(() => { getTradePortal().then(setPortal); listCatalogues().then(setCats); }, [cfgStamp]);

  const live = products.filter(p => p.catalogue && p.slug && !publishBlockers(p).length);
  const withPage = products.filter(p => p.content?.title && !p.catalogue);
  const draft = products.filter(p => !p.content?.title);
  const shown = filter === "live" ? live : filter === "ready" ? withPage : draft;

  const share = async (url: string, text: string) => { const ok = await copy(url); toast(ok ? "Link copied" : url); void text; };

  return (
    <div>
      <Head eyebrow="Online" title="Catalogue & sharing" sub="Publish product pages, then share the shop, the trade portal or a hand-picked catalogue with anyone — one link, works on any phone.">
        <a className="btn" href={shopUrl()} target="_blank" rel="noopener">Open shop ↗</a>
      </Head>

      <div className="split">
        <div className="stack">
          <div className="card">
            <header><h3>Designs</h3>
              <div className="seg" role="group" style={{ marginLeft: "auto" }}>
                <button aria-pressed={filter === "live"} onClick={() => setFilter("live")}>Live {live.length}</button>
                <button aria-pressed={filter === "ready"} onClick={() => setFilter("ready")}>Page written {withPage.length}</button>
                <button aria-pressed={filter === "draft"} onClick={() => setFilter("draft")}>No page {draft.length}</button>
              </div></header>
            <div className="pad stack" style={{ gap: 6 }}>
              {shown.slice(0, 200).map(p => (
                <div key={p.id} className="item">
                  <Thumb photo_id={p.pro_photo_id || p.photo_id} url={p.pro_photo_url || p.photo_url} text={p.item} size={44} />
                  <button className="grow linkbtn" style={{ textAlign: "left" }} onClick={() => go("product/" + p.id)}>
                    <b className="sm">{p.content?.title || label(p)}</b>
                    <div className="xs mut">{p.code}{p.mrp ? " · MRP " + rupees(p.mrp) : ""}{p.rate ? " · trade " + rupees(p.rate) : ""}{filter !== "live" && publishBlockers(p).length ? " · " + publishBlockers(p)[0] : ""}</div>
                  </button>
                  {filter === "live" && <button className="btn sm" onClick={() => share(productUrl(p.slug!), p.content?.title || "")}>Copy link</button>}
                  {filter !== "live" && <button className="btn sm" onClick={() => go("product/" + p.id)}>{filter === "draft" ? "Write page" : "Publish"}</button>}
                </div>))}
              {!shown.length && <div className="mut sm">{filter === "live" ? "Nothing live yet. Open a product → Online page → Write page with AI → Published." : "Nothing here."}</div>}
            </div>
          </div>
        </div>

        <div className="stack">
          <div className="card">
            <header><h3>Retail shop</h3><span className="pill ok" style={{ marginLeft: "auto" }}>public · on Google</span></header>
            <div className="pad stack">
              <code className="mono xs" style={{ wordBreak: "break-all" }}>{shopUrl()}</code>
              <div className="row">
                <button className="btn sm" onClick={() => share(shopUrl(), "")}>Copy link</button>
                <a className="btn sm g" href={waShare(`See our latest designs — ${shopUrl()}`)} target="_blank" rel="noopener">Share on WhatsApp</a>
              </div>
              <div className="xs mut">Shows live designs with MRP. Each design has its own Google-ready page.</div>
            </div>
          </div>

          <div className="card">
            <header><h3>Trade portal</h3><span className={"pill " + (portal?.enabled ? "ok" : "")} style={{ marginLeft: "auto" }}>{portal?.enabled ? "on · private link" : "off"}</span></header>
            <div className="pad stack">
              <div className="xs mut">Wholesale rates, packing and an order builder that sends the order to your WhatsApp. Only people with the link see trade rates; it is hidden from Google.</div>
              {portal?.enabled ? <>
                <code className="mono xs" style={{ wordBreak: "break-all" }}>{tradeUrl(portal)}</code>
                <div className="row">
                  <button className="btn sm" onClick={() => share(tradeUrl(portal), "")}>Copy link</button>
                  <a className="btn sm g" href={waShare(`Our wholesale line-sheet (trade rates) — ${tradeUrl(portal)}`)} target="_blank" rel="noopener">Share on WhatsApp</a>
                </div>
                {admin && <div className="row">
                  <button className="btn sm" onClick={async () => { if (!confirm("Make a new link? The old trade link stops working for everyone who has it.")) return; const v = { ...portal, token: randomKey() }; await saveTradePortal(v); setPortal(v); toast("New trade link made — old one no longer works"); }}>New link</button>
                  <button className="btn sm bad" onClick={async () => { const v = { ...portal, enabled: false }; await saveTradePortal(v); setPortal(v); toast("Trade portal switched off"); }}>Switch off</button>
                </div>}
              </> : admin ? <button className="btn p" onClick={async () => { const v = { token: portal?.token || randomKey(), enabled: true, created_at: portal?.created_at || new Date().toISOString() }; await saveTradePortal(v); setPortal(v); toast("Trade portal is on"); }}>Switch on trade portal</button>
                : <div className="xs mut">Ask the owner to switch it on.</div>}
            </div>
          </div>

          <div className="card">
            <header><h3>Catalogues to share</h3><button className="btn sm p" style={{ marginLeft: "auto" }} disabled={!live.length}
              onClick={() => setEdit({ slug: "", title: "", note: "", audience: "retail", product_ids: [], active: true, created_at: new Date().toISOString() })}>+ New</button></header>
            <div className="pad stack" style={{ gap: 8 }}>
              {!live.length && <div className="xs mut">Publish a few designs first, then pick them into a catalogue.</div>}
              {cats.map(c => (
                <div key={c.slug} className="item" style={{ flexWrap: "wrap" }}>
                  <span className="grow"><b className="sm">{c.title}</b>
                    <div className="xs mut">{c.product_ids.length} designs · {c.audience === "trade" ? "trade rates (private)" : "retail prices"}{c.active ? "" : " · paused"}</div></span>
                  <button className="btn sm" onClick={() => share(catalogueUrl(c), c.title)}>Copy</button>
                  <a className="btn sm g" href={waShare(`${c.title} — ${catalogueUrl(c)}`)} target="_blank" rel="noopener">WhatsApp</a>
                  <button className="btn sm" onClick={() => setEdit(c)}>Edit</button>
                </div>))}
            </div>
          </div>
        </div>
      </div>

      {edit && <CatalogueEditor value={edit} live={live} taken={cats.map(c => c.slug)} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); listCatalogues().then(setCats); }} />}
    </div>
  );
}

function CatalogueEditor({ value, live, taken, onClose, onSaved }: { value: CatalogueRow; live: Product[]; taken: string[]; onClose: () => void; onSaved: () => void }) {
  const isNew = !value.slug;
  const [c, setC] = useState<CatalogueRow>(value);
  const [q, setQ] = useState("");
  const picked = new Set(c.product_ids);
  const list = useMemo(() => { const t = q.trim().toLowerCase(); return live.filter(p => !t || `${p.content?.title} ${p.code} ${p.item} ${p.category}`.toLowerCase().includes(t)); }, [q, live]);
  const toggle = (id: string) => setC(x => ({ ...x, product_ids: picked.has(id) ? x.product_ids.filter(i => i !== id) : [...x.product_ids, id] }));
  const save = async () => {
    if (!c.title.trim()) return toast("Give the catalogue a name", true);
    if (!c.product_ids.length) return toast("Pick at least one design", true);
    let slug = c.slug;
    if (isNew) { const base = slugify(c.title) || "catalogue"; slug = base; let n = 2; while (taken.includes(slug)) slug = `${base}-${n++}`; }
    await saveCatalogue({ ...c, slug, title: c.title.trim() });
    toast(isNew ? "Catalogue created — copy the link to share" : "Saved"); onSaved();
  };
  return (
    <Modal title={isNew ? "New catalogue" : "Edit catalogue"} onClose={onClose}>
      <div className="stack">
        <label className="f">Name<input className="in" autoFocus value={c.title} placeholder="Diwali bridal sets" onChange={e => setC({ ...c, title: e.target.value })} /></label>
        <label className="f">Note for the buyer (optional)<input className="in" value={c.note} placeholder="Ready stock · dispatch in 2 days" onChange={e => setC({ ...c, note: e.target.value })} /></label>
        <div className="seg" role="group" aria-label="Who is it for">
          <button aria-pressed={c.audience === "retail"} onClick={() => setC({ ...c, audience: "retail" })}>Retail (MRP)</button>
          <button aria-pressed={c.audience === "trade"} onClick={() => setC({ ...c, audience: "trade" })}>Trade (wholesale rates)</button>
          <button aria-pressed={c.audience === "preview"} onClick={() => setC({ ...c, audience: "preview" })}>Photos (no prices)</button>
        </div>
        {c.audience === "trade" && <div className="xs mut">Trade catalogues get their own private key in the link. Delete the catalogue to stop that link working.</div>}
        {!isNew && <Switch on={c.active} onChange={v => setC({ ...c, active: v })} label="Link active" hint="Pause to stop the link working without deleting" />}
        <input className="in" placeholder={`Search ${live.length} live designs`} value={q} onChange={e => setQ(e.target.value)} />
        <div className="row xs"><span className="grow mut">{c.product_ids.length} picked</span>
          <button className="linkbtn" onClick={() => setC({ ...c, product_ids: [...new Set([...c.product_ids, ...list.map(p => p.id)])] })}>Pick all shown</button>
          <button className="linkbtn" onClick={() => setC({ ...c, product_ids: [] })}>Clear</button></div>
        <div className="stack" style={{ gap: 4, maxHeight: 320, overflow: "auto" }}>
          {list.map(p => (
            <label key={p.id} className="item" style={{ cursor: "pointer" }}>
              <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
              <Thumb photo_id={p.pro_photo_id || p.photo_id} url={p.pro_photo_url || p.photo_url} text={p.item} size={36} />
              <span className="grow sm">{p.content?.title || label(p)} <span className="xs mut mono">{p.code}</span></span>
              <span className="xs mono">{c.audience === "trade" ? (p.rate ? rupees(p.rate) : "") : (p.mrp ? rupees(p.mrp) : "")}</span>
            </label>))}
        </div>
        <div className="row">
          <button className="btn p" onClick={save}>{isNew ? "Create catalogue" : "Save"}</button>
          {!isNew && <button className="btn bad" onClick={async () => { if (confirm("Delete this catalogue? Its link stops working.")) { await deleteCatalogue(c.slug); toast("Deleted"); onSaved(); } }}>Delete</button>}
        </div>
      </div>
    </Modal>
  );
}
