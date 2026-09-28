import { db, getSetting, setSetting, type Config } from "./db";
import { now } from "./db";

/* ===========================================================================
   Consistent cost-code + price engine.

   The shop's problem: the profit margin is fixed, but staff hand-type the sell
   price and the "secret" cost code onto every label. Two people encode ₹120 two
   different ways, and later nobody can read the cost back. This engine removes
   the human step: enter the COST once, and the SELL PRICE and the ENCRYPTED COST
   CODE are both computed by a fixed, shop-wide rule — so the same cost always
   produces the same code, on every device, forever.

   Two things are derived from cost:
     1. rate (sell price)  = a fixed markup applied to cost, then rounded.
     2. cost_code          = the cost, hidden inside letters/relations, so the
                             owner can read the cost off the shelf but a customer
                             cannot. This is the "950X1PCS / 932UA11" style code.

   Everything is deterministic and pure: pricing(cost, rule) has no randomness,
   no dependence on when or where it runs.
=========================================================================== */

export type RoundTo = 0 | 1 | 5 | 10 | 50 | 100; // rupees to round the sell price to

/* How the sell price is built from the cost. */
export interface MarginRule {
  mode: "multiply" | "divide" | "percent";
  /* multiply: sell = cost * factor            (e.g. 2.5x)
     divide  : sell = cost / factor            (cost quoted after margin already added by vendor)
     percent : sell = cost * (1 + percent/100) (e.g. +150%)  */
  factor: number;          // used by multiply / divide
  percent: number;         // used by percent
  round_to: RoundTo;       // round the sell price to the nearest N rupees (0 = paise-exact)
  round_dir: "nearest" | "up";
}

/* How the cost is encrypted into the human-visible code on the label. */
export interface CodeRule {
  method: "letters" | "shift" | "plain";
  /* letters: each digit 0-9 → a letter of a 10-letter secret key. This is the
              classic jewellery "code word" trick. key must be 10 distinct chars.
              Digit d maps to key[d]. e.g. key "MONEYBAGSX" → 0=M 1=O 2=N …
     shift  : cost is transformed by a reversible maths step (× / +) then written
              as digits, so the number on the label is not the real cost.
     plain  : the cost is written as-is (no hiding) — for shops that don't care. */
  key: string;             // 10 distinct chars, used by "letters"
  mult: number;            // used by "shift": encoded = round(cost_rupees * mult) + add
  add: number;
  prefix: string;          // printed before the code, e.g. "" or "C"
  suffix_pack: boolean;    // append the packing, e.g. "X1PCS" / "X12PCS"
}

export interface PricingRule {
  margin: MarginRule;
  code: CodeRule;
  updated_at?: string;
}

export const DEFAULT_RULE: PricingRule = {
  margin: { mode: "multiply", factor: 2.5, percent: 150, round_to: 5, round_dir: "nearest" },
  // A neutral 10-letter key with no repeats (P R O F I T A B L E → digits 0-9).
  // The owner changes this to their own secret word in Settings — it is the whole
  // secret, so it stays out of git. Digit d maps to key[d].
  code: { method: "letters", key: "PROFITABLE", mult: 1, add: 0, prefix: "", suffix_pack: true },
};

const KEY = "pricing_rule";

/* Shop-wide (synced) so every counter encodes the same way. Falls back to a
   device-local copy if the shop config hasn't loaded yet. */
export async function getRule(): Promise<PricingRule> {
  const c = await db.config.get(KEY);
  if (c?.value) return normalizeRule(c.value);
  const local = await getSetting<PricingRule | null>(KEY, null);
  return normalizeRule(local || DEFAULT_RULE);
}

export async function saveRule(rule: PricingRule) {
  const r = normalizeRule(rule);
  r.updated_at = now();
  // config table syncs to all devices via put(); also keep a device-local copy for instant offline reads.
  const { put } = await import("./db");
  await put("config", { id: KEY, value: r, updated_at: now() } as Config);
  await setSetting(KEY, r);
  return r;
}

/* Guard against a broken key (must be exactly 10 distinct characters for the
   letter cipher) so the engine can never silently produce ambiguous codes. */
export function validateKey(key: string): string | null {
  const k = (key || "").toUpperCase();
  if (k.length !== 10) return "Code word must be exactly 10 letters (one for each digit 0–9).";
  if (new Set(k).size !== 10) return "Every letter in the code word must be different.";
  if (!/^[A-Z]{10}$/.test(k)) return "Use only letters A–Z in the code word.";
  return null;
}

