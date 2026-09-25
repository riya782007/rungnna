import { gemini, json, requireShop } from "./_lib.js";

/* One endpoint, four jobs:
   - voice_bill : a spoken or typed order ("do packet F-ring K5208 white, ek set choker…") → bill lines
   - transcribe : a voice note → text (Hindi/English/Hinglish as spoken)
   - photo      : a product photo → item, colour, short description, tags
   - ask        : a question about the shop, answered from the numbers the app sends */

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
