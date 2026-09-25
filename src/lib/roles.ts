import type { Staff } from "./db";

/* Who may do what. Kept deliberately short: a shop floor needs a few clear rules, not a matrix. */
export type Perm = "bill" | "sales" | "void" | "settings" | "staff" | "rates" | "discount" | "ai";
const R: Record<Staff["role"], Perm[]> = {
  owner: ["bill", "sales", "void", "settings", "staff", "rates", "discount", "ai"],
  manager: ["bill", "sales", "void", "settings", "rates", "discount", "ai"],
  cashier: ["bill", "sales"],
  salesman: ["bill"],
  helper: [],
  packer: [],
};
export const can = (me: Staff | null | undefined, p: Perm) => !!me && (R[me.role] || []).includes(p);
export const ROLE_NOTE: Record<Staff["role"], string> = {
  owner: "Everything", manager: "Everything except staff", cashier: "Billing + today's sales",
  salesman: "Billing only", helper: "Stock work only", packer: "Stock work only",
};
