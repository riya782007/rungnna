import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, uid, type VoiceNote } from "../lib/db";
import { transcribe } from "../lib/ai";
import { toast, useApp } from "../lib/app";
import { when } from "../lib/format";
import { Icon } from "./Icon";

/* Hold-free recorder: tap to start, tap to stop. Opus at ~24 kbps → a 1-minute note is ~180 KB. */
export function useRecorder(maxSec = 120) {
  const [rec, setRec] = useState<MediaRecorder | null>(null);
  const [secs, setSecs] = useState(0);
  const chunks = useRef<Blob[]>([]);
  const done = useRef<(b: Blob, s: number) => void>(() => {});
  const t0 = useRef(0);
  useEffect(() => { if (!rec) return; const i = setInterval(() => { const s = Math.round((Date.now() - t0.current) / 1000); setSecs(s); if (s >= maxSec) rec.stop(); }, 250); return () => clearInterval(i); }, [rec]);
  async function start(onDone: (b: Blob, seconds: number) => void) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    const mime = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus", ""].find(m => !m || MediaRecorder.isTypeSupported(m)) || "";
    const r = new MediaRecorder(stream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : undefined);
    chunks.current = []; done.current = onDone; t0.current = Date.now(); setSecs(0);
    r.ondataavailable = e => e.data.size && chunks.current.push(e.data);
    r.onstop = () => {
      stream.getTracks().forEach(t => t.stop());
      const b = new Blob(chunks.current, { type: r.mimeType || "audio/webm" });
      setRec(null); done.current(b, Math.round((Date.now() - t0.current) / 1000));
    };
    r.start(500); setRec(r);
  }
  return { recording: !!rec, secs, start, stop: () => rec?.stop() };
}

export function MicButton({ onAudio, label = "🎙 Speak", busy }: { onAudio: (b: Blob, s: number) => void; label?: string; busy?: boolean }) {
  const r = useRecorder();
  return (
    <button type="button" className={"btn " + (r.recording ? "rec" : "")} disabled={busy}
      onClick={async () => {
        if (r.recording) return r.stop();
        try { await r.start(onAudio); } catch { toast("Microphone not allowed — allow it in the browser's site settings", true); }
      }}>
      {busy ? "Working…" : r.recording ? `■ Stop · ${r.secs}s` : <><Icon n="mic" size={18} />{label.replace(/^🎙\s*/, "")}</>}
    </button>
  );
}

/* Voice notes pinned to anything (a bill, a product, a customer, a movement). Saved offline, uploaded when online. */
export function VoiceNotes({ entity, entityId, compact }: { entity: string; entityId: string; compact?: boolean }) {
  const { me } = useApp();
  const notes = useLiveQuery(() => db.voice_notes.where("entity_id").equals(entityId).filter(n => !n.deleted).sortBy("at"), [entityId], []);
  const [busy, setBusy] = useState("");
  const save = async (blob: Blob, seconds: number) => {
    if (seconds < 1) return;
    const id = uid();
    await db.voice_blobs.put({ id, blob, uploaded: 0, created_at: now() });
    await put("voice_notes", { id, entity, entity_id: entityId, seconds, transcript: "", by_staff: me?.id || "", at: now(), updated_at: now() } as VoiceNote);
    toast("Voice note saved");
    if (navigator.onLine) doTranscribe(id, blob);
  };
  const doTranscribe = async (id: string, blob?: Blob) => {
    try {
      setBusy(id);
      const b = blob || (await db.voice_blobs.get(id))?.blob;
      if (!b) return;
      const text = await transcribe(b);
      const n = await db.voice_notes.get(id); if (n) await put("voice_notes", { ...n, transcript: text });
    } catch (e: any) { toast(e.message, true); } finally { setBusy(""); }
  };
  return (
    <div className="stack" style={{ gap: 6 }}>
      {!compact && <div className="row"><b className="sm grow">Voice notes</b><MicButton onAudio={save} label="🎙 Record note" /></div>}
      {compact && <MicButton onAudio={save} label="🎙 Voice note" />}
      {notes.map(n => <NoteRow key={n.id} n={n} busy={busy === n.id} onText={() => doTranscribe(n.id)} />)}
    </div>
  );
}
function NoteRow({ n, busy, onText }: { n: VoiceNote; busy: boolean; onText: () => void }) {
  const [src, setSrc] = useState(n.url || "");
  useEffect(() => { db.voice_blobs.get(n.id).then(v => v && setSrc(URL.createObjectURL(v.blob))); }, [n.id]);
  return (
    <div className="vnote">
      <div className="row" style={{ flexWrap: "nowrap" }}>
        {src ? <audio controls src={src} preload="none" /> : <span className="xs mut">Audio on another device</span>}
        <span className="xs mut" style={{ whiteSpace: "nowrap" }}>{n.seconds}s · {when(n.at)}</span>
      </div>
      {n.transcript ? <div className="sm" style={{ whiteSpace: "pre-wrap" }}>{n.transcript}</div>
        : <button className="btn sm" onClick={onText} disabled={busy}>{busy ? "Writing…" : "✨ Write it down"}</button>}
    </div>
  );
}
