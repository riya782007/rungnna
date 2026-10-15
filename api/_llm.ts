import { env } from "./_lib.js";

/* ===========================================================================
   Text-model providers for the server functions.

   Roles (owner's rule):
     • Gemini  — looks at the raw photo and pulls out what it SEES   (see _lib.gemini)
     • OpenAI  — turns those facts into the structured product page
     • Groq    — takes over when OpenAI is out of credits, rate-limited or down

   OpenAI and Groq both speak the OpenAI chat-completions dialect, so one small
   client serves both. Keys live only in Vercel env vars; nothing here ever
   reaches the browser.
=========================================================================== */

export type Provider = "openai" | "groq";
export type ChatArgs = { system: string; user: string; json?: boolean; temperature?: number; timeoutMs?: number };

/* Why a provider failed — the UI shows this so the owner knows e.g. that the
   OpenAI account needs topping up rather than that "AI is broken". */
export class ProviderError extends Error {
  constructor(public provider: Provider, public status: number, public kind: "no_key" | "quota" | "rate_limit" | "timeout" | "error", message: string) {
    super(message);
  }
}

export const openaiConfigured = () => !!env("OPENAI_API_KEY");
export const groqConfigured = () => !!env("GROQ_API_KEY");
export const openaiModel = () => env("OPENAI_MODEL") || "gpt-5.4-mini";
export const groqModel = () => env("GROQ_MODEL") || "openai/gpt-oss-120b";

const ENDPOINT: Record<Provider, string> = {
  openai: "https://api.openai.com/v1/chat/completions",
  groq: "https://api.groq.com/openai/v1/chat/completions",
};

/* Classify an error response. OpenAI signals an empty wallet with
   error.code/type "insufficient_quota" (HTTP 429); Groq uses 429 for limits. */
export function classify(status: number, body: any): ProviderError["kind"] {
  const code = String(body?.error?.code || body?.error?.type || "").toLowerCase();
  const msg = String(body?.error?.message || "").toLowerCase();
  if (code.includes("insufficient_quota") || /quota|billing|credit|exceeded your current/.test(msg) || status === 402) return "quota";
  if (status === 429) return "rate_limit";
  return "error";
}

