import { getSetting, setSetting } from "./db";

export type Lang = "en" | "hi";
let current: Lang = "en";
const subs = new Set<(l: Lang) => void>();

const HI: Record<string, string> = {
  Home: "घर",
  Sell: "बिक्री",
  Stock: "स्टॉक",
  Reports: "रिपोर्ट",
  Settings: "सेटिंग",
  "New bill": "नया बिल",
  Bills: "बिल",
  Customers: "ग्राहक",
  Suppliers: "सप्लायर",
  Products: "माल",
  "Stock in": "स्टॉक इन",
  Import: "इम्पोर्ट",
  "Tax invoice": "टैक्स इनवॉइस",
  Estimate: "एस्टीमेट",
  "Delivery challan": "चालान",
  Total: "कुल",
  Balance: "बाकी",
  "Balance due": "बाकी रकम",
  Paid: "भुगतान",
  "Receive payment": "पेमेंट लें",
  "Pay supplier": "सप्लायर को भुगतान",
  Expense: "खर्च",
  Journal: "जर्नल",
  Payment: "पेमेंट",
  Receipt: "रसीद",
  Save: "सेव",
  Print: "प्रिंट",
  Share: "शेयर",
  "Language": "भाषा",
};

export const t = (s: string) => current === "hi" ? HI[s] || s : s;
export const lang = () => current;
export async function initLang() { current = await getSetting<Lang>("language", "en"); return current; }
export async function setLang(l: Lang) { current = l; await setSetting("language", l); subs.forEach(f => f(l)); }
export function onLang(f: (l: Lang) => void) { subs.add(f); f(current); return () => subs.delete(f); }

