import { env } from "./_lib.js";
import type { ComplianceRecord } from "../src/lib/db";
import type { GstKind } from "../src/lib/gst";
export interface GstProvider {
  sandbox: boolean;
  generate(kind: GstKind, payload: unknown, key: string): Promise<ComplianceRecord>;
  cancel(kind: GstKind, record: ComplianceRecord, reason: string): Promise<void>;
}
// Bridge contract is provider-neutral; a GSP/ASP-specific adapter can replace it.
class HttpGsp implements GstProvider {
  sandbox = env("GST_MODE") !== "production";
  private async call(action: string, body: unknown) {
    const base = this.sandbox ? env("GST_SANDBOX_URL") : env("GST_PROVIDER_URL");
    if (!base.startsWith("https://")) throw new Error("Configure an HTTPS provider URL");
    const r = await fetch(base.replace(/\/$/, "") + "/" + action, { method: "POST", redirect: "error", headers: { "content-type": "application/json", authorization: "Bearer " + env("GST_API_KEY") }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error("Provider rejected the request; check its portal for details");
    return r.json();
  }
  async generate(kind: GstKind, payload: unknown, key: string) {
    const j = await this.call("generate", { kind, payload, idempotency_key: key });
    if (typeof j.id !== "string" || !j.id || !Number.isFinite(Date.parse(j.generated_at)) || (kind === "irn" && (!j.ack_no || !j.signed_qr))) throw new Error("Incomplete provider acknowledgement");
    return { id: j.id, generated_at: new Date(j.generated_at).toISOString(), ack_no: j.ack_no ? String(j.ack_no) : undefined, signed_qr: j.signed_qr, sandbox: this.sandbox };
  }
  async cancel(kind: GstKind, record: ComplianceRecord, reason: string) { await this.call("cancel", { kind, id: record.id, reason }); }
}
export function provider(): GstProvider | null {
  return env("GST_PROVIDER") === "http-gsp" && env("GST_API_KEY") && (env("GST_MODE") === "production" ? env("GST_PROVIDER_URL") : env("GST_SANDBOX_URL")) ? new HttpGsp() : null;
}
