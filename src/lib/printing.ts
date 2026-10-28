import { useEffect, useRef } from "react";
import { nativePrinter } from "./platform";

export const RECEIPT_CUTS = {
  partial: "Automatic half cut (partial)",
  full: "Automatic full cut",
  manual: "Manual tear-off",
} as const;
export type ReceiptCut = keyof typeof RECEIPT_CUTS;
export function receiptCut(value: unknown): ReceiptCut {
  return value === "full" || value === "manual" ? value : "partial";
}
export function receiptCutSetup(cut: ReceiptCut) {
  return cut === "manual"
    ? "Windows printer preferences: disable automatic cutting; tear off after the complete bill."
    : `Windows printer preferences: ${cut === "partial" ? "Partial / Half cut" : "Full cut"} at End of Document / End of Job, not after each page. This device preference does not change the printer driver.`;
}

/* Blank paper after the last line of a receipt (owner's photo, 26 Oct: the tear went through "Box qty" and the
   totals). The print head sits behind the tear bar / cutter, so without this the last lines are still inside the
   printer when the slip is torn off. */
export const RECEIPT_FEEDS = [0, 10, 15, 20, 25, 30, 40] as const;
export const DEFAULT_RECEIPT_FEED = 15;
export function receiptFeed(value: unknown): number {
  const n = Number(value);
  return value !== null && value !== "" && (RECEIPT_FEEDS as readonly number[]).includes(n) ? n : DEFAULT_RECEIPT_FEED;
}
/* 27 Oct this fed no paper when the cutter was set to automatic, to shorten the gaps between slips. Owner, 28 Oct
   (photo): the printer is not cutting by itself, and the last lines (Total quantity) stayed inside behind the cutter,
   so the tear went through them. Whatever the cutter setting, every slip now ends with the chosen blank paper
   (Settings › Printing › Blank paper after the bill, 15 mm unless changed), so it always comes fully out. */
export const slipFeed = (feed: number, _cut?: ReceiptCut) => feed;

export async function printDocument(source: Document, frame: () => Promise<void>, onDone = () => {}, cancelled = () => false) {
  const content = source.getElementById("printroot");
  if (!content?.textContent?.trim() || !content.children.length) throw new Error("No printable content. Close print and try again.");
  const host = source.createElement("iframe");
  host.title = "Receipt / labels";
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:800px;height:600px;border:0";
  source.body.appendChild(host);
  const remove = () => host.remove();
  try {
    const doc = host.contentDocument!, win = host.contentWindow!;
    // An empty iframe defaults to quirks mode. Match the app's standards mode
    // before measuring receipts so table widths and page height stay consistent.
    doc.open();
    doc.write("<!doctype html><html><head></head><body></body></html>");
    doc.close();
    doc.title = "";
    const base = doc.createElement("base"); base.href = source.baseURI; doc.head.appendChild(base);
    const styles = Array.from(source.querySelectorAll("style,link[rel=stylesheet]"))
      .filter(el => !content.contains(el));
    // The styles are copied from what this page already has in memory, never downloaded again. After a
    // website update the old stylesheet's file is gone from the server while an open screen still uses it;
    // fetching it again failed with "Printer styles could not load" and no bill or sticker printed until the
    // app was reloaded (owner, 21 Oct: "stuck again" right after an update).
    await Promise.all(styles.map(el => new Promise<void>(resolve => {
      const css = el.tagName === "LINK" ? inlineSheet(source, el) : null;
      if (css !== null) { const style = doc.createElement("style"); style.textContent = css; doc.head.appendChild(style); resolve(); return; }
      const clone = doc.importNode(el, true);
      if (clone.tagName !== "LINK") { doc.head.appendChild(clone); resolve(); return; }
      // a sheet the page can't read (another site's): link it, but never let it hold up or stop the print
      const timer = setTimeout(resolve, 3000);
      clone.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
      clone.addEventListener("error", () => { clearTimeout(timer); resolve(); }, { once: true });
      doc.head.appendChild(clone);
    })));
    // Print a snapshot, not the live POS. Clearing the bill cannot erase this job.
    const root = doc.importNode(content, true) as HTMLElement;
    root.style.cssText = "display:block!important;position:static;visibility:visible";
    doc.body.appendChild(root);
    const reset = doc.createElement("style");
    reset.textContent = "html,body{margin:0!important;padding:0!important;height:auto!important;min-height:0!important;overflow:visible!important;background:white}#printroot{display:block!important}.inv-t tr{break-inside:avoid}.inv{max-width:100%;overflow-wrap:anywhere}";
    doc.head.appendChild(reset);
    await preparePrint(doc, frame);
    if (cancelled()) { remove(); return remove; }
    // Android app: its web view cannot print, so the page goes to Android's print service
    // (any installed printer app, or "Save as PDF"). Styles are inlined: the print view
    // can't fetch the app's own files.
    const native = nativePrinter();
    if (native) {
      const css = Array.from(source.styleSheets).map(sheet => { try { return Array.from(sheet.cssRules).map(r => r.cssText).join("\n"); } catch { return ""; } }).join("\n");
      const html = "<!doctype html><html><head><meta charset=\"utf-8\"><style>" + css + "</style><style>" + reset.textContent + "</style></head><body>" + root.outerHTML + "</body></html>";
      try { await native.printHtml({ html, name: source.title || "Rungnna bill" }); } finally { remove(); onDone(); }
      return remove;
    }
    win.addEventListener("afterprint", () => { remove(); onDone(); }, { once: true });
    win.focus(); win.print();
    return remove;
  } catch (e) { remove(); throw e; }
}

