import { useEffect, useRef } from "react";

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
export function usePrintJob(active: boolean, onDone: () => void, job = "") {
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    const finish = () => { if (!cancelled) { cancelled = true; done.current(); } };
    window.addEventListener("afterprint", finish);
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    preparePrint(document, frame).then(() => {
      if (!cancelled) window.print();
    }).catch(finish);
    return () => { cancelled = true; window.removeEventListener("afterprint", finish); };
  }, [active, job]);
}
