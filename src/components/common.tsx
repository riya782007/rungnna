import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type Location } from "../lib/db";
import { photoSrc, savePhoto } from "../lib/image";
import { Icon } from "./Icon";

export const LOC_PREFIX = "RJLOC|";

export const locName = (l?: Location) =>
  !l ? "—" : l.kind === "bucket" ? l.name : [l.floor && (l.floor === "G" ? "Ground" : "Floor " + l.floor), l.rack && "Rack " + l.rack, l.box && "Box " + l.box].filter(Boolean).join(" · ") + (l.name ? ` (${l.name})` : "");

export function useLocations() {
  return useLiveQuery(async () => (await db.locations.toArray()).filter(l => !l.deleted).sort((a, b) =>
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
export function PhotoButton({ value, onChange, label = "Photo" }: { value?: string; onChange: (photo_id: string | undefined) => void; label?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="row">
      {value && <Thumb photo_id={value} size={56} />}
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden
        onChange={async e => {
          const f = e.target.files?.[0]; if (!f) return;
          setBusy(true); try { onChange(await savePhoto(f)); } finally { setBusy(false); e.target.value = ""; }
        }} />
      <button type="button" className="btn sm" onClick={() => ref.current?.click()} disabled={busy}>
        {busy ? "Saving…" : value ? "Retake " + label.toLowerCase() : <><Icon n="camera" size={17} />{label}</>}
      </button>
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
