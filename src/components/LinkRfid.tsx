import { useRef, useState } from "react";
import type { Product } from "../lib/db";
import { findByScan, label } from "../lib/products";
import { isRfidTag, linkTag, normTag, tagsOf } from "../lib/rfid";
import { useScannerGun } from "./Scanner";
import { Modal } from "./common";
import { beep, toast } from "../lib/app";

/* Link RFID tags: scan the product's QR / label, then the next tag the UHF reader (USB keyboard mode)
   reads is saved into that product's barcodes. With a fixed product (product page) every tag read links to it. */
export function LinkRfid({ product, onClose }: { product?: Product; onClose: () => void }) {
  const [target, setTarget] = useState<Product | undefined>(product);
  const [v, setV] = useState("");
  const [log, setLog] = useState<{ tag: string; text: string }[]>([]);
  const busy = useRef(false);

  async function onCode(raw: string) {
    const r = raw.trim(); if (!r || busy.current) return;
    busy.current = true;
    try {
      if (isRfidTag(r)) {
        if (!target) { beep(false); toast("Scan the product's QR first, then read its tag", true); return; }
        const tag = normTag(r);
        const { product: p, movedFrom } = await linkTag(target, tag);
        beep(true);
        const text = `${label(p)}${movedFrom ? ` (moved from ${label(movedFrom)})` : ""}`;
        setLog(l => [{ tag, text }, ...l].slice(0, 20));
        toast("Tag linked to " + text);
        setTarget(product ? p : undefined);       // product page: keep linking to it; otherwise next product
        return;
      }
      const p = await findByScan(r);
      if (!p) { beep(false); toast("Product not found — scan its QR / label", true); return; }
      beep(true); setTarget(p);
    } finally { busy.current = false; }
  }
  useScannerGun(c => onCode(c));

  return (
    <Modal title="Link RFID tag" onClose={onClose}>
      <div className="stack">
        <div className={"note sm " + (target ? "" : "warn")}>
          {target
            ? <>Now read the tag for <b>{label(target)}</b> <span className="mono xs">({target.code} · {tagsOf(target).length} tag{tagsOf(target).length === 1 ? "" : "s"} linked)</span></>
            : <>Step 1: scan the product's QR or label.</>}
        </div>
        <input className="in mono" autoFocus value={v} placeholder={target ? "Read the RFID tag…" : "Scan product QR…"} autoComplete="off" spellCheck={false}
          onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === "Enter" && v.trim()) { e.preventDefault(); onCode(v); setV(""); } }} />
        <div className="xs mut">The reader must be in USB keyboard (HID) mode. Each tag can belong to one product only — linking it again moves it.</div>
        {target && !product && <button className="btn sm" onClick={() => setTarget(undefined)}>Choose a different product</button>}
        {log.length > 0 && <div className="stack" style={{ gap: 4 }}>{log.map(l => <div key={l.tag} className="row between xs"><span className="mono">{l.tag}</span><span className="mut">{l.text}</span></div>)}</div>}
      </div>
    </Modal>
  );
}
