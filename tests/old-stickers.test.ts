import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/lib/db";
import { parseLabel } from "../src/lib/parse";
import { resolveBillingScan } from "../src/lib/billing-products";
import { blankProduct } from "../src/lib/products";
import { MAIN_STORE, setScope, setScopePerms } from "../src/lib/scope";
import { noteMiss, learnFromPick, pendingMiss } from "../src/lib/scan-learn";

/* Owner, 25 Oct (phone call): "the QR codes our previous software printed don't scan in your billing — they must
   scan with the same efficiency". Real stickers from the shop's own scans (cloud, 5–22 Oct). */
const REAL = ["203~520~1~212~~4804\\140~snp", "180~310~1~183~~k5209/6su~kxzbgpl", "230~200~1~183~~K/5201/2T~K/XZ/ABH",
  "248~460~1~183~~k/5210/44t~k/xz39.05", "255~430~1~183~~K5210/1SH~KSAUL", "252~20~3~183~~k5210/11p~lkqr", "1942~1110~1~183~~K5209237SP~W/324.650",
  "202~24~12~183~~K5208/K-LT~W/LP/B", "203~220~1~212~~K/5011/50T~K/LAL-", "255~312~1~183~~K/5208/2T~KXZ86.25", "203~480~1~183~~k5010/73/t~k/sah",
  // fields starting with A / N / O, which an "international" keyboard merges with the "~" before them
  "203~520~1~183~~N5210/2T~OXD", "320~1450~1~183~~A/5208~ANTQ"];
// what scanners on other keyboard settings type for the same sticker
const KEYBOARDS: Record<string, (q: string) => string> = {
  exact: q => q, dash: q => q.replace(/~/g, "-"), backtick: q => q.replace(/~/g, "`"), caret: q => q.replace(/~/g, "^"),
  ukPipe: q => q.replace(/~/g, "|"), ukNot: q => q.replace(/~/g, "¬"), capsLost: q => q.toLowerCase(), capsOn: q => q.toUpperCase(),
  international: q => q.replace(/~([AaNnOo])/g, (_, c: string) => ({ A: "Ã", a: "ã", N: "Ñ", n: "ñ", O: "Õ", o: "õ" })[c as "A"]),
};
beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE, "owner"); setScopePerms(new Set()); });

describe("old software stickers scan at billing", () => {
  it("every real sticker, whatever the scanner's keyboard types", async () => {
    for (const [kb, f] of Object.entries(KEYBOARDS)) for (const raw of REAL) {
      const p = await resolveBillingScan(f(raw), "o");
      expect(p, `${kb}: ${f(raw)}`).toBeTruthy();
      expect(p!.item_code, `${kb}: ${raw}`).toBe(raw.split("~")[0]);
      expect(p!.rate, `${kb}: ${raw}`).toBe(Math.round(Number(raw.split("~")[1]) * 100));
    }
  });
  it("the second scan of a sticker finds the same item (no new product each time)", async () => {
    for (const raw of REAL) { const a = await resolveBillingScan(raw, "o"), b = await resolveBillingScan(raw, "o"); expect(b!.id).toBe(a!.id); }
    expect(await db.products.count()).toBe(REAL.length);
  });
  it("a biller whose ticks don't include 'Add / edit products' can still bill an old sticker", async () => {
    setScope(MAIN_STORE, "salesman", new Set(["billing.sell"])); setScopePerms(new Set(["billing.sell"]));
    expect(await resolveBillingScan(REAL[1], "s")).toMatchObject({ item_code: "180", style: "K5209/6SU" });
  });
  it("an old sticker with no style, or with its end garbled, still bills by item code and rate", async () => {
    expect(parseLabel("203~520~1~212~~~SNP")).toMatchObject({ how: "shop label", icode: "203", rate: "520", style: "", color: "SNP" });
    const a = await resolveBillingScan("203~520~1~212~~~SNP", "o");
    expect(a).toMatchObject({ item_code: "203", rate: 52000 });
    expect((await resolveBillingScan("203~520~1~212~~~SNP", "o"))!.id).toBe(a!.id);
    expect(parseLabel("203~520~1~212~~48°°")).toMatchObject({ how: "shop label", icode: "203", rate: "520", qty: "1" });
    expect(await resolveBillingScan("203~520~1~212~~48°°", "o")).toMatchObject({ item_code: "203", rate: 52000 });
  });
  it("the letter an international keyboard merges with the ~ is split back", () => {
    // "~~N5210/2T~OXD" typed as "~Ñ5210/2TÕXD": the ~ before each merged letter is gone
    expect(parseLabel("203~520~1~183~Ñ5210/2TÕXD")).toMatchObject({ how: "shop label", style: "N5210/2T", color: "OXD" });
  });
  it("ordinary typing is not taken for a sticker", () => {
    expect(parseLabel("12-10-2026").how).not.toBe("shop label");
    expect(parseLabel("K5210/2T").how).toBe("code");
  });
});

describe("a sticker that fails once is learnt from the biller's next pick", () => {
  it("miss → pick the item → the same sticker now adds that item", async () => {
    const p = { ...blankProduct("o"), item: "BALI", item_code: "5186", style: "K5210/2T", color: "KXZ", rate: 26400 };
    await db.products.put(p);
    const odd = "§§garbled-sticker-text§§";
    expect(await resolveBillingScan(odd, "o")).toBeUndefined();
    await noteMiss(odd, "M");
    expect(pendingMiss()).toBe(odd);
    expect(await learnFromPick(p)).toBe(true);
    expect((await resolveBillingScan(odd, "o"))?.id).toBe(p.id);
    // the person's choice wins even over what the sticker's own numbers say
    await noteMiss("203~264~1~183~~K5210/2T~KXZ"); await learnFromPick(p);
    expect((await resolveBillingScan("203~264~1~183~~K5210/2T~KXZ", "o"))?.id).toBe(p.id);
    const log = (await db.config.get("scan_misses"))!.value as any[];
    expect(log[log.length - 1]).toMatchObject({ raw: odd, by: "M", learnt: "BALI K5210/2T" });
  });
});
