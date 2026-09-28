import { useEffect, useRef, useState } from "react";

/* ===========================================================================
   Zero-dependency chart kit for the dashboard.

   No charting library (the app is offline-first and the npm registry is not
   available at build time here). Everything is plain SVG + CSS keyframes, using
   the app's design tokens. The global `prefers-reduced-motion` rule in
   styles.css already tames every animation for people who ask for less motion.
=========================================================================== */

/* Count-up number. Animates from 0 to `value` once on mount and whenever value
   changes. `format` turns the running number into the display string (money,
   plain, etc.). Uses requestAnimationFrame with an ease-out curve. */
export function AnimatedNumber({ value, format, duration = 900, className }: {
  value: number; format?: (n: number) => string; duration?: number; className?: string;
}) {
  const [n, setN] = useState(0);
  const from = useRef(0);
  const raf = useRef(0);
  useEffect(() => {
    const start = performance.now();
    const a = from.current, b = value;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // ease-out cubic
      setN(a + (b - a) * eased);
      if (p < 1) raf.current = requestAnimationFrame(tick);
      else from.current = b;
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [value, duration]);
  const fmt = format || ((x: number) => Math.round(x).toLocaleString("en-IN"));
  return <span className={className}>{fmt(n)}</span>;
}

/* Vertical bar chart. Bars grow up on entrance (staggered) and show their value
   on hover. `accent` picks the CSS var for the fill. */
export function BarChart({ data, format, height = 150, accent = "var(--gold)" }: {
  data: { label: string; value: number; hint?: string }[];
  format?: (n: number) => string; height?: number; accent?: string;
}) {
  const max = Math.max(1, ...data.map(d => d.value));
  const fmt = format || ((x: number) => Math.round(x).toLocaleString("en-IN"));
  return (
    <div className="chart-bars" style={{ height }}>
      {data.map((d, i) => {
        const h = d.value > 0 ? Math.max(3, (d.value / max) * 100) : 0;
        return (
          <div key={d.label + i} className="chart-bar-col" title={`${d.label}: ${fmt(d.value)}`}>
            <span className="chart-bar-val">{d.value > 0 ? fmt(d.value) : ""}</span>
            <div className="chart-bar-track">
              <div className="chart-bar" style={{ height: h + "%", background: accent, animationDelay: (i * 45) + "ms" }} />
            </div>
            <span className="chart-bar-label">{d.label}</span>
          </div>
        );
      })}
    </div>
  );
}

/* Donut / ring chart. Segments draw in with an animated stroke. `size` is the
   diameter in px. Renders a legend beside it via the caller. Centre shows total
   or a custom node. */
export type DonutSlice = { label: string; value: number; color: string };
export function Donut({ slices, size = 132, thickness = 16, center }: {
  slices: DonutSlice[]; size?: number; thickness?: number; center?: React.ReactNode;
}) {
  const total = slices.reduce((a, s) => a + Math.max(0, s.value), 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={thickness} />
        {total > 0 && slices.map((s, i) => {
          const frac = Math.max(0, s.value) / total;
          const len = frac * c;
          const seg = (
            <circle key={s.label + i} cx={size / 2} cy={size / 2} r={r} fill="none"
              stroke={s.color} strokeWidth={thickness} strokeLinecap="butt"
              strokeDasharray={`${len} ${c - len}`} strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
              className="donut-seg" style={{ animationDelay: (i * 90) + "ms" }} />
          );
          offset += len;
          return seg;
        })}
      </svg>
      {center != null && <div className="donut-center">{center}</div>}
    </div>
  );
}

/* Smooth area sparkline for a trend (e.g. sales over 14 days). */
export function Sparkline({ points, width = 260, height = 56, color = "var(--ok)" }: {
  points: number[]; width?: number; height?: number; color?: string;
}) {
  if (points.length < 2) return <div className="spark-empty" style={{ height }} />;
  const max = Math.max(1, ...points), min = Math.min(...points);
  const span = max - min || 1;
  const stepX = width / (points.length - 1);
  const y = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  const line = points.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const gid = "sg" + Math.round(width) + points.length;
  return (
    <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="spark">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <path d={line} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" className="spark-line" />
    </svg>
  );
}
