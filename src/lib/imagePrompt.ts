import type { Product } from "./db";

/* ===========================================================================
   Google-Flow image-prompt builder.

   The owner does NOT generate images inside this app and we do NOT host any
   generated image. Instead the app writes the exact prompt, hands over the raw
   product photo, and opens Google Flow (labs.google/fx/tools/flow) where the
   owner drags the raw photo in, pastes this prompt, generates, downloads the
   result, and uploads that finished professional image back onto the product.

   This module produces that prompt. It is the client's non-negotiable spec,
   adapted from the reference project: the model must wear the piece to advertise
   it, the DESIGN, ARCHITECTURE and COLOUR of the jewellery must stay identical to
   the raw photo, and the image must contain absolutely no text of any kind.

   Pure + deterministic so it can be unit-tested and always produces the same
   prompt for the same product.
=========================================================================== */

export type Aspect = "4:5" | "1:1" | "9:16";

/* Where each kind of jewellery is worn, so Flow frames a necklace as a necklace,
   an anklet on the ankle, etc. Keyed by rungnna's ITEM words (see products.ts
   DEFAULT_ITEMS) with a few common synonyms. */
const WORN_AT: Record<string, string> = {
  chain: "the neckline and décolletage",
  "necklace set": "the neckline and décolletage (full set worn together)",
  necklace: "the neckline and décolletage",
  choker: "the base of the neck, close on the throat",
  earring: "the ear and jawline, slight three-quarter turn",
  jhumki: "the ear and jawline, slight three-quarter turn",
  bali: "the ear and jawline, slight three-quarter turn",
  tops: "the ear and jawline, slight three-quarter turn",
  "maang tikka": "the centre forehead and hair parting, slight downward gaze",
  bangle: "the wrist and forearm, hand softly posed",
  kada: "the wrist and forearm, hand softly posed",
  bracelet: "the hand and wrist",
  ring: "the hand, fingers gently relaxed",
  payal: "the ankle and foot, seated or mid-step",
  anklet: "the ankle and foot, seated or mid-step",
  "pendant set": "the neckline and décolletage",
  mangalsutra: "the neckline and décolletage",
  nath: "the nose and cheek, delicate side profile",
  nathni: "the nose and cheek, delicate side profile",
  "hair accessory": "the hair and parting",
  bindi: "the centre forehead",
  brooch: "the upper chest / shoulder of a draped garment",
  kamarbandh: "the waist, three-quarter turn",
  hathphool: "the back of the hand and fingers, fingers gently splayed",
};

function wornAt(item: string): string {
  const k = (item || "").trim().toLowerCase();
  return WORN_AT[k] || "the piece worn naturally, jewellery as the clear hero";
}

/* A luminous, bright-skinned Indian model by default (the shop's clientele). */
const SUBJECT =
  "a graceful young Indian (South Asian) woman in her mid-20s with a luminous, evenly-lit fair-to-wheatish complexion (bright and healthy, never dark or muddy), expressive kohl-lined eyes, soft natural dewy makeup, sleek dark hair and a warm confident expression";

export interface ShotInput {
  item: string;            // rungnna ITEM word, e.g. "EARRING"
  category?: string;       // optional broader category
  style?: string;          // e.g. K5208/K-LT
  color?: string;          // colour code/words
  keywords?: string;       // owner's extra 1–2 details (highest priority), e.g. "kundan, peacock motif"
  aspect?: Aspect;
}

function aspectNote(a: Aspect): string {
  if (a === "1:1") return "a SQUARE 1:1 aspect ratio (e.g. 1024x1024), for a product-grid thumbnail";
  if (a === "9:16") return "a VERTICAL 9:16 aspect ratio (e.g. 1080x1920), for a full-screen story/reel";
  return "a VERTICAL PORTRAIT 4:5 aspect ratio (taller than wide, e.g. 1080x1350), for a product-page hero — model and jewellery centred with comfortable margins so nothing important is cropped";
}

