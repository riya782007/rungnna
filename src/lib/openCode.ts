import { db, getSetting, put } from "./db";
import { requirePerm } from "./scope";

/* The common entrance code is shared through config. It unlocks person selection;
   each person still needs their own PIN or role passcode. It never grants owner
   permissions. Like local PINs, this is a counter convenience lock; someone with
   full access to the device can inspect or alter its local browser data. */

export const DEFAULT_OPEN_CODE = "rungnna 2026";
const KEY = "open_code";

/** "  Rungnna   2026 " and "rungnna 2026" are the same phrase to a tired thumb. */
export const normCode = (s: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");

/** True when what was typed opens the shop. An empty phrase never opens it. */
export function codeMatches(typed: string, saved?: string | null): boolean {
  // spaces carry nothing here: "rungnna2026" is how the owner actually types it
  const bare = (x: string) => normCode(x).replace(/ /g, "");
  const want = bare(saved || DEFAULT_OPEN_CODE);
  const got = bare(typed);
  return !!got && !!want && got === want;
}

export async function getOpenCode(): Promise<string> {
  const shared = (await db.config.get(KEY))?.value?.code;
  // Keep counters upgraded from the earlier device-only setting working until the
  // owner saves a common code. New saves use config and therefore sync to counters.
  return typeof shared === "string" && shared.trim() ? shared : getSetting<string>(KEY, DEFAULT_OPEN_CODE);
}

/** Saving a blank code would lock the shop out of its own counter, so it restores the default. */
export async function setOpenCode(code: string) {
  requirePerm("staff.manage", "changing the shop entry code");
  const v = normCode(code);
  await put("config", { id: KEY, value: { code: v || DEFAULT_OPEN_CODE }, updated_at: "" });
  return v || DEFAULT_OPEN_CODE;
}
