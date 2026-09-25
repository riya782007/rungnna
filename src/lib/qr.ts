import qrcode from "qrcode-generator";

/* QR as crisp SVG path, generated fully offline. */
export function qrSvg(text: string, ecc: "L" | "M" | "Q" | "H" = "M"): { svg: string; modules: number } {
  const q = qrcode(0, ecc);
  q.addData(text, "Byte");
  q.make();
  const n = q.getModuleCount();
  let d = "";
  for (let r = 0; r < n; r++) {
    let run = -1;
    for (let c = 0; c <= n; c++) {
      const dark = c < n && q.isDark(r, c);
      if (dark && run < 0) run = c;
      if (!dark && run >= 0) { d += `M${run} ${r}h${c - run}v1h-${c - run}z`; run = -1; }
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 ${n + 2} ${n + 2}" shape-rendering="crispEdges"><rect x="-1" y="-1" width="${n + 2}" height="${n + 2}" fill="#fff"/><path d="${d}" fill="#000"/></svg>`;
  return { svg, modules: n };
}
