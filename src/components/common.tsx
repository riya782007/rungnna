import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Location, type Product } from "../lib/db";
import { photoSrc, savePhoto } from "../lib/image";
import { Icon } from "./Icon";
import { inStore } from "../lib/scope";
const CustomerCamera = lazy(() => import("./CustomerCamera"));

export { LOC_PREFIX } from "../lib/rackLabel";

export const locName = (l?: Location) =>
  !l ? "—" : l.kind === "bucket" ? l.name : [l.floor && (l.floor === "G" ? "Ground" : "Floor " + l.floor), l.rack && "Rack " + l.rack, l.box && "Box " + l.box].filter(Boolean).join(" · ") + (l.name ? ` (${l.name})` : "");

export function useLocations() {
  return useLiveQuery(async () => (await db.locations.toArray()).filter(l => !l.deleted && inStore(l)).sort((a, b) =>
    (a.kind === "bucket" ? 1 : 0) - (b.kind === "bucket" ? 1 : 0) || a.code.localeCompare(b.code, undefined, { numeric: true })), [], []);
}

export function LocationSelect({ value, onChange, allowNone, label = "Location", buckets = true }:
  { value: string; onChange: (id: string) => void; allowNone?: string; label?: string; buckets?: boolean }) {
  const locs = useLocations();
  const floors = [...new Set(locs.filter(l => l.kind !== "bucket").map(l => l.floor))];
  return (
    <label className="f">{label}
      <select className="in" value={value} onChange={e => onChange(e.target.value)}>
        <option value="">{allowNone || "— choose —"}</option>
        {floors.map(f => (
          <optgroup key={f} label={f === "G" ? "Ground floor" : f ? "Floor " + f : "Other"}>
            {locs.filter(l => l.kind !== "bucket" && l.floor === f).map(l => <option key={l.id} value={l.id}>{l.code}{l.name ? " — " + l.name : ""}</option>)}
          </optgroup>
        ))}
        {buckets && <optgroup label="Status buckets">
          {locs.filter(l => l.kind === "bucket").map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
        </optgroup>}
      </select>
    </label>
  );
}

export function Thumb({ photo_id, url, text, size = 48 }: { photo_id?: string; url?: string; text?: string; size?: number }) {
  const [src, setSrc] = useState("");
  useEffect(() => { let a = true; photoSrc(photo_id, url).then(s => a && setSrc(s)); return () => { a = false; }; }, [photo_id, url]);
  return <span className="thumb" style={{ width: size, height: size }}>{src ? <img src={src} alt="" loading="lazy" /> : (text || "RJ").slice(0, 2)}</span>;
}

/* Opens the phone's back camera directly; compresses to <100 KB before saving. */
export function PhotoButton({ value, onChange, label = "Photo", webcam = false }: { value?: string; onChange: (photo_id: string | undefined) => void; label?: string; webcam?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [camera, setCamera] = useState(false);
  return (
    <div className="row">
      {value && <Thumb photo_id={value} size={56} />}
      <input ref={ref} type="file" accept="image/*" capture={webcam ? undefined : "environment"} hidden
        onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          setBusy(true); try { onChange(await savePhoto(f)); } finally { setBusy(false); e.target.value = ""; }
        }} />
      <button type="button" className="btn sm" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? "Saving…" : webcam ? "Upload photo" : value ? "Retake " + label.toLowerCase() : <><Icon n="camera" size={17} />{label}</>}
      </button>
      {webcam && <button type="button" className="btn sm" onClick={() => setCamera(true)} disabled={busy}><Icon n="camera" size={17} />Take photo</button>}
      {camera && <Suspense fallback={<div role="status">Opening camera…</div>}><CustomerCamera onPhoto={onChange} onClose={() => setCamera(false)} /></Suspense>}
      {value && <button type="button" className="btn sm bad" onClick={() => onChange(undefined)}>Remove</button>}
    </div>
  );
}

export function Head({ eyebrow, title, sub, children }: { eyebrow?: string; title: string; sub?: string; children?: ReactNode }) {
  return (
    <div className="head">
      <div>
        
        <h1 className="h1">{title}</h1>
        {sub && <p className="mut sm" style={{ margin: "4px 0 0", maxWidth: "62ch" }}>{sub}</p>}
      </div>
      {children && <div className="acts">{children}</div>}
    </div>
  );
}

export function Modal({ onClose, children, title }: { onClose: () => void; children: ReactNode; title: string }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === "Escape" && onClose(); addEventListener("keydown", f); return () => removeEventListener("keydown", f); }, [onClose]);
  return (
    <div className="modal" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="sheet card">
        <header><h3 className="grow">{title}</h3><button className="btn sm" onClick={onClose}>Close</button></header>
        <div className="pad">{children}</div>
      </div>
    </div>
  );
}

/* iOS-style switch */
export function Switch({ on, onChange, label, hint }: { on: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" onClick={() => onChange(!on)}>
      <span className="grow" style={{ textAlign: "left" }}><span className="sm b" style={{ display: "block" }}>{label}</span>{hint && <span className="xs mut">{hint}</span>}</span>
      <span className="knob" />
    </button>
  );
}
/* TK on the shop's labels means dead stock. */
export function DeadToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <Switch on={!!value?.trim()} onChange={v => onChange(v ? "TK" : "")} label="Dead stock (TK)" hint="Not selling any more — shown on the dashboard, flagged at billing" />;
}

