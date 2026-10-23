import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { OLD_ITEMS, DEFAULT_FALLBACK, loadOldCodes, readOldCodes, saveOldCodes, suggestOldCode } from "../lib/old-codes";
import { toast } from "../lib/app";

/* Owner, 23 Oct: the old billing software must read our stickers. It knows an item only by its own number,
   so each of the shop's names is matched once to the old item it is billed as. Suggestions are filled in;
   one tap keeps them. Saved for every counter. Names left on "—" print the Rungnna QR (our app only). */
export function OldCodesCard({ names, title = "Old software reads these stickers", open = true }: { names: string[]; title?: string; open?: boolean }) {
  const cfg = useLiveQuery(async () => readOldCodes((await db.config.get("old_codes"))?.value), [], { aliases: {} as Record<string, string>, ref: "183", fallback: DEFAULT_FALLBACK });
  const [ref, setRef] = useState<string | null>(null);
  const list = [...new Set(names.map(n => n.trim().toUpperCase()).filter(Boolean))].sort();
  if (!list.length) return null;
  const missing = list.filter(n => !cfg.aliases[n]);
  const fb = OLD_ITEMS.find(i => i.code === cfg.fallback);
  const guesses = Object.fromEntries(missing.map(n => [n, suggestOldCode(n)]).filter(([, c]) => c));
  const set = async (patch: Parameters<typeof saveOldCodes>[0], what: string) => { await saveOldCodes(patch); await loadOldCodes(); toast(what); };
  return <details className="note stack old-codes" open={open || (!!missing.length && !fb)}>
    <summary><b>{title}</b> <span className="xs mut">— {missing.length ? (fb ? `${missing.length} name${missing.length === 1 ? "" : "s"} not matched yet: the old software bills ${missing.length === 1 ? "it" : "them"} as ${fb.code} · ${fb.name}` : `${missing.length} name${missing.length === 1 ? "" : "s"} not matched yet: those stickers scan only in this app`) : "every name is matched ✓"}</span></summary>
    <div className="xs mut">The old software knows each item by its own number. Choose which old item each of your names is billed as — once; every counter remembers it. The sticker still shows your own name.</div>
    {!!Object.keys(guesses).length && <button type="button" className="btn sm p" onClick={() => void set({ aliases: guesses }, `${Object.keys(guesses).length} matched`)}>Use the {Object.keys(guesses).length} suggestion{Object.keys(guesses).length === 1 ? "" : "s"}</button>}
    <div className="grid g3">{list.map(n => {
      const cur = cfg.aliases[n] || "", guess = !cur ? guesses[n] : "";
      return <label className="f" key={n}>{n}{guess && <span className="xs mut"> · suggested {guess}</span>}
        <select className={"in" + (cur ? "" : " warn-in")} value={cur || guess || ""} onChange={e => void set({ aliases: { [n]: e.target.value || null } }, e.target.value ? `${n} → ${e.target.value}` : `${n}: Rungnna QR only`)}>
          <option value="">— not matched{fb ? ` (old software: ${fb.code} · ${fb.name})` : " (Rungnna QR)"}</option>
          {OLD_ITEMS.map(i => <option key={i.code} value={i.code}>{i.code} · {i.name}</option>)}
        </select></label>;
    })}</div>
    <label className="f" style={{ maxWidth: 360 }}>Names not matched are billed in the old software as
      <select className="in" value={cfg.fallback} onChange={e => void set({ fallback: e.target.value }, e.target.value ? `Unmatched names → ${e.target.value}` : "Unmatched names: Rungnna QR only")}>
        <option value="">— nothing (those stickers scan only in this app)</option>
        {OLD_ITEMS.map(i => <option key={i.code} value={i.code}>{i.code} · {i.name}</option>)}
      </select></label>
    <label className="f" style={{ maxWidth: 260 }}>REF on the sticker (old software)
      <input className="in mono" value={ref ?? cfg.ref} placeholder="e.g. 183" onChange={e => setRef(e.target.value.replace(/[^0-9A-Za-z]/g, "").slice(0, 12))}
        onBlur={() => { if (ref !== null && ref !== cfg.ref) void set({ ref }, ref ? `REF ${ref} saved` : "REF cleared"); setRef(null); }} /></label>
    <div className="xs mut">Most of your old stickers carry REF 183. Leave it as on your old stickers so the old software accepts them.</div>
  </details>;
}
