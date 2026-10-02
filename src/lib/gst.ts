import type { Bill, ComplianceRecord, Transport } from "./db";
import type { Shop } from "./billing";
export type GstKind = "irn" | "ewb";
export const ewbRequired = (b: Bill) => b.status === "final" && ["gst", "challan"].includes(b.bill_type) && b.net > 5_000_000;
export const irnEligible = (b: Bill) => b.status === "final" && b.bill_type === "gst" && !!b.party_gstin;
export function canCancel(record?: ComplianceRecord, time = Date.now()) {
  const age = time - Date.parse(record?.generated_at || "");
  return !!record && !record.cancelled_at && Number.isFinite(age) && age >= 0 && age < 86400000;
}
export function gstDate(iso: string) { const d = new Date(iso); if (!Number.isFinite(d.getTime())) throw new Error("Invalid document date"); return d.toLocaleDateString("en-GB", { timeZone: "Asia/Kolkata" }); }
const money = (n: number) => Number((n / 100).toFixed(2));
const gstin = (s: string) => /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(s);
const pin = (s: string) => /^[1-9]\d{5}$/.test(s);
const unit = (s: string) => ({ PCS: "NOS", PAIR: "PRS", SET: "SET", DOZEN: "DOZ", BOX: "BOX", PACKET: "PAC" }[s as "PCS"] || "OTH");

