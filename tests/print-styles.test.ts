import { describe, expect, it } from "vitest";
import { inlineSheet } from "../src/lib/printing";

/* Owner, 21 Oct ("stuck again"): after a website update the print frame re-downloaded the page's old
   stylesheet, which is no longer on the server, and every bill and sticker print stopped with
   "Printer styles could not load". The print frame now copies the styles the page already has. */
describe("print frame styles come from memory", () => {
  const link = {} as Element, other = {} as Element;
  const source = (sheets: any[]) => ({ styleSheets: sheets, baseURI: "https://shop.example/" }) as unknown as Document;
  it("copies a loaded sheet's rules, with relative font paths made absolute", () => {
    const css = inlineSheet(source([{ ownerNode: other, href: "x", cssRules: [] }, { ownerNode: link, href: "https://shop.example/assets/index-abc.css",
      cssRules: [{ cssText: "@font-face { src: url(\"./roboto.woff2\") format(\"woff2\"); }" }, { cssText: ".lbl { color: black; }" }, { cssText: ".x { background: url(data:image/png;base64,AA) }" }] }]), link);
    expect(css).toContain('url("https://shop.example/assets/roboto.woff2")');
    expect(css).toContain(".lbl { color: black; }");
    expect(css).toContain("url(data:image/png;base64,AA)");
  });
  it("says so when it can't read a sheet (another site's), so the print links it without waiting on it", () => {
    const locked = { ownerNode: link, href: "https://fonts.example/a.css", get cssRules(): CSSRuleList { throw new Error("SecurityError"); } };
    expect(inlineSheet(source([locked]), link)).toBeNull();
    expect(inlineSheet(source([]), link)).toBeNull();
  });
});
