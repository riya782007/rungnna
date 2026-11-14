import { useState } from "react";
import { MicButton } from "./Voice";
import { transcribe } from "../lib/ai";
import { browserListen } from "../lib/spoken";
import { toast } from "../lib/app";

/* One mic button for short commands: the browser's own speech (fast, Hindi + English) where it has it,
   else a recording written down by the shop's AI (Windows app, needs internet). */
export function ListenButton({ onText, label = "🎙 Speak" }: { onText: (t: string) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  const can = typeof window !== "undefined" && ((window as any).webkitSpeechRecognition || (window as any).SpeechRecognition) && !(window as any).rungnnaDesktop;
  if (can) return <button type="button" className="btn p" disabled={busy} onClick={async () => {
    const p = browserListen(); if (!p) return; setBusy(true);
    try { const t = await p; t ? onText(t) : toast("Didn't catch that — try again", true); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  }}>{busy ? "Listening…" : label}</button>;
  return <MicButton busy={busy} label={label} onAudio={async a => {
    setBusy(true);
    try { const t = (await transcribe(a)).split("\nSummary:")[0].trim(); t ? onText(t) : toast("Didn't catch that — try again", true); } catch (e: any) { toast(e.message || "Could not hear", true); } finally { setBusy(false); }
  }} />;
}
