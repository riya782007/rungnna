import { db, put, uid, now, deviceId, type FiscalYearClose, type Party } from "./db";
import { fy } from "./billing";
import { balances } from "./ledger";
import { supplierBalances } from "./suppliers";

export const dayOf = (iso: string) => iso.slice(0, 10);

export async function lockedUpto() {
  return (await db.config.get("voucher_lock"))?.value?.date || "";
}

export async function assertUnlocked(at?: string) {
  const lock = await lockedUpto();
  if (lock && at && dayOf(at) <= lock) throw new Error(`Vouchers are locked up to ${lock}`);
}

export async function setVoucherLock(date: string) {
  await put("config", { id: "voucher_lock", value: { date }, updated_at: now() } as any);
}

export async function closeFinancialYear(by: string, date: string): Promise<FiscalYearClose> {
  await assertUnlocked(new Date(date + "T23:59").toISOString());
  const [customers, suppliers, cb, sb] = await Promise.all([
    db.parties.filter(p => !p.deleted && p.kind !== "supplier").toArray(),
    db.parties.filter(p => !p.deleted && p.kind === "supplier").toArray(),
    balances(),
    supplierBalances(),
  ]);
  const customer_balances: Record<string, number> = {}, supplier_balances: Record<string, number> = {};
  customers.forEach(p => { customer_balances[p.id] = cb.get(p.id) || 0; });
  suppliers.forEach(p => { supplier_balances[p.id] = sb.get(p.id) || 0; });
  const row: FiscalYearClose = { id: uid(), fy: fy(new Date(date + "T00:00")), closed_upto: date, customer_balances, supplier_balances, device: deviceId(), by_staff: by, at: now(), updated_at: now() };
  await db.transaction("rw", [db.parties, db.fiscal_year_closes, db.config, db.outbox], async () => {
    await put("fiscal_year_closes", row);
    for (const p of customers) await put("parties", { ...p, opening_balance: customer_balances[p.id] } as Party);
    for (const p of suppliers) await put("parties", { ...p, opening_balance: supplier_balances[p.id] } as Party);
    await put("config", { id: "voucher_lock", value: { date }, updated_at: now() } as any);
  });
  return row;
}

