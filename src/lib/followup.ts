import { db, put, now, type Config } from "./db";

/* Customer follow-up (owner, 14 Nov 14:24): what products the customer wants and when to call
   them back. Kept beside the customer (not in the customer row), so it syncs without a cloud change. */
export type FollowUp = { wants: string; callback: string; note: string; by: string; at: string; done?: string };
export async function getFollow(partyId: string): Promise<FollowUp | null> {
  const r = await db.config.get("follow:" + partyId);
  return r && !r.deleted ? (r.value as FollowUp) : null;
}
export async function saveFollow(partyId: string, f: Omit<FollowUp, "at">) {
  if (!f.wants.trim() && !f.callback && !f.note.trim()) return;
  await put("config", { id: "follow:" + partyId, value: { ...f, at: now() }, updated_at: now() } as Config);
}
/** Call-backs due today or earlier and not marked done. */
export async function dueCallbacks(day = new Date().toISOString().slice(0, 10)) {
  const rows = await db.config.filter(c => c.id.startsWith("follow:") && !c.deleted).toArray();
  return rows.map(r => ({ party_id: r.id.slice(7), ...(r.value as FollowUp) })).filter(f => f.callback && f.callback <= day && !f.done);
}
