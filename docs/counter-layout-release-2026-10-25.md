# Counter layout production release — 25 October 2026

This release is based on production commit 83b2ec37c9346c5f2c71a55d041b682ec04ebf2d. It preserves that version's company themes, separate drafts, permissions, percentage/extra-less calculations, supplier bill serials, scanner learning, photo bill reader and desktop/mobile update mechanism.

Billing has full-width item entry and a grid with separate item, unit, style and colour columns. Selection is at the right edge. Box summary, payments, saving and totals sit beneath the grid. F12 reveals and focuses the advance field.

The compact manual-sticker form comes before optional purchase import. Supplier and cost are visible, jewellery photos can be attached directly, common fields stay ready for the next article, and the next style receives focus. The live preview follows the current article. Immediate printing prints only that article; Add to queue remains a separate batch action. The existing BILL SR. input retains the supplier's actual serial/reference. Existing label field and printer settings remain in force.

Purchase review exposes jewellery-photo controls directly on every line, and approval waits for an active photo upload. Product photos and supplier bill photos remain separate.

Validation: production build, 673 tests in 92 files, and scripts/counter-release-browser-check.mjs passed on the combined source. Browser QA used isolated local data and mocked QZ printing; it checked three laptop widths, repeat scans, manual billing, advance focus, bulk selection, product photos, supplier serial input, repeat-entry defaults, current-item preview and immediate printing without reprinting queued labels. Physical printer operation remains a shop-floor check.
