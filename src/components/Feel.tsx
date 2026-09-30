import { useEffect, useRef, useState } from "react";
import { rupees } from "../lib/format";

/* A money figure that rolls to its new value (≈0.3 s), like a well-made till display. */
export function Money({ paise, className }: { paise: number; className?: string }) {
  const [shown, setShown] = useState(paise);
  const from = useRef(paise);
  useEffect(() => {
    const a = from.current, z = paise; if (a === z) return;
    const reduce = matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reduce) { from.current = z; setShown(z); return; }
    const t0 = performance.now(), dur = 320; let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      const v = Math.round(a + (z - a) * e); from.current = v; setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [paise]);
  return <b className={className}>{rupees(shown === paise ? paise : Math.round(shown / 100) * 100)}</b>;
}

/* "Saved" moment: a gold ring draws, then fades by itself. Never blocks the counter. */
export function Done({ title, sub, amount, onEnd }: { title: string; sub?: string; amount?: number; onEnd: () => void }) {
  useEffect(() => { const t = setTimeout(onEnd, 1400); return () => clearTimeout(t); }, []);
  return (
    <div className="done" role="status" aria-live="polite">
      <div>
        <svg viewBox="0 0 72 72" aria-hidden>
          <defs><linearGradient id="rjgold" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#E2C37A" /><stop offset="1" stopColor="#A9843A" /></linearGradient></defs>
          <circle cx="36" cy="36" r="32" transform="rotate(-90 36 36)" />
          <path d="M22 37.5l9.5 9.5L51 27.5" />
        </svg>
        <b>{title}</b>
        {amount !== undefined && <span className="amt">{rupees(amount)}</span>}
        {sub && <span className="xs mut mono">{sub}</span>}
      </div>
    </div>
  );
}

/* after a list changes, wash the touched row in gold and bring it into view */
export function flashRow(id: string) {
  requestAnimationFrame(() => {
    const el = document.querySelector<HTMLElement>(`[data-row="${CSS.escape(id)}"]`);
    if (!el) return;
    el.classList.remove("landed"); void el.offsetWidth; el.classList.add("landed");
    el.scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
}
