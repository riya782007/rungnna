import { db, put, uid, now, getSetting, setSetting, type Bill, type Movement, type Receipt, type VoiceNote } from "./db";
import { isEstimate } from "./privacy";
import { setTagsSold } from "./rfid";
import { inStore } from "./stores";
import { requirePerm } from "./scope";

/* ===========================================================================
   Deleting estimates for good, from everywhere the app keeps them.

   An estimate leaves traces in more places than its own row, and the owner asked for all of them to go:
     • the estimate itself, and any credit note (ECN) that returned goods from one;
     • its stock movements (customer name, estimate number in the note);
     • payments recorded against it on a receipt;
     • the link from a tax invoice it was converted or merged into;
     • its parcel photo and voice note;
     • a held estimate, or one half-typed on the bill screen.

   What must NOT change: what is on the racks. Pieces that left the shop stay gone (their movements are kept,
   with nothing left on them that names the estimate or the customer), unless the owner says the goods never
   left — then they go back to the racks they came from. A tax invoice made from an estimate keeps its stock
   history: the movements are handed over to it.

   Every emptied row keeps only its id and is marked deleted, so every other counter and the cloud drop the
   content on their next sync. Emptied fields are sent as null: a field left out of a sync would keep the
   cloud's old value (the earlier delete left the customer link in the cloud this way).
=========================================================================== */

const N = null as any;   // "clear this column in the cloud too"

/** Everything that counts as an estimate document on this store: estimates in any state + estimate credit notes. */
export async function allEstimateDocs(): Promise<Bill[]> {
  return db.bills.filter(b => !b.deleted && inStore(b) && isEstimate(b)).toArray();
}

const emptied = (b: Bill): Bill => ({
  id: b.id, store_id: b.store_id, updated_at: now(), deleted: 1,
  no: "", series: "", bill_type: b.bill_type, status: "void", src_type: b.src_type,
  party_id: N, party_name: "", party_phone: "", party_gstin: "", party_state: "", party_address: N, price_level: N,
  salesman: "", box_count: 0, total_qty: 0, gross: 0, discount: 0, discount_pct: 0, packing: 0, adjust: 0,
  gst_mode: "exclusive", gst_rate: 0, gst: 0, cgst: 0, sgst: 0, igst: 0, net: 0, advance: 0, paid: 0,
  remarks: "", payments: [], items: [], rfid_tags: [], photo_id: N, photo_url: N, voice_id: N,
  converted_from: N, converted_to: N, void_reason: "", merged_into: N, merged_into_no: N, merged_from: N,
  return_of: N, return_of_no: N, oversold: N, transport: N, compliance: N, prev_due: N,
  device: "", by_staff: "", at: "1970-01-01T00:00:00.000Z",
} as Bill);

export type PurgeResult = { estimates: number; creditNotes: number; movements: number; receipts: number; invoicesKept: number; backOnRacks: number; voiceFiles: string[] };

