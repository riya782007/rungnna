import { db, type Bill, type Receipt, type Voucher, type Purchase, type Party } from "./db";
import { inStore } from "./stores";
import { localDay } from "./ledger";

/* Tally Prime file (owner's list R-153): one XML file for a date range — party ledgers, GST sales
   invoices, credit notes, payments taken, purchases and expenses — that Tally imports with
   Gateway of Tally › Import › Transactions (masters are inside the same file). Accounting-voucher
   view, so no stock items have to exist in Tally. Estimates are private and never go in. */

export type TallyNames = { company: string; sales: string; purchase: string; cgst: string; sgst: string; igst: string; cash: string; bank: string };
export const TALLY_DEFAULTS: TallyNames = { company: "", sales: "Sales GST 3%", purchase: "Purchase GST 3%", cgst: "Output CGST", sgst: "Output SGST", igst: "Output IGST", cash: "Cash", bank: "Bank" };

const esc = (s: string) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const amt = (paise: number) => (paise / 100).toFixed(2);
const day = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; };
const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const entry = (ledger: string, paise: number) =>
  // Tally: a debit is "deemed positive" and written as a negative amount
  `<ALLLEDGERENTRIES.LIST><LEDGERNAME>${esc(ledger)}</LEDGERNAME><ISDEEMEDPOSITIVE>${paise < 0 ? "Yes" : "No"}</ISDEEMEDPOSITIVE><AMOUNT>${amt(paise)}</AMOUNT></ALLLEDGERENTRIES.LIST>`;
const voucher = (type: string, at: string, no: string, party: string, narration: string, lines: [string, number][]) =>
  `<TALLYMESSAGE xmlns:UDF="TallyUDF"><VOUCHER VCHTYPE="${type}" ACTION="Create" OBJVIEW="Accounting Voucher View"><DATE>${day(at)}</DATE><VOUCHERTYPENAME>${type}</VOUCHERTYPENAME><VOUCHERNUMBER>${esc(no)}</VOUCHERNUMBER>${party ? `<PARTYLEDGERNAME>${esc(party)}</PARTYLEDGERNAME>` : ""}<NARRATION>${esc(narration)}</NARRATION><PERSISTEDVIEW>Accounting Voucher View</PERSISTEDVIEW>${lines.filter(([, p]) => p).map(([l, p]) => entry(l, p)).join("")}</VOUCHER></TALLYMESSAGE>`;
const ledger = (name: string, parent: string, extra = "") =>
  `<TALLYMESSAGE xmlns:UDF="TallyUDF"><LEDGER NAME="${esc(name)}" ACTION="Create"><NAME.LIST><NAME>${esc(name)}</NAME></NAME.LIST><PARENT>${esc(parent)}</PARENT>${extra}</LEDGER></TALLYMESSAGE>`;

