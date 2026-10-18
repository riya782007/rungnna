import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: null as any, read: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }) }));
vi.mock("../api/_lib.js", () => ({ env: (key: string) => process.env[key] || "", json: (body: unknown, status = 200) => Response.json(body, { status }) }));
/* The endpoint now reads a bill through the OpenAI -> Gemini -> Groq chain (api/_llm).
   state.read stands in for that chain and returns what a provider answered. */
vi.mock("../api/_llm.js", () => ({
  askAI: async (...a: any[]) => ({ data: await state.read(...a), provider: "openai", attempts: [{ provider: "openai", ok: true }] }),
  canServe: (p: string) => (p === "openai" ? !!process.env.OPENAI_API_KEY : p === "gemini" ? !!process.env.GEMINI_API_KEY : !!process.env.GROQ_API_KEY),
  openaiConfigured: () => !!process.env.OPENAI_API_KEY,
  geminiConfigured: () => !!process.env.GEMINI_API_KEY,
  groqConfigured: () => !!process.env.GROQ_API_KEY,
  openaiModel: () => process.env.OPENAI_MODEL || "gpt-5.4-mini",
  geminiModel: () => process.env.GEMINI_MODEL || "gemini-2.5-flash",
  DEFAULT_ORDER: ["openai", "gemini", "groq"],
}));
import { GET, POST } from "../api/purchase-photo";
const request = (images: any = [{ mime: "image/jpeg", data: "test" }], token = "token") => new Request("https://shop.example/api/purchase-photo", { method: "POST", headers: { authorization: token ? `Bearer ${token}` : "", "content-type": "application/json" }, body: JSON.stringify({ images }) });
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://shop.supabase.co"); vi.stubEnv("SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("PURCHASE_OWNER_EMAILS", ""); vi.stubEnv("GST_OWNER_EMAILS", "");
  vi.stubEnv("PURCHASE_AI_ACCESS", "");
  vi.stubEnv("GEMINI_API_KEY", ""); vi.stubEnv("GEMINI_MODEL", "");
  vi.stubEnv("OPENAI_API_KEY", ""); vi.stubEnv("GROQ_API_KEY", ""); vi.stubEnv("GROQ_VISION_MODEL", "");
  state.user = { email: "owner@example.com", app_metadata: { role: "owner" } };
  state.read.mockReset().mockResolvedValue({ rows: [{ item: "BALI", qty: "4", cost: "25" }], warnings: ["Review selling rates"] });
});
it("requires verified cloud login", async () => { expect((await POST(request(undefined, ""))).status).toBe(401); state.user = null; expect((await POST(request())).status).toBe(401); expect(state.read).not.toHaveBeenCalled(); });
it("does not trust editable owner metadata", async () => { state.user.app_metadata = {}; state.user.user_metadata = { role: "owner" }; expect((await POST(request())).status).toBe(403); expect(state.read).not.toHaveBeenCalled(); });
it("allows the server-configured owner email", async () => { state.user.app_metadata = {}; vi.stubEnv("PURCHASE_OWNER_EMAILS", "OWNER@example.com"); expect((await POST(request())).status).toBe(200); });
it("rejects unsupported or excessive uploads before calling AI", async () => { expect((await POST(request([{ mime: "application/pdf", data: "test" }]))).status).toBe(400); expect((await POST(request(Array(4).fill({ mime: "image/jpeg", data: "test" })))).status).toBe(400); expect(state.read).not.toHaveBeenCalled(); });
it("rejects invalid AI output and preserves review warnings", async () => { state.read.mockResolvedValueOnce({ rows: "bad" }); expect((await POST(request())).status).toBe(422); expect(await (await POST(request())).json()).toMatchObject({ warnings: ["Review selling rates"] }); });
it("rejects empty or damaged rows and reports bounded AI timeouts", async () => {
  for (const rows of [[], [null], ["bad"]]) { state.read.mockResolvedValueOnce({ rows }); expect((await POST(request())).status).toBe(422); }
  state.read.mockRejectedValueOnce(Object.assign(new Error("timeout"), { name: "TimeoutError" }));
  const r = await POST(request()); expect(r.status).toBe(503); expect((await r.json()).error).toContain("no purchase has been saved");
});
it("reports which providers can read a bill, without exposing a key or making a paid call", async () => {
  expect(await (await GET(request())).json()).toMatchObject({ configured: false, provider: "none" });
  vi.stubEnv("GEMINI_API_KEY", "private-test-key");
  const r = await GET(request()); expect(await r.text()).not.toContain("private-test-key");
  expect(await (await GET(request())).json()).toMatchObject({ configured: true, provider: "Gemini" });
  vi.stubEnv("OPENAI_API_KEY", "o");
  expect(await (await GET(request())).json()).toMatchObject({ configured: true, provider: "OpenAI \u2192 Gemini" });
  expect(state.read).not.toHaveBeenCalled();
  state.user.app_metadata = {}; expect((await GET(request())).status).toBe(403);
});
it("rejects missing image records", async () => { expect((await POST(request([null]))).status).toBe(400); expect(state.read).not.toHaveBeenCalled(); });
it("allows all verified shop logins only when explicitly configured", async () => {
  state.user.app_metadata = {}; vi.stubEnv("PURCHASE_AI_ACCESS", "shop");
  expect((await GET(request())).status).toBe(200);
  expect((await POST(request())).status).toBe(200);
  expect((await POST(request(undefined, ""))).status).toBe(401);
  state.user = null; expect((await POST(request())).status).toBe(401);
});
