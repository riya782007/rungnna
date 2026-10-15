import { db, type Product } from "./db";
import { saveProduct } from "./products";
import { generateListing, slugFor, cloudImage, publishBlockers } from "./listing";
import { requirePerm } from "./scope";

/* ===========================================================================
   Write online pages for many products in one command.

   Doing this one product at a time is the thing the owner actually does today,
   hundreds of times. The bulk version has to be careful about three things that
   a loop would get wrong:

     1. Money. Every page is a paid AI call. If the provider is out of credit or
        rate-limited, a naive loop burns through the whole catalogue producing
        nothing. This stops after a few failures in a row and says why.
     2. Work already done. Each page is saved the moment it is written, so losing
        the tab, closing the laptop or pressing Stop keeps everything up to then.
     3. Not overwriting the owner's own words. A product that already has a page
        is skipped unless the owner explicitly asks to rewrite.
=========================================================================== */

export type BulkTarget = "missing" | "all";
export type BulkFailure = { id: string; code: string; item: string; why: string };
export type BulkProgress = { done: number; total: number; ok: number; failed: number; skipped: number; current: string };
export type BulkResult = { ok: number; skipped: number; failures: BulkFailure[]; stopped: "" | "cancelled" | "provider" };

/** A product has no page yet when the AI has never written its title. */
export const needsPage = (p: Product) => !p.content?.title?.trim();

/** Nothing to write about: the AI needs at least an item name or a design number. */
export const canWritePage = (p: Product) => !!(p.item?.trim() || p.style?.trim());

/** The products a bulk run would touch, newest first so the latest intake gets pages soonest. */
export async function pickForListing(target: BulkTarget = "missing"): Promise<Product[]> {
  const all = await db.products.filter(p => !p.deleted).toArray();
  return all
    .filter(canWritePage)
    .filter(p => (target === "all" ? true : needsPage(p)))
    .sort((a, z) => (z.updated_at || "").localeCompare(a.updated_at || ""));
}

/** How many consecutive failures mean "the provider is down", not "this one product is odd". */
export const GIVE_UP_AFTER = 3;

export type BulkOptions = {
  keywords?: string;
  onProgress?: (p: BulkProgress) => void;
  /** Return true to stop after the current product. */
  cancelled?: () => boolean;
  /** Gap between calls, so a free-tier quota is not hammered. */
  gapMs?: number;
};

/**
 * Write a page for each product, saving as it goes.
 * Never throws for one bad product — it records the reason and moves on.
 */
export async function writePages(products: Product[], o: BulkOptions = {}): Promise<BulkResult> {
  requirePerm("products.edit", "writing product pages");
  requirePerm("ai.use", "using AI");
  if (typeof navigator !== "undefined" && navigator.onLine === false)
    throw new Error("Writing pages needs internet. The rest of the shop works offline — try again when you are back on.");

  const failures: BulkFailure[] = [];
  let ok = 0, skipped = 0, run = 0, streak = 0;
  const total = products.length;
  const gap = o.gapMs ?? 400;

  for (const p of products) {
    if (o.cancelled?.()) return { ok, skipped, failures, stopped: "cancelled" };
    run++;
    const label = [p.item, p.style, p.color].filter(Boolean).join(" ") || p.code;
    o.onProgress?.({ done: run - 1, total, ok, failed: failures.length, skipped, current: label });

    if (!canWritePage(p)) { skipped++; continue; }
    try {
      const r = await generateListing(p, o.keywords || "");
      const title = r.content?.title?.trim();
      if (!title) throw new Error("the AI returned a page with no title");
      // keep a slug the owner already chose; only fill a missing one
      await saveProduct({ ...p, content: r.content, slug: p.slug || slugFor(p, title) });
      ok++; streak = 0;
    } catch (e: any) {
      failures.push({ id: p.id, code: p.code, item: label, why: String(e?.message || e).slice(0, 160) });
      streak++;
      // three in a row is the provider, not the product: stop rather than burn the catalogue
      if (streak >= GIVE_UP_AFTER) {
        o.onProgress?.({ done: run, total, ok, failed: failures.length, skipped, current: "" });
        return { ok, skipped, failures, stopped: "provider" };
      }
    }
    if (gap && run < total) await new Promise(r => setTimeout(r, gap));
  }
  o.onProgress?.({ done: total, total, ok, failed: failures.length, skipped, current: "" });
  return { ok, skipped, failures, stopped: "" };
}

/* ---------------- publishing in bulk ---------------- */

export type PublishPlan = { ready: Product[]; blocked: { p: Product; why: string }[] };

/** Split products into the ones that can go live now and the ones still missing something. */
export function planPublish(products: Product[]): PublishPlan {
  const ready: Product[] = [], blocked: { p: Product; why: string }[] = [];
  for (const p of products) {
    const why = publishBlockers(p);
    if (why.length) blocked.push({ p, why: why[0] });
    else ready.push(p);
  }
  return { ready, blocked };
}

/** Put every ready product on the shop, trade portal and catalogues. Local-only; syncs after. */
export async function publishAll(products: Product[]): Promise<{ published: number; blocked: number }> {
  requirePerm("catalogue.share", "publishing to the catalogue");
  const { ready, blocked } = planPublish(products);
  for (const p of ready) {
    if (p.catalogue === 1 && p.slug) continue;                    // already live, leave it alone
    await saveProduct({ ...p, catalogue: 1, slug: p.slug || slugFor(p, p.content?.title || p.item) });
  }
  return { published: ready.length, blocked: blocked.length };
}

/** A one-line summary of what a catalogue run would do, for the button and the confirm. */
export function describePlan(products: Product[]) {
  const withPage = products.filter(p => !needsPage(p)).length;
  const withPhoto = products.filter(p => !!cloudImage(p)).length;
  const { ready } = planPublish(products);
  return { total: products.length, withPage, withPhoto, ready: ready.length };
}
