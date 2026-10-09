# Rungnna Shop OS

Offline-first point-of-sale, inventory and accounts app (installable PWA) for Rungnna Jewellery & Co.

- **Frontend:** React 18 + TypeScript + Vite. All data lives first in IndexedDB (Dexie) and is queued in an outbox that syncs to Supabase when online.
- **Money** is stored as integer paise everywhere. Tax maths is in `src/lib/billing.ts` (`totals()`): bill-wide GST rate with optional per-product rate, exclusive/inclusive mode, CGST+SGST or IGST decided by GST state code (`src/lib/states.ts`), net rounded to the nearest rupee.
- **Documents:** tax invoice (`RJ`), estimate (`EST`), delivery challan (`CH`), credit note (`CN`/`ECN`). Numbers look like `RJ/26C7K0001` (series / financial-year / counter code / sequence). Each device has its own counter code; duplicates are skipped locally and `duplicateNumbers()` finds any that clashed across devices.
- **PDFs** (`src/lib/pdf.ts`) embed subsetted Noto Sans / Noto Sans Devanagari from `public/fonts` (SIL OFL) so ₹ and Hindi print correctly; without the fonts they fall back to Latin text with "Rs.".
- **Serverless API** (`api/`, Vercel): Gemini/Groq/OpenAI helpers, purchase-bill photo reader, GST e-invoice/e-way-bill bridge, WhatsApp, media (R2).
- **Database:** `supabase/migrations/` (run in order; 0012 adds role-based policies, see `docs/phase3-setup.md`).

## Develop

```
npm install
npm run dev      # local app
npm test         # vitest (unit + IndexedDB flows)
npm run build    # type-check + production build
```

## Environment (Vercel)

`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `GEMINI_API_KEY` (`GEMINI_MODEL`), optional `GROQ_*`/`OPENAI_*`, `GST_PROVIDER`, `GST_PROVIDER_URL`, `GST_API_KEY`, `GST_MODE`, `GST_OWNER_EMAILS`, `PURCHASE_OWNER_EMAILS`, `PURCHASE_AI_ACCESS` (`shop` lets any signed-in shop login read purchase bills; unset = owner only), `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `SITE_URL`.

## Things to know

- Roles in the app (`src/lib/roles.ts`) are enforced in the client; the server only separates users who have their own Supabase accounts with `app_metadata.role` (see `docs/phase3-setup.md`). Legacy shared logins are unrestricted.
- Selling more than the recorded stock is allowed (the shop must be able to bill), but the bill is flagged `oversold` and a warning shows at save.
- Add a unique index on `bills(no)` per store in Supabase if you want the database itself to refuse duplicate document numbers.
- More notes: `docs/`.
