import { useState } from "react";
import type { Product } from "../lib/db";
import { saveProduct } from "../lib/products";
import { toast } from "../lib/app";
import { Switch } from "./common";
import { Icon } from "./Icon";
import {
  generateListing, slugFor, publishBlockers, humanAttempt, cloudImage, productUrl, waShare, copy,
  type ListingContent, type Attempt,
} from "../lib/listing";
import { slugify } from "../../api/_listing";

/* The product's public page: write it with AI (Gemini reads the photo, OpenAI
   writes, Groq covers for OpenAI), edit anything, then publish. Publishing puts
   it on /shop, the trade portal and in catalogues. */
export function OnlineListing({ p, setP }: { p: Product; setP: (fn: (x: Product) => Product) => void }) {
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [attempts, setAttempts] = useState<Attempt[] | null>(null);
  const c = p.content;
  const setC = (patch: Partial<ListingContent>) => setP(x => ({ ...x, content: { ...(x.content as ListingContent), ...patch } }));
  const setSeo = (patch: Partial<ListingContent["seo"]>) => setP(x => ({ ...x, content: { ...(x.content as ListingContent), seo: { ...(x.content as ListingContent).seo, ...patch } } }));
  const setTrade = (patch: Partial<ListingContent["trade"]>) => setP(x => ({ ...x, content: { ...(x.content as ListingContent), trade: { ...(x.content as ListingContent).trade, ...patch } } }));
  const blockers = publishBlockers(p);
  const live = !!p.catalogue && !!p.slug && !blockers.length;

  async function write() {
    if (!p.item && !p.style) return toast("Fill the Item first so the AI knows what the piece is", true);
    setBusy(true); setAttempts(null);
    try {
      const r = await generateListing(p, notes.trim());
      setAttempts(r.attempts);
      setP(x => ({ ...x, content: r.content, slug: x.slug || slugFor(x, r.content.title) }));
      toast(r.provider === "template"
        ? "AI unavailable — a basic page was written from the details. Check and Save."
        : `Page written${r.vision ? " from the photo" : ""} by ${r.provider === "openai" ? "OpenAI" : "Groq"} — check and Save`, r.provider === "template");
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }
  async function save(publish?: boolean) {
    const next = { ...p, ...(publish === undefined ? {} : { catalogue: (publish ? 1 : 0) as 0 | 1 }), slug: p.slug ? slugify(p.slug) : p.slug };
    if (next.catalogue && publishBlockers(next).length) { toast(publishBlockers(next)[0], true); return; }
    await saveProduct(next); setP(() => next);
    toast(publish === true ? "Published — live on the shop, trade portal and catalogues" : publish === false ? "Unpublished" : "Saved");
  }
  const len = (s: string, max: number) => <span className={"xs " + (s.length > max ? "bad" : "mut")}>{s.length}/{max}</span>;

  return (
    <div className="card">
      <header><Icon n="sell" size={16} /><h3>Online page</h3>
        <span className={"pill " + (live ? "ok" : "")} style={{ marginLeft: "auto" }}>{live ? "Live" : p.catalogue ? "Not live yet" : "Draft"}</span></header>
      <div className="pad stack">
        <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
          <label className="f grow" style={{ margin: 0 }}>Notes for the AI (optional)
            <input className="in" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. bridal, peacock motif, best seller in Rajasthan" /></label>
          <button className="btn p" onClick={write} disabled={busy}>{busy ? "Writing…" : c ? "✨ Rewrite with AI" : "✨ Write page with AI"}</button>
        </div>
        <div className="xs mut">Gemini reads the photo · OpenAI writes the page · Groq takes over if OpenAI is out of credits. {cloudImage(p) || p.photo_id ? "" : "Add a photo first for the best result."}</div>
        {attempts && <div className="chips">{attempts.map((a, i) => <span key={i} className={"pill " + (a.ok ? "ok" : "warn")} title={a.message}>{humanAttempt(a)}</span>)}</div>}

        {c && <>
          <label className="f">Title {len(c.title, 70)}<input className="in" value={c.title} onChange={e => setC({ title: e.target.value })} /></label>
          <label className="f">Subtitle<input className="in" value={c.subtitle} onChange={e => setC({ subtitle: e.target.value })} /></label>
          <label className="f">Description<textarea className="in" rows={6} value={c.description} onChange={e => setC({ description: e.target.value })} /></label>
          <label className="f">Highlights (one per line)<textarea className="in" rows={4} value={c.highlights.join("\n")} onChange={e => setC({ highlights: e.target.value.split("\n").map(x => x.trim()).filter(Boolean) })} /></label>
          <details className="stack">
            <summary className="b sm">Google (SEO)</summary>
            <label className="f">Meta title {len(c.seo.metaTitle, 60)}<input className="in" value={c.seo.metaTitle} onChange={e => setSeo({ metaTitle: e.target.value })} /></label>
            <label className="f">Meta description {len(c.seo.metaDescription, 160)}<textarea className="in" rows={2} value={c.seo.metaDescription} onChange={e => setSeo({ metaDescription: e.target.value })} /></label>
            <label className="f">Keywords (comma separated)<input className="in" value={c.seo.keywords.join(", ")} onChange={e => setSeo({ keywords: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })} /></label>
            <label className="f">Page address<div className="row" style={{ gap: 4, flexWrap: "nowrap" }}><span className="xs mut mono">/p/</span>
              <input className="in mono" value={p.slug || ""} onChange={e => setP(x => ({ ...x, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))} /></div></label>
            <div className="note sm" style={{ background: "#fff", border: "1px solid var(--line)" }}>
              <div style={{ color: "#1a0dab", fontSize: 16 }}>{c.seo.metaTitle}</div>
              <div style={{ color: "#006621" }} className="xs">{productUrl(p.slug || "…")}</div>
              <div className="xs" style={{ color: "#545454" }}>{c.seo.metaDescription}</div>
            </div>
          </details>
          <details className="stack">
            <summary className="b sm">Trade portal text</summary>
            <label className="f">Trade summary<textarea className="in" rows={3} value={c.trade.summary} onChange={e => setTrade({ summary: e.target.value })} /></label>
            <div className="grid g2">
              <label className="f">Packing<input className="in" value={c.trade.packing} onChange={e => setTrade({ packing: e.target.value })} /></label>
              <label className="f">Minimum order<input className="in" value={c.trade.moq} onChange={e => setTrade({ moq: e.target.value })} /></label>
            </div>
          </details>
          {!p.mrp && <div className="note warn sm">No MRP set — the retail page will say "Price on request". Trade rates always use the Rate field.</div>}
          <Switch on={!!p.catalogue} onChange={v => save(v)} label="Published" hint={blockers.length ? blockers[0] : "Visible on /shop, the trade portal and catalogues"} />
          <div className="row">
            <button className="btn" onClick={() => save()}>Save page</button>
            {live && <>
              <a className="btn sm" href={productUrl(p.slug!)} target="_blank" rel="noopener">View page ↗</a>
              <button className="btn sm" onClick={async () => toast((await copy(productUrl(p.slug!))) ? "Link copied" : productUrl(p.slug!))}>Copy link</button>
              <a className="btn sm g" href={waShare(`${c.title} — ${productUrl(p.slug!)}`)} target="_blank" rel="noopener">WhatsApp</a>
            </>}
          </div>
        </>}
      </div>
    </div>
  );
}
