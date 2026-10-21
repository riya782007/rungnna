import { useState } from "react";
import { getSetting, setSetting } from "../lib/db";
import { DEFAULT_LABEL_DENSITY } from "../lib/label-darkness";
import type { LabelCfg } from "../pages/Labels";

/* ===========================================================================
   The sticker settings he actually changes, on the print screen itself.

   Owner, 21 Oct (voice note): going to Labels › Printer settings again and again while printing a bill
   wasted his time — and the cloud log shows the same bill saved twice that evening (bill no. given a
   trailing "/") just to print its stickers again after a settings change. These are the everyday ones:
   what is printed on the sticker, where it sits, how big the words are, how dark. Each tap is saved on
   this computer at once and the preview above the Approve button shows it straight away. Size, paper,
   printer and the rest stay on the Labels page ("All printer settings").
=========================================================================== */

const FIELDS: [keyof LabelCfg["show"], string][] = [
  ["style", "Style"], ["color", "Colour"], ["cost_code", "Cost code"], ["line", "Line no."],
  ["rate", "Rate"], ["qty", "X qty"], ["shop", "RUNGNNA"],
];

/** Save a change to this computer's sticker settings (merged into what is saved, so nothing else changes). */
export async function saveLabelPatch(base: LabelCfg, patch: Partial<LabelCfg>): Promise<LabelCfg> {
  const saved = await getSetting<Partial<LabelCfg> | null>("label_cfg", null);
  const next = { ...base, ...(saved || {}), ...patch, show: { ...base.show, ...(saved?.show || {}), ...(patch.show || {}) } } as LabelCfg;
  await setSetting("label_cfg", next);
  return next;
}

export function StickerQuickBar({ cfg, onChange }: { cfg: LabelCfg; onChange?: (c: LabelCfg) => void }) {
  const [tick, setTick] = useState("");
  const apply = async (patch: Partial<LabelCfg>, what: string) => {
    const next = await saveLabelPatch(cfg, patch);
    onChange?.(next);
    setTick(what);
    window.setTimeout(() => setTick(t => (t === what ? "" : t)), 2500);
  };
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const step = (key: "offX" | "offY" | "font", d: number, what: string, min = -20, max = 20) =>
    apply({ [key]: Math.max(min, Math.min(max, r2((Number(cfg[key]) || 0) + d))) } as Partial<LabelCfg>, what);
  const direct = cfg.output === "qz" || cfg.output === "tspl";
  const dark = cfg.density ?? DEFAULT_LABEL_DENSITY;
  return (
    <div className="sticker-quick" aria-label="Sticker settings">
      <div className="sq-row">
        <span className="sq-h">On the sticker</span>
        {FIELDS.map(([k, label]) => (
          <button key={k} type="button" className="chip" aria-pressed={!!cfg.show[k]}
            onClick={() => void apply({ show: { ...cfg.show, [k]: !cfg.show[k] } }, `${label} ${cfg.show[k] ? "off" : "on"}`)}>{label}</button>))}
      </div>
      <div className="sq-row">
        <span className="sq-h">Position</span>
        <span className="sq-pair"><button type="button" className="btn sm" title="Move the print left" onClick={() => void step("offX", -0.25, "Moved left")}>←</button>
          <span className="mono xs">{cfg.offX || 0} mm</span>
          <button type="button" className="btn sm" title="Move the print right" onClick={() => void step("offX", 0.25, "Moved right")}>→</button></span>
        <span className="sq-pair"><button type="button" className="btn sm" title="Move the print up" onClick={() => void step("offY", -0.25, "Moved up")}>↑</button>
          <span className="mono xs">{cfg.offY || 0} mm</span>
          <button type="button" className="btn sm" title="Move the print down" onClick={() => void step("offY", 0.25, "Moved down")}>↓</button></span>
        <span className="sq-h">Text</span>
        <span className="sq-pair"><button type="button" className="btn sm" title="Smaller words" onClick={() => void step("font", -0.5, "Smaller text", 3, 14)}>A−</button>
          <span className="mono xs">{cfg.font} pt</span>
          <button type="button" className="btn sm" title="Bigger words" onClick={() => void step("font", 0.5, "Bigger text", 3, 14)}>A+</button></span>
        {direct && <><span className="sq-h">Dark</span>
          <span className="sq-pair"><button type="button" className="btn sm" title="Lighter print" onClick={() => void apply({ density: Math.max(0, dark - 1) }, "Lighter")}>−</button>
            <span className="mono xs">{dark}</span>
            <button type="button" className="btn sm" title="Darker print" onClick={() => void apply({ density: Math.min(15, dark + 1) }, "Darker")}>+</button></span></>}
        <span className="grow" />
        {tick ? <span className="xs ok-text" role="status">✓ {tick} · saved</span> : <span className="xs mut">Saved on this computer as you tap</span>}
        <a className="xs" href="#/labels">All printer settings</a>
      </div>
    </div>
  );
}
