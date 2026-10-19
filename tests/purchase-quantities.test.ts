import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { db, now } from "../src/lib/db";
import { newParty } from "../src/lib/billing";
import { blankProduct } from "../src/lib/products";
import { MAIN_STORE, setScope } from "../src/lib/scope";
import { applyPhotoQuantities, readCount, readPacketSize } from "../src/lib/purchase-quantities";
import { preparePhotoRows, savePhotoPurchase, draftLabelProducts, validatePhotoRows, labelCountFor, type PhotoRow } from "../src/lib/purchase-photo";
import { purchaseLabelJobs } from "../src/lib/purchase-labels";
import { DEFAULT_RULE } from "../src/lib/pricing";
import { ownPayload } from "../src/lib/parse";
const row: PhotoRow = { item: "BALI", style: "K1", color: "G", unit: "PAIR", qty: "24", cost: "100", rate: "250", hsn: "7117", pack: "" };
beforeEach(async () => {
  await Promise.all(db.tables.map(t=>t.clear()));setScope(MAIN_STORE,"owner");
  await db.parties.put({ ...newParty("KAYAN"), id:"supplier", kind:"supplier" });
  await db.locations.put({ id:"rack", store_id:MAIN_STORE, floor:"1", rack:"1", box:"", kind:"rack", code:"F1-R01", name:"", updated_at:now() });
});
describe("purchase quantities without repeated typing",()=>{
  it("accepts explicit packet notations and whole decimals instead of silently replacing them with X1",()=>{
    for(const input of ["12","12.0","12 PCS","12 PCS/BOX","X12","1 DZN","1 dozen"])expect(readPacketSize(input)).toBe("12");
    expect(readCount("1,200")).toBe("1200");expect(readCount("1,2")).toBe("1,2");
    for(const input of ["unclear","2.5","0"])expect(readPacketSize(input)).toBe(input);
  });
  it("uses printed packet size, exact article then saved default without changing the bill quantity",async()=>{
    await db.products.put({...blankProduct("o"),vendor_id:"supplier",item:"BALI",type:"PAIR",style:"K1",model:"K1",color:"G",pack:6,item_code:"5186",ref:"212"});
    const rows=await preparePhotoRows([{...row,pack:"12 PCS"},row,{...row,style:"K2"}],"supplier","24");
    expect(rows.map(r=>r.pack)).toEqual(["12","6","24"]);expect(rows.map(r=>r.qty)).toEqual(["24","24","24"]);
    expect(rows[1]).toMatchObject({item_code:"5186",ref:"212",packSource:"saved"});
  });
  it("can set all 26 packet sizes in one action while preserving totals and sticker overrides",()=>{
    const original=Array.from({length:26},(_,i)=>({...row,style:"K"+i,qty:String(12*(i+1)),stickers:i===0?"0":""}));
    const changed=applyPhotoQuantities(original,"","12");
    expect(changed.map(r=>r.qty)).toEqual(original.map(r=>r.qty));expect(changed.every(r=>r.pack==="12")).toBe(true);
    expect(changed[0].stickers).toBe("0");expect(original[0].pack).toBe("");
    const all=applyPhotoQuantities(changed,"12","12");expect(all.every(r=>r.qty==="12"&&r.pack==="12")).toBe(true);
    expect(labelCountFor(validatePhotoRows(all))).toBe(25);
  });
  it("rejects the entire bulk change for invalid counts",()=>{
    for(const [qty,pack] of [["",""],["1.5","12"],["0","12"],["12","-1"],["12","10001"]])expect(()=>applyPhotoQuantities([row],qty,pack)).toThrow();
    expect(row.qty).toBe("24");
  });
  it("recovers default packet sizes when a supplier becomes known but preserves manual edits",async()=>{
    const initial=await preparePhotoRows([row],"","12");
    await db.products.put({...blankProduct("o"),vendor_id:"supplier",item:"BALI",style:"K1",model:"K1",color:"G",pack:6});
    expect((await preparePhotoRows(initial,"supplier","12"))[0].pack).toBe("6");
    const manual=applyPhotoQuantities(initial,"","24");expect((await preparePhotoRows(manual,"supplier","12"))[0].pack).toBe("24");
  });
  it("carries the real old item code and reference through photo saving, printed QR and packet stock",async()=>{
    const ready=await preparePhotoRows([{...row,ref:"212",pack:"12"}],"supplier","1");
    expect(ready[0].item_code).toBe("5186");
    expect(ownPayload(draftLabelProducts(ready,"o",DEFAULT_RULE)[0],"shop")).toBe("5186~250~12~212~~K1~G");
    const saved=await savePhotoPurchase(ready,{by:"o",rack:"rack",supplierId:"supplier",billNo:"Q1",note:""});
    const products=await db.products.toArray(), jobs=purchaseLabelJobs(saved,products);
    expect(products[0]).toMatchObject({item_code:"5186",ref:"212",pack:12});
    expect(jobs).toMatchObject([{qtyOnLabel:12,copies:2}]);expect((await db.stock.toArray())[0].qty).toBe(24);
    expect(ownPayload(products[0],"shop")).toBe("5186~250~12~212~~K1~G");
  });
  it("does not invent an old code when category mappings disagree",async()=>{
    await db.products.bulkPut(["201","202"].map(item_code=>({...blankProduct("o"),item:"UNKNOWN",type:"PCS",item_code})));
    const rows=await preparePhotoRows([{...row,item:"UNKNOWN",unit:"PCS"}],"supplier","12");
    expect(rows[0].item_code).toBeUndefined();
    expect(()=>ownPayload(draftLabelProducts(rows,"o",DEFAULT_RULE)[0],"shop")).toThrow("numeric ITEM CODE");
  });
});