function normalizeRule(r: PricingRule): PricingRule {
  const m = r.margin || DEFAULT_RULE.margin;
  const c = r.code || DEFAULT_RULE.code;
  return {
    margin: {
      mode: m.mode || "multiply",
      factor: Number(m.factor) || 1,
      percent: Number(m.percent) || 0,
      round_to: (m.round_to ?? 5) as RoundTo,
      round_dir: m.round_dir === "up" ? "up" : "nearest",
    },
    code: {
      method: c.method || "letters",
      key: (c.key || DEFAULT_RULE.code.key).toUpperCase(),
      mult: Number(c.mult) || 1,
      add: Number(c.add) || 0,
      prefix: c.prefix || "",
      suffix_pack: c.suffix_pack !== false,
    },
    updated_at: r.updated_at,
  };
}

/* ----------------------------- the maths -------------------------------- */
/* All money in paise, as everywhere else in the app. */

function roundRupees(rupees: number, to: RoundTo, dir: "nearest" | "up"): number {
  if (!to) return Math.round(rupees * 100) / 100;
  const q = rupees / to;
  const n = dir === "up" ? Math.ceil(q) : Math.round(q);
  return n * to;
}

/* Sell price (paise) computed from cost (paise) by the rule. Deterministic. */
export function sellFromCost(costPaise: number, rule: PricingRule): number {
  const cost = costPaise / 100;
  const m = rule.margin;
  let sell: number;
  if (m.mode === "multiply") sell = cost * (m.factor || 1);
  else if (m.mode === "divide") sell = m.factor ? cost / m.factor : cost;
  else sell = cost * (1 + (m.percent || 0) / 100);
  return Math.round(roundRupees(sell, m.round_to, m.round_dir) * 100);
}

/* The encrypted cost code — the same cost ALWAYS gives the same code. */
export function costCode(costPaise: number, rule: PricingRule, pack = 1, type = "PCS"): string {
  const c = rule.code;
  const costRupees = Math.round(costPaise / 100); // codes are on whole rupees, like the shop's current labels
  let core: string;

  if (c.method === "letters") {
    const key = (c.key || DEFAULT_RULE.code.key).toUpperCase();
    // spell each digit of the cost as its keyed letter
    core = String(costRupees).split("").map(d => key[Number(d)] ?? d).join("");
  } else if (c.method === "shift") {
    const shifted = Math.round(costRupees * (c.mult || 1) + (c.add || 0));
    core = String(shifted);
  } else {
    core = String(costRupees);
  }

  let out = (c.prefix || "") + core;
  if (c.suffix_pack) out += `X${pack || 1}${(type || "PCS").toUpperCase()}`;
  return out;
}

/* Read the cost back from a code (owner-only helper — used to verify a shelf tag
   or when reprinting). Returns cost in paise, or null if it can't be read. */
export function decodeCostCode(code: string, rule: PricingRule): number | null {
  const c = rule.code;
  let s = (code || "").toUpperCase().trim();
  if (c.prefix) s = s.startsWith(c.prefix.toUpperCase()) ? s.slice(c.prefix.length) : s;
  s = s.replace(/X\d+[A-Z]+$/i, ""); // drop the X1PCS packing suffix
  if (!s) return null;

  if (c.method === "letters") {
    const key = (c.key || DEFAULT_RULE.code.key).toUpperCase();
    const inv: Record<string, string> = {};
    for (let d = 0; d < 10; d++) inv[key[d]] = String(d);
    let digits = "";
    for (const ch of s) { if (inv[ch] == null) return null; digits += inv[ch]; }
    return digits ? parseInt(digits, 10) * 100 : null;
  }
  if (c.method === "shift") {
    const n = parseInt(s.replace(/\D/g, ""), 10);
    if (Number.isNaN(n)) return null;
    const back = (c.mult || 1) ? (n - (c.add || 0)) / (c.mult || 1) : n;
    return Math.round(back) * 100;
  }
  const n = parseInt(s.replace(/\D/g, ""), 10);
  return Number.isNaN(n) ? null : n * 100;
}

/* One call the UI uses: given a cost, return everything a label needs. */
export function priceFromCost(costPaise: number, rule: PricingRule, pack = 1, type = "PCS") {
  return {
    rate: sellFromCost(costPaise, rule),          // sell price, paise
    cost_code: costCode(costPaise, rule, pack, type), // encrypted code for the label
  };
}