/** Delete these estimate documents (and the credit notes that return them) everywhere. */
export async function purgeEstimates(chosen: Bill[], opts: { returnStock: boolean; by: string }): Promise<PurgeResult> {
  requirePerm("estimates.delete", "deleting estimates");
  const docs = chosen.filter(b => !b.deleted && isEstimate(b));
  const ids = new Set(docs.map(b => b.id));
  // a credit note that returned goods from a chosen estimate goes with it
  const ecns = await db.bills.filter(b => !b.deleted && b.bill_type === "return" && !!b.return_of && ids.has(b.return_of) && !ids.has(b.id)).toArray();
  for (const c of ecns) { docs.push(c); ids.add(c.id); }
  const out: PurgeResult = { estimates: 0, creditNotes: 0, movements: 0, receipts: 0, invoicesKept: 0, backOnRacks: 0, voiceFiles: [] };

  await db.transaction("rw", [db.bills, db.movements, db.outbox, db.stock, db.products, db.receipts, db.photos, db.voice_notes, db.voice_blobs, db.settings], async () => {
    for (const b of docs) {
      // where this estimate's goods live on: the tax invoice it became, or the invoice it was merged into
      const heir = b.status === "converted" && b.converted_to ? await db.bills.get(b.converted_to)
        : b.status === "merged" && b.merged_into ? await db.bills.get(b.merged_into) : undefined;
      const live = heir && !heir.deleted && !ids.has(heir.id) ? heir : undefined;

      if (live) {
        out.invoicesKept++;
        await put("bills", { ...live, converted_from: live.converted_from === b.id ? N : live.converted_from, merged_from: live.merged_from?.filter(x => x !== b.id) });
      } else if (opts.returnStock && b.bill_type === "estimate" && b.status === "final") {
        await setTagsSold(b.rfid_tags, null);
        const outs = await db.movements.where("ref_bill").equals(b.id).filter(m => m.kind === "sale" && !m.deleted).toArray();
        for (const m of outs) {
          await put("movements", { ...m, id: uid(), kind: "return", from_loc: null, to_loc: m.from_loc, person_name: "", note: "", ref_bill: N, at: now(), by_staff: opts.by } as Movement);
          if (m.from_loc) { const k = m.product_id + "|" + m.from_loc; const c = await db.stock.get(k); await db.stock.put({ key: k, product_id: m.product_id, loc_id: m.from_loc, qty: (c?.qty || 0) + m.qty }); out.backOnRacks += m.qty; }
        }
      }

      // its movements stay (the racks are right) but no longer say whose estimate they were
      const moves = await db.movements.where("ref_bill").equals(b.id).toArray();
      for (const m of moves) {
        out.movements++;
        await put("movements", live ? { ...m, ref_bill: live.id, note: live.no, person_name: live.party_name || "" } : { ...m, ref_bill: N, note: "", person_name: "" } as Movement);
      }

      if (b.photo_id) await db.photos.delete(b.photo_id);
      const notes = await db.voice_notes.where("entity_id").equals(b.id).toArray();
      if (b.voice_id && !notes.some(n => n.id === b.voice_id)) { const v = await db.voice_notes.get(b.voice_id); if (v) notes.push(v); }
      for (const n of notes) {
        await db.voice_blobs.delete(n.id);
        if (n.url) out.voiceFiles.push(n.url);
        await put("voice_notes", { ...n, deleted: 1, transcript: "", url: N, entity_id: "", seconds: 0 } as VoiceNote);
      }

      await put("bills", emptied(b));
      if (b.bill_type === "estimate") out.estimates++; else out.creditNotes++;
    }

    // money taken against them comes off the receipts; a receipt that was only for estimates goes entirely
    const rcpts = await db.receipts.filter(r => !r.deleted && r.allocations.some(a => ids.has(a.bill_id))).toArray();
    for (const r of rcpts) {
      out.receipts++;
      const gone = r.allocations.filter(a => ids.has(a.bill_id)).reduce((s, a) => s + a.amount, 0);
      const keep = r.allocations.filter(a => !ids.has(a.bill_id));
      const amount = r.amount - gone;
      if (amount <= 0 && !keep.length) await put("receipts", { ...r, deleted: 1, amount: 0, allocations: [], party_name: "", note: "", unallocated: 0, opening_part: 0 } as Receipt);
      else await put("receipts", { ...r, amount: Math.max(0, amount), allocations: keep });
    }

    // an estimate half-typed or held on this counter
    const draft = await getSetting<Bill | null>("draft_bill", null);
    if (draft && isEstimate(draft)) await setSetting("draft_bill", null);
  });
  return out;
}

/** The "Delete all estimates" button. */
export async function purgeAllEstimates(opts: { returnStock: boolean; by: string }) {
  return purgeEstimates(await allEstimateDocs(), opts);
}

/** The recordings themselves, in the cloud's voice store (best effort: the rows pointing at them are already gone). */
export async function removeCloudVoice(urls: string[]) {
  if (!urls.length) return 0;
  const { sb } = await import("./sync");
  const c = await sb(); if (!c) return 0;
  const paths = urls.map(u => decodeURIComponent(u.split("/object/public/voice/")[1] || "")).filter(Boolean);
  if (!paths.length) return 0;
  const { error } = await c.storage.from("voice").remove(paths);
  return error ? 0 : paths.length;
}
