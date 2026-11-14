/* Numbers said out loud, in English, Hindi or Hinglish (owner's list R-186 … R-190):
   "count forty five", "pachas", "sau piece", "dedh sau", "45", "ek sau bees" → 45, 50, 100, 150, 45, 120. */
const HI: Record<string, number> = {
  shunya: 0, zero: 0, ek: 1, do: 2, teen: 3, tin: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, che: 6, chah: 6, chhah: 6, saat: 7, sat: 7, aath: 8, ath: 8, nau: 9, das: 10, dus: 10,
  gyarah: 11, gyara: 11, barah: 12, bara: 12, terah: 13, tera: 13, chaudah: 14, chauda: 14, pandrah: 15, pandra: 15, solah: 16, sola: 16, satrah: 17, satra: 17, atharah: 18, athara: 18, unnis: 19, unees: 19,
  bees: 20, bis: 20, ikkis: 21, ikkees: 21, bais: 22, baees: 22, teis: 23, tees: 30, tis: 30, chaubis: 24, pachis: 25, pachchis: 25, chhabbis: 26, sattais: 27, atthais: 28, untis: 29, unatis: 29,
  ikattis: 31, battis: 32, taintis: 33, chautis: 34, paintis: 35, paitis: 35, chhattis: 36, saintis: 37, adtis: 38, untalis: 39, chalis: 40, chaalis: 40, iktalis: 41, bayalis: 42, taitalis: 43, chavalis: 44, paintalis: 45, chhiyalis: 46, saintalis: 47, adtalis: 48, unchas: 49,
  pachas: 50, pachaas: 50, ikyavan: 51, bavan: 52, tirpan: 53, chauvan: 54, pachpan: 55, chhappan: 56, sattavan: 57, attavan: 58, unsath: 59, saath: 60, sath: 60, ikshath: 61, basath: 62, tirsath: 63, chausath: 64, painsath: 65, chhiyasath: 66, sadsath: 67, adsath: 68, unhattar: 69,
  sattar: 70, ikhattar: 71, bahattar: 72, tihattar: 73, chauhattar: 74, pachhattar: 75, chhihattar: 76, sathattar: 77, athattar: 78, unasi: 79, assi: 80, ikyasi: 81, bayasi: 82, tirasi: 83, chaurasi: 84, pachasi: 85, chhiyasi: 86, sattasi: 87, atthasi: 88, navasi: 89,
  nabbe: 90, ikyanve: 91, banve: 92, tiranve: 93, chauranve: 94, pachanve: 95, chhiyanve: 96, sattanve: 97, atthanve: 98, ninyanve: 99,
};
const EN: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
  twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const DEV: Record<string, string> = { "०": "0", "१": "1", "२": "2", "३": "3", "४": "4", "५": "5", "६": "6", "७": "7", "८": "8", "९": "9" };
const HI_SCRIPT: Record<string, string> = { "एक": "ek", "दो": "do", "तीन": "teen", "चार": "char", "पांच": "paanch", "पाँच": "paanch", "छह": "chhah", "छः": "chhah", "सात": "saat", "आठ": "aath", "नौ": "nau", "दस": "das", "बीस": "bees", "तीस": "tees", "चालीस": "chalis", "पचास": "pachas", "साठ": "saath", "सत्तर": "sattar", "अस्सी": "assi", "नब्बे": "nabbe", "सौ": "sau", "हज़ार": "hazar", "हजार": "hazar", "डेढ़": "dedh", "ढाई": "dhai", "पच्चीस": "pachis", "पैंतालीस": "paintalis", "पैंतीस": "paintis", "बारह": "barah", "पंद्रह": "pandrah" };

/** The number in what was said, or null. Digits win if present ("count 45"). */
export function spokenNumber(text: string): number | null {
  let t = (text || "").toLowerCase().replace(/[०-९]/g, d => DEV[d]);
  for (const [k, v] of Object.entries(HI_SCRIPT)) t = t.split(k).join(" " + v + " ");
  const dig = t.replace(/(\d),(\d)/g, "$1$2").match(/\d+(\.\d+)?/);
  if (dig) return Number(dig[0]);
  const words = t.replace(/[^a-z.\s-]/g, " ").split(/[\s-]+/).filter(Boolean);
  // the first run of number words is the number: "das piece bhej do" is 10, not 10 + 2
  let total = 0, cur = 0, seen = false;
  for (const w of words) {
    const isNum = w in HI || w in EN || ["dedh", "dhai", "dhaai", "sava", "sau", "hundred", "hazar", "hazaar", "thousand", "dozen", "darjan", "darjen"].includes(w) || (seen && (w === "and" || w === "aur"));
    if (!isNum) { if (seen) break; continue; }
    seen = true;
    if (w === "dedh") cur += 1.5;
    else if (w === "dhai" || w === "dhaai") cur += 2.5;
    else if (w === "sava") cur += 1.25;
    else if (w === "sau" || w === "hundred") cur = (cur || 1) * 100;
    else if (w === "hazar" || w === "hazaar" || w === "thousand") { total += (cur || 1) * 1000; cur = 0; }
    else if (w === "dozen" || w === "darjan" || w === "darjen") cur = (cur || 1) * 12;
    else if (w !== "and" && w !== "aur") cur += HI[w] ?? EN[w];
  }
  return seen ? Math.round((total + cur) * 100) / 100 : null;
}

/** "send 10 boxes of RU1023 to floor 1" / "RU1023 das piece floor do bhejo" → its parts. */
export function spokenRequest(text: string, codes: string[] = []): { qty: number | null; code: string; floor: string } {
  const t = (text || "").replace(/[०-९]/g, d => DEV[d]);
  const floor = (t.match(/(?:floor|flor|manzil|मंज़िल|फ्लोर)\s*(?:no\.?\s*)?(\w+)/i)?.[1] || "").toLowerCase();
  const fl = !floor ? "" : floor === "ground" || floor === "g" ? "G" : String(spokenNumber(floor) ?? floor).toUpperCase();
  const compact = t.toUpperCase().replace(/[\s-]/g, "");
  let code = [...codes].map(c => c.toUpperCase()).filter(c => c.length >= 3 && compact.includes(c.replace(/[\s-]/g, ""))).sort((a, z) => z.length - a.length)[0] || "";
  if (!code) code = (t.match(/\b([A-Za-z]{1,4}-?\d{2,6}[A-Za-z]?)\b/)?.[1] || "").replace("-", "").toUpperCase();
  // the number is what is left once the code and the floor are taken out
  let rest = t.replace(/(?:floor|flor|manzil|मंज़िल|फ्लोर)\s*(?:no\.?\s*)?\w+/i, " ");
  if (code) rest = rest.replace(new RegExp(code.split("").map(ch => ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[\\s-]?"), "i"), " ");
  return { qty: spokenNumber(rest), code, floor: fl };
}

/** Speech to text in the browser when it can (Chrome, phone); null where it can't (Windows app). */
export function browserListen(lang = "hi-IN"): Promise<string> | null {
  const SR = (globalThis as any).SpeechRecognition || (globalThis as any).webkitSpeechRecognition;
  if (!SR || (globalThis as any).rungnnaDesktop) return null;
  return new Promise((res, rej) => {
    const r = new SR(); r.lang = lang; r.interimResults = false; r.maxAlternatives = 3;
    r.onresult = (e: any) => res(Array.from(e.results[0]).map((a: any) => a.transcript).join(" | "));
    r.onerror = (e: any) => rej(new Error(e.error === "not-allowed" ? "Microphone not allowed" : "Didn't catch that"));
    r.onend = () => res("");
    r.start();
  });
}
