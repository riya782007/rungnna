/* Money always reads with both paise digits: a tax invoice must say ₹12.50, never ₹12.5.
   (Sticker prices are deliberately different — see labelRate in lib/label-tspl.) */
/* -₹0.25, never ₹-0.25 (the round-off line on every bill used to print the sign after the rupee mark) */
export const rupees = (paise: number) =>
  (Math.round(paise) < 0 ? "-₹" : "₹") + (Math.abs(Math.round(paise)) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/* Customer bills use figures only, as requested by the shop owner; keep the currency in the POS and accounts. */
export const billAmount = (paise: number) => rupees(paise).replace("₹", "");
export const toPaise = (v: string | number) => { const n = Number(String(v).replace(/[^\d.]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export const when = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};
export const today = () => new Date().toISOString().slice(0, 10);
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
