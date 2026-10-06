# Product names across scans

All product lookups now enrich the same product from a recognized QR, its stored label, and learned or verified item-code names. This covers stock-in, billing, Scan & record, product lookup, Labels, Move, recheck, store transfers and RFID linking/counting. Camera captions prefer the resolved name over raw barcode text. Rack scans remain rack scans.

The reported failure occurred when an old product already matched a barcode but had no item_code. Stock-in returned that stored row without deriving the code from the QR, while billing filled it. Both now use the shared resolver. Product, learned mapping and sync records are saved in one IndexedDB transaction. A repaired scan does not repeatedly add sync records, and lookup-only screens do not create products or stock.

Real product names, non-default units and existing prices are preserved. Unknown item numbers are not guessed; they show Name needed until named in Scan & record or the item-code prompt. The verified BALI QR resolves item number 5186. This does not prove names for every other legacy sticker without its master mapping. Missing names on saved stock-in views use the current named master; real historical names stay unchanged. Recheck fills missing bill names without rewriting saved bills.

Verification: 197 tests passed, frontend TypeScript and production build passed. The new tests cover missing item codes on exact matches, stock-in/billing parity, opaque barcodes and RFID using stored labels, named QRs, learned overrides, unchanged prices, unknown codes, repeated scans, and atomic rollback on sync failure.

Browser trial on isolated local data: cleared the BALI test product's name and item code, scanned its original QR in Stock in, and verified BALI, K5209/, KXZKLN and rate 100 appeared again. Confirmed the same QR's name in Move, Labels and Scan & record. No financial documents or stock movements were saved. Actual scanner/camera hardware still needs the counter trial.

Karan ji: after the update loads, scan the same old sticker once in Stock in, Scan & record, Move and Labels. Its product name should appear on each screen. If any sticker says Name needed, choose its actual name once in Scan & record; do not substitute a guessed name. Please send that scanner's raw text if the name remains missing.
