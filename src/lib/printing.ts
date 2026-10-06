import { useEffect, useRef } from "react";

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
    doc.title = "";
    const base = doc.createElement("base"); base.href = source.baseURI; doc.head.appendChild(base);
    const styles = Array.from(source.querySelectorAll("style,link[rel=stylesheet]"))
      .filter(el => !content.contains(el));
    await Promise.all(styles.map(el => new Promise<void>((resolve, reject) => {
      const clone = doc.importNode(el, true);
      if (clone.tagName !== "LINK") { doc.head.appendChild(clone); resolve(); return; }
      const timer = setTimeout(() => reject(new Error("Printer styles did not load. Try again.")), 8000);
      clone.addEventListener("load", () => { clearTimeout(timer); resolve(); }, { once: true });
      clone.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Printer styles could not load.")); }, { once: true });
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
    win.addEventListener("afterprint", () => { remove(); onDone(); }, { once: true });
    win.focus(); win.print();
    return remove;
  } catch (e) { remove(); throw e; }
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
  const height = Math.max(30, Math.ceil(heightPx * 25.4 / 96 + 6));
  return `@page rj-receipt{size:${width}mm ${height}mm;margin:2mm}`;
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
