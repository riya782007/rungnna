import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ user: null as any, read: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }) }));
vi.mock("../api/_lib.js", () => ({ env: (key: string) => process.env[key] || "", json: (body: unknown, status = 200) => Response.json(body, { status }), gemini: state.read }));
import { POST } from "../api/purchase-photo";
const request = (images: any = [{ mime: "image/jpeg", data: "test" }], token = "token") => new Request("https://shop.example/api/purchase-photo", { method: "POST", headers: { authorization: token ? `Bearer ${token}` : "", "content-type": "application/json" }, body: JSON.stringify({ images }) });
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://shop.supabase.co"); vi.stubEnv("SUPABASE_ANON_KEY", "anon");
  vi.stubEnv("PURCHASE_OWNER_EMAILS", ""); vi.stubEnv("GST_OWNER_EMAILS", "");
  state.user = { email: "owner@example.com", app_metadata: { role: "owner" } };
  state.read.mockReset().mockResolvedValue({ rows: [], warnings: ["No readable lines"] });
});
it("requires verified cloud login", async () => { expect((await POST(request(undefined, ""))).status).toBe(401); state.user = null; expect((await POST(request())).status).toBe(401); expect(state.read).not.toHaveBeenCalled(); });
it("does not trust editable owner metadata", async () => { state.user.app_metadata = {}; state.user.user_metadata = { role: "owner" }; expect((await POST(request())).status).toBe(403); expect(state.read).not.toHaveBeenCalled(); });
it("allows the server-configured owner email", async () => { state.user.app_metadata = {}; vi.stubEnv("PURCHASE_OWNER_EMAILS", "OWNER@example.com"); expect((await POST(request())).status).toBe(200); });
it("rejects unsupported or excessive uploads before calling AI", async () => { expect((await POST(request([{ mime: "application/pdf", data: "test" }]))).status).toBe(400); expect((await POST(request(Array(4).fill({ mime: "image/jpeg", data: "test" })))).status).toBe(400); expect(state.read).not.toHaveBeenCalled(); });
it("rejects invalid AI output and preserves review warnings", async () => { state.read.mockResolvedValueOnce({ rows: "bad" }); expect((await POST(request())).status).toBe(422); expect(await (await POST(request())).json()).toMatchObject({ rows: [], warnings: ["No readable lines"] }); });
