/* GST state codes (as used on GSTINs and e-invoices) and tolerant lookup, so "Delhi", "NCT of Delhi",
   "delhi " and a GSTIN starting 07 all mean the same place when deciding CGST+SGST vs IGST. */
export const GST_STATES: Record<string, string> = {
  "01": "Jammu and Kashmir", "02": "Himachal Pradesh", "03": "Punjab", "04": "Chandigarh", "05": "Uttarakhand", "06": "Haryana",
  "07": "Delhi", "08": "Rajasthan", "09": "Uttar Pradesh", "10": "Bihar", "11": "Sikkim", "12": "Arunachal Pradesh", "13": "Nagaland",
  "14": "Manipur", "15": "Mizoram", "16": "Tripura", "17": "Meghalaya", "18": "Assam", "19": "West Bengal", "20": "Jharkhand",
  "21": "Odisha", "22": "Chhattisgarh", "23": "Madhya Pradesh", "24": "Gujarat", "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra", "29": "Karnataka", "30": "Goa", "31": "Lakshadweep", "32": "Kerala", "33": "Tamil Nadu", "34": "Puducherry",
  "35": "Andaman and Nicobar Islands", "36": "Telangana", "37": "Andhra Pradesh", "38": "Ladakh", "97": "Other Territory",
};
const ALIASES: Record<string, string> = {
  "nct of delhi": "07", "new delhi": "07", "jammu & kashmir": "01", "j&k": "01", "orissa": "21", "uttaranchal": "05", "chattisgarh": "22",
  "pondicherry": "34", "tamilnadu": "33", "telengana": "36", "andhra": "37", "up": "09", "mp": "23", "hp": "02", "uk": "05", "wb": "19",
  "tn": "33", "ap": "37", "mh": "27", "gj": "24", "rj": "08", "hr": "06", "pb": "03", "dl": "07", "ka": "29", "kl": "32", "br": "10",
  "dadra and nagar haveli": "26", "daman and diu": "26", "daman & diu": "26", "andaman & nicobar islands": "35",
};
const norm = (s: string) => s.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const BY_NAME: Record<string, string> = {};
for (const [c, n] of Object.entries(GST_STATES)) BY_NAME[norm(n)] = c;
for (const [a, c] of Object.entries(ALIASES)) BY_NAME[norm(a)] = c;

/** Two-digit GST code from a state name, a two-digit code, or "07-Delhi" style text. "" if unknown. */
export function stateCode(s: string): string {
  const t = (s || "").trim(); if (!t) return "";
  const lead = t.match(/^(\d{2})\b/); if (lead && GST_STATES[lead[1]]) return lead[1];
  return BY_NAME[norm(t)] || "";
}
/** State code carried by a well-formed GSTIN (first two digits), else "". */
export function gstinState(g: string): string {
  const m = (g || "").trim().toUpperCase().match(/^(\d{2})[0-9A-Z]{13}$/);
  return m && GST_STATES[m[1]] ? m[1] : "";
}
/** A party's place of supply: GSTIN prefix wins over the typed state name. */
export const placeCode = (gstin: string, state: string) => gstinState(gstin) || stateCode(state);

/** True when supply is inter-state (IGST). Compares codes when both sides are known, otherwise
    falls back to comparing the typed names; unknown/blank on either side means intra-state. */
export function isInterState(shop: { state: string; gstin?: string }, partyState: string, partyGstin = ""): boolean {
  const a = placeCode(shop.gstin || "", shop.state), b = placeCode(partyGstin, partyState);
  if (a && b) return a !== b;
  const x = norm(shop.state || ""), y = norm(partyState || "");
  return !!(x && y && x !== y);
}