export async function chat(p: Provider, a: ChatArgs): Promise<string> {
  const key = env(p === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY");
  if (!key) throw new ProviderError(p, 503, "no_key", `${p === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY"} is not set`);
  const body: any = {
    model: p === "openai" ? openaiModel() : groqModel(),
    messages: [{ role: "system", content: a.system }, { role: "user", content: a.user }],
  };
  if (a.json) body.response_format = { type: "json_object" };
  // Current OpenAI models only accept the default temperature, so it is sent to Groq only.
  if (p === "groq") body.temperature = a.temperature ?? 0.4;
  let r: Response;
  try {
    r = await fetch(ENDPOINT[p], {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(a.timeoutMs ?? 25_000),
    });
  } catch (e: any) {
    const t = /timeout|abort/i.test(String(e?.name || e?.message));
    throw new ProviderError(p, 504, t ? "timeout" : "error", t ? `${p} took too long` : `${p} unreachable: ${e?.message || e}`);
  }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ProviderError(p, r.status, classify(r.status, j), j?.error?.message || `${p} error ${r.status}`);
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new ProviderError(p, 502, "error", `${p} returned an empty answer`);
  return text;
}

/* Parse model JSON, tolerating a stray code fence or preamble. */
export function parseJsonLoose(text: string): any {
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("Model did not return JSON");
}

export type Attempt = { provider: Provider; ok: boolean; kind?: ProviderError["kind"]; message?: string };

/* Try providers in order; first valid answer wins. `accept` may throw to reject
   a malformed answer, which moves on to the next provider. OpenAI → Groq is the
   default order; any OpenAI failure (not only credits) falls back so the owner is
   never stuck, and the attempt list records exactly why. */
export async function chainJson<T>(a: ChatArgs, accept: (raw: any) => T, order: Provider[] = ["openai", "groq"]): Promise<{ data: T; provider: Provider; attempts: Attempt[] } | { data: null; attempts: Attempt[] }> {
  const attempts: Attempt[] = [];
  for (const p of order) {
    try {
      const data = accept(parseJsonLoose(await chat(p, { ...a, json: true })));
      attempts.push({ provider: p, ok: true });
      return { data, provider: p, attempts };
    } catch (e: any) {
      attempts.push({ provider: p, ok: false, kind: e instanceof ProviderError ? e.kind : "error", message: String(e?.message || e).slice(0, 200) });
    }
  }
  return { data: null, attempts };
}

/* ===========================================================================
   One chain for everything: OpenAI → Gemini → Groq.

   The shop's rule used to be "Gemini sees the photo, OpenAI writes the words".
   The owner now wants a single order for every AI job, photos included, so that
   one provider being out of credit or slow never stops the counter.

   Vision is the catch. OpenAI and Gemini both read images; the Groq model the
   shop runs (openai/gpt-oss-120b) is text-only, so for a job with a picture Groq
   is skipped unless GROQ_VISION_MODEL names a model that can actually see. A
   provider that cannot do the job is not an error — it is simply not asked.
=========================================================================== */

export type AIProvider = "openai" | "gemini" | "groq";
export type AIPart = { text: string } | { image: { mime: string; data: string } };

export const DEFAULT_ORDER: AIProvider[] = ["openai", "gemini", "groq"];

export const geminiConfigured = () => !!env("GEMINI_API_KEY");
export const geminiModel = () => env("GEMINI_MODEL") || "gemini-2.5-flash";
/* Groq's one model that reads images (console.groq.com/docs/vision, checked Oct 2026). The model
   that used to fill this role, Llama 4 Scout, was shut down on 17 Jul 2026. Groq retires models
   often, so GROQ_VISION_MODEL overrides this without a deploy, and "off" turns photos off for Groq. */
export const GROQ_VISION_DEFAULT = "qwen/qwen3.8-27b";
export const groqVisionModel = () => { const v = env("GROQ_VISION_MODEL").trim(); return v.toLowerCase() === "off" ? "" : v || GROQ_VISION_DEFAULT; };

const hasImage = (parts: AIPart[]) => parts.some(p => "image" in p);

/** Can this provider do this particular job? */
export function canServe(p: AIProvider, parts: AIPart[]): boolean {
  const configured = p === "openai" ? openaiConfigured() : p === "gemini" ? geminiConfigured() : groqConfigured();
  if (!configured) return false;
  if (!hasImage(parts)) return true;
  if (p === "groq") return !!groqVisionModel();   // the default Groq model cannot see
  return true;
}

/* ---- OpenAI-dialect call that can carry images (serves OpenAI and Groq) ---- */
async function chatOpenAIDialect(p: "openai" | "groq", parts: AIPart[], o: { system?: string; json?: boolean; temperature?: number; timeoutMs?: number }): Promise<string> {
  const key = env(p === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY");
  if (!key) throw new ProviderError(p, 503, "no_key", `${p === "openai" ? "OPENAI_API_KEY" : "GROQ_API_KEY"} is not set`);
  const content = parts.map(part => "text" in part
    ? { type: "text", text: part.text }
    : { type: "image_url", image_url: { url: `data:${part.image.mime};base64,${part.image.data}` } });
  const body: any = {
    model: p === "openai" ? openaiModel() : (hasImage(parts) ? groqVisionModel() : groqModel()),
    messages: [...(o.system ? [{ role: "system", content: o.system }] : []), { role: "user", content }],
  };
  if (o.json) body.response_format = { type: "json_object" };
  if (p === "groq") body.temperature = o.temperature ?? 0.2;
  if (p === "groq" && /^qwen\//i.test(body.model)) body.reasoning_format = "hidden";
  const send = async (b: any) => {
    try {
      return await fetch(ENDPOINT[p], {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(b), signal: AbortSignal.timeout(o.timeoutMs ?? 45_000),
      });
    } catch (e: any) {
      const t = /timeout|abort/i.test(String(e?.name || e?.message));
      throw new ProviderError(p, 504, t ? "timeout" : "error", t ? `${p} took too long` : `${p} unreachable: ${e?.message || e}`);
    }
  };
  let r = await send(body);
  let j: any = await r.json().catch(() => ({}));
  // a parameter this particular model doesn't take (Groq says which): drop it and ask once more.
  // The prompt itself demands JSON and parseJsonLoose reads it, so nothing is lost.
  if (p === "groq" && r.status === 400 && /reasoning_format|response_format|json/i.test(String(j?.error?.message || ""))) {
    const { reasoning_format: _r, response_format: _f, ...plain } = body;
    r = await send(plain);
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok) throw new ProviderError(p, r.status, classify(r.status, j), j?.error?.message || `${p} error ${r.status}`);
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new ProviderError(p, 502, "error", `${p} returned an empty answer`);
  return text;
}

/* ---- Gemini, same shape in and out ---- */
async function chatGemini(parts: AIPart[], o: { system?: string; json?: boolean; temperature?: number; timeoutMs?: number }): Promise<string> {
  const key = env("GEMINI_API_KEY");
  if (!key) throw new ProviderError("groq", 503, "no_key", "GEMINI_API_KEY is not set");   // provider field is cosmetic here
  const body: any = {
    contents: [{ role: "user", parts: parts.map(p => "text" in p ? { text: p.text } : { inline_data: { mime_type: p.image.mime, data: p.image.data } }) }],
    generationConfig: { temperature: o.temperature ?? 0.2, ...(o.json ? { responseMimeType: "application/json" } : {}) },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  let r: Response;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${geminiModel()}:generateContent`, {
      method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(body), signal: AbortSignal.timeout(o.timeoutMs ?? 45_000),
    });
  } catch (e: any) {
    const t = /timeout|abort/i.test(String(e?.name || e?.message));
    throw new ProviderError("groq", 504, t ? "timeout" : "error", t ? "gemini took too long" : `gemini unreachable: ${e?.message || e}`);
  }
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ProviderError("groq", r.status, classify(r.status, j), j?.error?.message || `gemini error ${r.status}`);
  const text = (j?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("");
  if (!text.trim()) throw new ProviderError("groq", 502, "error", "gemini returned an empty answer");
  return text;
}

export type AIAttempt = { provider: AIProvider; ok: boolean; skipped?: boolean; kind?: string; message?: string };

/** Ask one provider. Exported so a caller can pin one deliberately. */
export const askOne = (p: AIProvider, parts: AIPart[], o: { system?: string; json?: boolean; temperature?: number; timeoutMs?: number } = {}) =>
  p === "gemini" ? chatGemini(parts, o) : chatOpenAIDialect(p, parts, o);

/** OpenAI → Gemini → Groq. Returns the first usable answer and how it got there. */
export async function askAI(
  parts: AIPart[],
  o: { system?: string; json?: boolean; temperature?: number; timeoutMs?: number; accept?: (raw: any) => any } = {},
  order: AIProvider[] = DEFAULT_ORDER,
): Promise<{ text: string; data?: any; provider: AIProvider; attempts: AIAttempt[] }> {
  const attempts: AIAttempt[] = [];
  let asked = 0;
  for (const p of order) {
    if (!canServe(p, parts)) {
      const keyed = p === "openai" ? openaiConfigured() : p === "gemini" ? geminiConfigured() : groqConfigured();
      attempts.push({ provider: p, ok: false, skipped: true, message: !keyed ? "no API key" : "no vision model configured" });
      continue;
    }
    asked++;
    try {
      const text = await askOne(p, parts, o);
      const data = o.json ? (o.accept ? o.accept(parseJsonLoose(text)) : parseJsonLoose(text)) : undefined;
      attempts.push({ provider: p, ok: true });
      return { text, data, provider: p, attempts };
    } catch (e: any) {
      attempts.push({ provider: p, ok: false, kind: e instanceof ProviderError ? e.kind : "error", message: String(e?.message || e).slice(0, 200) });
    }
  }
  throw Object.assign(new Error(explainFailure(attempts, asked)), { status: asked ? 502 : 503, attempts });
}

/* Three raw provider errors, with billing URLs and quota jargon, told the owner nothing he could act
   on. Each line now says what happened and the one thing that fixes it. */
const NAME: Record<AIProvider, string> = { openai: "OpenAI", gemini: "Gemini", groq: "Groq" };
export function explainFailure(attempts: AIAttempt[], asked = attempts.filter(a => !a.skipped).length): string {
  const line = (a: AIAttempt) => {
    const n = NAME[a.provider], m = a.message || "";
    if (a.skipped) return `${n}: ${/vision/.test(m) ? "can't read photos (set GROQ_VISION_MODEL in Vercel)" : "no key added in Vercel"}`;
    if (a.kind === "quota" && a.provider === "openai") return "OpenAI: out of credit. Add credit at platform.openai.com → Billing";
    if (a.kind === "quota" && a.provider === "gemini") return "Gemini: free quota used up. It refills daily, or turn on billing in Google AI Studio";
    if (a.kind === "quota") return `${n}: out of credit or quota`;
    if (a.kind === "rate_limit") return `${n}: busy (too many requests), try again in a minute`;
    if (a.kind === "timeout") return `${n}: took too long`;
    if (a.kind === "no_key") return `${n}: no key added in Vercel`;
    return `${n}: ${m.slice(0, 120) || "failed"}`;
  };
  const head = asked ? "No AI could read this. Nothing was saved." : "No AI is set up for this yet.";
  return [head, ...attempts.map(a => "• " + line(a))].join("\n");
}
