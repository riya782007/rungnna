import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { db } from "../src/lib/db";
import { DEFAULT_SHOP, fixLine, newBill } from "../src/lib/billing";
import { appendPosLine } from "../src/lib/pos";
import { mergeBillLines } from "../src/lib/billingBox";
import { bagLabelJobs, bagPayload, parseBagPayload } from "../src/lib/bag-labels";
import { DEFAULT_CFG, PrintSheet, PRESETS, tscCommands, validateLabelPrint } from "../src/pages/Labels";
import { blankProduct, hideProducts } from "../src/lib/products";
import { MAIN_STORE, setScope } from "../src/lib/scope";
const line=(id:string,item="EARRING",style="E1",patch:any={})=>fixLine({id,code:"",item,style,color:"GOLD",type:"PAIR",box_no:1,pack:1,pkts:0,qty:1,rate:10000,disc:"",amount:0,...patch});
const bill=(name="Customer A")=>({...newBill("owner",DEFAULT_SHOP,"gst"),no:"GST/26/001",status:"final" as const,party_name:name,box_count:2,items:[line("1")]});
beforeEach(async()=>{await Promise.all(db.tables.map(t=>t.clear()));setScope(MAIN_STORE,"owner");});
describe("matching bill models",()=>{
 it("merges a repeated manual model across an intervening model and keeps its original row",()=>{
   const first=line("first"),middle=line("middle","JHUMKA","J1"),last=line("last");
   const added=appendPosLine([first,middle],last);
   expect(added.items.map(l=>[l.id,l.item,l.qty])).toEqual([["first","EARRING",2],["middle","JHUMKA",1]]);
   expect(added.line.id).toBe("first");expect(added.items.reduce((s,l)=>s+l.amount,0)).toBe(30000);
   expect(mergeBillLines([first,middle,last])).toEqual(added.items);
 });
 it("keeps price, packet, unit, colour, tax, stock-history and ambiguous manual identities separate",()=>{
   for(const patch of [{rate:20000},{pack:2},{color:"WHITE"},{type:"PCS"},{gst_rate:3},{box_no:2},{src_line:"earlier"},{stock_done:1},{style:""},{item:"OTHER"},{disc:"5"}])expect(appendPosLine([line("a")],line("b","EARRING","E1",patch)).items).toHaveLength(2);
   expect(appendPosLine([line("a","EARRING","")],line("b","EARRING","")).items).toHaveLength(2);
 });
});
describe("customer bag labels",()=>{
 it("prints the exact bill name and numbered bags with a separate stable barcode",async()=>{
   const b=bill("Karan's customer"),jobs=bagLabelJobs(b,4);
   expect(new Set(jobs.map(j=>bagPayload(j.bag!))).size).toBe(4);
   expect(bagLabelJobs(b,4).map(j=>bagPayload(j.bag!))).toEqual(jobs.map(j=>bagPayload(j.bag!)));
   expect(jobs.every(j=>j.p.item===b.party_name&&j.p.style===b.no)).toBe(true);
   expect(parseBagPayload(bagPayload(jobs[2].bag!))).toEqual({billId:b.id,number:3});
   expect(await db.products.count()).toBe(0);expect(await db.stock.count()).toBe(0);expect(await db.outbox.count()).toBe(0);
 });
 it("never shares identities across four customers, even when their bill numbers happen to match",()=>{
   const jobs=["Customer A","Customer B","Customer C","Customer D"].map(name=>bagLabelJobs(bill(name),1)[0]);
   expect(new Set(jobs.map(j=>bagPayload(j.bag!))).size).toBe(4);
 });
 it("uses the label printer without requiring a product master code or printing rates",()=>{
   const jobs=bagLabelJobs(bill(),2);expect(()=>validateLabelPrint(DEFAULT_CFG,jobs)).not.toThrow();
   const html=renderToStaticMarkup(<PrintSheet cfg={DEFAULT_CFG} jobs={jobs}/>);
   expect(html.match(/Customer A<\/text>/g)).toHaveLength(2);expect(html).toContain("BAG 1 OF 2");expect(html).toContain("BAG 2 OF 2");
   expect(html).not.toContain("X1PCS");
   expect([...html.matchAll(/font-weight="(\d+)"/g)].every(m=>Number(m[1])>=700)).toBe(true);
   const cfg={...DEFAULT_CFG,...PRESETS.find(p=>p.key==="rj")!.cfg};
   const commands=tscCommands(cfg,jobs);expect(commands).toContain(bagPayload(jobs[0].bag!));expect(commands).toContain("Customer A");
 });
 it("rejects unnamed, unsaved and cancelled bills and damaged bag identifiers",()=>{
   for(const patch of [{party_name:" "},{no:""},{status:"hold" as const},{status:"void" as const}])expect(()=>bagLabelJobs({...bill(),...patch})).toThrow();
   for(const count of [0,-1,1.5,5001])expect(()=>bagLabelJobs(bill(),count)).toThrow();
   expect(parseBagPayload("203~360~1~212~~K5209/11P~W/XZBSPHL")).toBeUndefined();
   expect(()=>parseBagPayload("RJ-BAG1|id|0")).toThrow();expect(()=>parseBagPayload("RJ-BAG1|id|1|extra")).toThrow();
 });
});
describe("batch product removal",()=>{
 it("hides only selected products while retaining stock and document history",async()=>{
   const a={...blankProduct("o"),item:"A"},b={...blankProduct("o"),item:"B"},c={...blankProduct("o"),item:"C"};
   await db.products.bulkPut([a,b,c]);await db.stock.put({key:a.id+"|rack",product_id:a.id,loc_id:"rack",qty:12});
   const history={...bill(),items:[line("h","A","S",{product_id:a.id})]};await db.bills.put(history);
   await hideProducts([a.id,b.id,a.id]);
   expect((await db.products.get(a.id))?.deleted).toBe(1);expect((await db.products.get(b.id))?.deleted).toBe(1);expect((await db.products.get(c.id))?.deleted).toBeUndefined();
   expect((await db.stock.toArray())[0].qty).toBe(12);expect(await db.bills.get(history.id)).toEqual(history);expect(await db.outbox.count()).toBe(2);
 });
 it("rolls the whole batch back if a write fails and requires edit permission",async()=>{
   const a=blankProduct("o"),b=blankProduct("o");await db.products.bulkPut([a,b]);
   const fail=(_mods:any,key:any)=>{if(key===b.id)throw new Error("simulated write failure");};db.products.hook("updating",fail);
   try{await expect(hideProducts([a.id,b.id])).rejects.toThrow("simulated");}finally{db.products.hook("updating").unsubscribe(fail);}
   expect((await db.products.get(a.id))?.deleted).toBeUndefined();expect(await db.outbox.count()).toBe(0);
   setScope(MAIN_STORE,"",new Set());await expect(hideProducts([a.id])).rejects.toThrow();
 });
});
