import type { Bill, Payment, Receipt } from "./db";
import { due, isSale } from "./billing";
import { isEstimate } from "./privacy";
import { localDay } from "./ledger";

/* End-of-day: what came in and went out on one day, by payment mode.
   - Money is counted on the day it was received (Payment.at; older payments without a time use the bill's time).
   - Payments that came from a receipt (ref "RCPT …") are counted once, under Receipts.
   - A bill's advance is cash taken when the bill was made.
   - Estimates (and their returns) are reported separately and only when unlocked. */

export type Modes = { cash: number; upi: number; card: number; bank: number };
const zero = (): Modes => ({ cash: 0, upi: 0, card: 0, bank: 0 });
const addMode = (m: Modes, p: Pick<Payment, "mode" | "amount">) => { if (p.mode !== "credit") m[p.mode] += p.amount; };
export const modesTotal = (m: Modes) => m.cash + m.upi + m.card + m.bank;

export interface SalesPart { count: number; net: number; pcs: number; received: Modes; credit: number }
export interface EodReport {
  day: string;
  gst: SalesPart;
  est: SalesPart | null;              // only when estimates are unlocked
  orders: Modes;                      // advances / payments taken on orders still on hold
  later: Modes;                       // money received today on older bills
  receipts: { count: number; modes: Modes };
  returns: { count: number; net: number; refunds: Modes };
  challans: { count: number; pcs: number };
  cashIn: number; cashOut: number; opening: number; closing: number;
  collected: number;                  // all money in today, every mode
}

const part = (): SalesPart => ({ count: 0, net: 0, pcs: 0, received: zero(), credit: 0 });
const fromReceipt = (p: Payment) => (p.ref || "").startsWith("RCPT");

export function eodReport(bills: Bill[], receipts: Receipt[], day: string, opening: number, open: boolean): EodReport {
  const r: EodReport = { day, gst: part(), est: open ? part() : null, orders: zero(), later: zero(), receipts: { count: 0, modes: zero() },
    returns: { count: 0, net: 0, refunds: zero() }, challans: { count: 0, pcs: 0 }, cashIn: 0, cashOut: 0, opening, closing: 0, collected: 0 };
  const today = (iso?: string) => !!iso && localDay(iso) === day;

  for (const b of bills) {
    if (b.deleted || (!open && isEstimate(b))) continue;
    const madeToday = today(b.at);
    const paysToday = b.payments.filter(p => p.mode !== "credit" && !fromReceipt(p) && today(p.at || b.at));

    if (b.bill_type === "challan") { if (b.status === "final" && madeToday) { r.challans.count++; r.challans.pcs += b.total_qty; } continue; }

    if (b.bill_type === "return") {
      if (b.status !== "final") continue;
      if (madeToday) { r.returns.count++; r.returns.net += b.net; }
      paysToday.forEach(p => addMode(r.returns.refunds, p));
      continue;
    }

    if (!isSale(b)) continue;
    if (b.status === "hold") {                         // an order with money taken on it
      if (madeToday && b.advance) r.orders.cash += b.advance;
      paysToday.forEach(p => addMode(r.orders, p));
      continue;
    }
    if (b.status !== "final") continue;                // void / merged / converted: counted where they ended up
    const sec = b.bill_type === "estimate" ? r.est! : r.gst;
    if (madeToday) {
      sec.count++; sec.net += b.net; sec.pcs += b.total_qty;
      if (b.advance) sec.received.cash += b.advance;
      sec.credit += Math.max(0, due(b));
      paysToday.forEach(p => addMode(sec.received, p));
    } else paysToday.forEach(p => addMode(r.later, p));
  }

  for (const rc of receipts) {
    if (rc.deleted || !today(rc.at)) continue;
    // while estimates are locked, the part of a receipt that paid estimates stays out
    const hidden = open ? 0 : rc.allocations.filter(a => /^EST\//.test(a.bill_no)).reduce((x, a) => x + a.amount, 0);
    const amount = rc.amount - hidden; if (amount <= 0) continue;
    r.receipts.count++; addMode(r.receipts.modes, { mode: rc.mode, amount });
  }

  const ins = [r.gst.received, r.est?.received || zero(), r.orders, r.later, r.receipts.modes];
  r.cashIn = ins.reduce((a, m) => a + m.cash, 0);
  r.collected = ins.reduce((a, m) => a + modesTotal(m), 0);
  r.cashOut = r.returns.refunds.cash;
  r.closing = opening + r.cashIn - r.cashOut;
  return r;
}
