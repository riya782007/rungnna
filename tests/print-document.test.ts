import { expect, it, vi } from "vitest";
import { printDocument } from "../src/lib/printing";

function fixture() {
  const listeners = new Map<string, () => void>();
  const content: any = { textContent: "BALI receipt", children: [{}], contains: () => false };
  const body: any[] = [], head: any[] = [];
  const clone: any = { textContent: content.textContent, style: {}, querySelector: () => null };
  const doc: any = {
    head: { appendChild: (el: any) => head.push(el) }, body: { appendChild: (el: any) => body.push(el) },
    fonts: { ready: Promise.resolve() }, querySelectorAll: () => [],
    getElementById: () => clone, importNode: () => clone,
    createElement: (tag: string) => ({ tagName: tag.toUpperCase() }),
  };
  const win = { focus: vi.fn(), print: vi.fn(), addEventListener: (event: string, fn: () => void) => listeners.set(event, fn) };
  const host = { style: {}, contentDocument: doc, contentWindow: win, remove: vi.fn() };
  const source: any = { getElementById: () => content, createElement: () => host, body: { appendChild: vi.fn() }, querySelectorAll: () => [], baseURI: "https://shop.example/" };
  return { source, host, win, content, clone, body, head, listeners };
}
it("copies only printable content into a separate document and keeps it until afterprint", async () => {
  const x = fixture(), done = vi.fn();
  await printDocument(x.source, async () => {}, done);
  x.content.textContent = "";
  expect(x.body).toEqual([x.clone]); expect(x.clone.textContent).toBe("BALI receipt");
  expect(x.clone.style.cssText).toContain("display:block!important");
  expect(x.win.print).toHaveBeenCalledOnce(); expect(x.host.remove).not.toHaveBeenCalled();
  x.listeners.get("afterprint")!(); expect(done).toHaveBeenCalledOnce(); expect(x.host.remove).toHaveBeenCalledOnce();
});
it("does not print empty content or an effect cancelled while assets were loading", async () => {
  const x = fixture(); x.content.textContent = "";
  await expect(printDocument(x.source, async () => {})).rejects.toThrow("No printable");
  expect(x.win.print).not.toHaveBeenCalled();
  x.content.textContent = "BALI";
  await printDocument(x.source, async () => {}, () => {}, () => true);
  expect(x.win.print).not.toHaveBeenCalled(); expect(x.host.remove).toHaveBeenCalledOnce();
});
it("reports a failed print rather than leaving a hidden document mounted", async () => {
  const x = fixture(); x.win.print.mockImplementation(() => { throw new Error("Print unavailable"); });
  await expect(printDocument(x.source, async () => {})).rejects.toThrow("Print unavailable");
  expect(x.host.remove).toHaveBeenCalledOnce();
});