/* ---------------------------------------------------------------------------
   Product image assist.

   Two photos matter for a product:
     • the RAW photo the owner shoots at the counter (kept on the device), and
     • the polished, professional advertising image used in the catalogue.

   The app does NOT generate or host the polished image. Instead this control:
     1. keeps the raw photo (camera / upload),
     2. writes the exact Google-Flow prompt for a model-worn advertising shot of
        THIS piece (design, architecture & colour identical, absolutely no text),
        refined by AI from the raw photo when online,
     3. copies the prompt, downloads the raw photo, and opens Google Flow so the
        owner drags the raw in, pastes the prompt and generates the image, then
     4. lets the owner upload that finished professional image to REPLACE the raw.
--------------------------------------------------------------------------- */
export function ImageAssist({ product, onPhoto }: {
  product: Pick<Product, "item" | "category" | "style" | "color" | "photo_id" | "photo_url">;
  onPhoto: (photo_id: string | undefined) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="row">
        <Thumb photo_id={product.photo_id} url={product.photo_url} text={product.item} size={72} />
        <div className="stack" style={{ gap: 6 }}>
          <PhotoButton value={product.photo_id} onChange={onPhoto} label="Raw photo" />
          <button type="button" className="btn sm" disabled={!(product.photo_id || product.photo_url)} onClick={() => setOpen(true)}>
            <Icon n="ask" size={15} /> Create pro image (Google Flow)
          </button>
        </div>
      </div>
      <div className="xs mut">Shoot the piece as-is, then make a professional model shot in Google Flow and upload it back here.</div>
      {open && <FlowModal product={product} onClose={() => setOpen(false)} onUploaded={onPhoto} />}
    </div>
  );
}

function FlowModal({ product, onClose, onUploaded }: {
  product: Pick<Product, "item" | "category" | "style" | "color" | "photo_id" | "photo_url">;
  onClose: () => void; onUploaded: (photo_id: string | undefined) => void;
}) {
  const [prompt, setPrompt] = useState("");
  const [keywords, setKeywords] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const upRef = useRef<HTMLInputElement>(null);

  async function rawBlob(): Promise<Blob | null> {
    if (product.photo_id) return (await db.photos.get(product.photo_id))?.blob || null;
    if (product.photo_url) return (await fetch(product.photo_url)).blob().catch(() => null);
    return null;
  }

  async function makePrompt() {
    setBusy(true);
    try {
      const { shotPromptForProduct } = await import("../lib/imagePrompt");
      const base = shotPromptForProduct(product as any, keywords.trim() || undefined);
      let final = base;
      const blob = await rawBlob();
      if (blob) { const { refineShotPrompt } = await import("../lib/ai"); final = await refineShotPrompt(base, blob); }
      setPrompt(final);
    } finally { setBusy(false); }
  }

  async function copyPrompt() {
    const text = prompt || (await (async () => { await makePrompt(); return ""; })());
    try { await navigator.clipboard.writeText(prompt || text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }

  async function downloadRaw() {
    const blob = await rawBlob(); if (!blob) return;
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `${(product.style || product.item || "product").replace(/\W+/g, "-")}-raw.${blob.type.includes("png") ? "png" : "jpg"}`;
    a.click();
  }

  return (
    <Modal title="Create a professional image with Google Flow" onClose={onClose}>
      <div className="stack">
        <ol className="sm" style={{ margin: 0, paddingLeft: 18, lineHeight: 1.7 }}>
          <li>Add 1–2 extra details (optional), then <b>Build prompt</b>.</li>
          <li><b>Copy prompt</b> and <b>Download raw photo</b>.</li>
          <li><b>Open Google Flow</b> → paste the prompt, drag the raw photo in, generate, download the result.</li>
          <li><b>Upload finished image</b> below to use it on the product &amp; catalogue.</li>
        </ol>
        <label className="f">Extra details for the shot (optional)
          <input className="in" placeholder="e.g. kundan, peacock motif, ruby drops" value={keywords} onChange={e => setKeywords(e.target.value)} /></label>
        <div className="row">
          <button className="btn p" onClick={makePrompt} disabled={busy}>{busy ? "Writing…" : prompt ? "Rebuild prompt" : "Build prompt"}</button>
          {prompt && <button className="btn" onClick={copyPrompt}>{copied ? "Copied ✓" : "Copy prompt"}</button>}
          {(product.photo_id || product.photo_url) && <button className="btn" onClick={downloadRaw}>Download raw photo</button>}
        </div>
        {prompt && <textarea className="in mono" rows={8} value={prompt} onChange={e => setPrompt(e.target.value)} style={{ fontSize: 12 }} />}
        <div className="row">
          <a className="btn dk" href="https://labs.google/fx/tools/flow" target="_blank" rel="noopener noreferrer">Open Google Flow ↗</a>
          <input ref={upRef} type="file" accept="image/*" hidden onChange={async e => {
            const f = e.target.files?.[0]; e.target.value = ""; if (!f) return;
            const id = await savePhoto(f); onUploaded(id);
            onClose();
          }} />
          <button className="btn g" onClick={() => upRef.current?.click()}>Upload finished image</button>
        </div>
        <div className="xs mut">The finished image replaces the raw photo on this product. Google Flow opens in a new tab — your work here stays open.</div>
      </div>
    </Modal>
  );
}
