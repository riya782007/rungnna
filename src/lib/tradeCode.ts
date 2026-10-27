import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, type Config, type Bill } from "./db";
import { ownerOnly } from "./scope";
import { billAmount } from "./format";
import { useApp } from "./app";

/* Owner, 27 Oct: the shop's own trade code for estimates. The staff are used to reading an estimate's total in
   the shop's code (e.g. ÷10: ₹10,000 reads 1,000), and the owner asked for it while setting up the software.

   It changes only what the counter SCREEN shows for an estimate's total. Every amount is saved as it really is, and
   every printed or shared bill, report, ledger, khata and GST figure shows the real amount. A coded figure always
   carries its "÷N" mark, so it is never mistaken for a real one. The owner sets it in Settings › Prices. */
export type TradeCode = { on: boolean; divisor: number; owner_real: boolean };
export const DEFAULT_TRADE_CODE: TradeCode = { on: false, divisor: 10, owner_real: true };
const KEY = "trade_code";

export async function getTradeCode(): Promise<TradeCode> {
  const v = (await db.config.get(KEY))?.value || {};
  const divisor = Number(v.divisor);
  return { ...DEFAULT_TRADE_CODE, ...v, divisor: Number.isFinite(divisor) && divisor > 1 ? divisor : DEFAULT_TRADE_CODE.divisor };
}
export async function saveTradeCode(t: TradeCode) {
  ownerOnly();
  const divisor = Number(t.divisor);
  if (!Number.isFinite(divisor) || divisor <= 1 || divisor > 1000) throw new Error("The code divides by a number above 1, e.g. 10");
  await put("config", { id: KEY, value: { on: !!t.on, divisor, owner_real: !!t.owner_real }, updated_at: now() } as Config);
}

/** The divisor to show this bill's total with on this screen, or 0 for the real amount. */
export function codeFor(t: TradeCode | undefined, bill: Pick<Bill, "bill_type">, isOwner: boolean): number {
  if (!t?.on || bill.bill_type !== "estimate") return 0;
  if (isOwner && t.owner_real) return 0;
  return t.divisor;
}

/** For screens: shows an estimate total in the trade code when it applies, with its ÷ mark; the real amount otherwise. */
export function useEstimateAmount() {
  const { me } = useApp();
  const t = useLiveQuery(getTradeCode, [], DEFAULT_TRADE_CODE);
  return (paise: number, bill: Pick<Bill, "bill_type">, money: (p: number) => string = billAmount) => {
    const d = codeFor(t, bill, me?.role === "owner");
    return d ? `${money(Math.round(paise / d))} ÷${d}` : money(paise);
  };
}
