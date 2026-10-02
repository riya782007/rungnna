import { db, put, uid, now, deviceId, type Bill, type BillLine, type BillType, type Movement, type Payment } from "./db";
import { totals, fixLine, finalize, newBill, bumpStock, isSale, isChallan, type Shop } from "./billing";
import { setTagsSold } from "./rfid";

/* Documents made from other documents — all offline, all-or-nothing:
   merge (several estimates / orders / challans → one invoice), split (some lines → a new bill),
   sales return (lines of a saved bill → credit note). */

/* ---------------- merge ---------------- */

/* A bill whose goods are already off the racks: any saved invoice / estimate / challan. Held orders are not. */
export const stockOut = (b: Pick<Bill, "status">) => b.status === "final";

/* Which documents can be combined into one invoice. Saved GST invoices are never merged (they're already filed). */
export const mergeable = (b: Bill) =>
  !b.deleted && !b.converted_to && !b.merged_into &&
  ((b.bill_type === "estimate" && (b.status === "final" || b.status === "hold")) ||
   (b.bill_type === "gst" && b.status === "hold") ||
   (b.bill_type === "challan" && (b.status === "final" || b.status === "hold")));

const partyKey = (b: Pick<Bill, "party_id" | "party_name" | "party_phone">) =>
  b.party_id || ("~" + (b.party_name || "").trim().toUpperCase() + "|" + (b.party_phone || "").replace(/\D/g, ""));

/** null when these can be merged, otherwise why not (shown to the user) */
export function canMerge(bills: Bill[]): string | null {
  if (bills.length < 2 && !(bills.length === 1 && isChallan(bills[0]))) return "Pick at least two bills to merge";
  const bad = bills.find(b => !mergeable(b));
  if (bad) return `${bad.no || "A held bill"} can't be merged (${bad.status === "final" && bad.bill_type === "gst" ? "saved tax invoice" : bad.status})`;
  if (new Set(bills.map(partyKey)).size > 1) return "All the bills must be for the same customer";
  return null;
}

/* Lines are combined: the same product at the same rate, discount and packet size becomes one line.
   Pieces that already left with a saved source stay marked stock_done, so they are never deducted twice. */
export function mergeLines(sources: Bill[]): BillLine[] {
  const out: BillLine[] = [];
  const key = (l: BillLine) => [l.product_id || "~" + l.item + "|" + l.style + "|" + l.color, l.rate, l.disc, l.pack, l.stock_done ? 1 : 0].join("§");
  const idx = new Map<string, number>();
  for (const s of [...sources].sort((a, z) => a.at.localeCompare(z.at))) {
    const done = stockOut(s);
    for (const l0 of s.items) {
      const l: BillLine = { ...l0, ...(done || l0.stock_done ? { stock_done: 1 as const } : { stock_done: undefined }) };
      const k = key(l), i = idx.get(k);
      if (i === undefined) { idx.set(k, out.length); out.push(fixLine({ ...l, id: uid(), src_line: undefined })); continue; }
      const m = out[i];
      out[i] = fixLine(m.pack > 1 && m.pkts > 0 && l.pkts > 0 ? { ...m, pkts: m.pkts + l.pkts } : { ...m, pkts: 0, qty: m.qty + l.qty });
    }
  }
  return out;
}

/* The new invoice (still unsaved): customer from the first source, lines combined, every payment and advance carried over. */
export function buildMerged(sources: Bill[], type: BillType, shop: Shop, by: string): Bill {
  const first = [...sources].sort((a, z) => a.at.localeCompare(z.at))[0];
  const tot = sources.map(s => totals(s, shop.state));
  const b = newBill(by, shop, type);
  return {
    ...b,
    party_id: first.party_id, party_name: first.party_name, party_phone: first.party_phone, party_gstin: first.party_gstin, party_state: first.party_state,
    salesman: first.salesman, items: mergeLines(sources),
    discount: tot.reduce((a, t) => a + t.discount, 0), discount_pct: 0,
    packing: tot.reduce((a, t) => a + t.packing, 0),
    // each source's advance becomes a dated cash payment, so the day it was taken keeps it (end-of-day never counts it twice)
    advance: 0,
    payments: sources.flatMap(s => [
      ...(s.advance ? [{ mode: "cash" as const, amount: s.advance, ref: "Advance on " + (s.no || "order"), at: s.at }] : []),
      ...s.payments.map(p => ({ ...p, ref: p.ref || "from " + (s.no || "held bill"), at: p.at || s.at })),
    ]),
    remarks: [...new Set(sources.map(s => s.remarks).filter(Boolean))].join(" · "),
    rfid_tags: [...new Set(sources.flatMap(s => s.rfid_tags || []))],
    merged_from: sources.map(s => s.id),
  };
}

