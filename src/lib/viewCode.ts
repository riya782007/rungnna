import { useEffect, useState } from "react";
import { db, put, now, type Config } from "./db";

/* Owner, 23 Oct: "to see reports, sales, activity and stock, make it a 777 code which the owner can change".
   Everyone except the owner types it once per sign-in to open those screens. Stored hashed, shared by every
   counter; "777" until the owner sets another. */
const KEY = "view_code";
export const VIEW_ROUTES = ["reports", "bills", "activity", "products", "product"];
type Cfg = { salt: string; hash: string };
async function sha(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
}
export async function viewCodeMatches(code: string) {
  const c = (await db.config.get(KEY))?.value as Cfg | undefined;
  if (!c?.hash) return code.trim() === "777";
  return (await sha(c.salt + code.trim())) === c.hash;
}
export async function setViewCode(code: string) {
  if (!/^\d{3,8}$/.test(code.trim())) throw new Error("Use 3 to 8 digits");
  const salt = crypto.getRandomValues(new Uint32Array(4)).join("-");
  await put("config", { id: KEY, value: { salt, hash: await sha(salt + code.trim()) }, updated_at: now() } as Config);
}

let open = false;
const subs = new Set<(v: boolean) => void>();
export function setViewOpen(v: boolean) { open = v; subs.forEach(f => f(v)); }
export function useViewOpen() {
  const [v, setV] = useState(open);
  useEffect(() => { subs.add(setV); return () => { subs.delete(setV); }; }, []);
  return v;
}
