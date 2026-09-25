export const rupees = (paise: number) => "₹" + (Math.round(paise) / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 });
export const toPaise = (v: string | number) => { const n = Number(String(v).replace(/[^\d.]/g, "")); return Number.isFinite(n) ? Math.round(n * 100) : 0; };
export const when = (iso: string) => {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) + " · " + d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
};
export const today = () => new Date().toISOString().slice(0, 10);
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
