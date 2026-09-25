/* Shared helpers for the server functions. Keys live only in Vercel → Settings → Environment Variables,
   never in the app bundle, so nobody can lift them from a phone. */

export const env = (k: string) => {
  const v = (globalThis as any).process?.env?.[k] as string | undefined;
  return v && !v.startsWith("PASTE") ? v.trim() : "";
};

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/* Only the shop's signed-in devices may use the AI / WhatsApp functions (stops strangers burning the quota). */
export async function requireShop(req: Request): Promise<string | Response> {
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const url = env("SUPABASE_URL"), key = env("SUPABASE_ANON_KEY");
  if (!url || !key) return json({ error: "Server is missing SUPABASE_URL / SUPABASE_ANON_KEY" }, 500);
  if (!token) return json({ error: "Sign in to the shop account first (Settings → Cloud)" }, 401);
  const r = await fetch(`${url}/auth/v1/user`, { headers: { apikey: key, authorization: `Bearer ${token}` } });
  if (!r.ok) return json({ error: "Shop login expired — sign in again in Settings" }, 401);
  const u = await r.json();
  return u?.email || u?.id || "shop";
}

/* ---- Gemini (Google AI Studio, free tier) ---- */
type Part = { text: string } | { inline_data: { mime_type: string; data: string } };
export async function gemini(parts: Part[], opts: { json?: boolean; system?: string; temperature?: number } = {}) {
  const key = env("GEMINI_API_KEY");
  if (!key) throw Object.assign(new Error("AI key not added yet: Vercel → rungnna_shop_os → Settings → Environment Variables → GEMINI_API_KEY"), { status: 503 });
  const model = env("GEMINI_MODEL") || "gemini-2.5-flash";
  const body: any = {
    contents: [{ role: "user", parts }],
    generationConfig: { temperature: opts.temperature ?? 0.2, ...(opts.json ? { responseMimeType: "application/json" } : {}) },
  };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body),
  });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j?.error?.message || `Gemini error ${r.status}`), { status: r.status === 429 ? 429 : 502 });
  const text = (j?.candidates?.[0]?.content?.parts || []).map((p: any) => p.text || "").join("");
  if (!opts.json) return text;
  try { return JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : {}; }
}