export function tallyXml(data: { bills: Bill[]; receipts: Receipt[]; vouchers: Voucher[]; purchases: Purchase[]; parties: Party[] }, n: TallyNames = TALLY_DEFAULTS): { xml: string; count: number; skipped: number } {
  const pay = (mode: string) => mode === "cash" ? n.cash : n.bank;
  const msgs: string[] = [], used = new Map<string, "debtor" | "creditor">(), exp = new Set<string>();
  let count = 0, skipped = 0;
  for (const b of data.bills) {
    const src = b.bill_type === "return" ? b.src_type : b.bill_type;
    if (b.deleted || b.status === "void" || b.status === "hold" || src !== "gst") { if (b.bill_type === "estimate" || src === "estimate") skipped++; continue; }
    if (b.bill_type !== "gst" && b.bill_type !== "return") continue;
    const party = b.party_name?.trim() || "Cash Sales"; used.set(party, "debtor");
    const tax = (b.cgst || 0) + (b.sgst || 0) + (b.igst || 0);
    const s = b.bill_type === "return" ? -1 : 1;   // a credit note is the sale turned round
    msgs.push(voucher(b.bill_type === "return" ? "Credit Note" : "Sales", b.at, b.no, party, `${b.bill_type === "return" ? "Return of " + (b.return_of_no || "") : "Invoice"} · ${b.total_qty || 0} pcs${b.party_gstin ? " · GSTIN " + b.party_gstin : ""}`,
      [[party, -s * b.net], [n.sales, s * (b.net - tax)], [n.cgst, s * (b.cgst || 0)], [n.sgst, s * (b.sgst || 0)], [n.igst, s * (b.igst || 0)]]));
    count++;
    if (b.bill_type === "gst") b.payments?.filter(p => p.mode !== "credit" && p.amount > 0).forEach((p, i) => {
      msgs.push(voucher("Receipt", b.at, `${b.no}-P${i + 1}`, party, `Paid at billing (${p.mode}) against ${b.no}`, [[pay(p.mode), -p.amount], [party, p.amount]])); count++;
    });
  }
  for (const r of data.receipts) {
    if (r.deleted || !(r.amount > 0)) continue;
    const party = r.party_name?.trim() || "Cash Sales"; used.set(party, used.get(party) || "debtor");
    msgs.push(voucher("Receipt", r.at, r.no, party, r.note || `Payment received (${r.mode})`, [[pay(r.mode), -r.amount], [party, r.amount]])); count++;
  }
  for (const p of data.purchases) {
    if (p.deleted || p.status !== "final") continue;
    const total = p.invoice_total || p.total_cost; if (!(total > 0)) continue;
    const sup = p.supplier_name?.trim() || "Cash Purchases"; used.set(sup, "creditor");
    msgs.push(voucher("Purchase", p.at, p.supplier_bill || p.no, sup, `${p.no} · supplier bill ${p.supplier_bill || "-"} · ${p.total_qty} pcs`, [[n.purchase, -total], [sup, total]])); count++;
  }
  for (const v of data.vouchers) {
    if (v.deleted || !(v.amount > 0)) continue;
    const money = pay(v.mode);
    if (v.type === "expense") { const l = title(v.category || "other") + " Expenses"; exp.add(l); msgs.push(voucher("Payment", v.at, v.no, "", v.note, [[l, -v.amount], [money, v.amount]])); count++; }
    else if (v.type === "payment" && v.party_name) { used.set(v.party_name, v.party_kind === "supplier" ? "creditor" : used.get(v.party_name) || "debtor"); msgs.push(voucher("Payment", v.at, v.no, v.party_name, v.note, [[v.party_name, -v.amount], [money, v.amount]])); count++; }
    else if (v.type === "receipt" && v.party_name) { used.set(v.party_name, used.get(v.party_name) || "debtor"); msgs.push(voucher("Receipt", v.at, v.no, v.party_name, v.note, [[money, -v.amount], [v.party_name, v.amount]])); count++; }
  }
  const byName = new Map(data.parties.map(p => [p.name.trim(), p]));
  const masters = [
    ledger(n.sales, "Sales Accounts"), ledger(n.purchase, "Purchase Accounts"),
    ledger(n.cgst, "Duties & Taxes", "<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>Central Tax</GSTDUTYHEAD>"),
    ledger(n.sgst, "Duties & Taxes", "<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>State Tax</GSTDUTYHEAD>"),
    ledger(n.igst, "Duties & Taxes", "<TAXTYPE>GST</TAXTYPE><GSTDUTYHEAD>Integrated Tax</GSTDUTYHEAD>"),
    ledger(n.bank, "Bank Accounts"),
    ...[...exp].map(e => ledger(e, "Indirect Expenses")),
    ...[...used].map(([name, kind]) => { const p = byName.get(name);
      return ledger(name, kind === "creditor" ? "Sundry Creditors" : "Sundry Debtors", `<ISBILLWISEON>Yes</ISBILLWISEON>${p?.gstin ? `<PARTYGSTIN>${esc(p.gstin)}</PARTYGSTIN><GSTREGISTRATIONTYPE>Regular</GSTREGISTRATIONTYPE>` : ""}${p?.state ? `<LEDSTATENAME>${esc(p.state)}</LEDSTATENAME>` : ""}${p?.address ? `<ADDRESS.LIST><ADDRESS>${esc(p.address)}</ADDRESS></ADDRESS.LIST>` : ""}${p?.pin ? `<PINCODE>${esc(p.pin)}</PINCODE>` : ""}`); }),
  ];
  const head = `<?xml version="1.0" encoding="UTF-8"?>\n<ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY><IMPORTDATA><REQUESTDESC><REPORTNAME>All Masters</REPORTNAME>${n.company ? `<STATICVARIABLES><SVCURRENTCOMPANY>${esc(n.company)}</SVCURRENTCOMPANY></STATICVARIABLES>` : ""}</REQUESTDESC><REQUESTDATA>\n`;
  const xml = head + [...masters, ...msgs].join("\n") + "\n</REQUESTDATA></IMPORTDATA></BODY></ENVELOPE>\n";
  return { xml, count, skipped };
}

export async function tallyFile(from: string, to: string, store: string, names: TallyNames) {
  const inR = (at: string) => localDay(at) >= from && localDay(at) <= to;
  const sc = (r: { store_id?: string }) => store === "all" || inStore(r, store);
  const [bills, receipts, vouchers, purchases, parties] = await Promise.all([
    db.bills.filter(b => sc(b) && inR(b.at)).toArray(), db.receipts.filter(r => sc(r) && inR(r.at)).toArray(),
    db.vouchers.filter(v => sc(v) && inR(v.at)).toArray(), db.purchases.filter(p => sc(p) && inR(p.at)).toArray(), db.parties.toArray()]);
  return tallyXml({ bills, receipts, vouchers, purchases, parties }, names);
}
