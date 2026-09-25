import { env, json } from "./_lib.js";

/* Tells the Settings screen which keys are filled in (never the keys themselves). */
export async function GET() {
  return json({
    ai: !!env("GEMINI_API_KEY"), model: env("GEMINI_MODEL") || "gemini-2.5-flash",
    whatsapp_api: !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")),
    supabase: !!(env("SUPABASE_URL") && env("SUPABASE_ANON_KEY")),
  });
}
