import { db, put, uid, now, deviceId, getSetting, setSetting, type ExpenseCategory, type MoneyMode, type Party, type Voucher, type VoucherType } from "./db";
import { counterCode, fy } from "./billing";
import { assertUnlocked } from "./finance";

export const EXPENSES: ExpenseCategory[] = ["rent", "salary", "electricity", "transport", "tea", "other"];
export const VOUCHER_MODES: MoneyMode[] = ["cash", "upi", "bank", "cheque"];

export async function nextSeries(prefix: string, at = new Date()) {
  const cc = await counterCode();
  const f = fy(at);
  const key = `seq_${prefix}_${f}_${cc}`;
  const n = (await getSetting<number>(key, 0)) + 1;
  await setSetting(key, n);
  return { no: `${prefix}/${f}/${cc}-${String(n).padStart(4, "0")}`, series: `${prefix}/${f}/${cc}` };
}

export function voucherPrefix(t: VoucherType) {
  return t === "payment" ? "PV" : t === "receipt" ? "RV" : t === "expense" ? "EX" : "JV";
}

export async function saveVoucher(input: {
  type: VoucherType;
  amount: number;
  mode?: MoneyMode;
  party?: Party;
  category?: ExpenseCategory;
  note?: string;
  by: string;
  at?: string;
  debit_account?: string;
  credit_account?: string;
}): Promise<Voucher> {
  await assertUnlocked(input.at || now());
  const d = input.at ? new Date(input.at) : new Date();
  const num = await nextSeries(voucherPrefix(input.type), d);
  const v: Voucher = {
    id: uid(),
    ...num,
    type: input.type,
    at: input.at || now(),
    mode: input.mode || "cash",
    amount: input.amount,
    party_id: input.party?.id,
    party_name: input.party?.name,
    party_kind: input.party?.kind,
    category: input.category,
    note: input.note || "",
    debit_account: input.debit_account,
    credit_account: input.credit_account,
    device: deviceId(),
    by_staff: input.by,
    updated_at: now(),
  };
  return put("vouchers", v);
}

export const cashSign = (v: Pick<Voucher, "type" | "mode" | "amount">) =>
  v.mode !== "cash" ? 0 : v.type === "receipt" ? v.amount : v.type === "payment" || v.type === "expense" ? -v.amount : 0;
