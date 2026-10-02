import { useRef, useState } from "react";
import type { Product } from "../lib/db";
import { findByScan, label } from "../lib/products";
import { isRfidTag, linkTag, normTag, tagsOf, Recent } from "../lib/rfid";
import { useScannerGun } from "./Scanner";
import { Modal } from "./common";
import { beep, toast } from "../lib/app";

/* Link RFID tags: scan the product's QR / label, then the next tag the UHF reader (USB keyboard mode)
   reads is saved into that product's barcodes. Either order works: a fresh tag read first waits for the
   product scan. With a fixed product (product page, or `tag` from the RFID count) it links straight away.
   A tag already on another product is only moved after a yes, so a stray read never steals a tag. */
export function LinkRfid({ product, tag: tag0, onClose }: { product?: Product; tag?: string; onClose: () => void }) {
  const [target, setTarget] = useState<Product | undefined>(product);
  const [pending, setPending] = useState(tag0 ? normTag(tag0) : "");
  const [v, setV] = useState("");
  const [log, setLog] = useState<{ tag: string; text: string }[]>([]);
  const busy = useRef(false);
  const repeat = useRef(new Recent(4000));

  async function link(p: Product, tag: string) {
    const owner = await findByScan(tag);
    if (owner?.id === p.id) { if (repeat.current.first(tag)) toast("That tag is already on " + label(p)); return false; }
    if (owner && !confirm(`This tag is on ${label(owner)}. Move it to ${label(p)}?`)) return false;
    const { product: np, movedFrom } = await linkTag(p, tag);
    beep(true);
    const text = `${label(np)}${movedFrom ? ` (moved from ${label(movedFrom)})` : ""}`;
    setLog(l => [{ tag, text }, ...l.filter(x => x.tag !== tag)].slice(0, 20));
    toast("Tag linked to " + text);
    return true;
  }

  async function onCode(raw: string) {
    const r = raw.trim(); if (!r || busy.current) return;
    busy.current = true;
    try {
      if (isRfidTag(r)) {
        const tag = normTag(r);
        if (target) {
          if (await link(target, tag) && !product) { setTarget(undefined); if (tag0) onClose(); }
          return;
        }
        const owner = await findByScan(tag);
        if (owner) { if (repeat.current.first(tag)) toast(`That tag is on ${label(owner)} — scan a product first to move it`); return; }
        if (repeat.current.first(tag)) beep(true);
        setPending(tag);                           // tag first: link it to the next product scanned
        return;
      }
      const p = await findByScan(r);
      if (!p) { beep(false); toast("Product not found — scan its QR / label", true); return; }
      beep(true);
      if (pending) { if (await link(p, pending)) { setPending(""); if (tag0) onClose(); } return; }
      setTarget(p);
    } finally { busy.current = false; }
  }
  useScannerGun(c => onCode(c));

  return (
    <Modal title="Link RFID tag" onClose={onClose}>
      <div className="stack">
        <div className={"note sm " + (target ? "" : "warn")}>
          {target
            ? <>Now read the tag for <b>{label(target)}</b> <span className="mono xs">({target.code} · {tagsOf(target).length} tag{tagsOf(target).length === 1 ? "" : "s"} linked)</span></>
            : pending ? <>Tag <span className="mono">{pending}</span> read — now scan the product's QR or label.</>
            : <>Step 1: scan the product's QR or label (or read the tag first).</>}
        </div>
        <input className="in mono" autoFocus value={v} placeholder={target ? "Read the RFID tag…" : "Scan product QR…"} autoComplete="off" spellCheck={false}
          onChange={e => setV(e.target.value)} onKeyDown={e => { if ((e.key === "Enter" || (e.key === "Tab" && isRfidTag(v))) && v.trim()) { e.preventDefault(); onCode(v); setV(""); } }} />
        <div className="xs mut">The reader must be in USB keyboard (HID) mode. While linking, use single read (trigger) mode and hold one tag near the reader. A tag belongs to one product only — linking it to another asks before moving it.</div>
        {((target && !product) || (pending && !tag0)) && <button className="btn sm" onClick={() => { setTarget(product); setPending(""); }}>Start over</button>}
        {log.length > 0 && <div className="stack" style={{ gap: 4 }}>{log.map(l => <div key={l.tag} className="row between xs"><span className="mono">{l.tag}</span><span className="mut">{l.text}</span></div>)}</div>}
      </div>
    </Modal>
  );
}
