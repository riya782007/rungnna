import type { Staff } from "./db";

/* ===========================================================================
   Roles & permissions — granular, grouped, like the reference console:
   a role grants exactly what that person may do (e.g. a packer who can move
   stock but never cancel a bill). The owner always has everything.

   Every person keeps their PIN login. They get either a built-in role
   (owner / manager / cashier / salesman / helper / packer — which keep the
   app's original behaviour) or a custom role the owner makes on the Roles page.
   Custom roles are stored in config "roles" and sync to every counter.

   Checks happen on the device (the shop runs offline). They decide what a
   person sees and can press; the cloud login is still the shop's single account.
=========================================================================== */

export type PermDef = { key: string; label: string; desc?: string };
/* The permissions that move money, erase a trail, or hand over the shop. The Roles page flags
   these so the owner never grants one by skimming a long list of checkboxes.
   Recording an expense (money.vouchers) is deliberately NOT here: packing, labour and tea are
   daily counter work in this shop, and flagging routine things makes the flag mean nothing. */
export const SENSITIVE = new Set(["billing.void", "billing.discount_over", "billing.rates", "estimates.delete",
  "rates.view", "settings.manage", "staff.manage", "import.data", "gst.register", "bank.reconcile"]);
export const isSensitive = (k: string) => SENSITIVE.has(k);
export type PermGroup = { key: string; label: string; perms: PermDef[] };

export const PERMISSION_GROUPS: PermGroup[] = [
  { key: "billing", label: "Billing & counter", perms: [
    { key: "billing.sell", label: "Make bills", desc: "GST invoice, delivery challan, hold & resume" },
    { key: "billing.rates", label: "Change rates on a bill" },
    { key: "billing.discount_over", label: "Discount above the shop limit", desc: "also approves someone else's with their PIN" },
    { key: "billing.void", label: "Cancel saved bills", desc: "the sensitive one" },
    { key: "billing.returns", label: "Sales returns / credit notes" },
    { key: "billing.merge", label: "Merge, split & convert bills" },
  ]},
  { key: "estimates", label: "Private estimates", perms: [
    { key: "estimates.open", label: "Open private estimates" },
    { key: "estimates.delete", label: "Delete estimates for good" },
  ]},
  { key: "sales", label: "Sales & customers", perms: [
    { key: "sales.today", label: "See today's sales" },
    { key: "reports.view", label: "Reports & GST returns" },
    { key: "customers.manage", label: "Customers & khata", desc: "add / edit customers, see dues" },
    { key: "receipts.take", label: "Take customer payments" },
  ]},
  { key: "stock", label: "Stock & racks", perms: [
    { key: "stock.view", label: "See stock & activity" },
    { key: "stock.in", label: "Stock in / scan new pieces" },
    { key: "stock.move", label: "Move pieces between racks" },
    { key: "stock.count", label: "Recheck & RFID counting" },
    { key: "racks.manage", label: "Racks & rack stickers" },
    { key: "stores.transfer", label: "Transfers between stores" },
  ]},
  { key: "products", label: "Products & labels", perms: [
    { key: "products.edit", label: "Add / edit products" },
    { key: "rates.view", label: "See cost & set selling rates", desc: "cost codes, purchase cost, margins" },
    { key: "labels.print", label: "Print labels" },
  ]},
  { key: "purchases", label: "Purchases & suppliers", perms: [
    { key: "suppliers.manage", label: "Suppliers, purchases & supplier payments" },
    { key: "purchases.photo", label: "Read purchase bill photos (AI)" },
  ]},
  { key: "online", label: "Catalogue & trade portal", perms: [
    { key: "catalogue.share", label: "Publish & share the catalogue" },
    { key: "dealers.manage", label: "Approve dealers & handle trade orders" },
  ]},
  { key: "money", label: "Money", perms: [
    { key: "money.vouchers", label: "Expenses & vouchers" },
    { key: "bank.reconcile", label: "Bank reconciliation" },
  ]},
  { key: "control", label: "Control (sensitive)", perms: [
    { key: "settings.manage", label: "Shop settings & printers" },
    { key: "staff.manage", label: "Staff, roles & permissions" },
    { key: "ai.use", label: "Ask the shop (AI)" },
    { key: "import.data", label: "Import & bulk changes" },
    { key: "gst.register", label: "E-invoice & e-way bill" },
  ]},
];
export const ALL_PERMS = PERMISSION_GROUPS.flatMap(g => g.perms.map(p => p.key));
const LABELS = Object.fromEntries(PERMISSION_GROUPS.flatMap(g => g.perms.map(p => [p.key, p.label])));
export const permLabel = (k: string) => LABELS[k] || k;

