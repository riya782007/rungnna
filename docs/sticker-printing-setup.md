# Sticker printing handoff — 18 October 2026

The local app now supports the supplied sticker arrangement: item, style and
colour on the left, QR on the right, vertical RUNGNNA, and a bold rate × packet
quantity line below. Screen, browser output and QZ output share one artwork.

## At the counter

1. Open Stock → Labels → Printer settings. Choose **Shop roll — 3 across**.
   The starting measurements from the earlier handoff are 33 × 15 mm per sticker,
   2.5 mm across gaps and 2.6 mm between rows: a 104 mm row. Measure the actual
   stock and adjust these values before accepting a check print. Photos alone do
   not establish millimetre measurements. Existing saved printer settings are
   preserved; use **Use 3-across shop roll** to switch this device explicitly.
2. For a compatible TSPL/TSPL2 TSC printer at 203 dpi, install and open
   [QZ Tray](https://qz.io/download/) on that Windows computer. Select
   **QZ Tray → Windows TSC printer**, click **Find Windows printers**, and choose
   the exact label printer. Allow QZ's connection/print requests. Unsigned mode
   may prompt for approval for each request; no paid certificate is required to
   use the prompted flow. This does not install QZ or change Windows settings.
3. Enter ITEM, STYLE, COLOR and RATE. **QTY** means units in each packet;
   **PRINT QTY** means number of stickers. Add to queue or press Print barcode.
4. A new/changed setup first prints one row of the actual queue. If correct,
   accept it: these stickers are removed from the queue. Print the remainder.
   If wrong, choose the visible symptom and adjust/reprint the check row. Do not
   accept a cancelled print dialog or a row that did not physically print.

QZ sends row size and gap directly in TSPL, bypassing Chrome's page selection.
It sends one spool job and never automatically retries or switches output after
an error. Check Windows' printer queue before retrying a potentially partial job.
Spool submission does not establish physical success.

## Browser option

In the TSC Windows driver, create a stock named **Rungnna row** with the actual
full row width and sticker height (starting values 104 × 15 mm), Labels With
Gaps, gap 2.6 mm. The gap belongs in the driver, not in the browser page height.
Chrome: select that stock, Margins None, Scale Default / 100%, Headers and
footers off. A 4 × 6 inch page can feed many blank sticker rows. Driver menu
names vary. Old applications that explicitly send stock dimensions can continue
to do so; verify both applications after changing a shared driver preference.

## Purchase bill reader

- **Total qty** remains the purchased inventory quantity.
- **Qty / packet** is the quantity written and encoded on each sticker.
- **Stickers** blank uses the grey automatic count, one per packet, including a
  correctly labelled partial final packet. An entered number prints exactly that
  many full-packet stickers; 0 skips that line. All-zero purchases save normally.
- These choices are saved on purchase items. Reopening the purchase keeps them.
  Existing product packet sizes and supplier stock totals are preserved.

## Verification and limits

Unit/integration tests cover purchase persistence, quantities, partial packets,
check-row subtraction, QR artwork validation, bitmap ordering/padding and binary
QZ transport. All 253 tests in 34 files, TypeScript and the production build pass.
The browser trial also confirms three accepted check labels plus one remaining
label for a four-label order, and the mobile purchase count defaults/overrides.
The official TSC bitmap
diagram confirms 0 = black, 1 = white, with the most significant bit first.
The browser trial intercepts QZ locally; it does not send data to a real printer.

Physical paper advance, margins, darkness and QR scanning still need one row on
the merchant's actual printer. This update has not been deployed or pushed.

References: [TSC programming manual, BITMAP pp. 67–69](https://fs.tscprinters.com/system/files/31-0000001-00_tspl_tspl2_programming_3_0.pdf),
[QZ raw printing](https://qz.io/docs/raw),
[QZ signing and prompts](https://qz.io/docs/signing-examples).
