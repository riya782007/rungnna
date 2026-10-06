# Karan's counter workflow: implementation and trial

## Delivered in this change

- Billing opens on a fresh launch. Desktop navigation collapses to an icon rail with named tooltips.
- Manual entry stays open above the bill table, defaulting to Custom item. Add item/F8 returns to Custom and focuses the name. Enter adds a valid item; the form resets and focuses the next name without jumping the page. Names remain editable and appear on bills. Catalog items supply their stored unit, rate and HSN; unknown custom items require explicit details.
- Latest additions remain visible with their name, box, quantity, unit, rate and amount. Successful additions and repeats have distinct tones; repeated custom items remain separate lines with a warning. Desktop billing has a fixed counter workspace with independently scrolling items and totals. Shorter screens use natural flow. Shared pages now use available width, with responsive purchase rows and a compact phone entry form.
- Active billing and label inputs turn yellow. Familiar keys: F3 hold, F4 held bills, F5 calculator, F6 save, F7 scan, F8 item, F11 box summary, F12 advance. Repeat scans increase quantity in the same box with a warning and distinct tone. A repeated save does not create another invoice.
- `bb` increments explicit BOX QTY: first scan/entry gives 1, second gives 2. New lines use that current box. This implements the one observed example; Karan should verify what subsequent `bb` scans mean in his old system.
- Barcode print exposes ITEM, TYPE, STYLE, COLOR, TK, RATE, QTY and PRINT QTY. Default print quantity is 1; dimensions and printer configuration remain adjustable. Product and optional stock intake save together in IndexedDB. Large label batches are bounded.
- Print content stays mounted through the browser print lifecycle. Fonts/images are prepared before printing, thermal pages get a measured valid size, and the last label no longer forces an extra page break. Close print is available for browsers that omit afterprint.
- Customer details support Upload photo and Take photo, including a saved camera selector for USB webcams. Photos are compressed into local storage. Camera streams stop on closing or switching. Ask the customer before taking their photo. HTTPS and camera permission are required.
- Customer/supplier list views conceal phone numbers; opening the account reveals contacts and address. Suppliers are excluded from the customer list.
- Home links to daily expenses, customers, suppliers, analytics, catalogue and purchases. Daily staff tasks support assignment, completion and printing.
- Reports add sales-by-hour using India time. Existing item-wise reports identify best sellers. Private estimates retain the existing report exclusion rules.
- Catalogue adds Photos (no prices), whose public page omits offers, rates and price-bearing product links. Publishing still needs the existing cloud/media setup.
- Floor/rack bulk creation validates its range and saves all new locations in one local transaction.
- Owner-only purchase-photo review accepts up to three pages, exposes uncertain fields and warnings, supports shop pricing and manual entry, and saves named products, stock intake, supplier purchase, sequence and sync queue in one IndexedDB transaction. Duplicate supplier bill numbers are rejected. Supplier payable can include reviewed tax/freight without changing inventory goods cost. Save purchase & print labels loads the saved purchase and printer settings, prepares all named purchase lines and opens the print dialog once. Missing product details or excessive label counts are reported rather than silently skipped. Browser/printer confirmation is still required.

## Verification and limits

188 tests passed, including persistent Custom entry, repeat detection, purchase-label quantities and safety limits, Gemini configuration responses without secrets or paid calls, purchase rollback, duplicate bills, trusted server-side owner authorization, printable product names, no-price catalogue and applying the new SQL migration twice. Frontend TypeScript, API TypeScript and production build passed. Build retains existing large-chunk warnings.

Browser trial at desktop 1440x900 and mobile 390x844 verified same-page manual entry, yellow active fields, calculator (132*5 = 660), label form defaults, mobile estimate-unlock control and no captured console errors. Test data was local and disconnected from Cloud.

The latest desktop trial also verified repeated Custom addition using Enter, maintained name focus, visible latest-item details and unchanged page scroll position. Purchase pages fill desktop width; the phone purchase review uses labelled rows without horizontal page overflow. A 1024x768 tablet trial verified no duplicate floating save bar or horizontal page overflow. No browser errors were captured.

