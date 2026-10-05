# POS verification and workflow

## Evidence from the supplied labels

The photo supplied on 5 October 2026 shows BALI, K5209/, KXZKLN and INR100 x 1PAIR. ZXing-WASM (the app's scanner engine) decoded the first and third QR codes directly, and the second after grayscale enlargement/thresholding, independently, as:

`5186~100~1~212~~K5209/~KXZKLN`

The fourth QR code could not be reliably decoded from this compressed photo, even with enlarged crops. A clear original image or physical label is needed to verify it independently. This is not evidence that the physical label fails.

The payload carries item number 5186, price INR100, pack size 1, reference 212, an empty TK field, style K5209/ and colour KXZKLN. It does **not** encode the printed word BALI or unit PAIR. The verified fallback mapping 5186 -> BALI / PAIR is now included. Owner-learned mappings and existing real product names take priority. Other item numbers are never guessed: import the existing product master or name each code once.

Git history was reviewed, including the QR name fix and the newer box recovery/scan visibility fix. No production customer's scan telemetry or deployed device logs were available. Local tests cannot certify every unseen QR, camera or scanner, or confirm that production has deployed the latest commit.

## Implemented workflow

- Scan existing labels, or use Add item -> Stock item and search by name, item number, style or colour.
- Choose packets or loose quantity before adding. Stock-linked manual lines retain product IDs and use normal stock movements. Identical compatible lines consolidate; different rates remain separate.
- Add item -> Custom item supports named non-catalogue sales with unit, style, colour, HSN, quantity and rate. These lines do not create fictional products or stock movements.
- POS calculator supports decimal arithmetic, parentheses, percentages via /100 and a short local history. Apply results to an item rate, packing or bill discount. Staff price permissions remain in force; calculator expressions accept numbers/operators only, not executable code.
- Names and units appear in the POS and printed invoices. Bill saving validates positive whole quantities and exact paise amounts. Number allocation and all bill/stock/outbox writes are now in one IndexedDB transaction, including rollback. Repeated Save/Print/Share triggers during the same save are ignored; errors are shown instead of silently failing.
- Drafts, manual lines, scanned product mappings and completed bills use the existing offline IndexedDB storage. Tools are lazy-loaded and included in PWA precache.

## Research

[Square cart workflows](https://api.squareup.com/help/ca/en/article/8238-build-your-customer-s-cart-in-the-square-retail-pos-app) support scan/search/tap entry, quantity preselection, consolidation and saved carts. [Shopify custom sales](https://help.shopify.com/en/manual/sell-in-person/shopify-pos/order-management/custom-sales) separates catalogue products from named custom sale lines. These patterns informed the POS changes; the existing shop's packet/box workflow and role restrictions were retained.

## Verification

`tests/pos.test.ts` covers the actual decoded payload, repeated scans, learned-name overrides, unknown-code handling, saved/thermal-printed names and units, manual lines, amount/quantity validation, mixed bills, different rates and calculator safety. The full suite, TypeScript and production build were run. Browser QA additionally exercised the scanned payload, custom two-pair entry and applying 100+50x2 to packing in an isolated local owner session with no Supabase connection.

No database migration is required. Confirm deployment of the latest commit and refresh installed devices before shop-floor acceptance testing. Test one actual sticker with the intended scanner/camera and confirm quantity/unit, rate, GST mode and invoice print before the first real sale. Price/GST profiles remain business-controlled; the QR alone does not establish tax treatment.
