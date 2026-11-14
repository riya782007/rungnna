import { db, put, now, type Bill, type Config } from "./db";

/* WhatsApp from the shop phone (owner, 14 Nov 15:09): WhatsApp can be linked on at most 4 devices, so most
   billing computers have no WhatsApp. Such a computer hands the bill to the shop phone instead: the phone
   shows "bills to send", one tap shares the bill picture to the customer's chat. */
export type WaJob = { bill_id: string; no: string; phone: string; party: string; by: string; at: string; sent?: string; sent_by?: string };
export const viaPhone = () => { try { return localStorage.getItem("rj_wa_phone") === "1"; } catch { return false; } };
export const setViaPhone = (on: boolean) => { try { on ? localStorage.setItem("rj_wa_phone", "1") : localStorage.removeItem("rj_wa_phone"); } catch { /* private */ } };
export async function queueWa(b: Bill, by: string) {
  const job: WaJob = { bill_id: b.id, no: b.no, phone: b.party_phone, party: b.party_name, by, at: now() };
  await put("config", { id: "wa_out:" + b.id, value: job, updated_at: now() } as Config);
}
export async function waitingWa(): Promise<WaJob[]> {
  const rows = await db.config.filter(c => c.id.startsWith("wa_out:") && !c.deleted && !c.value?.sent).toArray();
  return rows.map(r => r.value as WaJob).filter(j => Date.now() - Date.parse(j.at) < 3 * 86400000).sort((a, z) => z.at.localeCompare(a.at));
}
export async function markWaSent(j: WaJob, by: string) {
  await put("config", { id: "wa_out:" + j.bill_id, value: { ...j, sent: now(), sent_by: by }, updated_at: now() } as Config);
}
