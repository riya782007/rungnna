import { db, getSetting, setSetting, type Config } from "./db";
import { now } from "./db";
import { requirePerm, currentStore, MAIN_STORE } from "./scope";

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
  method: "letters" | "shift" | "shift_letters" | "plain";
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
  /** sticker rates are whole even rupees (975 → 976) so half, the wholesale rate, has no paise. On unless the owner turns it off. */
  even_rate?: boolean;
  /** retail rate = sticker rate + this % (owner, 22 Oct: "I can't find the formula for the retail rate"). 0 = the sticker rate itself. */
  retail_pct?: number;
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
/* Owner, 23 Oct: the GST company's profit margin is kept apart from the estimate company's. Each company other
   than the main one has its own rule ("pricing_rule@<company>"); until one is saved it uses the main rule. */
const keyFor = (store = currentStore()) => (store && store !== MAIN_STORE ? `${KEY}@${store}` : KEY);
export async function getRule(): Promise<PricingRule> {
  const c = (await db.config.get(keyFor())) || await db.config.get(KEY);
  const r = c?.value ? normalizeRule(c.value) : normalizeRule((await getSetting<PricingRule | null>(KEY, null)) || DEFAULT_RULE);
  evenOn = r.even_rate !== false;
  return r;
}

export async function saveRule(rule: PricingRule) {
  requirePerm("settings.manage", "changing the pricing rule");
  const r = normalizeRule(rule);
  r.updated_at = now();
  // config table syncs to all devices via put(); also keep a device-local copy for instant offline reads.
  const { put } = await import("./db");
  await put("config", { id: keyFor(), value: r, updated_at: now() } as Config);
  if (keyFor() === KEY) await setSetting(KEY, r);
  evenOn = r.even_rate !== false;
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
    even_rate: r.even_rate !== false,
    retail_pct: Math.max(0, Number(r.retail_pct) || 0),
    updated_at: r.updated_at,
  };
}

/* ----------------------------- the maths -------------------------------- */
/** Retail rate from the sticker (wholesale) rate: + the shop's retail %, rounded the shop's way. 0 when no % is set. */
export function retailFromRate(ratePaise: number, rule: PricingRule): number {
  const pct = rule.retail_pct || 0;
  if (!(ratePaise > 0) || !pct) return 0;
  return Math.round(roundRupees(ratePaise / 100 * (1 + pct / 100), rule.margin.round_to || 1, "up") * 100);
}

/* All money in paise, as everywhere else in the app. */

function roundRupees(rupees: number, to: RoundTo, dir: "nearest" | "up"): number {
  if (!to) return Math.round(rupees * 100) / 100;
  const q = rupees / to;
  const n = dir === "up" ? Math.ceil(q) : Math.round(q);
  return n * to;
}

/* Sell price (paise) computed from cost (paise) by the rule. Deterministic. */
/* Shop rule (owner, 18 Oct): the rate on a label is always an EVEN number of whole rupees. Half of it is the
   wholesale rate, and "975" would make that ₹37.50: so 75 → 76, 24.50 → 26 (up to the next even rupee). */
/* The owner can turn it off in Settings → Prices & stickers; then a rate is printed exactly as worked out. */
let evenOn = true;
export const evenRatesOn = () => evenOn;
export function evenRate(paise: number): number {
  if (!(paise > 0)) return 0;
  if (!evenOn) return Math.round(paise);
  const r = Math.ceil(Math.round(paise) / 100);
  return (r % 2 ? r + 1 : r) * 100;
}
/** Settings' worked example: each step from cost to the sticker rate (all paise). */
export function priceSteps(costPaise: number, rule: PricingRule) {
  const cost = costPaise / 100, m = rule.margin;
  const raw = m.mode === "multiply" ? cost * (m.factor || 1) : m.mode === "divide" ? (m.factor ? cost / m.factor : cost) : cost * (1 + (m.percent || 0) / 100);
  const rounded = Math.round(roundRupees(raw, m.round_to, m.round_dir) * 100);
  const even = rule.even_rate !== false;
  const r = Math.ceil(rounded / 100);
  return { raw: Math.round(raw * 100), rounded, final: !(rounded > 0) ? 0 : even ? (r % 2 ? r + 1 : r) * 100 : rounded };
}

export function sellFromCost(costPaise: number, rule: PricingRule): number {
  return priceSteps(costPaise, rule).final;
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
  } else if (c.method === "shift" || c.method === "shift_letters") {
    const shifted = Math.round(costRupees * (c.mult || 1) + (c.add || 0));
    // shift_letters (owner, 22 Oct: "double the number, then the code letters"): the shifted number spelt in the code word
    const key = (c.key || DEFAULT_RULE.code.key).toUpperCase();
    core = c.method === "shift" ? String(shifted) : String(shifted).split("").map(d => key[Number(d)] ?? d).join("");
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
  if (c.method === "shift_letters") {
    const key = (c.key || DEFAULT_RULE.code.key).toUpperCase();
    let digits = "";
    for (const ch of s) { const d = key.indexOf(ch); if (d < 0) return null; digits += d; }
    if (!digits) return null;
    return Math.round((parseInt(digits, 10) - (c.add || 0)) / (c.mult || 1)) * 100;
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
