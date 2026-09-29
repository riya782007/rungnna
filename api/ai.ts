import { gemini, json, requireShop, env } from "./_lib.js";
import { chainJson } from "./_llm.js";
import { b64 } from "./_r2.js";
import { VISION_PROMPT, contentPrompt, normalizeListing, normalizeFacts, templateListing, type ProductFacts, type VisualFacts } from "./_listing.js";

/* One endpoint, several jobs:
   - voice_bill  : a spoken or typed order ("do packet F-ring K5208 white, ek set choker…") → bill lines
   - transcribe  : a voice note → text (Hindi/English/Hinglish as spoken)
   - photo       : a product photo → item, colour, short description, tags
   - embed       : a product photo → structured visual fingerprint (hybrid match second opinion)
   - shot_prompt : raw product photo + locked base prompt → refined Google-Flow image prompt
   - listing     : product photo + fields → full SEO product page (retail + trade + catalogue)
                   Gemini reads the photo → OpenAI writes the page → Groq if OpenAI fails → template
   - ask         : a question about the shop, answered from the numbers the app sends */

const SYS = `You work inside the billing and stock app of RUNGNNA JEWELLERY & CO, a fashion/imitation jewellery wholesaler in India.
Staff speak Hindi, English or Hinglish. Item words: F-RING (finger ring), CHAIN, NECKLACE SET, CHOKER, EARRING, JHUMKI, BALI, TOPS,
MAANG TIKKA, BANGLE, KADA, BRACELET, PAYAL, PENDANT SET, MANGALSUTRA, NATH. Colours are codes like W (white), G (gold), R (rose),
K (kundan), LP, B, GBN. Styles look like K5208/K-LT. "packet"/"pkt"/"dabba" = packet; "piece"/"pc"/"nag" = piece; "darjan" = dozen (12).
Numbers may be spoken in Hindi (ek, do, teen, char, paanch, chhe, saat, aath, nau, das, bees, pachaas, sau).`;

