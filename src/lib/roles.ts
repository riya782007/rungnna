import type { Staff } from "./db";
import { estimateBilling } from "./company-kind";

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
    { key: "estimates.open", label: "Open private estimates (and make estimates)" },
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
    { key: "rates.coded", label: "Set selling rates — cost shown only as code", desc: "for the boy doing rates: he sees the cost code, never the rupees" },
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
  /* Owner, 27 Oct: "search bar option to be allowed or not". Search only ever finds what the person may
     already open, but without this tick there is no search box at all. */
  { key: "search", label: "Search", perms: [
    { key: "search.use", label: "Search bar (Ctrl K)", desc: "finds only the screens, products, customers and bills this person may open" },
  ]},
  { key: "control", label: "Control (sensitive)", perms: [
    { key: "settings.manage", label: "Shop settings", desc: "bills, prices, GST, people's PINs" },
    { key: "printers.manage", label: "Printer & sticker settings", desc: "label size, position, what prints — kept apart from shop settings (owner, 22 Oct)" },
    { key: "staff.manage", label: "Staff, roles & permissions" },
    { key: "ai.use", label: "Ask the shop (AI)" },
    { key: "import.data", label: "Import & bulk changes" },
    { key: "gst.register", label: "E-invoice & e-way bill" },
  ]},
];
export const ALL_PERMS = PERMISSION_GROUPS.flatMap(g => g.perms.map(p => p.key));
/** Kept in a saved role's list when its printer switch is OFF, so it is never mistaken for an older role. */
export const PRINTERS_OFF = "printers.none";
const LABELS = Object.fromEntries(PERMISSION_GROUPS.flatMap(g => g.perms.map(p => [p.key, p.label])));
export const permLabel = (k: string) => LABELS[k] || k;

/* Built-in roles: the app's original rules, written as permissions. Stock work was open to everyone, so it still is. */
const STOCK = ["stock.view", "stock.in", "stock.move", "stock.count", "racks.manage", "stores.transfer", "products.edit", "labels.print", "printers.manage", "catalogue.share"];
const COUNTER = ["billing.sell", "billing.returns", "billing.merge", "customers.manage", "receipts.take", "money.vouchers"];
// the built-in roles always had search; a custom role or a person's own ticks get it only when the owner ticks it
const SEARCH = "search.use";
export const BUILTIN_DEFAULT: Record<Staff["role"], string[]> = {
  owner: ALL_PERMS,
  // a manager already runs suppliers and purchases, so reading a supplier's bill photo belongs here
  manager: [...STOCK, ...COUNTER, SEARCH, "sales.today", "billing.rates", "billing.discount_over", "billing.void", "estimates.delete", "settings.manage", "rates.view", "suppliers.manage", "purchases.photo", "dealers.manage", "ai.use"],
  cashier: [...STOCK, ...COUNTER, SEARCH, "sales.today"],
  salesman: [...STOCK, ...COUNTER, SEARCH],
  helper: [...STOCK, SEARCH],
  packer: [...STOCK, SEARCH],
};
export const ROLE_NOTE: Record<Staff["role"], string> = {
  owner: "All permissions", manager: "Stock, billing, suppliers & settings; no staff or reports",
  cashier: "Stock, billing & today's sales", salesman: "Stock & billing",
  helper: "Stock work only", packer: "Stock work only",
};

export type CustomRole = {
  id: string; name: string; perms: string[]; base: Staff["role"];
  /* As in the reference console, every role has its own passcode. Staff type it on the opening
     screen and are signed in as that role, seeing only what it allows. */
  passcode?: string;
  /* The staff row that passcode signs in as. A new one is made whenever the passcode is
     regenerated and the old row is retired, which signs out every device still using the old
     code (a retired row ends its session, see lib/app). */
  login_id?: string;
};

/* ---------------- role passcodes ---------------- */

/** No 0/O, 1/I/L: the passcode is read out loud across a busy counter and typed on a phone. */
export const PASS_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const PASS_LEN = 6;
/** "abc 23d" and "ABC23D" are the same code to a tired thumb. */
export const normPass = (s: string) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** A fresh passcode that no other role is using. Cryptographic randomness, never Math.random. */
export function newPasscode(taken: Iterable<string> = []): string {
  const used = new Set([...taken].map(normPass));
  const buf = new Uint32Array(PASS_LEN);
  for (let tries = 0; tries < 50; tries++) {
    crypto.getRandomValues(buf);
    const code = Array.from(buf, n => PASS_ALPHABET[n % PASS_ALPHABET.length]).join("");
    if (!used.has(code)) return code;
  }
  throw new Error("Could not make a unique passcode — try again");
}

