// Item codes from the owner's previous billing software (its "ITEM Information"
// screen), plus the BALI code verified from his sticker photo and decoded QR.
// An old QR carries only the number (e.g. 202~24~12~…); this list turns it into the
// item name on scans, bills, estimates, printed invoices and labels.
// Names the shop has learned/edited in the app always take priority over this list.
// Unit is left blank where the old screen didn't give one, so the product's own unit stays.
const OLD_SOFTWARE_ITEMS: Record<string, string> = {
  "1942": "BANGLE", "227": "BINDI", "201": "BNGL/BRAC", "6492": "BORLA", "13975": "BRACE+RING",
  "180": "BRACELET", "320": "BRIDAL SET", "231": "BROOCH", "19880": "CCCC", "322": "CHAIN",
  "248": "CHAIN LKT", "507": "COMBO", "237": "CROWN", "232": "CUFFLINK", "234": "DISPLAY",
  "782": "DOORI", "2830": "DORI LOCKET", "470": "EAR+TIKKA", "506": "EAR+TIKKA+PASSA", "203": "EARING",
  "228": "EARING/STAND", "5203": "FLOR BRACLT", "5202": "FLOR SET", "5201": "FLOR TIKA", "202": "F-RING",
  "224": "HAIR ACC", "321": "HAIR BAND", "5231": "HAIR BUTON", "225": "HAIR CLIP", "226": "HAIR RUBBER",
  "323": "HATHPHOOL", "333": "H-BAND", "252": "H-CLUTCH", "508": "IM-JWELRY", "7057": "JP ORGNAL",
  "297": "JURA PIN", "235": "KAMARBELT", "326": "KANCHAIN", "851": "KIDS HAIR ACC", "8904": "LOCKET",
  "2362": "MALA", "182": "MANG TIKA", "230": "MANGALSUTRA", "6327": "MASK CHAIN", "556": "MS-CHAIN",
  "7115": "N CHAIN", "236": "NATH", "325": "NOSE", "255": "N-SET", "459": "PASSA",
  "1290": "PAYL-ANKLT", "1217": "PENDANT SET", "6089": "POUCH", "2890": "PUSHER", "7220": "RING+BRACLT",
  "3470": "SAREE GUCHHA", "340": "SIDE PIN", "5553": "SINDOORDANI", "3252": "SISPATI", "7883": "TIE PIN",
  "229": "TIKTAK", "1518": "TOE RING", "949": "TOPS", "233": "TRAY TOPS", "239": "TRAY TOPS 3DOZ",
  "324": "TYARA",
};
const UNITS: Record<string, string> = { "5186": "PAIR", "203": "PAIR" };

export const VERIFIED_ITEM_CODES: Record<string, { name: string; unit: string }> = Object.fromEntries(
  Object.entries({ "5186": "BALI", ...OLD_SOFTWARE_ITEMS }).map(([code, name]) => [code, { name, unit: UNITS[code] || "" }]),
);

/** Old-software code for an item name, when exactly one code carries that name. */
export function verifiedCodeFor(name: string): string {
  const want = name.trim().toUpperCase();
  if (!want) return "";
  const hits = Object.entries(VERIFIED_ITEM_CODES).filter(([, v]) => v.name === want).map(([code]) => code);
  return hits.length === 1 ? hits[0] : "";
}