export function validateGst(b: Bill, shop: Shop, kind: GstKind): string[] {
  const errors: string[] = [];
  const tr = b.transport;
  if (b.deleted || b.status !== "final") errors.push("Finalize the document first");
  if (kind === "irn" && !irnEligible(b)) errors.push("E-invoice requires a B2B GST invoice");
  if (kind === "ewb" && !["gst", "challan"].includes(b.bill_type)) errors.push("Use a GST invoice or delivery challan");
  if (!/^[A-Za-z0-9][A-Za-z0-9/-]{0,15}$/.test(b.no)) errors.push("Government document number must be 1–16 characters (letters, digits, /, -)");
  if (!gstin(shop.gstin)) errors.push("Enter a valid seller GSTIN in Settings");
  if (kind === "irn" && !gstin(b.party_gstin)) errors.push("Enter a valid buyer GSTIN");
  if (b.party_gstin && !gstin(b.party_gstin)) errors.push("Buyer GSTIN is invalid");
  if (!tr || !pin(tr.from_pin) || !pin(tr.to_pin) || !tr.from_city || !tr.to_city || !tr.to_address || !shop.address) errors.push("Complete seller and buyer addresses, cities and PIN codes");
  if (tr && !/^\d{2}$/.test(tr.to_state_code)) errors.push("Enter the buyer's two-digit GST state code");
  if (tr && b.party_gstin && tr.to_state_code !== b.party_gstin.slice(0, 2)) errors.push("Buyer GSTIN and state code differ");
  if (!b.items.length || b.items.some(l => l.qty <= 0 || !/^\d{4,8}$/.test(l.hsn || shop.hsn))) errors.push("Each item needs a positive quantity and a 4–8 digit HSN");
  if (kind === "ewb" && tr) {
    if (!Number.isInteger(tr.distance) || tr.distance < 1 || tr.distance > 4000) errors.push("Transport distance must be 1–4000 km");
    if (tr.mode === "1" && !/^[A-Z0-9]{4,15}$/.test(tr.vehicle_no)) errors.push("Enter a valid vehicle number");
    if (tr.mode !== "1" && (!tr.doc_no || !tr.doc_date)) errors.push("Enter transport document number and date");
  }
  return errors;
}
// Allocate integer paise so exported tax and discount totals equal the saved bill.
function allocate(total: number, weights: number[]) {
  const sum = weights.reduce((a, n) => a + n, 0);
  const out = weights.map(n => sum ? Math.floor(total * n / sum) : 0);
  let left = total - out.reduce((a, n) => a + n, 0);
  for (let i = 0; left > 0 && i < out.length; i++, left--) out[i]++;
  return out;
}
export function gstPayload(b: Bill, shop: Shop, kind: GstKind) {
  const errors = validateGst(b, shop, kind); if (errors.length) throw new Error(errors.join("; "));
  const tr = b.transport as Transport;
  const weights = b.items.map(l => l.amount);
  const taxable = b.net - b.adjust - b.gst;
  const bases = allocate(taxable, weights), cg = allocate(b.cgst, weights), sg = allocate(b.sgst, weights), ig = allocate(b.igst, weights);
  if (kind === "irn") return {
    Version: "1.1", TranDtls: { TaxSch: "GST", SupTyp: "B2B", RegRev: "N", IgstOnIntra: "N" },
    DocDtls: { Typ: "INV", No: b.no, Dt: gstDate(b.at) },
    SellerDtls: { Gstin: shop.gstin, LglNm: shop.name, Addr1: shop.address, Loc: tr.from_city, Pin: Number(tr.from_pin), Stcd: shop.gstin.slice(0, 2) },
    BuyerDtls: { Gstin: b.party_gstin, LglNm: b.party_name, Pos: tr.to_state_code, Addr1: tr.to_address, Loc: tr.to_city, Pin: Number(tr.to_pin), Stcd: tr.to_state_code },
    ItemList: b.items.map((l, i) => ({ SlNo: String(i + 1), PrdDesc: [l.item, l.style, l.color].filter(Boolean).join(" "), IsServc: "N", HsnCd: l.hsn || shop.hsn, Qty: l.qty, Unit: unit(l.type), UnitPrice: Number((bases[i] / l.qty / 100).toFixed(6)), TotAmt: money(bases[i]), Discount: 0, AssAmt: money(bases[i]), GstRt: b.gst_rate, IgstAmt: money(ig[i]), CgstAmt: money(cg[i]), SgstAmt: money(sg[i]), TotItemVal: money(bases[i] + cg[i] + sg[i] + ig[i]) })),
    ValDtls: { AssVal: money(taxable), CgstVal: money(b.cgst), SgstVal: money(b.sgst), IgstVal: money(b.igst), CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: money(b.adjust), TotInvVal: money(b.net) },
  };
  return {
    supplyType: "O", subSupplyType: b.bill_type === "challan" ? "8" : "1", subSupplyDesc: "", docType: b.bill_type === "challan" ? "CHL" : "INV", docNo: b.no, docDate: gstDate(b.at),
    fromGstin: shop.gstin, fromTrdName: shop.name, fromAddr1: shop.address, fromAddr2: "", fromPlace: tr.from_city, fromPincode: Number(tr.from_pin), actFromStateCode: Number(shop.gstin.slice(0, 2)), fromStateCode: Number(shop.gstin.slice(0, 2)),
    toGstin: b.party_gstin || "URP", toTrdName: b.party_name, toAddr1: tr.to_address, toAddr2: "", toPlace: tr.to_city, toPincode: Number(tr.to_pin), actToStateCode: Number(tr.to_state_code), toStateCode: Number(tr.to_state_code), transactionType: 1,
    totalValue: money(taxable), cgstValue: money(b.cgst), sgstValue: money(b.sgst), igstValue: money(b.igst), cessValue: 0, cessNonAdvolValue: 0, otherValue: money(b.adjust), totInvValue: money(b.net),
    transporterId: tr.transporter_id, transporterName: tr.transporter_name, transDocNo: tr.doc_no || "", transDocDate: tr.doc_date ? gstDate(tr.doc_date) : "", transMode: tr.mode, transDistance: String(tr.distance), vehicleNo: tr.vehicle_no, vehicleType: "R",
    itemList: b.items.map((l, i) => ({ productName: l.item, productDesc: [l.style, l.color].join(" "), hsnCode: Number(l.hsn || shop.hsn), quantity: l.qty, qtyUnit: unit(l.type), taxableAmount: money(bases[i]), cgstRate: b.gst && !b.igst ? b.gst_rate / 2 : 0, sgstRate: b.gst && !b.igst ? b.gst_rate / 2 : 0, igstRate: b.igst ? b.gst_rate : 0, cessRate: 0, cessNonadvol: 0 })),
  };
}
export function gstUpload(b: Bill, shop: Shop, kind: GstKind) {
  const payload = gstPayload(b, shop, kind);
  return kind === "irn" ? [payload] : { version: "1.0.0621", billLists: [payload] };
}
