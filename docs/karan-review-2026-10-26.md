# Karan's counter review — 26 October 2026

Based on the eight voice notes from 00:32–00:58 and two counter screenshots. The user confirmed that the two companies should have separate details and records within the same software, rather than separate cloud accounts. The note asking for a phone call is context for the user's follow-up, not an instruction to contact Karan.

Billing puts small Hold, Held, Save, Print and WhatsApp buttons at the right. Totals and discount stay below the lines. Expanded navigation is narrower on the billing screen. Box quantities wrap visibly; remarks support multiple lines. The optional estimate invoice number appears under More, or stays visible if already entered. Desktop scan feedback remains in the inline confirmation strip, without a duplicate floating overlay.

Selecting a payment method opens a blank amount field. The cashier enters the actual amount received; Use balance explicitly fills the remainder. A selected payment with no amount blocks final saving until completed or removed. Credit bills with no payment rows still work. The same explicit amount rule applies to receiving payment on an already-saved bill.

UPI rows accept a recipient name. Amount and recipient generate narration shown on the bill, shared bill, and customer account. This is derived from the payment rows, so edits and removals cannot leave stale generated text in typed remarks. Packing slips still omit payment amounts.

Explicit Hold requires a typed remark and focuses the remarks field if it is blank. Held bills show the remark and retain split payment details on resume. Automatic draft preservation is retained, including when switching documents or companies.

The existing company setup remains an owner action under Stores & transfers → Make the estimate company. Billing More links there for an owner in a mixed company. Setup does not relocate existing stock or bills. The main company's existing profile stays at config `shop`; other explicitly designated companies use `shop_<company id>`. An unconfigured estimate profile starts with blank tax/contact/payment details, rather than borrowing the GST company's details. Ordinary branches without a company kind continue sharing their business profile. Company contact email is distinct from the shared cloud sign-in email.

The screen gate now identifies the signed-in person's assigned role and distinguishes the screen code from the common entry code and personal PIN. The real Owner role still bypasses it; using “Owner” as a person's or custom role's display name does not grant owner access. The default screen code remains 777 until changed.

Verification uses isolated local browser data and mocked printing, with no production records or hardware jobs changed. See `scripts/counter-review-browser-check.mjs`, `scripts/counter-release-browser-check.mjs`, and the payment-narration/company-profile regression tests.

Verified build: `aff89fac57ca725f`. Regression results: 677 tests verified across 93 files (one database startup timeout under concurrent build load passed on its isolated rerun). Production build and both browser scripts passed. The full-bill layout check covers expanded navigation at 1366×768, 1280×768, 1100×768 and 1366×720; nine normal rows fit at 768 pixels high and eight at 720. Actual installed-device refresh and physical printer operation remain shop-side checks.
