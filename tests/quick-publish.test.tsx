import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { PutLive, QuickPhoto } from "../src/components/QuickPhoto";
import { db, type Product } from "../src/lib/db";
import { MAIN_STORE, setScope } from "../src/lib/scope";

/* The two row controls carry one promise each, and both are easy to get wrong:
   "Put live" must refuse a design the site cannot show, and the photo button must
   not claim a local photo is on the site when the cloud has not got it yet. */

const prod = (over: Partial<Product> = {}): Product => ({
  id: "p1", code: "RAB12", barcodes: [], item: "CHOKER SET", type: "PCS", style: "K900", color: "GOLD", tk: "",
  rate: 2400, mrp: 4500, category: "", notes: "", created_by: "t", created_at: "", updated_at: "",
  ...over,
});
const withPage = { content: { title: "Gold Choker Set", subtitle: "", description: "", highlights: [], seo: { metaTitle: "", metaDescription: "", keywords: [] }, trade: { summary: "", bullets: [], packing: "", moq: "" } } } as Partial<Product>;

beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); });

describe("Put live, from the row", () => {
  it("refuses a design with no page and says why", () => {
    const html = renderToStaticMarkup(<PutLive p={prod({ photo_url: "https://img/x.jpg" })} />);
    expect(html).toContain("disabled");
    expect(html).toContain("Not ready");
    expect(html).toMatch(/product page/i);            // the reason is on the button itself
  });

  it("refuses a design whose photo has not reached the cloud", () => {
    const html = renderToStaticMarkup(<PutLive p={prod({ ...withPage, photo_id: "local-only" })} />);
    expect(html).toContain("disabled");
    expect(html).toMatch(/uploading/i);
  });

  it("offers to publish once the page and the cloud photo are both there", () => {
    const html = renderToStaticMarkup(<PutLive p={prod({ ...withPage, photo_url: "https://img/x.jpg" })} />);
    expect(html).not.toContain("disabled");
    expect(html).toContain("Put live");
  });
});

describe("Add photo, from the row", () => {
  it("opens the back camera rather than a file browser", () => {
    const html = renderToStaticMarkup(<QuickPhoto p={prod()} />);
    expect(html).toContain('capture="environment"');
    expect(html).toContain('accept="image/*"');
    expect(html).toContain("Add photo");
  });

  it("does not call a device-only photo live on the site", () => {
    const html = renderToStaticMarkup(<QuickPhoto p={prod({ photo_id: "local-only" })} />);
    expect(html).toContain("Uploading…");
    expect(html).not.toContain("Change");
  });

  it("offers a replacement once the cloud has the photo", () => {
    const html = renderToStaticMarkup(<QuickPhoto p={prod({ photo_url: "https://img/x.jpg" })} />);
    expect(html).toContain("Change");
  });
});