/** The role a typed passcode opens, if any. Exact length only, so a half-typed code never matches. */
export function roleForPasscode(typed: string, roles: CustomRole[] = ROLES): CustomRole | undefined {
  const code = normPass(typed);
  if (code.length !== PASS_LEN) return undefined;
  return roles.find(r => !!r.passcode && normPass(r.passcode) === code && !!r.login_id);
}

/** A staff row that exists only so a role's passcode can sign in. It is not a person. */
export const isRoleLogin = (s: { login?: string } | null | undefined) => s?.login === "role";
let ROLES: CustomRole[] = [];
/** Called by the app whenever the synced role list changes. */
export function setRolesCache(r: unknown) { ROLES = Array.isArray(r) ? r.filter(x => x && typeof x.id === "string" && Array.isArray(x.perms)) : []; }

/* The owner can change what each built-in role may do (Roles page → Built-in roles → Edit).
   Changes live in config "roles" as { builtin: { salesman: [...] } } and sync like custom roles.
   The owner role always keeps everything. */
let BUILTIN_EDITS: Partial<Record<Staff["role"], string[]>> = {};
export function setBuiltinCache(v: unknown) {
  const out: Partial<Record<Staff["role"], string[]>> = {};
  if (v && typeof v === "object") for (const [k, perms] of Object.entries(v as Record<string, unknown>))
    if (k !== "owner" && k in BUILTIN_DEFAULT && Array.isArray(perms)) out[k as Staff["role"]] = perms.filter(p => typeof p === "string" && ALL_PERMS.includes(p));
  BUILTIN_EDITS = out;
}
export const builtinEdited = (role: Staff["role"]) => role !== "owner" && !!BUILTIN_EDITS[role];
/** What a built-in role grants right now (the owner's edit, or the original default). */
export const BUILTIN: Record<Staff["role"], string[]> = new Proxy(BUILTIN_DEFAULT, {
  get: (base, role: string) => (role !== "owner" && BUILTIN_EDITS[role as Staff["role"]]) || base[role as Staff["role"]],
});
export const customRoles = () => ROLES;

export function permsOf(me: Pick<Staff, "role"> & { role_id?: string; perms?: string[] } | null | undefined): Set<string> {
  if (!me) return new Set();
  if (me.role === "owner") return new Set(ALL_PERMS);
  // the person's own ticks (owner, 23 Oct) come before any role
  if (Array.isArray(me.perms)) return new Set(me.perms.filter(p => ALL_PERMS.includes(p)));
  const custom = me.role_id ? ROLES.find(r => r.id === me.role_id) : undefined;
  // A missing custom role can be a deletion or a partial sync. Never silently grant the
  // broader built-in base while waiting for its permissions to arrive.
  const raw = me.role_id ? custom?.perms || [] : BUILTIN[me.role] || [];
  const out = new Set(raw.filter(p => ALL_PERMS.includes(p)));
  // a role saved before printers had their own switch (22 Oct) keeps the printer settings it could already change
  if (!raw.includes("printers.manage") && !raw.includes(PRINTERS_OFF) && (out.has("labels.print") || out.has("settings.manage"))) out.add("printers.manage");
  return out;
}

/** A retired role login must stop working as soon as the role configuration arrives,
 * even if the retired staff row has not reached this counter yet. */
export function sessionAllowed(staff: Staff | null | undefined, roles: CustomRole[] = ROLES): boolean {
  if (!staff || !staff.active || staff.deleted) return false;
  if (!isRoleLogin(staff)) return true;
  const role = roles.find(r => r.id === staff.role_id);
  return staff.role !== "owner" && !!role?.passcode && role.login_id === staff.id;
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
export const can = (me: (Pick<Staff, "role"> & { role_id?: string; perms?: string[] }) | null | undefined, p: Perm | string) => {
  const set = permsOf(me), key = (LEGACY as Record<string, string>)[p] || p;
  return set.has(key) || estimateBilling(key, k => set.has(k));
};
