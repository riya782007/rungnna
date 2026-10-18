import { getSetting, setSetting } from "./db";

/* ===========================================================================
   The passcode that opens the app on a counter.

   The old opening screen asked for a cloud email + password AND then a person
   AND then that person's PIN, before anyone could sell anything. On a counter in
   Sadar Bazar at 11am that is three walls in front of the first bill. Now one
   phrase opens it, and everything else is still there behind "Use a different
   person" and in Settings.

   This is a shop-floor convenience lock, in the same tier as the staff PINs —
   it keeps a passer-by out of the till, it is not a secret against an attacker
   who has the device. Anything that genuinely must be guarded (cancelling a
   bill, deleting estimates, cost prices) is gated by role permissions, which
   this does not touch.
=========================================================================== */

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

export const getOpenCode = () => getSetting<string>(KEY, DEFAULT_OPEN_CODE);

/** Saving a blank code would lock the shop out of its own counter, so it restores the default. */
export async function setOpenCode(code: string) {
  const v = normCode(code);
  await setSetting(KEY, v || DEFAULT_OPEN_CODE);
  return v || DEFAULT_OPEN_CODE;
}
