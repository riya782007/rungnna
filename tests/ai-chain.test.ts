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

  it("reads photos on Groq with its vision model by default, and 'off' turns that off", async () => {
    ENV.GROQ_API_KEY = "k";
    const { canServe, groqVisionModel, GROQ_VISION_DEFAULT } = await load();
    expect(groqVisionModel()).toBe(GROQ_VISION_DEFAULT);
    expect(GROQ_VISION_DEFAULT).toBe("qwen/qwen3.8-27b");     // Llama 4 Scout was shut down 17 Jul 2026
    expect(canServe("groq", WITH_IMAGE)).toBe(true);
    ENV.GROQ_VISION_MODEL = "off";
    expect(canServe("groq", WITH_IMAGE)).toBe(false);
    expect(canServe("groq", TEXT)).toBe(true);                 // text still goes to the text model
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

  it("on a bill photo with Groq's photos switched off, says no AI is set up rather than failing obscurely", async () => {
    ENV.GROQ_API_KEY = "k"; ENV.GROQ_VISION_MODEL = "off";
    stubFetch(() => ({ ok: true }));
    const { askAI } = await load();
    await expect(askAI(WITH_IMAGE, { json: true })).rejects.toThrow(/No AI is set up for this yet[\s\S]*Groq: can't read photos/);
  });

  it("explains every provider when they all fail, so the owner knows which account to fix", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g"; ENV.GROQ_API_KEY = "k";
    stubFetch(() => ({ ok: false, status: 500, body: { error: { message: "boom" } } }));
    const { askAI } = await load();
    await expect(askAI(TEXT, { json: true })).rejects.toThrow(/No AI could read this[\s\S]*OpenAI: boom[\s\S]*Gemini: boom[\s\S]*Groq: boom/);
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


describe("when OpenAI and Gemini are both out (15 Oct 2026, as the owner saw it)", () => {
  const OPENAI_OUT = { ok: false, status: 429, body: { error: { message: "You have no credits remaining. Add credits to continue using the API at https://platform.openai.com/settings/organization/billing/." } } };
  const GEMINI_OUT = { ok: false, status: 429, body: { error: { message: "You exceeded your current quota, please check your plan and billing details." } } };

  it("the bill photo still gets read, by Groq's vision model, with its reasoning hidden", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g"; ENV.GROQ_API_KEY = "k";
    const bodies: any[] = [];
    vi.spyOn(globalThis, "fetch" as any).mockImplementation(async (url: any, init: any) => {
      const host = String(url).includes("openai.com") ? "openai" : String(url).includes("groq.com") ? "groq" : "gemini";
      if (host === "groq") bodies.push(JSON.parse(init.body));
      const r = host === "openai" ? OPENAI_OUT : host === "gemini" ? GEMINI_OUT
        : { ok: true, status: 200, body: { choices: [{ message: { content: '<think>reading…</think>{"rows":[1]}' } }] } };
      return { ok: r.ok, status: r.status, json: async () => r.body } as any;
    });
    const { askAI } = await load();
    const r = await askAI(WITH_IMAGE, { json: true });
    expect(r.provider).toBe("groq");
    expect(r.data).toEqual({ rows: [1] });                          // <think> never breaks the JSON
    expect(bodies[0].model).toBe("qwen/qwen3.8-27b");
    expect(bodies[0].reasoning_format).toBe("hidden");
  });

  it("asks Groq once more without a parameter the model refuses", async () => {
    ENV.GROQ_API_KEY = "k";
    const bodies: any[] = [];
    vi.spyOn(globalThis, "fetch" as any).mockImplementation(async (_u: any, init: any) => {
      const b = JSON.parse(init.body); bodies.push(b);
      return (b.reasoning_format
        ? { ok: false, status: 400, json: async () => ({ error: { message: "reasoning_format is not supported with this model" } }) }
        : { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) }) as any;
    });
    const { askAI } = await load();
    const r = await askAI(WITH_IMAGE, { json: true }, ["groq"]);
    expect(r.data).toEqual({ ok: true });
    expect(bodies).toHaveLength(2);
    expect(bodies[1].reasoning_format).toBeUndefined();
  });

  it("when nothing can read it, says what to do in plain words, not three raw errors", async () => {
    ENV.OPENAI_API_KEY = "o"; ENV.GEMINI_API_KEY = "g"; ENV.GROQ_VISION_MODEL = "off";
    stubFetch(h => (h === "openai" ? OPENAI_OUT : GEMINI_OUT));
    const { askAI } = await load();
    const e: any = await askAI(WITH_IMAGE, { json: true }).catch(x => x);
    expect(e.message).toBe([
      "No AI could read this. Nothing was saved.",
      "• OpenAI: out of credit. Add credit at platform.openai.com → Billing",
      "• Gemini: free quota used up. It refills daily, or turn on billing in Google AI Studio",
      "• Groq: no key added in Vercel",
    ].join("\n"));
    expect(e.message).not.toMatch(/https?:\/\//);                 // no raw billing URLs dumped on the counter
  });
});
