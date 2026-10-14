import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* The shop has three AI keys. The owner's rule is one order for every job:
   OpenAI → Gemini → Groq, so no single provider being out of credit, rate-limited
   or slow can stop a counter mid-intake. */

const ENV: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(ENV)) delete ENV[k];
  (globalThis as any).process = { env: ENV };
  vi.resetModules();
});
afterEach(() => vi.restoreAllMocks());

const TEXT = [{ text: "hello" }] as any;
const WITH_IMAGE = [{ text: "read this bill" }, { image: { mime: "image/jpeg", data: "AAAA" } }] as any;

const load = () => import("../api/_llm.js");

/** A fetch stub: decides per-host whether the call works. */
function stubFetch(handler: (host: string) => { ok: boolean; status?: number; body?: any }) {
  return vi.spyOn(globalThis, "fetch" as any).mockImplementation(async (url: any) => {
    const host = String(url).includes("openai.com") ? "openai"
      : String(url).includes("groq.com") ? "groq" : "gemini";
    const r = handler(host);
    return {
      ok: r.ok, status: r.status ?? (r.ok ? 200 : 500),
      json: async () => r.body ?? (host === "gemini"
        ? { candidates: [{ content: { parts: [{ text: '{"from":"gemini"}' }] } }] }
        : { choices: [{ message: { content: `{"from":"${host}"}` } }] }),
    } as any;
  });
}

describe("which provider can do which job", () => {
  it("skips a provider with no key instead of calling it", async () => {
    ENV.GEMINI_API_KEY = "g";
    const { canServe } = await load();
    expect(canServe("openai", TEXT)).toBe(false);
    expect(canServe("gemini", TEXT)).toBe(true);
    expect(canServe("groq", TEXT)).toBe(false);
  });

  it("will not send a photo to the shop's text-only Groq model", async () => {
    ENV.GROQ_API_KEY = "k";
    const { canServe } = await load();
    expect(canServe("groq", TEXT)).toBe(true);          // text is fine
    expect(canServe("groq", WITH_IMAGE)).toBe(false);   // the bill photo is not
  });

  it("uses Groq for a photo once a vision model is named", async () => {
    ENV.GROQ_API_KEY = "k"; ENV.GROQ_VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
    const { canServe } = await load();
    expect(canServe("groq", WITH_IMAGE)).toBe(true);
  });

  it("OpenAI and Gemini both read photos", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g";
    const { canServe } = await load();
    expect(canServe("openai", WITH_IMAGE)).toBe(true);
    expect(canServe("gemini", WITH_IMAGE)).toBe(true);
  });
});

describe("the OpenAI → Gemini → Groq chain", () => {
  it("asks OpenAI first and stops there when it answers", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g"; ENV.GROQ_API_KEY = "k";
    const f = stubFetch(() => ({ ok: true }));
    const { askAI } = await load();
    const r = await askAI(TEXT, { json: true });
    expect(r.provider).toBe("openai");
    expect(r.data).toEqual({ from: "openai" });
    expect(f).toHaveBeenCalledTimes(1);                 // Gemini and Groq never touched
  });

  it("falls through to Gemini when OpenAI has no credit left", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g"; ENV.GROQ_API_KEY = "k";
    stubFetch(h => h === "openai"
      ? { ok: false, status: 429, body: { error: { code: "insufficient_quota", message: "exceeded your current quota" } } }
      : { ok: true });
    const { askAI } = await load();
    const r = await askAI(TEXT, { json: true });
    expect(r.provider).toBe("gemini");
    expect(r.attempts[0]).toMatchObject({ provider: "openai", ok: false, kind: "quota" });
  });

  it("reaches Groq only when both of the others fail", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g"; ENV.GROQ_API_KEY = "k";
    stubFetch(h => h === "groq" ? { ok: true } : { ok: false, status: 500 });
    const { askAI } = await load();
    const r = await askAI(TEXT, { json: true });
    expect(r.provider).toBe("groq");
    expect(r.attempts.map(a => a.provider)).toEqual(["openai", "gemini", "groq"]);
  });

  it("on a bill photo with only Groq keyed, says no provider can do it rather than failing obscurely", async () => {
    ENV.GROQ_API_KEY = "k";                              // text-only model, image job
    stubFetch(() => ({ ok: true }));
    const { askAI } = await load();
    await expect(askAI(WITH_IMAGE, { json: true })).rejects.toThrow(/No AI provider can do this/);
  });

  it("explains every provider when they all fail, so the owner knows which account to fix", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g"; ENV.GROQ_API_KEY = "k";
    stubFetch(() => ({ ok: false, status: 500, body: { error: { message: "boom" } } }));
    const { askAI } = await load();
    await expect(askAI(TEXT, { json: true })).rejects.toThrow(/Every AI provider failed[\s\S]*openai[\s\S]*gemini[\s\S]*groq/);
  });

  it("rejects an answer the caller will not accept and moves to the next provider", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g";
    stubFetch(() => ({ ok: true }));
    const { askAI } = await load();
    const r = await askAI(TEXT, {
      json: true,
      accept: (raw: any) => { if (raw.from !== "gemini") throw new Error("not what I wanted"); return raw; },
    });
    expect(r.provider).toBe("gemini");
  });

  it("sends the photo to OpenAI as a data URI it can actually read", async () => {
    ENV.OPENAI_API_KEY = "o";
    const f = stubFetch(() => ({ ok: true }));
    const { askAI } = await load();
    await askAI(WITH_IMAGE, { json: true });
    const body = JSON.parse((f.mock.calls[0][1] as any).body);
    const parts = body.messages.at(-1).content;
    expect(parts[0]).toEqual({ type: "text", text: "read this bill" });
    expect(parts[1].image_url.url).toBe("data:image/jpeg;base64,AAAA");
    expect(body.response_format).toEqual({ type: "json_object" });
  });
});
