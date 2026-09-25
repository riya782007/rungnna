import { sb } from "./sync";
import { db } from "./db";

/* Calls the shop's own server functions (/api/…). They hold the Gemini / WhatsApp keys; the phone never sees them. */
async function token() {
  const c = await sb(); const { data } = (await c?.auth.getSession()) || { data: { session: null } };
  return data.session?.access_token || "";
}
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  if (!navigator.onLine) throw new Error("AI needs internet — everything else keeps working offline");
  const r = await fetch("/api/" + path, {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: "Bearer " + (await token()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const j = await r.json().catch(() => ({ error: "Server error " + r.status }));
  if (!r.ok) throw new Error(j.error || "Failed");
  return j as T;
}
export type Health = { ai: boolean; model: string; whatsapp_api: boolean; supabase: boolean };
export const health = () => api<Health>("health");

export const blobToB64 = (b: Blob) => new Promise<string>((res, rej) => {
  const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(b);
});

/* A compact catalogue so the AI can map "K5208 white" to a real product. */
export async function catalogueText(limit = 1500) {
  const ps = await db.products.filter(p => !p.deleted).limit(limit).toArray();
  return ps.map(p => [p.style, p.item, p.color, p.rate ? p.rate / 100 : "", p.pack || ""].join(" | ")).join("\n");
}

export type VoiceBill = { customer?: { name?: string; phone?: string }; lines: { style?: string; item?: string; color?: string; packets?: number; pieces?: number; rate?: number; note?: string }[]; remarks?: string; heard?: string };
export async function voiceBill(input: { audio?: Blob; text?: string }): Promise<VoiceBill> {
  const body: any = { task: "voice_bill", catalogue: await catalogueText(), text: input.text };
  if (input.audio) { body.audio = await blobToB64(input.audio); body.mime = input.audio.type; }
  return api("ai", body);
}
export async function transcribe(audio: Blob) { return (await api<{ text: string }>("ai", { task: "transcribe", audio: await blobToB64(audio), mime: audio.type })).text; }
export async function describePhoto(img: Blob) { return api<{ item?: string; color?: string; description?: string; tags?: string[]; stone?: string; finish?: string }>("ai", { task: "photo", image: await blobToB64(img), mime: img.type }); }
export async function ask(question: string, context: unknown) { return (await api<{ text: string }>("ai", { task: "ask", question, context })).text; }
