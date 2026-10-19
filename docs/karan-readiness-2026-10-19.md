# Karan's requirements — implementation and counter acceptance

Reviewed 19 October 2026 against the supplied WhatsApp screenshot and the current GitHub main commit 3b8279a. Karan's priorities are a dependable scanner counter, complete readable documents, familiar labels, controlled access and billing that keeps working when internet drops. The user's clarification is explicit: the billing panel must work both with and without internet. Normal online sync remains automatic.

| Karan's pointer | Current implementation / fix | Evidence and remaining acceptance |
| --- | --- | --- |
| Scanned line yellow | Latest scanned item stays yellow until another item is added. Each read flashes yellow and shows item / quantity confirmation. Removed the later green override. | Packet/repeat tests and browser trial. |
| Complete estimate after finalizing | Print snapshots remain independent of the billing screen. Print headers repeat, long names wrap, summary rows stay together, and shared bill images measure all wrapped text before drawing. | Long 140-line estimate checked in A5, A4, 80mm and 58mm. Physical paper trial remains. |
| No rupee symbol or amount in words on bill | Printed sheets, thermal receipts, shared bill text and bill images use numeric amounts with two decimals. Tax values, discounts and balances keep their actual values. | Owner bill-format and wholesale balance tests. |
| ESTIMATE watermark | Estimates carry an ESTIMATE watermark, plus the existing sale-not-executed notice. Thermal estimates get a compact watermark. GST invoices do not receive an estimate watermark. | Estimate watermark tests. |
| GST / billing offline and online | Every save goes to local IndexedDB first. Offline saves remain in the queue; normal internet reconnection triggers sync. An owner can deliberately pause this computer's cloud sync in Settings. | Offline queue, reconnect and concurrent sync tests. No live shop data was used. |
| Separate online permission box | Government e-invoice / e-way-bill submission requires the bill's separate approval checkbox, an authorized owner cloud account, internet and successful invoice sync. The client helper and server reject requests missing approval. Saving or printing never submits automatically. | GST API and cloud-control tests. Provider and government acceptance need the shop's configured account. |
| Dark barcode printing | Labels > Printer settings exposes darkness 0–15 and speed 1–6. QZ bitmap and direct TSC jobs both send these commands. Starting values are darkness 10 / speed 2. A change requires a fresh check row. | Binary / TSPL tests verify commands and unchanged artwork and payload. Browser printing uses Windows driver darkness/speed, which a webpage cannot change. |
| Roles and permissions index | Owner: Settings > People > Roles & permissions, or Roles & Permissions in navigation. Built-in/custom permission matrices and role-code instructions are visible. People has a personal PIN setup action. | Role/permission and entry tests; restricted-navigation browser trial. |
| Same entry code, individual access | The common shop entry code opens identity selection. Each person then uses their own four-digit PIN; configured role passcodes are an alternative. The common code grants no owner session. Missing/deleted custom roles grant no fallback rights. | Common-code, PIN, role deletion/regeneration and session-revocation tests. See access instructions below. |
| Estimate says approval challan | Estimate sheets, thermal documents and shared versions include APPROVAL CHALLAN. Delivery challans and GST invoices retain their own document types. | Owner print tests and long-document browser trial. |
| Keep barcode roll / reference / line | Sticker stock size, columns, row gaps, legacy barcode format, references, purchase line code and printed quantity remain as configured. Darkness changes do not regenerate the barcode or alter the artwork. | Byte/artwork preservation test and existing sticker suites. |
| Compact cost code and fake letters | Labels > Printer settings enables compact repeated letters and a configurable A–Z fake-letter pool. RPPX1PCS prints RP-ZX1PCS with pool Z. Each later occurrence of a cost-code letter becomes a dash; one fake letter is selected from a shuffled cycle per physical sticker. Packing suffix and stored product/prices/QR remain intact. | SVG, sheet, direct TSC and QZ bitmap tests cover variation, saved settings and resumed batches. |
| Billing without intake / exact stock | Scanned and custom articles can be billed or estimated at zero or negative stock. Custom articles become reusable products; shortages post to a normal unassigned rack so movements rebuild to the real negative total. Products > open item > Set exact stock accepts any safe whole number, including zero and negative, with a reason/history entry. | Legacy and Rungnna QR, custom GST/estimate, void, rebuild, rollback, store/quarantine and stale-count tests. Offline browser trial: −3 scanned, −2 custom, then exact 25, 0 and −7. |
| Legacy QR compatibility | Copied old labels preserve numeric item code, reference, style, colour, quantity and rate. Explicit old-software printing rejects missing identity instead of silently emitting RJ1. | The old photo decoded to 203~360~1~212~~K5209/11P~W/XZBSPHL. A newly rendered sticker decodes to these exact bytes. The new-label photo was too blurred to decode. Acceptance by the actual old application remains a counter check; unknown categories need that application's real master code. |
| Pieces multiply correctly on repeat scanning | Repeats add exact packet or loose quantity. Different pack sizes/rates/discounts/units/tax/details and processed stock lines stay separate. Scan acceptance captures its box; fast BB and delayed lookups cannot move/erase another scan. | Packet/remainder, mixed-line, stock-deduction and rapid-scan regressions. |

