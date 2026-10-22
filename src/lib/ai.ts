import { sb, ensureSession } from "./sync";
import { apiUrl } from "./platform";
import { db } from "./db";

/* Calls the shop's own server functions (/api/…). They hold the Gemini / WhatsApp keys; the phone never sees them. */
async function token() {
  const c = await sb(); const { data } = (await c?.auth.getSession()) || { data: { session: null } };
  return data.session?.access_token || "";
}
export async function api<T = any>(path: string, body?: unknown): Promise<T> {
  if (!navigator.onLine) throw new Error("AI needs internet — everything else keeps working offline");
  await ensureSession().catch(() => false);   // a shop device connects itself: no email or password to type
  const call = async () => fetch(apiUrl(path), {
    method: body ? "POST" : "GET",
    headers: { "content-type": "application/json", authorization: "Bearer " + (await token()) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let r = await call();
  /* An expired or replaced login used to sign the device OUT here, which sent the owner back to
     Settings to type the email and password again. Now the login is renewed quietly and the call
     tried once more; the device stays connected. */
  if (r.status === 401) {
    const c = await sb();
    const renewed = await c?.auth.refreshSession().then(x => !!x.data.session).catch(() => false);
    if (!renewed) { await c?.auth.signOut({ scope: "local" }).catch(() => {}); await ensureSession().catch(() => false); }
    r = await call();
  }
  // a page that is not JSON (an HTML fallback, a proxy error) is never an answer, even with a 200:
  // treating it as one turned "the server is unreachable" into "no AI key yet"
  const j = await r.json().catch(() => null);
  if (!j || typeof j !== "object") throw new Error(`The AI service did not answer (server ${r.status}). Check the internet, or that the latest version is deployed.`);
  if (!r.ok) throw new Error(j.error || "Failed");
  return j as T;
}
export type Health = { ai: boolean; model: string; openai?: boolean; openai_model?: string; groq?: boolean; groq_model?: string; r2?: boolean; whatsapp_api: boolean; supabase: boolean };
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

/* Structured visual fingerprint (server "embed" task) — a second opinion for the
   hybrid matcher on top of the on-device embedding in lib/vision.ts. Optional:
   needs internet, so callers must fall back to the local embedding when offline. */
export type VisualFingerprint = { item?: string; shape?: string; metal?: string; stones?: string; stone_color?: string; finish?: string; size?: string; distinctive?: string[] };
export async function visualFingerprint(img: Blob) { return api<VisualFingerprint>("ai", { task: "embed", image: await blobToB64(img), mime: img.type }); }

/* Refine the locked Google-Flow prompt with the real details Gemini sees in the raw
   photo. Falls back to the locked base prompt itself if AI is unavailable (offline,
   no key), so the owner always gets a usable prompt to paste into Google Flow. */
export async function refineShotPrompt(base: string, img: Blob): Promise<string> {
  try {
    const r = await api<{ prompt: string }>("ai", { task: "shot_prompt", base, image: await blobToB64(img), mime: img.type });
    return (r.prompt || "").trim() || base;
  } catch {
    return base;
  }
}
export async function ask(question: string, context: unknown) { return (await api<{ text: string }>("ai", { task: "ask", question, context })).text; }
