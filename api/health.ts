import { env, json } from "./_lib.js";
import { openaiConfigured, groqConfigured, openaiModel, groqModel } from "./_llm.js";
import { r2Configured } from "./_r2.js";

/* Tells the Settings screen which keys are filled in (never the keys themselves). */
export async function GET() {
  return json({
    ai: !!env("GEMINI_API_KEY"), model: env("GEMINI_MODEL") || "gemini-2.5-flash",
    openai: openaiConfigured(), openai_model: openaiModel(),
    groq: groqConfigured(), groq_model: groqModel(),
    r2: r2Configured(),
    whatsapp_api: !!(env("WHATSAPP_TOKEN") && env("WHATSAPP_PHONE_NUMBER_ID")),
    supabase: !!(env("SUPABASE_URL") && env("SUPABASE_ANON_KEY")),
  });
}
