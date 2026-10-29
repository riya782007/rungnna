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
  // Groq's per-minute limits say "Rate limit reached … upgrade at …/billing": that's a speed limit, not money
  if (/rate limit reached|tokens per minute|requests per minute|\(tpm\)|\(rpm\)/.test(msg)) return "rate_limit";
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
  // what each call cost in tokens, in Vercel's log, so the credit can be watched
  if (j?.usage) console.info(`[ai] ${p} ${body.model} tokens in ${j.usage.prompt_tokens ?? "?"} · out ${j.usage.completion_tokens ?? "?"}${j.usage.completion_tokens_details?.reasoning_tokens ? ` (thinking ${j.usage.completion_tokens_details.reasoning_tokens})` : ""}`);
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
      // the provider's own words, in Vercel's runtime log: the screen shows the plain version
      console.warn(`[ai] ${p} failed (${e instanceof ProviderError ? e.kind : "error"}): ${String(e?.message || e).slice(0, 300)}`);
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
/* Bills (photos): Gemini first while its free daily quota lasts, then the paid OpenAI credit, then Groq — so the
   OpenAI credit is spent only on what Gemini could not take (owner's $10 has to last two months).
   AI_PHOTO_ORDER="openai,gemini,groq" in Vercel puts OpenAI back in front without a deploy. */
export function photoOrder(): AIProvider[] {
  const want = env("AI_PHOTO_ORDER").toLowerCase().split(/[\s,>]+/).filter((x): x is AIProvider => x === "openai" || x === "gemini" || x === "groq");
  const list = want.length ? want : (["gemini", "openai", "groq"] as AIProvider[]);
  return [...new Set([...list, ...DEFAULT_ORDER])];
}

export const geminiConfigured = () => !!env("GEMINI_API_KEY");
/* 25 Oct: Google closed "gemini-2.5-flash" to new users ("This model … is no longer available to new users"), so
   every bill fell through to Groq. "gemini-flash-latest" always points at Google's current Flash model; if a
   model is refused as retired, the next one in this list is tried in the same request. */
export const GEMINI_FALLBACKS = ["gemini-flash-latest", "gemini-3-flash", "gemini-2.5-flash"];
export const geminiModel = () => env("GEMINI_MODEL") || GEMINI_FALLBACKS[0];
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

/* 29 Oct: three strip readings of one bill each ran past the server's limit and were cut off, so lines went missing.
   Every call now stops in time for the next provider to have its turn. */
const wait = (o: { timeoutMs?: number; deadline?: number }, fallback: number) =>
  Math.max(5000, Math.min(o.timeoutMs ?? fallback, o.deadline ? o.deadline - Date.now() : Infinity));

