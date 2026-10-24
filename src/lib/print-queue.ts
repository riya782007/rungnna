import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, deviceId } from "./db";

/* Owner, 24 Oct (voice): "while I sit at the computer the rates come out. But when I'm outside Delhi I should still
   be able to send a bill from my phone and have its stickers print out by themselves at the shop."
   A purchase approved on a phone is put in this list (synced to every counter); the shop computer's Bill → Stickers
   screen shows it with one Print button, and prints it by itself when a direct label printer is set up. */
export type RemotePrint = { id: string; no: string; by: string; device: string; at: string; labels: number; supplier?: string };
const KEY = "print_queue";

const read = async (): Promise<RemotePrint[]> => (((await db.config.get(KEY))?.value as RemotePrint[]) || []).filter(x => x && x.id);
export async function queueForShop(p: { id: string; no: string; supplier_name?: string }, by: string, labels: number) {
  const list = (await read()).filter(x => x.id !== p.id);
  list.push({ id: p.id, no: p.no, by, device: deviceId(), at: now(), labels, supplier: p.supplier_name });
  await put("config", { id: KEY, value: list.slice(-50), updated_at: now() } as any);
}
export async function doneAtShop(id: string) {
  const list = await read();
  if (list.some(x => x.id === id)) await put("config", { id: KEY, value: list.filter(x => x.id !== id), updated_at: now() } as any);
}
/** Stickers waiting for this computer (those sent from other devices). */
export function useShopQueue(): RemotePrint[] {
  return useLiveQuery(async () => (await read()).filter(x => x.device !== deviceId()), [], []);
}
/** A phone or small tablet: its stickers are meant for the shop's printer. */
export const isPhoneLike = () => typeof window !== "undefined" && (/Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || matchMedia("(max-width: 860px)").matches);