/** A loaded stylesheet's rules as text (relative url()s made absolute), or null when the page can't read it. */
export function inlineSheet(source: Document, link: Element): string | null {
  const sheet = Array.from(source.styleSheets).find(x => x.ownerNode === link);
  if (!sheet) return null;
  let rules: CSSRuleList;
  try { rules = sheet.cssRules; } catch { return null; }
  const base = sheet.href || source.baseURI;
  return Array.from(rules).map(r => r.cssText).join("\n")
    .replace(/url\((['"]?)(?!data:|blob:|https?:|\/|#)([^'")]+)\1\)/g, (all, q, path) => { try { return `url(${q}${new URL(path, base).href}${q})`; } catch { return all; } });
}

export async function preparePrint(doc: Document, frame: () => Promise<void>) {
  let timer: ReturnType<typeof setTimeout>;
  await Promise.race([doc.fonts?.ready, new Promise(resolve => { timer = setTimeout(resolve, 2000); })]);
  clearTimeout(timer!);
  await Promise.all(Array.from(doc.querySelectorAll<HTMLImageElement>("#printroot img")).map(img =>
    img.decode().catch(() => undefined)));
  await frame();
  await frame();
  const root = doc.getElementById("printroot"), page = root?.querySelector<HTMLStyleElement>("style[data-thermal-width]");
  if (root && page) {
    const old = root.style.cssText;
    try {
      const width = Number(page.dataset.thermalWidth);
      // Measure only the receipt, at the printable roll width. A hidden or
      // unmeasurable receipt must never fall back to the driver's full roll.
      root.style.cssText = `display:block;position:absolute;left:-10000px;top:0;visibility:hidden;width:${width - 4}mm;height:auto;min-height:0`;
      const receipt = root.querySelector<HTMLElement>(".inv");
      const height = receipt ? Math.max(receipt.getBoundingClientRect().height, receipt.scrollHeight) : 0;
      page.textContent = thermalPage(width, height);
    } finally { root.style.cssText = old; }
  }
}

export function thermalPage(width: number, heightPx: number) {
  if (![58, 80].includes(width) || !Number.isFinite(heightPx) || heightPx <= 0) throw new Error("Invalid receipt dimensions");
  // Capping at 1 metre makes longer estimates print another full metre page,
  // including blank paper after the final line. Let the content set the length.
  // +4 mm for the 2 mm margins and +10 mm slack: the slip is measured with screen styles, and the print styles
  // add a few mm (owner's photo, 26 Oct: the Balance line was still in the printer when the slip was torn).
  // 27 Oct: +14 mm left long blank gaps under every slip; +8 mm (2 mm margins + 4 mm) still fits the print styles
  // Long custom sheets are scaled down by some drivers. Paginate at a supported
  // length while retaining the physical roll width and readable font sizes.
  const height = Math.min(280, Math.max(30, Math.ceil(heightPx * 25.4 / 96 + 8)));
  return `@page{size:${width}mm ${height}mm;margin:2mm 1mm}@page rj-receipt{size:${width}mm ${height}mm;margin:2mm 1mm}`;
}

/* Some mobile browsers return from print() before the preview has captured the DOM. */
export function usePrintJob(active: boolean, onDone: () => void, job = "", onError?: (message: string) => void) {
  const done = useRef(onDone); done.current = onDone;
  const error = useRef(onError); error.current = onError;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const finish = () => { if (!cancelled) { cancelled = true; done.current(); } };
    let clean: (() => void) | undefined;
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    // A painted frame ensures the portal is mounted before copying it.
    frame().then(async () => {
      if (cancelled) return;
      clean = await printDocument(document, frame, finish, () => cancelled);
      if (cancelled) clean();
    }).catch(e => { if (!cancelled) error.current?.(e.message || "Could not prepare print"); finish(); });
    return () => { cancelled = true; clean?.(); };
  }, [active, job]);
}
