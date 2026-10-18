# Sticker printing — 18 October 2026

The release preserves the current bill reader, supplier roll numbers, even rates,
boxed bill-line numbers, and stoppable label batches. Preview, browser printing
and QZ printing share the same artwork.

## One-time setup at the counter

1. Finish or hold the current bill, then apply the app update. Open Stock → Labels
   → Printer settings. The current shop preset is **Rungnna row**, three 33 × 15 mm
   stickers across, with the existing 1.3 mm across gap, 2.5 mm horizontal offset
   and 104 mm printable right edge. These are starting settings inherited from
   the live app; compare them with the actual stock and check one row.
2. For a compatible TSPL/TSPL2 TSC printer at 203 dpi, install and open
   [QZ Tray](https://qz.io/download/) on that Windows counter. Choose
   **QZ Tray → Windows TSC printer**, click **Find Windows printers**, and select
   the exact printer. Allow its connection and print requests. Unsigned mode may
   show an approval prompt for each request.
3. Check **Gap between rows mm**. Choosing QZ starts this at 2.6 mm when the
   browser configuration had zero; measure the actual gap and adjust it. QZ sends
   sticker height and gap separately, bypassing Chrome's paper size.
4. Print the first row. Accept only if it physically printed clearly inside the
   stickers, without feeding blank rows. **Yes, right: print the other …** sends
   the remaining stickers; accepted check labels are not repeated. A cancelled
   print dialog does not count as success.
5. If wrong, choose the symptom. Alignment buttons move the print by 0.5 or 1 mm
   and reprint that row. Settings remain saved on this computer.

QZ sends one spool job per approved batch. It never automatically retries or
switches output after an error. Check the Windows printer queue before retrying
an unconfirmed or partially printed job. Submission is not physical confirmation.

## Browser printing

Create a Windows TSC stock **Rungnna row** with the measured full row width and
sticker height (starting values 104 × 15 mm), Labels With Gaps, and the measured
row gap. In Chrome select that stock, Margins None, Scale Default / 100%, and
Headers and footers off. Driver menu names vary. A 4 × 6 inch page can feed blank
sticker rows. The browser's row height excludes the physical gap.

## Purchase review

- **Total qty** remains the purchased inventory quantity.
- **Pieces per packet (X)** is written and encoded on each sticker.
- **Stickers** blank uses the grey automatic count, one per packet, with a
  correctly labelled partial last packet. An explicit number prints exactly that
  many full-packet stickers; 0 skips the line. All-zero purchases save normally.
- Choices persist on purchase items; supplier stock totals remain exact, and the
  reviewed packet size continues to update the product as in the current app.

## Validation

All 487 tests in 59 files, frontend/API TypeScript checks, and the production
build pass. An isolated browser trial verifies a four-sticker order as three in
its accepted check row plus one remaining sticker. QZ is intercepted in the trial;
no real printer job is sent. Physical margins, feed and QR scanning still require
one row on the merchant's printer.

References: [TSC BITMAP manual pp. 67–69](https://fs.tscprinters.com/system/files/31-0000001-00_tspl_tspl2_programming_3_0.pdf),
[QZ raw printing](https://qz.io/docs/raw),
[QZ signing and prompts](https://qz.io/docs/signing-examples).
