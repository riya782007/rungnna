/* Light for daylight counters, Night for dim shops and late billing; Auto follows the device. */
import { useEffect, useState } from "react";

export type Theme = "auto" | "light" | "dark";
const KEY = "rj_theme";
const mq = typeof matchMedia !== "undefined" ? matchMedia("(prefers-color-scheme: dark)") : null;

export function getTheme(): Theme {
  try { const t = localStorage.getItem(KEY); return t === "light" || t === "dark" ? t : "auto"; } catch { return "auto"; }
}
function apply(t: Theme) {
  const dark = t === "dark" || (t === "auto" && !!mq?.matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#0E0D10" : "#F6F4EF");
}
const subs = new Set<(t: Theme) => void>();
export function setTheme(t: Theme) {
  try { t === "auto" ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, t); } catch { /* private mode */ }
  apply(t); subs.forEach(f => f(t));
}
export function startTheme() {
  apply(getTheme());
  mq?.addEventListener?.("change", () => getTheme() === "auto" && apply("auto"));
}
export function useTheme(): [Theme, (t: Theme) => void] {
  const [t, set] = useState(getTheme());
  useEffect(() => { subs.add(set); return () => { subs.delete(set); }; }, []);
  return [t, setTheme];
}
