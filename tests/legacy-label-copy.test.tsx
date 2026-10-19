import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { legacyLabelCopy, validateLegacyCopy } from "../src/lib/legacy-label-copy";
import { blankProduct } from "../src/lib/products";
import { DEFAULT_CFG, PrintSheet, PRESETS, tscCommands, validateLabelPrint } from "../src/pages/Labels";
import { validateLabelBitmapJob } from "../src/lib/label-bitmap";
const original="203~360~1~212~~K5209/11P~W/XZBSPHL";
const saved={...blankProduct("owner"),item:"EARING",type:"PAIR",rate:99900,ref:"WRONG",tk:"WRONG",item_code:"999",pack:12};
describe("exact working old QR copies",()=>{
 it("keeps original rate, packet, empty TK and reference instead of conflicting saved article fields",()=>{
  const job=legacyLabelCopy(original,saved);
  expect(job.p).toMatchObject({item:"EARING",type:"PAIR",rate:36000,ref:"212",tk:"",item_code:"203",pack:1,style:"K5209/11P",color:"W/XZBSPHL"});
  expect(validateLegacyCopy(job)).toBe(original);expect(saved.ref).toBe("WRONG");
 });
 it("uses the same exact source for browser, QZ bitmap and direct TSC",()=>{
  const job=legacyLabelCopy(original,saved);
  expect(()=>validateLabelPrint(DEFAULT_CFG,[job])).not.toThrow();
  expect(()=>validateLabelBitmapJob({...DEFAULT_CFG,output:"qz",gapY:2.6},[job])).not.toThrow();
  const html=renderToStaticMarkup(<PrintSheet cfg={{...DEFAULT_CFG,format:"rungnna"}} jobs={[job]}/>);
  expect(html).toContain("9360X1PAIR");expect(html).not.toContain(">999");
  expect(tscCommands({...DEFAULT_CFG,...PRESETS.find(p=>p.key==="rj")!.cfg},[job])).toContain(original);
 });
 it("keeps odd and fractional old prices, leading zeros and empty reference without even-price rewriting",()=>{
  for(const price of ["361","361.50","0360.00"]){
   const raw=original.replace("~360~","~"+price+"~").replace("~212~","~~");const job=legacyLabelCopy(raw,saved);
   expect(validateLegacyCopy(job)).toBe(raw);expect(job.p.ref).toBe("");
   const html=renderToStaticMarkup(<PrintSheet cfg={DEFAULT_CFG} jobs={[job]}/>);
   expect(html).toContain("9"+(Number.isInteger(Number(price))?Number(price):Number(price).toFixed(2))+"X1PAIR");
  }
 });
 it("refuses corrupt payloads and edited exact-copy identities before printing",()=>{
  for(const raw of ["RJ1|1|A|PCS|S|||1|1",original.replace("~360~","~abc~"),original.replace("~1~","~0~"),original.replace("~360~","~9999999999999999999999999999~"),original+"~extra",original.replace("~212~","~bad\nref~")])expect(()=>legacyLabelCopy(raw,saved)).toThrow();
  const job=legacyLabelCopy(original,saved);
  for(const changed of [{...job,qtyOnLabel:3},{...job,p:{...job.p,rate:36200}},{...job,p:{...job.p,ref:"changed"}},{...job,bag:{}}])expect(()=>validateLegacyCopy(changed)).toThrow();
 });
});
