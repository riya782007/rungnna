import { db, put, type Bill } from "./db";
import { sb, syncNow } from "./sync";
import { assertStoreRow } from "./stores";
import { assertUnlocked } from "./finance";
import { ownerOnly } from "./scope";
import { gstUpload, type GstKind } from "./gst";
import type { Shop } from "./billing";
export async function gstRequest(body?: unknown) {
  const c = await sb(); const token = (await c?.auth.getSession())?.data.session?.access_token;
  if (!token) throw new Error("Connect the owner account in Settings");
  const r = await fetch("/api/gst", { method: body ? "POST" : "GET", headers: { "content-type": "application/json", authorization: "Bearer " + token }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const j = await r.json(); if (!r.ok) throw new Error(j.error || "Government service unavailable"); return j;
}
export async function submitGst(b: Bill, kind: GstKind, action: "generate" | "cancel", reason?: string) {
  ownerOnly(); await assertStoreRow(b); await assertUnlocked(b.at);
  if (!navigator.onLine) throw new Error("Internet is required for government submission");
  await syncNow();
  if (await db.outbox.filter(x => x.table === "bills" && x.row_id === b.id).count()) throw new Error("Invoice sync is pending; try again when saved to cloud");
  const j = await gstRequest({ bill_id: b.id, kind, action, reason });
  await db.transaction("rw", [db.bills, db.outbox], async () => {
    const fresh = await db.bills.get(b.id); if (!fresh) throw new Error("Invoice no longer exists");
    await put("bills", { ...fresh, compliance: j.compliance });
  });
}
export function downloadGst(b: Bill, shop: Shop, kind: GstKind) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(gstUpload(b, shop, kind), null, 2)], { type: "application/json" }));
  const a = document.createElement("a"); a.href = url; a.download = `${kind}-${b.no.replace(/\//g, "-")}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