The decoded original BALI sticker payload is `5186~100~1~212~~K5209/~KXZKLN`. Browser entry added BALI, K5209/, KXZKLN, PAIR and rate 100; repeating increased quantity. The product name is NOT encoded in this old QR. Only its verified numeric mapping or an imported product master can recover it. The newer multi-item photograph did not decode reliably. Do not promise all existing stickers are named until representative scans from Karan's actual scanner pass.

The voice note could not be transcribed: Windows Application Control blocked the local transcription library. No private audio was sent to a third party. Requirements found only in that audio remain unverified.

Hardware printing and actual Logitech capture have not been tested. Turn browser headers/footers off, choose the actual 58/80 mm roll or label stock, use 100% scale and check the printer driver paper size. Print one sample before a batch. Browser configuration cannot be changed automatically by this website.

## Setup and unresolved decisions

This incremental SQL was applied and its bigint column verified in production on 2026-10-06. It is safe to rerun after the existing repository migrations:

```sql
alter table public.purchases
  add column if not exists invoice_total bigint;

comment on column public.purchases.invoice_total is
  'Reviewed supplier payable including tax, freight and discounts; null uses total_cost for older purchases.';
```

Source: `supabase/migrations/20261006053516_purchase_invoice_total.sql`. Applied to Supabase project `klzeqzutxqiblbpjwoyh` with migration name `purchase_invoice_total`.

Purchase AI uses the Gemini server helper in `/api/purchase-photo`. Vercel Production already has GEMINI_API_KEY, GEMINI_MODEL (`gemini-2.5-flash`), SUPABASE_URL and SUPABASE_ANON_KEY. A server-side model metadata request returned HTTP 200; this verifies key/model access, not OCR accuracy or generation quota. The owner-only Check Gemini button checks configuration without sending photos or calling paid generation. Credentials never enter client source. Staff cannot call extraction by changing local role/user_metadata. AI reading requires internet; manual review and local saving work offline. Only the first uploaded page is retained as the purchase photo attachment.

Owner access is still pending: Production has no PURCHASE_OWNER_EMAILS/GST_OWNER_EMAILS allowlist and no trusted app_metadata.role=owner account. The exact owner Cloud-login email has been requested; do not infer it from the only existing account. Add that confirmed email to PURCHASE_OWNER_EMAILS in Vercel Production and redeploy. Until then the API correctly rejects photo reading with an owner-required response. No actual supplier bill has been sent to Gemini in this trial.

For a non-generating provider check, run `vercel env run -e production -- node scripts/check-gemini.mjs` from the linked project. PowerShell's Vercel wrapper can lose forwarded arguments; invoking Vercel's installed `dist/vc.js` with Node preserves them. The script prints only model, status and availability.

Do not silently divide financial amounts by ten. The ambiguous request for a Rs100 bill to show Rs10 is not implemented; statutory invoices, ledgers and tax reports retain actual amounts. A separately labelled private code representation needs Karan's explicit confirmation.

GSTIN automatic lookup requires a configured authorized lookup service. It is not implemented here; enter/verify the GSTIN and party details manually. Automatic Instagram/LinkedIn reel publishing, automatic sales notifications and a new backup destination are also not implemented. Existing cloud sync and Download backup remain the backup paths; never clear browser data without a verified backup. Cloud sync is not a substitute for a separate recoverable backup.

Pushing main is not proof of a production deployment. Verify the production deployment commit, then test on one counter before wider rollout.

## Research basis

The workflow combines scanner-first catalog selection, inline manual fallback and recoverable held carts documented by [Shopify product search](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/inventory-management/searching-for-products) and [saved carts](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/manage-recent-carts), while preserving Karan's actual field names and shortcuts.

Printing follows [MDN print lifecycle](https://developer.mozilla.org/en-US/docs/Web/API/Window/print), [afterprint](https://developer.mozilla.org/en-US/docs/Web/API/Window/afterprint_event) and valid [page sizes](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/At-rules/@page/size). Webcam capture follows [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia): permission, secure context and explicit device selection.

Gemini follows [Google's API-key guidance](https://ai.google.dev/gemini-api/docs/api-key) with server-side credentials and owner authentication through [Supabase getUser](https://supabase.com/docs/reference/javascript/auth-getuser).
