import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, rebuildStock } from "../src/lib/db";
import { DEFAULT_SHOP, finalize, lineFrom, newBill, voidBill } from "../src/lib/billing";
import { resolveBillingScan } from "../src/lib/billing-products";
import { ownPayload } from "../src/lib/parse";
import { blankProduct } from "../src/lib/products";
import { manualLine } from "../src/lib/pos";
import { setStockQuantity, unassignedRackId } from "../src/lib/stock-adjustment";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { storeStock } from "../src/lib/stores";
const total = async (id: string) => (await storeStock()).filter(c => c.product_id === id).reduce((n,c) => n+c.qty,0);
beforeEach(async () => { await Promise.all(db.tables.map(t => t.clear())); setScope(MAIN_STORE,"owner"); });
describe("billing and corrections with zero or negative stock", () => {
  it("scans the photographed legacy earring with zero intake, saves below zero, rebuilds and voids correctly", async () => {
    const p = (await resolveBillingScan("203~360~1~212~~K5209/11P~W/XZBSPHL","o"))!;
    expect(p).toMatchObject({item:"EARING",type:"PAIR",rate:36000});
    const bill = await finalize({...newBill("o",DEFAULT_SHOP,"gst"),items:[{...lineFrom(p),qty:3}]},"Delhi");
    expect(await total(p.id)).toBe(-3);
    await rebuildStock(); expect(await total(p.id)).toBe(-3);
    expect((await db.movements.toArray()).every(m => !!m.from_loc)).toBe(true);
    await voidBill(bill,"Trial void","o"); expect(await total(p.id)).toBe(0);
  });
  it("scans a Rungnna-only generated QR without intake and keeps selling when already negative", async () => {
    const original = { ...blankProduct("o"), item: "NEW CHAIN", style: "N1", rate: 10000, type: "PCS", pack: 2 };
    const raw = ownPayload(original, "rungnna");
    const p = (await resolveBillingScan(raw, "o"))!;
    for (let i = 0; i < 2; i++) await finalize({ ...newBill("o", DEFAULT_SHOP, "estimate"), items: [lineFrom(p)] }, "Delhi");
    expect(await total(p.id)).toBe(-4);
    await rebuildStock(); expect(await total(p.id)).toBe(-4);
  });
  it("custom additions create one reusable product and keep exact negative quantities for bills and estimates", async () => {
    const line=manualLine({item:"CUSTOM CHAIN",style:"C1",color:"GOLD",unit:"PCS",hsn:"7117",qty:"4",rate:"100",box:1});
    const first=await finalize({...newBill("o",DEFAULT_SHOP,"estimate"),items:[line]},"Delhi");
    const second=await finalize({...newBill("o",DEFAULT_SHOP,"gst"),items:[{...line,id:"next",qty:2}]},"Delhi");
    const id=first.items[0].product_id!;
    expect(second.items[0].product_id).toBe(id); expect(await db.products.count()).toBe(1); expect(await total(id)).toBe(-6);
    await rebuildStock(); expect(await total(id)).toBe(-6);
  });
  it("sets an exact total above zero, at zero and below zero with an auditable movement each time", async () => {
    const p=(await resolveBillingScan("203~360~1~212~~K5209/11P~W/XZBSPHL","o"))!;
    for (const target of [25,0,-9,104]) { await setStockQuantity(p.id,target,"Physical recount","o"); expect(await total(p.id)).toBe(target); await rebuildStock(); expect(await total(p.id)).toBe(target); }
    expect((await db.movements.toArray()).every(m => m.kind === "adjust" && m.note.includes("Physical recount"))).toBe(true);
  });
  it("does not touch other stores or damaged stock, rejects stale counts and checks permission", async () => {
    const p=(await resolveBillingScan("203~360~1~212~~K5209/11P~W/XZBSPHL","o"))!;
    await setStockQuantity(p.id,10,"Initial count","o");
    await db.locations.bulkPut([{id:"foreign",store_id:"00000000-0000-4000-8000-000000000002",code:"OTHER",kind:"rack",floor:"",rack:"",box:"",name:"",updated_at:""},{id:"damage",store_id:MAIN_STORE,code:"DAMAGED",kind:"bucket",floor:"",rack:"",box:"",name:"",updated_at:""}]);
    await db.stock.bulkPut([{key:p.id+"|foreign",product_id:p.id,loc_id:"foreign",qty:200},{key:p.id+"|damage",product_id:p.id,loc_id:"damage",qty:5}]);
    await expect(setStockQuantity(p.id,7,"Count","o",9)).rejects.toThrow("Stock changed");
    await setStockQuantity(p.id,-2,"Count","o",10);
    expect((await db.stock.get(p.id+"|foreign"))?.qty).toBe(200); expect((await db.stock.get(p.id+"|damage"))?.qty).toBe(5);
    setScope(MAIN_STORE,"",new Set()); await expect(setStockQuantity(p.id,100,"Count","o")).rejects.toThrow("role");
  });
  it("rolls back custom article creation and negative movements if finalization fails", async () => {
    const line=manualLine({item:"ROLLBACK",style:"",color:"",unit:"PCS",hsn:"7117",qty:"2",rate:"5",box:1});
    await expect(finalize({...newBill("o",DEFAULT_SHOP),items:[line]},"Delhi","",async()=>{throw new Error("stop");})).rejects.toThrow("stop");
    expect(await db.products.count()).toBe(0); expect(await db.stock.count()).toBe(0); expect(await db.outbox.count()).toBe(0);
    expect(unassignedRackId()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/i);
  });
});