## Daily operation

On each fresh app opening or reload, enter the common shop code and then the person's PIN or role passcode. The previous signed-in identity is cleared; the draft and shop data are retained. The owner saves the common code once in Settings > Shop passcode, then lets every counter sync online before testing that same code offline. Older locally stored codes remain a fallback until the shared setting arrives. Set personal PINs in Settings > People and role codes in Roles & Permissions. On a new device, the owner completes initial PIN setup. Role codes identify a role; use named personal PINs when individual accountability is needed.

Billing saves, totals, estimates, stock changes and printing work locally. The counter must first load the app and the shop's data while online; another counter cannot receive updates while disconnected. The app's service worker precaches the interface, fonts and scanner decoder. Install/open it once before an offline shift. Keep browser storage and a recoverable backup; do not clear site data.

Cloud sync is enabled normally and resumes when internet returns. Settings > Cloud backup has a checkbox for deliberately pausing this computer. Re-enabling sends ALL queued changes, including GST bills, and pulls shared codes, people and products. Pausing does not remove previously uploaded information or cancel a request already sent. It is independent of the government-submission approval on each bill.

To print a darker label through QZ Tray or direct TSC, open Labels > Printer settings, adjust darkness/speed and accept one check row before a batch. For Browser / Windows printer driver output, set darkness and speed in the actual printer driver's preferences. Check QR readability as well as darkness. Use the saved stock size/roll geometry.

For the new code appearance, open Labels > Printer settings. Compact repeated letters is enabled by default, with fake pool Z. Enter any desired A–Z pool (for example ZYAB); one letter varies across stickers. Empty pool adds no fake letter, and the checkbox restores the original printed code. Letters in the quantity/unit suffix do not change. Changing settings requires a fresh print check; a started batch keeps its captured settings and sticker positions.

For stock correction, open Products, select the item, enter the exact desired total and a reason under Set exact stock. Billing staff can continue selling with a negative count; correcting stock requires the stock-move permission. These corrections queue for normal synchronization.

## One-counter acceptance before wider rollout

1. Back up the current counter, load the reviewed release online and check the deployed commit.
2. Verify common shop entry plus Karan's own PIN, one restricted person's PIN and the role matrix. Open a direct restricted URL and confirm access is denied.
3. Scan one real X3 packet three times: quantity must be 9; scan an X1 remainder and verify it stays its own packet line. Repeat across two boxes, including scanning BB immediately after an item.
4. Finalize a long estimate. Confirm every item, the last item, discounts, packing, paid/advance, previous balance, total due and remarks on actual paper. Verify ESTIMATE / APPROVAL CHALLAN, no currency glyph and no amount-in-words line.
5. Disconnect internet. Reopen the installed app, authenticate, scan and save a test bill. Reconnect and verify that same bill syncs once with unchanged totals and stock. Stop if any discrepancy appears.
6. Print one label from the actual roll, rescan it with the shop's scanner and inspect first/last column alignment, reference/line and quantity. Increase darkness gradually if needed.
7. Leave government submission unchecked during routine trials. Test an authorized sandbox path separately if that provider is configured.