/* Built-in roles: the app's original rules, written as permissions. Stock work was open to everyone, so it still is. */
const STOCK = ["stock.view", "stock.in", "stock.move", "stock.count", "racks.manage", "stores.transfer", "products.edit", "labels.print", "catalogue.share"];
const COUNTER = ["billing.sell", "billing.returns", "billing.merge", "customers.manage", "receipts.take", "money.vouchers"];
export const BUILTIN: Record<Staff["role"], string[]> = {
  owner: ALL_PERMS,
  // a manager already runs suppliers and purchases, so reading a supplier's bill photo belongs here
  manager: [...STOCK, ...COUNTER, "sales.today", "billing.rates", "billing.discount_over", "billing.void", "estimates.delete", "settings.manage", "rates.view", "suppliers.manage", "purchases.photo", "dealers.manage", "ai.use"],
  cashier: [...STOCK, ...COUNTER, "sales.today"],
  salesman: [...STOCK, ...COUNTER],
  helper: [...STOCK],
  packer: [...STOCK],
};
export const ROLE_NOTE: Record<Staff["role"], string> = {
  owner: "Everything", manager: "Everything except staff", cashier: "Billing + today's sales",
  salesman: "Billing only", helper: "Stock work only", packer: "Stock work only",
};

export type CustomRole = { id: string; name: string; perms: string[]; base: Staff["role"] };
let ROLES: CustomRole[] = [];
/** Called by the app whenever the synced role list changes. */
export function setRolesCache(r: unknown) { ROLES = Array.isArray(r) ? r.filter(x => x && typeof x.id === "string" && Array.isArray(x.perms)) : []; }
export const customRoles = () => ROLES;

export function permsOf(me: Pick<Staff, "role"> & { role_id?: string } | null | undefined): Set<string> {
  if (!me) return new Set();
  if (me.role === "owner") return new Set(ALL_PERMS);
  const custom = me.role_id ? ROLES.find(r => r.id === me.role_id) : undefined;
  return new Set((custom ? custom.perms : BUILTIN[me.role] || []).filter(p => ALL_PERMS.includes(p)));
}
export const roleName = (me: Pick<Staff, "role"> & { role_id?: string } | null | undefined) =>
  !me ? "" : me.role === "owner" ? "owner" : (me.role_id && ROLES.find(r => r.id === me.role_id)?.name) || me.role;

/* The original short checks, kept so every existing screen works unchanged; each maps to its permission. */
export type Perm = "bill" | "sales" | "void" | "settings" | "staff" | "rates" | "discount" | "ai" | "reports" | "lock";
const LEGACY: Record<Perm, string> = {
  bill: "billing.sell", sales: "sales.today", void: "billing.void", settings: "settings.manage", staff: "staff.manage",
  rates: "rates.view", discount: "billing.discount_over", ai: "ai.use", reports: "reports.view", lock: "estimates.open",
};
/** can(me, "bill") (original names) or can(me, "stock.move") (any permission key). */
export const can = (me: (Pick<Staff, "role"> & { role_id?: string }) | null | undefined, p: Perm | string) =>
  permsOf(me).has((LEGACY as Record<string, string>)[p] || p);