/* Save the merged invoice and mark every source "merged into <no>" in one go. */
export async function mergeBills(sources: Bill[], type: BillType, shop: Shop, by: string): Promise<Bill> {
  const why = canMerge(sources); if (why) throw new Error(why);
  // re-read: another device or tab may have touched them since they were ticked
  const fresh = (await db.bills.bulkGet(sources.map(s => s.id))).filter(Boolean) as Bill[];
  const why2 = canMerge(fresh); if (why2 || fresh.length !== sources.length) throw new Error(why2 || "Some bills changed — refresh and try again");
  const draft = buildMerged(fresh, type, shop, by);
  return finalize(draft, shop.state, draft.party_name, async saved => {
    for (const s of fresh) await put("bills", { ...s, status: "merged", merged_into: saved.id, merged_into_no: saved.no });
  });
}

/* ---------------- split ---------------- */

export const splittable = (b: Bill) => !b.deleted && (isSale(b) || isChallan(b)) && (b.status === "hold" || b.status === "final") && !b.converted_to && !b.merged_into;

/* Move some lines to a new bill. A held bill just becomes two held bills. A saved bill keeps its number,
   the new one gets the next number of the same series, and the sale movements of the moved pieces are
   handed to the new bill (so cancelling either one returns exactly its own pieces). Payments stay on the original. */
export async function splitBill(b0: Bill, lineIds: string[], shop: Shop, by: string): Promise<{ original: Bill; split: Bill }> {
  const b = (await db.bills.get(b0.id)) || b0;
  if (!splittable(b)) throw new Error("This bill can't be split");
  const ids = new Set(lineIds);
  const moving = b.items.filter(l => ids.has(l.id)), staying = b.items.filter(l => !ids.has(l.id));
  if (!moving.length) throw new Error("Tick the lines to move");
  if (!staying.length) throw new Error("Leave at least one line on the original bill");
  const fresh = newBill(by, shop, b.bill_type);
  const base: Bill = { ...fresh, party_id: b.party_id, party_name: b.party_name, party_phone: b.party_phone, party_gstin: b.party_gstin,
    party_state: b.party_state, salesman: b.salesman, gst_rate: b.gst_rate, gst_mode: b.gst_mode, remarks: "Split from " + (b.no || "held bill") };
  const movingProducts = new Set(moving.map(l => l.product_id).filter(Boolean) as string[]);
  const pieces = await db.products.bulkGet([...movingProducts]);
  const tagSet = new Set(pieces.flatMap(p => p?.barcodes || []));
  const tagsMoving = (b.rfid_tags || []).filter(t => tagSet.has(t) && !staying.some(l => l.product_id && pieces.find(p => p?.id === l.product_id)?.barcodes.includes(t)));

  if (b.status === "hold") {
    const split = totals({ ...base, items: moving.map(l => ({ ...l })), rfid_tags: tagsMoving }, shop.state);
    const original = totals({ ...b, items: staying, rfid_tags: (b.rfid_tags || []).filter(t => !tagsMoving.includes(t)) }, shop.state);
    await db.transaction("rw", [db.bills, db.outbox], async () => { await put("bills", split); await put("bills", original); });
    return { original, split };
  }

  const original = totals({ ...b, items: staying, rfid_tags: (b.rfid_tags || []).filter(t => !tagsMoving.includes(t)) }, shop.state);
  const draft: Bill = { ...base, items: moving.map(l => ({ ...l, stock_done: 1 as const })), rfid_tags: tagsMoving };
  const split = await finalize(draft, shop.state, b.party_name, async saved => {
    await put("bills", original);
    // hand over the sale movements of the moved pieces, splitting a movement when only part of it moves
    const need = new Map<string, number>();
    for (const l of moving) if (l.product_id && !l.stock_done) need.set(l.product_id, (need.get(l.product_id) || 0) + l.qty);
    const outs = await db.movements.where("ref_bill").equals(b.id).filter(m => m.kind === "sale" && !m.deleted).toArray();
    for (const m of outs) {
      const want = need.get(m.product_id) || 0; if (!want) continue;
      const q = Math.min(want, m.qty); need.set(m.product_id, want - q);
      if (q === m.qty) await put("movements", { ...m, ref_bill: saved.id, note: saved.no });
      else {
        await put("movements", { ...m, qty: m.qty - q });
        await put("movements", { ...m, id: uid(), qty: q, ref_bill: saved.id, note: saved.no, updated_at: now() } as Movement);
      }
    }
  });
  return { original, split };
}

/* ---------------- sales return / credit note ---------------- */

export const returnableBill = (b: Bill) => !b.deleted && b.status === "final" && isSale(b);

/* How many pieces of each line can still come back: sold − already returned on saved credit notes. */
export function returnable(bill: Bill, creditNotes: Bill[]): Map<string, number> {
  const back = new Map<string, number>();
  for (const cn of creditNotes) if (cn.return_of === bill.id && cn.status === "final" && !cn.deleted)
    for (const l of cn.items) if (l.src_line) back.set(l.src_line, (back.get(l.src_line) || 0) + l.qty);
  return new Map(bill.items.map(l => [l.id, Math.max(0, l.qty - (back.get(l.id) || 0))]));
}

