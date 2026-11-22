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
  /* Owner, 22 Nov (voice): "tried the Google Gemini picture — refused because of the version". This helper still
     asked for "gemini-2.5-flash", which Google has closed to new keys. It now goes through the same chain as the
     bill reader: the models Google lists for this key, newest Flash first, skipping retired names. */
  const { askOne, ProviderError } = await import("./_llm.js");
  let text: string;
  try {
    text = await askOne("gemini", parts.map(p => "text" in p ? { text: p.text } : { image: { mime: p.inline_data.mime_type, data: p.inline_data.data } }),
      { json: opts.json, system: opts.system, temperature: opts.temperature ?? 0.2, timeoutMs: 45000 });
  } catch (e: any) {
    const status = e instanceof ProviderError ? (e as any).status : 502;
    throw Object.assign(new Error(e?.message || "Gemini error"), { status: status === 429 ? 429 : 502 });
  }
  if (!opts.json) return text;
  try { return JSON.parse(text); } catch { const m = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/); return m ? JSON.parse(m[0]) : {}; }
}