/* ---- OpenAI-dialect call that can carry images (serves OpenAI and Groq) ---- */
async function chatOpenAIDialect(p: "openai" | "groq", parts: AIPart[], o: { system?: string; json?: boolean; temperature?: number; timeoutMs?: number; deadline?: number }): Promise<string> {
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
  /* 29 Oct: $10 of OpenAI credit has to last two months. Reading a bill needs little "thinking": low reasoning
     effort cuts the billed output tokens several times over (OPENAI_REASONING=medium/high to change it). */
  if (p === "openai" && /^(gpt-5|o\d)/i.test(body.model)) body.reasoning_effort = env("OPENAI_REASONING").trim() || "low";
  const send = async (b: any) => {
    try {
      return await fetch(ENDPOINT[p], {
        method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
        body: JSON.stringify(b), signal: AbortSignal.timeout(wait(o, 45_000)),
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
  if (r.status === 400 && /reasoning_format|reasoning_effort|response_format|json/i.test(String(j?.error?.message || ""))) {
    const { reasoning_format: _r, reasoning_effort: _e, response_format: _f, ...plain } = body;
    r = await send(plain);
    j = await r.json().catch(() => ({}));
  }
  if (!r.ok) throw new ProviderError(p, r.status, classify(r.status, j), j?.error?.message || `${p} error ${r.status}`);
  const text = j?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new ProviderError(p, 502, "error", `${p} returned an empty answer`);
  return text;
}

/* 29 Oct: bills were read by the weak backup reader all day because every Gemini name in the fixed list was
   refused ("models/gemini-3-flash is not found"). Google publishes which models a key may use; that list is
   read once per server instance and the newest Flash model (not lite, image, audio or live) is asked first. */
let geminiList: { at: number; names: string[] } | undefined;
const geminiDead = new Set<string>();
export function pickGeminiModels(list: { name?: string; supportedGenerationMethods?: string[] }[]): string[] {
  const ver = (n: string) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? Number(m[1]) : 0; };
  return list
    .filter(m => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map(m => String(m.name || "").replace(/^models\//, ""))
    .filter(n => /^gemini-/.test(n) && /flash/.test(n) && !/lite|image|audio|tts|live|embed|native|thinking|exp-\d|computer|robotics/.test(n))
    .sort((a, b) => ver(b) - ver(a) || Number(/latest/.test(b)) - Number(/latest/.test(a)) || Number(/preview|exp/.test(a)) - Number(/preview|exp/.test(b)) || a.length - b.length);
}
async function liveGeminiModels(key: string): Promise<string[]> {
  if (!geminiList || Date.now() - geminiList.at > 6 * 3600_000) {
    try {
      const r = await fetch("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(6000) });
      const j: any = r.ok ? await r.json() : {};
      geminiList = { at: Date.now(), names: pickGeminiModels(Array.isArray(j?.models) ? j.models : []) };
    } catch { geminiList = { at: Date.now() - 5.5 * 3600_000, names: [] }; }   // try the list again in half an hour
  }
  const pinned = env("GEMINI_MODEL").trim();
  return [...(pinned && geminiList.names.includes(pinned) ? [pinned] : []), ...geminiList.names].filter(n => !geminiDead.has(n));
}

/* ---- Gemini, same shape in and out ---- */
async function chatGemini(parts: AIPart[], o: { system?: string; json?: boolean; temperature?: number; timeoutMs?: number; deadline?: number }): Promise<string> {
  const key = env("GEMINI_API_KEY");
  if (!key) throw new ProviderError("groq", 503, "no_key", "GEMINI_API_KEY is not set");   // provider field is cosmetic here
  const body: any = {
    contents: [{ role: "user", parts: parts.map(p => "text" in p ? { text: p.text } : { inline_data: { mime_type: p.image.mime, data: p.image.data } }) }],
    generationConfig: { temperature: o.temperature ?? 0.2, ...(o.json ? { responseMimeType: "application/json" } : {}) },
  };
  if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
  // the models Google says this key can use (cached), newest Flash first; then the fixed list as a last resort
  const all = [...new Set([...(await liveGeminiModels(key)), geminiModel(), ...GEMINI_FALLBACKS])];
  const alive = all.filter(n => !geminiDead.has(n));
  const models = (alive.length ? alive : all).slice(0, 6);
  let r!: Response, j: any = {}, best: { r: Response; j: any; rank: number } | undefined;
  for (const model of models) {
    if (o.deadline && Date.now() > o.deadline - 5000 && best) break;   // out of time: the next provider's turn
    for (let tryNo = 0; tryNo < 2; tryNo++) {
      try {
        r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify(body), signal: AbortSignal.timeout(wait(o, 45_000)),
        });
      } catch (e: any) {
        const t = /timeout|abort/i.test(String(e?.name || e?.message));
        throw new ProviderError("groq", 504, t ? "timeout" : "error", t ? "gemini took too long" : `gemini unreachable: ${e?.message || e}`);
      }
      j = await r.json().catch(() => ({}));
      if (r.ok) break;
      // 25 Oct: "This model is currently experiencing high demand" (503): wait a moment and ask once more
      const busy = r.status === 503 || r.status === 500 || /high demand|overloaded|unavailable/i.test(String(j?.error?.message || ""));
      if (!busy || tryNo || (o.deadline && Date.now() > o.deadline - 15000)) break;
      await new Promise(ok => setTimeout(ok, 1200));
    }
    if (r.ok) { console.info(`[ai] gemini answered with ${model}`); break; }
    const msg = String(j?.error?.message || "");
    const retired = r.status === 404 || /no longer available|not found|is not supported|deprecated/i.test(msg);
    const busy = r.status === 503 || r.status === 500 || /high demand|overloaded|unavailable/i.test(msg);
    // remember the most useful failure: "busy" or "quota" says more than "this old model name is gone"
    const rank = retired ? 0 : busy ? 2 : 1;
    if (!best || rank > best.rank) best = { r, j, rank };
    if (!retired && !busy) break;   // quota, a bad photo: the next model would say the same
    if (retired) geminiDead.add(model);
  }
  if (!r.ok && best) ({ r, j } = best);
  if (!r.ok) throw new ProviderError("groq", r.status, classify(r.status, j), j?.error?.message || `gemini error ${r.status}`);
  const text = (j?.candidates?.[0]?.content?.parts || []).map((x: any) => x.text || "").join("");
  if (!text.trim()) throw new ProviderError("groq", 502, "error", "gemini returned an empty answer");
  return text;
}

export type AIAttempt = { provider: AIProvider; ok: boolean; skipped?: boolean; kind?: string; message?: string };

/** Ask one provider. Exported so a caller can pin one deliberately. */
export const askOne = (p: AIProvider, parts: AIPart[], o: { system?: string; json?: boolean; temperature?: number; timeoutMs?: number; deadline?: number } = {}) =>
  p === "gemini" ? chatGemini(parts, o) : chatOpenAIDialect(p, parts, o);

/** OpenAI → Gemini → Groq. Returns the first usable answer and how it got there. */
export async function askAI(
  parts: AIPart[],
  o: { system?: string; json?: boolean; temperature?: number; timeoutMs?: number; budgetMs?: number; accept?: (raw: any) => any } = {},
  order: AIProvider[] = DEFAULT_ORDER,
): Promise<{ text: string; data?: any; provider: AIProvider; attempts: AIAttempt[] }> {
  const attempts: AIAttempt[] = [];
  let asked = 0;
  const start = Date.now(), budget = o.budgetMs ?? 0;
  for (const [k, p] of order.entries()) {
    if (!canServe(p, parts)) {
      const keyed = p === "openai" ? openaiConfigured() : p === "gemini" ? geminiConfigured() : groqConfigured();
      attempts.push({ provider: p, ok: false, skipped: true, message: !keyed ? "no API key" : "no vision model configured" });
      continue;
    }
    asked++;
    try {
      // with a budget, each provider must leave ~35 s for every provider after it
      const later = order.slice(k + 1).filter(q => canServe(q, parts)).length;
      const text = await askOne(p, parts, budget ? { ...o, deadline: start + budget - later * 35_000 } : o);
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
  const head = asked ? "No AI could read this. Nothing was saved." : "No AI is set up for this yet.";
  return [head, ...attempts.map(a => "• " + explainAttempt(a))].join("\n");
}

/** One provider's failure, in the owner's words. */
export function explainAttempt(a: AIAttempt): string {
  const n = NAME[a.provider], m = a.message || "";
  if (a.skipped) return `${n}: ${/vision/.test(m) ? "can't read photos (set GROQ_VISION_MODEL in Vercel)" : "no key added in Vercel"}`;
  if (a.kind === "quota" && a.provider === "openai") return "OpenAI: out of credit. Add credit at platform.openai.com → Billing";
  if (a.kind === "quota" && a.provider === "gemini") return "Gemini: free quota used up. It refills daily, or turn on billing in Google AI Studio";
  if (a.kind === "quota") return `${n}: out of credit or quota`;
  if (a.kind === "rate_limit") return `${n}: busy (too many requests), try again in a minute`;
  if (a.kind === "timeout") return `${n}: took too long`;
  if (a.kind === "no_key") return `${n}: no key added in Vercel`;
  return `${n}: ${m.slice(0, 120) || "failed"}`;
}

/* ---- "Test each AI": every provider on its own, at once ---- */

export type ProbeResult = { provider: AIProvider; model: string; ok: boolean; read?: string; ms?: number; skipped?: boolean; kind?: string; plain: string };

/** Which model a provider would use for a photo, so the owner sees exactly what was tested. */
export const visionModelOf = (p: AIProvider) => p === "openai" ? openaiModel() : p === "gemini" ? geminiModel() : groqVisionModel();

/** Ask every provider to read one small picture of a number. Nothing is saved; each costs a fraction of a paisa. */
export async function probeAll(png: string, answer: string): Promise<ProbeResult[]> {
  const parts: AIPart[] = [
    { image: { mime: "image/png", data: png } },
    { text: `This image shows a number. Reply only with JSON {"text":"<the number exactly as shown>"}.` },
  ];
  return Promise.all(DEFAULT_ORDER.map(async (p): Promise<ProbeResult> => {
    const model = visionModelOf(p);
    if (!canServe(p, parts)) {
      const keyed = p === "openai" ? openaiConfigured() : p === "gemini" ? geminiConfigured() : groqConfigured();
      const a: AIAttempt = { provider: p, ok: false, skipped: true, message: keyed ? "no vision model configured" : "no API key" };
      return { provider: p, model, ok: false, skipped: true, plain: explainAttempt(a) };
    }
    const t0 = Date.now();
    try {
      const text = await askOne(p, parts, { json: true, temperature: 0, timeoutMs: 25_000 });
      const ms = Date.now() - t0;
      const read = String(parseJsonLoose(text)?.text ?? "").replace(/[^0-9]/g, "");
      const ok = read === answer;
      console.warn(`[ai-test] ${p} (${model}) ${ok ? "ok" : "misread"} "${read}" in ${ms}ms`);
      return { provider: p, model, ok, read, ms, plain: ok ? `${NAME[p]}: working, read ${read} in ${(ms / 1000).toFixed(1)}s` : `${NAME[p]}: answered but read "${read || "nothing"}" instead of ${answer}` };
    } catch (e: any) {
      const kind = e instanceof ProviderError ? e.kind : "error";
      const message = String(e?.message || e).slice(0, 300);
      console.warn(`[ai-test] ${p} (${model}) failed (${kind}): ${message}`);
      return { provider: p, model, ok: false, ms: Date.now() - t0, kind, plain: explainAttempt({ provider: p, ok: false, kind, message }) };
    }
  }));
}