/* The credit note (unsaved). Same rates as the bill; the bill's own discount is shared out in proportion,
   packing is not refunded. A tax invoice's credit note reverses its GST at the same rate. */
export function buildReturn(bill: Bill, picks: { line_id: string; qty: number }[], left: Map<string, number>, shop: Shop, by: string): Bill {
  const items: BillLine[] = [];
  for (const p of picks) {
    const l = bill.items.find(x => x.id === p.line_id);
    const q = Math.min(Math.max(0, Math.floor(p.qty)), left.get(p.line_id) ?? 0);
    if (!l || !q) continue;
    items.push(fixLine({ ...l, id: uid(), src_line: l.id, pkts: 0, qty: q, stock_done: undefined }));
  }
  const cn0: Bill = {
    ...newBill(by, shop, "return"),
    party_id: bill.party_id, party_name: bill.party_name, party_phone: bill.party_phone, party_gstin: bill.party_gstin, party_state: bill.party_state,
    salesman: bill.salesman, gst_rate: bill.gst_rate, gst_mode: bill.gst_mode, items,
    return_of: bill.id, return_of_no: bill.no, src_type: bill.bill_type, remarks: "Return against " + bill.no,
  };
  const gross = items.reduce((a, l) => a + l.amount, 0);
  const share = bill.gross ? Math.round((bill.discount * gross) / bill.gross) : 0;
  return { ...cn0, discount: Math.min(gross, share) };
}

/* Save the credit note: number it (CN/ or ECN/), put each piece back on the rack it left from
   (fullest-first in the order it went out), free its RFID tags, and record any cash refunded. */
export async function saveReturn(cn0: Bill, bill: Bill, shop: Shop, refund?: { mode: Payment["mode"]; amount: number }): Promise<Bill> {
  if (!cn0.items.length) throw new Error("Pick at least one piece to return");
  const prev = await db.bills.where("return_of").equals(bill.id).toArray();
  const left = returnable(bill, prev);
  for (const l of cn0.items) if (!l.src_line || l.qty > (left.get(l.src_line) || 0)) throw new Error(`Only ${left.get(l.src_line || "") || 0} of ${l.item || l.style} can still be returned`);
  const cn: Bill = refund && refund.amount > 0 ? { ...cn0, payments: [{ ...refund, ref: "Refund", at: now() }] } : cn0;
  return finalize(cn, shop.state, bill.party_name, async saved => {
    // the pieces may have left on this bill, on the bills it was merged from, or on the estimate it was converted from
    const refs = [bill.id, ...(bill.merged_from || []), ...(bill.converted_from ? [bill.converted_from] : [])];
    const outs = await db.movements.where("ref_bill").anyOf(refs).filter(m => m.kind === "sale" && !m.deleted).toArray();
    const prevIds = prev.filter(p => p.status === "final" && p.id !== saved.id).map(p => p.id);
    const backBefore = prevIds.length ? await db.movements.where("ref_bill").anyOf(prevIds).filter(m => m.kind === "return" && !m.deleted).toArray() : [];
    const used = new Map<string, number>(); // pieces of a sale movement already returned earlier
    for (const m of backBefore) { const k = m.product_id + "|" + (m.to_loc || ""); used.set(k, (used.get(k) || 0) + m.qty); }
    for (const l of saved.items) {
      if (!l.product_id) continue;
      let q = l.qty;
      for (const m of outs.filter(x => x.product_id === l.product_id)) {
        if (!q) break;
        const k = m.product_id + "|" + (m.from_loc || "");
        const free = Math.max(0, m.qty - (used.get(k) || 0)); if (!free) continue;
        const n = Math.min(q, free); q -= n; used.set(k, (used.get(k) || 0) + n);
        await put("movements", { id: uid(), product_id: l.product_id, kind: "return", qty: n, from_loc: null, to_loc: m.from_loc, person_type: "customer",
          person_name: saved.party_name, by_staff: saved.by_staff, note: saved.no + " · return of " + bill.no, device: deviceId(), ref_bill: saved.id, at: saved.at, updated_at: now() } as Movement);
        if (m.from_loc) await bumpStock(l.product_id, m.from_loc, n);
      }
      if (q > 0) await put("movements", { id: uid(), product_id: l.product_id, kind: "return", qty: q, from_loc: null, to_loc: null, person_type: "customer",
        person_name: saved.party_name, by_staff: saved.by_staff, note: saved.no + " · return of " + bill.no + " (rack unknown)", device: deviceId(), ref_bill: saved.id, at: saved.at, updated_at: now() } as Movement);
    }
    // tagged pieces that came back are live again (as many tags per product as pieces returned)
    const tags = bill.rfid_tags || [];
    if (tags.length) {
      const free: string[] = [];
      for (const l of saved.items) {
        const p = l.product_id ? await db.products.get(l.product_id) : undefined;
        free.push(...tags.filter(t => p?.barcodes.includes(t) && p.sold_tags?.[t]).slice(0, l.qty));
      }
      await setTagsSold(free, null);
    }
  });
}
