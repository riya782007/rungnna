import { beforeEach, describe, expect, it, vi } from "vitest";
import { newBill, DEFAULT_SHOP, totals, lineFrom } from "../src/lib/billing";
import type { Product } from "../src/lib/db";
const state = vi.hoisted(() => ({ user: null as any, bill: null as any, shop: null as any, security: false, configured: true, generate: vi.fn(), cancel: vi.fn(), update: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) }, from: (table: string) => {
  let id = ""; const chain: any = { select: () => chain, eq: (_: string, value: string) => { id = value; return chain; }, single: async () => ({ data: table === "bills" ? state.bill : { value: state.shop } }), maybeSingle: async () => ({ data: { value: { enabled: state.security } } }), update: (value: any) => { state.update(value); return chain; }, then: (resolve: any) => resolve({ error: null }) }; return chain;
} }) }));
vi.mock("../api/_gst-provider", () => ({ provider: () => state.configured ? { sandbox: true, generate: state.generate, cancel: state.cancel } : null }));
import { GET, POST } from "../api/gst";
const request = (body?: any) => new Request("https://shop.example/api/gst", { method: body ? "POST" : "GET", headers: { authorization: "Bearer test-token", "content-type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
beforeEach(() => {
  vi.stubEnv("SUPABASE_URL", "https://shop.supabase.co"); vi.stubEnv("SUPABASE_ANON_KEY", "anon"); vi.stubEnv("GST_OWNER_EMAILS", "");
  state.user = { email: "owner@example.com", app_metadata: { role: "owner" }, user_metadata: {} }; state.configured = true; state.security = false;
  state.shop = { ...DEFAULT_SHOP, gstin: "07ABCDE1234F1Z5", address: "Delhi shop" };
  const p = { id: "p", code: "P", item: "CHAIN", type: "PCS", rate: 10000, hsn: "7117" } as Product;
  state.bill = totals({ ...newBill("o", state.shop, "gst"), id: "b", status: "final", no: "RJ/26C10001", party_name: "Buyer", party_gstin: "07FGHIJ5678K1Z2", items: [lineFrom(p)], transport: { mode: "1", vehicle_no: "DL01AB1234", distance: 10, from_city: "Delhi", from_pin: "110001", to_city: "Delhi", to_address: "Street", to_pin: "110002", to_state_code: "07", transporter_id: "", transporter_name: "" } });
  state.generate.mockReset().mockResolvedValue({ id: "irn", generated_at: new Date().toISOString(), sandbox: true, ack_no: "123", signed_qr: "signed" }); state.cancel.mockReset().mockResolvedValue(undefined); state.update.mockReset();
});
describe("GST server authorization and acknowledgement", () => {
  it("ignores user-editable metadata for owner authorization", async () => { state.user.app_metadata = {}; state.user.user_metadata = { role: "owner" }; expect((await GET(request())).status).toBe(403); });
  it("reports JSON-only mode when no provider is configured", async () => { state.configured = false; expect(await (await GET(request())).json()).toMatchObject({ configured: false }); expect((await POST(request({ bill_id: "b", kind: "irn", action: "generate" }))).status).toBe(503); });
  it("uses the saved invoice rather than client tax values", async () => { const r = await POST(request({ bill_id: "b", kind: "irn", action: "generate", payload: { amount: 1 } })); expect(r.status).toBe(200); expect(state.generate.mock.calls[0][1].ValDtls.TotInvVal).toBe(103); expect(state.generate.mock.calls[0][2]).toBe("sandbox:irn:b"); expect(state.update).toHaveBeenCalledWith({ compliance: { irn: expect.objectContaining({ id: "irn" }) } }); });
  it("returns an existing acknowledgement without generating twice", async () => { state.bill.compliance = { irn: { id: "existing", generated_at: new Date().toISOString(), sandbox: true } }; expect((await POST(request({ bill_id: "b", kind: "irn", action: "generate" }))).status).toBe(200); expect(state.generate).not.toHaveBeenCalled(); });
  it("rejects expired cancellation and active linked EWB", async () => { state.bill.compliance = { irn: { id: "old", generated_at: "2020-01-01", sandbox: true } }; expect((await POST(request({ bill_id: "b", kind: "irn", action: "cancel", reason: "Wrong invoice" }))).status).toBe(409); state.bill.compliance.irn.generated_at = new Date().toISOString(); state.bill.compliance.ewb = { id: "ewb" }; expect((await POST(request({ bill_id: "b", kind: "irn", action: "cancel", reason: "Wrong invoice" }))).status).toBe(409); expect(state.cancel).not.toHaveBeenCalled(); });
});
