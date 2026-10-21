import { describe, expect, it } from "vitest";
import { ownPayload, parseLabel } from "../src/lib/parse";
const photographed = "203~360~1~212~~K5209/11P~W/XZBSPHL";
const product={code:"RJ-LOCAL",item:"EARING",type:"PAIR",style:"K5209/11P",color:"W/XZBSPHL",tk:"",rate:36000,item_code:"203",pack:1,ref:"212"};
describe("explicit old-software label compatibility",()=>{
  it("reproduces the exact decoded original earring payload byte for byte",()=>{ expect(ownPayload(product,"shop")).toBe(photographed); expect(parseLabel(photographed)).toMatchObject({icode:"203",ref:"212",qty:"1",rate:"360"}); });
  it("prints the named Rungnna QR when an item has no old code, instead of refusing the whole print",()=>{ for (const p of [{...product,item_code:undefined},{...product,item_code:"RJ-LOCAL"},{...product,style:""}]) { const text=ownPayload(p,"shop"); expect(text).toMatch(/^RJ1\|/); expect(parseLabel(text)).toMatchObject({item:"EARING",type:"PAIR"}); } });
  it("keeps Rungnna-only labels named and self contained for zero-stock billing",()=>{ const text=ownPayload({...product,item_code:undefined},"rungnna"); expect(text).toMatch(/^RJ1\|/); expect(parseLabel(text)).toMatchObject({item:"EARING",type:"PAIR",qty:"1"}); });
  it("refuses fields that would corrupt the seven-slot legacy structure",()=>{ expect(()=>ownPayload({...product,style:"K~123"},"shop")).toThrow("fields"); });
});