/* Build the ready-to-paste Google Flow prompt. */
export function buildShotPrompt(input: ShotInput): string {
  const item = (input.item || "jewellery piece").trim();
  const label = item.toLowerCase();
  const identity = `It is a ${label}${input.style ? ` (style ${input.style})` : ""}, worn at ${wornAt(item)}.`;
  const colourLine = input.color?.trim()
    ? ` The piece's colour is "${input.color.trim()}" exactly as shown in the reference — do not change or invent any colour.`
    : " Take the colour directly from the reference — do not change or invent any colour.";
  const keywordLine = input.keywords?.trim()
    ? ` OWNER-SPECIFIED DETAILS (must be shown accurately): ${input.keywords.trim()}.`
    : "";
  const aspect = input.aspect ?? "4:5";

  return `This is a REAL, manufactured artificial-jewellery product that a customer will physically receive. Use the ATTACHED image as the EXACT product reference. Generate a professional, editorial-grade e-commerce advertising photograph of a model WEARING this exact piece to advertise it.

PRODUCT IDENTITY (frame the shot correctly): ${identity}${keywordLine} Photograph and style it AS a ${label} — worn and framed in the correct place for that jewellery type, never as a different kind of jewellery.

NON-NEGOTIABLE — KEEP THE DESIGN, ARCHITECTURE AND COLOUR IDENTICAL (the #1 rule):
The jewellery in the output must be IDENTICAL to the reference — the same shape and overall architecture, the same metal colour and finish, the same gemstone/bead cut, colour, size and exact placement, the same enamel/meenakari, engravings, links, tassels, drops, clasps and proportions.${colourLine} Do NOT add, remove, resize, restyle, rearrange, recolour or "improve" anything. NO HALLUCINATION: never invent or add a stone, motif, drop, colour or element that is not clearly visible in the reference — reproduce ONLY what is actually there. If in doubt, copy the reference exactly.

MAXIMUM SHARPNESS & DETAIL: render the jewellery ultra-sharp and high-resolution so every stone, bead, facet, cut and engraving is clearly defined and separated — tack-sharp, no blur or softening, like a high-end macro product photograph.

NON-NEGOTIABLE — ABSOLUTELY NO TEXT:
The image must contain ZERO text of any kind — no words, letters, numbers, captions, labels, logos, watermarks, brand names, price tags, signatures, stamps, borders with writing, or UI. Every surface — background, clothing, jewellery — must be completely free of writing. If any text would normally appear, leave that area clean and blank.

SUBJECT (the jewellery is the hero, not her face): ${SUBJECT}. Bright, luminous, well-exposed skin. SHOT: close, flattering framing on ${wornAt(item)}.

THE JEWELLERY IS THE HERO: it must be the brightest, sharpest, most eye-catching element in the frame — expose and light FOR the piece so metal gleams and every stone sparkles and reads vivid and true; it should be the first thing the eye lands on.

STYLING: minimal neutral wardrobe (soft beige, ivory, blush or muted tone) with a simple neckline that showcases the piece; no competing jewellery; no printed text or graphics on clothing.
LIGHTING: bright, clean, high-key studio beauty lighting; soft and flattering on skin; crisp directional key on the jewellery; no dark or muddy tones, no heavy face shadows, no blown highlights; colour-accurate so metal and stones read true.
BACKGROUND & MOOD: clean bright off-white / soft ivory seamless studio backdrop; calm, aspirational, premium Indian jewellery-brand feel; plain and free of any signage or writing.
TECHNICAL: photorealistic, 85mm lens look, shallow depth of field with the jewellery tack-sharp, high resolution, natural skin texture, professional colour grading.
OUTPUT FRAMING: render the final image in ${aspectNote(aspect)}.
OUTPUT: a clean advertising photograph with NO text, NO watermark, NO logo and NO graphic overlays anywhere.`;
}

/* Convenience: build the prompt straight from a product row. */
export function shotPromptForProduct(p: Pick<Product, "item" | "category" | "style" | "color">, keywords?: string, aspect?: Aspect): string {
  return buildShotPrompt({ item: p.item, category: p.category, style: p.style, color: p.color, keywords, aspect });
}

/* The Google Flow tool URL. Flow has no query-param prompt/ingredient API, so we
   open it in a new tab; the owner pastes the copied prompt and drags in the raw
   photo (both prepared by the app). */
export const GOOGLE_FLOW_URL = "https://labs.google/fx/tools/flow";
