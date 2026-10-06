# Receipt and purchase-label trial

## What the photographs establish

The failed print contains the browser date/title and almost no bill content. That
is consistent with a missing print document or a paper/driver mismatch, but the
photographs alone do not identify the exact cause. No printer/spooler logs or
confirmed printer model were supplied. The old receipts establish box-wise item
lines, unit, quantity, rate, amount, discount, advance, packing and net amount.
Karan's follow-up on 6 October 2026 confirms automatic half/partial cutting.
The model, driver configuration and output from the updated app remain unverified.

## Changes

- Print a separate document containing a snapshot of the receipt/labels only.
  Wait for styles, fonts, images and layout; retain content until afterprint.
- New-device billing defaults to 80 mm. Explicit saved A4/A5 choices remain intact.
  Settings supports 58/80 mm; thermal page height is measured for each bill.
- Thermal receipts show product names, style/colour/unit and each box's quantity.
  Statutory amounts remain actual amounts, not privately coded prices.
- Purchase-photo readings automatically fill missing selling rates using the
  current shop pricing rule, while preserving explicitly printed selling rates.
  The rule, goods cost, supplier payable and label count are visible for review.
- Save purchase and print opens the prepared label batch automatically. Product,
  purchase, stock, movements, numbering, outbox and draft clearing are one local
  IndexedDB transaction. Duplicate supplier bills cannot take stock twice.
- Existing articles use the reviewed name/rate and deterministic cost code.
  Packet labels and their QR payload agree; partly filled packets get a separate
  label. Billing/stock scans use that sticker's quantity without changing the
  product master's standard packet size.
- Browser/Windows-driver printing is the default. Optional direct TSC output is
  for supported TSPL, 203-dpi single-column roll printers only. Connect once in
  label settings. One batch is sent in one write; errors do not trigger automatic
  reprints because a partly accepted job could otherwise produce duplicates.
  Use browser output for Hindi/Unicode text, sheets and 2-up labels.
- Invalid dimensions, incomplete names, empty OCR output and excessive label
  batches are rejected. AI requests have a 45-second timeout.

## Production AI authorization

At the user's explicit request, `PURCHASE_AI_ACCESS=shop` was set in Vercel
Production. Any server-verified Supabase login for this project may use the bill
reader. Anonymous requests remain denied; API keys remain server-only. This does
not change staff cost visibility or owner-only financial saving permissions.
Remove this variable to restore the server's owner-only default.

Gemini `gemini-2.5-flash` model access returned HTTP 200. A live synthetic-image
test correctly read DEMO-123, BALI, 4 PAIR, unit cost 25.50 and total 120.36, with
no invented selling rate. No Karan customer/supplier document was sent for this
test. These results do not guarantee accuracy on blurry real bills or future
provider quota availability.

## One-time printer setup and trial

1. Update the app after finishing/holding the current bill.
2. Settings > Printing: choose the real roll width (80 mm default, 58 mm available).
3. In the browser dialog choose the correct printer, receipt/roll paper, 100%
   scale, and turn off Headers and footers. Do not use A4 paper on a receipt roll.
4. In the manufacturer's Windows driver enable cutting at End of Document / End
   of Job with Partial / Half cut, not a cut after each page. Settings > Printing
   records this per-device cutter preference (half cut by default); it does not
   configure Windows. Full cut and manual tear-off remain selectable for other
   counters. Names and supported cut modes vary by manufacturer.
   Browser CSS cannot turn a physical cutter on or supply a missing driver.
5. Print a small two-box bill; check names, quantities, totals, paper length and
   one cut after the bill. Exact auto-cut behavior remains unverified until this
   hardware trial and printer-model confirmation.
6. Labels default to the supplied 50 x 20 mm sticker style. Choose the actual
   label roll size/gap in label settings and the Windows driver. Browser printing
   opens a dialog; no-dialog direct output requires compatible connected hardware.
7. Stock in > Purchase bill photos: read one clear bill, select supplier/rack,
   review every quantity/unit/cost/rate and supplier payable, then click Save
   purchase & print labels. Ambiguous boxes/dozens still require explicit conversion;
   the software will not silently invent their unit quantities.
8. Scan one fresh label in New bill and Stock in. Verify its product name and the
   exact quantity shown on that sticker before using a full production batch.

## Verification

- 219 tests across 32 files passed after merging the newer main-branch receipt fix;
  TypeScript and production build passed.
- Browser-rendered 80/58 mm receipt samples show box-wise named products and no
  horizontal overflow. Sample page height is fitted, not an empty A4 sheet.
- The 50 x 20 mm sticker preview shows BALI, article, colour, rate and 1 PAIR.
- Purchase review was checked on desktop and a phone-sized viewport. The separate
  scanner-save toolbar is hidden while purchase entry is open to avoid covering
  the review fields or presenting the wrong save action.
- Print preparation was triggered in an isolated local account. Browser automation
  could not inspect the system print dialog; no physical output/cutter was verified.
- No new migration is required. The earlier purchase invoice_total migration is
  already applied to production.

## Research Basis

The search did not establish a universal Sadar Bazaar printer protocol or price
coding convention. Karan's supplied receipts/stickers are the primary workflow
reference. These sources support the implementation choices, not an assumption
that every Sadar Bazaar shop uses the same software or printer:

- [Tally barcode workflows](https://tallysolutions.com/inventory/creating-using-barcodes-inventory-management-tallyprime/)
- [Tally price levels](https://tallysolutions.com/tally/price-lists-and-price-levels-in-tally-prime/)
- [MDN separate-document printing](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Media_queries/Printing)
- [Epson cutter commands](https://download4.epson.biz/sec_pubs/pos/reference_en/escpos/gs_cv.html)
- [NCR Windows driver end-document/end-job cutting reference](https://onlinehelp.ncr.com/Retail/Printers/LandingPage/7197/1609.pdf)

## Short Message For Karan

Karan ji, please update the app and try one small bill first. Set Printing to your
roll width, turn browser headers/footers off and enable Partial / Half cut at End
of Document / End of Job in the
printer driver. Check both boxes, names, totals and the cut. Then upload one clear
purchase bill in Stock in > Purchase bill photos. Check the pricing rule, supplier,
rack, quantities, rates and payable, then press Save purchase & print labels once.
Scan one fresh label in billing and stock in to check its name and quantity. Please
send the printer model and a photo of both trial prints before a large batch.