## Production follow-up

The initial production smoke found the GST function importing browser billing code at runtime, causing an ESM module-not-found startup error. Allocation math is now isolated in a pure module with a Node-compatible import; a native-Node runtime regression guards this deployment path. The production smoke checks the common-code entry screen, API health, unauthenticated GST response, service-worker control and an actual network-offline reload in a fresh Chrome profile without touching shop records.

## Verification record and limits

Final checks are recorded below. Large cloud pulls now use ordered timestamp/id pagination: more than 1,000 updates cannot become stranded in the overlap window. Interrupted movement pulls rebuild the local stock cache. GST submission stops if the server cannot read owner security settings. This release passed local verification before publication. Confirm the production release commit and deployed assets when rolling out to counters. No production database migration is needed. Existing purchase-reader / label-print workspace edits were preserved.

Verified on the final source:

- **545 tests passed across 68 files**, with no skips or failures: `node node_modules/vitest/vitest.mjs run --maxWorkers=2 --minWorkers=1 --hookTimeout=120000`. A longer hook timeout accommodates Windows Postgres/WASM initialization; tests still execute normally.
- Frontend TypeScript and API TypeScript checks passed. Production Vite/PWA build passed and precached 72 assets. Existing bundle-size/dynamic-import warnings remain.
- Production browser scan trial passed: exact packet/remainder totals, rapid reads during delayed lookup, yellow rows, correct boxes, stale-bill rejection, focus and mobile display.
- Production browser access trial passed: common/personal access, direct-route restrictions, role regeneration/deletion, default online sync and owner pause. Reload required fresh identity while the actual scanned billing draft survived. Label darkness 10 / speed 2 appeared; darkness 12 persisted after reload and reauthentication. Zero JavaScript errors and zero external requests.
- Standards-mode Chrome print snapshots and extracted PDFs retained all **140 items**, complete settlement and final remarks: A5 five pages, A4 four pages, 80mm one long page and 58mm one long page. One print call per trial; clearing the live bill did not erase its snapshot. First/last pages and thermal sections were rendered and visually inspected for clipping.
- Regression queries retrieved all 2,501 same-timestamp cloud rows and covered page boundaries, quoted config IDs, retry/overlap and stock rebuilding after interrupted pulls.

Repeatable browser checks: `scripts/billing-scan-browser-check.mjs`, `scripts/access-offline-browser-check.mjs` `scripts/estimate-print-browser-check.mjs` and `scripts/negative-stock-browser-check.mjs`. They use isolated test data. The first two accept `LABEL_PLAYWRIGHT_MODULE`; the print check accepts `PRINT_PLAYWRIGHT_MODULE` when Playwright is supplied by a bundled runtime.

The connected Supabase account does not list the Rungnna project referenced by this repository, so no live production database assertion or change was made. GitHub source status is not proof of a deployed release. No real customer data, paid AI extraction, government submission or physical print job was used for these trials.

Offline roles are enforced by the application on a trusted shop computer. A device with local administrative/browser storage access can tamper with local data. A disconnected device cannot receive role revocations until it reconnects. Local passcodes do not replace the existing trusted server owner authorization.

Hardware print darkness, physical scanner behaviour, old-software acceptance and installed-PWA cold reload on Karan's actual PC remain counter acceptance checks. The browser trial uses isolated local test data and explicitly reports the limits of virtual-host/offline emulation.

A factual update for Karan after deployment and the counter trial: "Karan ji, the requested scan, estimate, bill-format, label and access fixes are in place. Billing saves on the computer without internet and syncs when connection returns. We have checked the software flows; the final receipt, label and offline restart have also been checked on your counter." Use the final sentence only after those physical checks actually pass.