import { repeatPhotoCount } from "../src/lib/purchase-quantities";

describe("Enter repeats purchase counts independently", () => {
  const lines = () => [1, 2, 3, 4].map(n => ({ item: `Copper set ${n}`, qty: "10", pack: "1", stickers: "", cost: "100", rate: "200", unit: "SET", hsn: "7117" }));
  it.each(["qty", "pack", "stickers"] as const)("carries 2, then a manually changed 3 down %s only", field => {
    const original = lines();
    let rows = repeatPhotoCount(original, 0, field, "2");
    rows = repeatPhotoCount(rows, 1, field, rows[1][field]!);
    expect(rows.slice(0, 3).map(r => r[field])).toEqual(["2", "2", "2"]);
    rows = repeatPhotoCount(rows, 2, field, "3");
    expect(rows.map(r => r[field])).toEqual(["2", "2", "3", "3"]);
    expect(rows.map(r => r.cost)).toEqual(original.map(r => r.cost));
    for (const other of ["qty", "pack", "stickers"] as const) if (other !== field) expect(rows.map(r => r[other])).toEqual(original.map(r => r[other]));
    expect(original[0][field]).not.toBe("2");
  });
  it("keeps zero and blank sticker meanings", () => {
    expect(repeatPhotoCount(lines(), 0, "stickers", "0")[1].stickers).toBe("0");
    expect(repeatPhotoCount(lines(), 0, "stickers", "")[1].stickers).toBe("");
  });
  it("validates counts and handles the last line without adding a product", () => {
    expect(() => repeatPhotoCount(lines(), 0, "qty", "0")).toThrow();
    expect(() => repeatPhotoCount(lines(), 0, "pack", "")).toThrow();
    expect(() => repeatPhotoCount(lines(), 0, "stickers", "5001")).toThrow();
    expect(() => repeatPhotoCount(lines(), 0, "stickers", "2.5")).toThrow();
    expect(repeatPhotoCount(lines(), 3, "qty", "3")).toHaveLength(4);
  });
});
