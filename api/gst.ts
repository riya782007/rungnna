import { createClient } from "@supabase/supabase-js";
import { env, json } from "./_lib.js";
import { provider } from "./_gst-provider.js";
import { canCancel, gstPayload, type GstKind } from "../src/lib/gst.js";
import type { Bill, Compliance } from "../src/lib/db";
async function handle(req: Request) {
  try {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    const url = env("SUPABASE_URL"), key = env("SUPABASE_ANON_KEY");
    if (!url || !key || !token) return json({ error: "Sign in to the shop account" }, 401);
    const c = createClient(url, key, { global: { headers: { Authorization: "Bearer " + token } }, auth: { persistSession: false } });
    const { data: { user }, error } = await c.auth.getUser(token);
    if (error || !user) return json({ error: "Login expired" }, 401);
    const allow = env("GST_OWNER_EMAILS").split(",").map(s => s.trim().toLowerCase());
    if (user.app_metadata.role !== "owner" && !allow.includes((user.email || "").toLowerCase())) return json({ error: "Owner account required" }, 403);
    const gsp = provider();
    if (req.method === "GET") return json({ configured: !!gsp, sandbox: gsp?.sandbox ?? true });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
    const { data: security } = await c.from("config").select("value").eq("id", "owner_security").maybeSingle();
    if (security?.value?.enabled) {
      const claims = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      if (claims.aal !== "aal2") return json({ error: "Owner two-step verification required" }, 403);
    }
    if (!gsp) return json({ error: "Provider not configured", code: "no_gst" }, 503);
    const input = await req.json();
    if (!["irn", "ewb"].includes(input.kind) || !["generate", "cancel"].includes(input.action)) return json({ error: "Invalid action" }, 400);
    const kind = input.kind as GstKind;
    const { data: bill, error: billError } = await c.from("bills").select("*").eq("id", input.bill_id).single();
    if (billError || !bill) return json({ error: "Sync this invoice before submitting" }, 409);
    const compliance: Compliance = bill.compliance || {};
    const record = compliance[kind];
    if (input.action === "generate") {
      if (record) return json({ compliance });
      const { data: shop } = await c.from("config").select("value").eq("id", "shop").single();
      if (!shop) return json({ error: "Sync the shop profile first" }, 409);
      compliance[kind] = await gsp.generate(kind, gstPayload(bill as Bill, shop.value, kind), `${gsp.sandbox ? "sandbox" : "live"}:${kind}:${bill.id}`);
    } else {
      if (!canCancel(record)) return json({ error: "Cancellation window has expired (24 hours)" }, 409);
      if (kind === "irn" && compliance.ewb && !compliance.ewb.cancelled_at) return json({ error: "Cancel the e-way bill first" }, 409);
      if (typeof input.reason !== "string" || input.reason.trim().length < 3) return json({ error: "Enter a cancellation reason" }, 400);
      await gsp.cancel(kind, record!, input.reason.trim());
      compliance[kind] = { ...record!, cancelled_at: new Date().toISOString() };
    }
    const { error: saveError } = await c.from("bills").update({ compliance }).eq("id", bill.id);
    if (saveError) return json({ error: "Provider succeeded, but saving failed. Retry to recover the acknowledgement." }, 502);
    return json({ compliance });
  } catch (e: any) { return json({ error: e.message || "Government service unavailable" }, 400); }
}
export const GET = handle;
export const POST = handle;
