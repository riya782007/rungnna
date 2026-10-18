import { useRef, useState } from "react";
import { Camera } from "lucide-react";
import type { Product } from "../lib/db";
import { savePhoto } from "../lib/image";
import { saveProduct } from "../lib/products";
import { cloudImage, publishBlockers, slugFor } from "../lib/listing";
import { Thumb } from "./common";
import { toast } from "../lib/app";

/* ===========================================================================
   Add a photo, and put a design live, without leaving the list.

   A design needs two things before it can go on the site: a page (the AI writes
   it) and a photo. The photo was the piece that forced the owner to open each
   design one at a time. These two little controls sit on the row itself.

   The photo is saved on the device first and uploaded by the usual sync, so it
   works in the shop with no internet — but the site can only show a photo the
   cloud has. The row says so plainly instead of pretending it is live.
=========================================================================== */

export function QuickPhoto({ p, compact }: { p: Product; compact?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const local = p.pro_photo_id || p.photo_id;
  const cloud = cloudImage(p);

  async function pick(f: File) {
    setBusy(true);
    try {
      const photo_id = await savePhoto(f);
      await saveProduct({ ...p, photo_id });
      toast(navigator.onLine === false
        ? "Photo saved on this device — it uploads when you are back online"
        : "Photo saved — it goes on the site once it finishes uploading");
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  }

  return (
    <>
      <input ref={ref} type="file" accept="image/*" capture="environment" hidden
        onChange={e => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void pick(f); }} />
      {cloud || local ? <Thumb photo_id={local} url={p.pro_photo_url || p.photo_url} text={p.item} size={compact ? 32 : 40} /> : null}
      <button type="button" className="btn sm" disabled={busy} onClick={() => ref.current?.click()}
        title={cloud ? "Replace the photo on the site" : local ? "Photo is still uploading — tap to replace it" : "Take or choose a photo for the site"}>
        {busy ? "Saving…" : <><Camera size={15} />{cloud ? (compact ? "" : "Change") : local ? "Uploading…" : "Add photo"}</>}
      </button>
    </>
  );
}

/** Put one design live from the row it is already on. */
export function PutLive({ p, onDone }: { p: Product; onDone?: () => void }) {
  const [busy, setBusy] = useState(false);
  const why = publishBlockers(p);
  return (
    <button type="button" className={"btn sm" + (why.length ? "" : " p")} disabled={busy || !!why.length}
      title={why[0] || "Show this design on the shop, dealer portal and catalogues"}
      onClick={async () => {
        setBusy(true);
        try {
          await saveProduct({ ...p, catalogue: 1, slug: p.slug || slugFor(p, p.content?.title || p.item) });
          toast("Live on the shop, dealer portal and catalogues");
          onDone?.();
        } catch (e: any) { toast(e.message, true); }
        finally { setBusy(false); }
      }}>
      {busy ? "…" : why.length ? "Not ready" : "Put live"}
    </button>
  );
}
