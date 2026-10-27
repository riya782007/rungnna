import { can } from "./roles";
import type { Staff } from "./db";

/* What each screen needs (lib/roles). A tab you can't use is not shown, and search never offers it.
   Kept here (not in App.tsx) so the menu and the search read the same list. */
export const ROUTE_PERM: Record<string, string> = {
  bill: "billing.sell", bills: "billing.sell", customers: "customers.manage", suppliers: "suppliers.manage", vouchers: "money.vouchers",
  reports: "reports.view", ask: "ai.use", scan: "stock.in", stockin: "stock.in", recheck: "stock.count", rfid: "stock.count",
  labels: "labels.print", catalogue: "catalogue.share", photos: "catalogue.share", racks: "racks.manage", move: "stock.move", products: "stock.view", product: "stock.view",
  activity: "stock.view", add: "products.edit", dealers: "dealers.manage", import: "import.data", bank: "bank.reconcile", stores: "stores.transfer", roles: "staff.manage",
  settings: "settings.manage", purchase: "purchases.photo",
};

/** May this person open this screen? Settings always opens (a person's own language, PIN and lock). */
export const routeOk = (me: Staff | null | undefined, route: string) =>
  route === "settings" || !ROUTE_PERM[route] || can(me, ROUTE_PERM[route]);