export async function POST(req: Request) {
  const who = await requireShop(req);
  if (who instanceof Response) return who;
  let b: any;
  try { b = await req.json(); } catch { return json({ error: "Bad request" }, 400); }
  const audio = b.audio ? [{ inline_data: { mime_type: String(b.mime || "audio/webm").split(";")[0], data: String(b.audio) } }] : [];
  try {
    switch (b.task) {
      case "voice_bill": {
        const catalogue = String(b.catalogue || "").slice(0, 60_000);
        const out = await gemini([
          ...audio,
          { text: `${b.text ? "Typed order: " + b.text + "\n" : "The audio is a spoken order.\n"}
Known products (style | item | colour | rate ₹ | pieces per packet):
${catalogue}

Return JSON {"customer":{"name":"","phone":""},"lines":[{"style":"","item":"","color":"","packets":0,"pieces":0,"rate":0,"note":""}],"remarks":"","heard":""}.
- Use a style from the list when the order clearly means it; otherwise leave style empty and fill item/colour.
- If quantity is in packets set packets, else set pieces. rate only if the speaker said a price.
- "heard" = what you understood, written plainly.` },
        ], { json: true, system: SYS });
        return json(out);
      }
      case "transcribe": {
        const text = await gemini([...audio, { text: "Transcribe this shop voice note exactly as spoken (keep Hindi in Roman script). Then on a new line starting 'Summary:' give one short English line." }], { system: SYS });
        return json({ text });
      }
      case "photo": {
        const out = await gemini([
          { inline_data: { mime_type: b.mime || "image/webp", data: String(b.image) } },
          { text: `Describe this jewellery piece for the catalogue. JSON {"item":"one of the item words","color":"short colour code or words","stone":"","finish":"","description":"one line for customers","tags":["..."]}` },
        ], { json: true, system: SYS });
        return json(out);
      }
      case "embed": {
        // A structured visual fingerprint used by the hybrid matcher as a second
        // opinion alongside the on-device embedding. We ask for stable, discrete
        // visual attributes (not free text) so two photos of the same piece score
        // the same, and crucially so LOOK-ALIKE-BUT-DIFFERENT pieces still surface
        // any distinguishing detail for the operator to check against the model no.
        const out = await gemini([
          { inline_data: { mime_type: b.mime || "image/webp", data: String(b.image) } },
          { text: `Return a STRUCTURED visual fingerprint of this jewellery piece as JSON, using only these controlled values so the same piece always scores the same:
{"item":"one of the item words","shape":"round|oval|square|teardrop|floral|geometric|abstract|other","metal":"gold|rosegold|silver|oxidised|mixed|other","stones":"none|single|cluster|pave|kundan|pearl|meena","stone_color":"clear|white|red|green|blue|pink|multi|none","finish":"glossy|matte|antique|textured","size":"small|medium|large","distinctive":["short notes on anything that would tell this apart from a near-identical piece"]}
Be consistent and conservative; if unsure use "other"/"none".` },
        ], { json: true, system: SYS });
        return json(out);
      }
      case "shot_prompt": {
        // Refine the locked Google-Flow prompt using what Gemini actually SEES in the
        // owner's raw photo, so the prompt names the real stones/motifs/colours of THIS
        // piece. The client passes the locked base prompt (from src/lib/imagePrompt.ts);
        // the model may only ENRICH it — never weaken the fidelity / no-text / colour rules.
        const base = String(b.base || "").slice(0, 8_000);
        const image = b.image ? [{ inline_data: { mime_type: b.mime || "image/webp", data: String(b.image) } }] : [];
        if (!image.length || !base) return json({ error: "shot_prompt needs base + image" }, 400);
        const text = await gemini([
          ...image,
          { text: `Below is a LOCKED base prompt for generating an advertising photo of a model wearing the jewellery in the attached reference image. Rewrite it into ONE final, ready-to-paste prompt that:
- keeps EVERY non-negotiable rule intact and unchanged (design/architecture/colour identical to the reference; ABSOLUTELY NO TEXT anywhere; jewellery is the hero; the stated worn-location, subject, lighting, background, aspect and output rules);
- ENRICHES only the description of the piece with the specific, real visual details you can see in the reference (exact stone colours, bead/cut types, motifs, number of drops, metal finish) so the generator reproduces THIS exact piece;
- never invents anything not visible in the reference, and never adds any instruction that would place text in the image.
Return ONLY the final prompt text, no preamble, no markdown.

LOCKED BASE PROMPT:
${base}` },
        ], { system: SYS, temperature: 0.2 });
        // Safety net: if the model dropped the no-text rule, re-append it.
        const out = /no text/i.test(text) ? text : text + "\n\nABSOLUTELY NO TEXT of any kind anywhere in the image — no words, letters, numbers, logos or watermarks.";
        return json({ prompt: out });
      }
      case "listing": {
        const p: ProductFacts = {
          code: String(b.product?.code || ""), item: String(b.product?.item || ""), type: b.product?.type, style: b.product?.style,
          color: b.product?.color, category: b.product?.category, size: b.product?.size, pack: Number(b.product?.pack) || undefined,
          keywords: String(b.keywords || "").slice(0, 300),
        };
        const attempts: { provider: string; ok: boolean; kind?: string; message?: string }[] = [];
        // 1) Gemini looks at the raw photo and reports only what it can see
        let facts: VisualFacts = {};
        let img: { data: string; mime: string } | null = b.image ? { data: String(b.image), mime: String(b.mime || "image/webp") } : null;
        if (!img && typeof b.image_url === "string" && /^https:\/\//.test(b.image_url)) {
          try {
            const r = await fetch(b.image_url, { signal: AbortSignal.timeout(6_000) });
            if (r.ok) img = { data: b64(new Uint8Array(await r.arrayBuffer())), mime: r.headers.get("content-type") || "image/jpeg" };
          } catch { /* no photo → text-only page */ }
        }
        if (img && env("GEMINI_API_KEY")) {
          try {
            facts = normalizeFacts(await gemini([{ inline_data: { mime_type: img.mime, data: img.data } }, { text: VISION_PROMPT }], { json: true, system: SYS, temperature: 0.1 }));
            attempts.push({ provider: "gemini", ok: true });
          } catch (e: any) { attempts.push({ provider: "gemini", ok: false, message: String(e?.message || e).slice(0, 200) }); }
        } else if (img) attempts.push({ provider: "gemini", ok: false, kind: "no_key", message: "GEMINI_API_KEY is not set — page written without photo analysis" });
        // 2) OpenAI writes the structured page; 3) Groq takes over if OpenAI fails
        const r = await chainJson({ system: "You are the product copywriter for Rungnna Jewellery & Co. Return only valid JSON.", user: contentPrompt(p, facts) }, raw => normalizeListing(raw, p));
        attempts.push(...r.attempts);
        // 4) never dead-end: a plain factual page from the template
        const content = r.data ?? templateListing(p, facts);
        content.facts = facts;
        content.provider = r.data ? r.provider : "template";
        content.generated_at = new Date().toISOString();
        return json({ content, provider: content.provider, vision: attempts.some(a => a.provider === "gemini" && a.ok), attempts });
      }
      case "ask": {
        const text = await gemini([{ text: `Shop data (JSON, money in rupees):\n${JSON.stringify(b.context || {}).slice(0, 80_000)}\n\nQuestion: ${b.question}\n\nAnswer briefly in the language of the question. Use only the data given; if it isn't there, say what to record so it can be answered next time.` }],
          { system: SYS, temperature: 0.3 });
        return json({ text });
      }
      default: return json({ error: "Unknown task" }, 400);
    }
  } catch (e: any) {
    return json({ error: e?.message || "AI failed" }, e?.status || 500);
  }
}
