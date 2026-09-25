import { env, json, requireShop } from "./_lib.js";

/* Automatic WhatsApp (Meta Cloud API). Stays switched off until WHATSAPP_TOKEN and
   WHATSAPP_PHONE_NUMBER_ID are filled in; the app then offers "Send automatically" next to tap-to-send.
   Note: Meta only allows free text inside 24 h of the customer's last message; outside that it needs an approved template. */
export async function POST(req: Request) {
  const who = await requireShop(req);
  if (who instanceof Response) return who;
  const token = env("WHATSAPP_TOKEN"), phoneId = env("WHATSAPP_PHONE_NUMBER_ID");
  if (!token || !phoneId) return json({ error: "WhatsApp API keys not added yet — use tap-to-send" }, 503);
  const b: any = await req.json().catch(() => ({}));
  const to = String(b.to || "").replace(/\D/g, "");
  if (to.length < 10) return json({ error: "Customer phone number missing" }, 400);
  const payload = b.template
    ? { messaging_product: "whatsapp", to, type: "template", template: { name: b.template, language: { code: b.lang || "en" }, components: b.components || [] } }
    : { messaging_product: "whatsapp", to, type: "text", text: { body: String(b.text || "").slice(0, 4000) } };
  const r = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(payload),
  });
  const j: any = await r.json().catch(() => ({}));
  return r.ok ? json({ ok: true, id: j?.messages?.[0]?.id }) : json({ error: j?.error?.message || "WhatsApp send failed" }, 502);
}
