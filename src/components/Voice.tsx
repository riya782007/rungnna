import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, uid, type VoiceNote } from "../lib/db";
import { transcribe } from "../lib/ai";
import { toast, useApp } from "../lib/app";
import { when } from "../lib/format";
import { Icon } from "./Icon";
import { can } from "../lib/roles";
import { confirmDelete } from "../lib/confirm-delete";
import { removeCloudVoice } from "../lib/estimatePurge";

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
      {notes.map(n => <NoteRow key={n.id} n={n} busy={busy === n.id} onText={() => doTranscribe(n.id)}
        canDelete={!!me && (me.id === n.by_staff || can(me, "staff"))} />)}
    </div>
  );
}
/* Owner, 22 Oct: "how do I delete a voice note, and where are they kept?" A note is kept on the computer that
   recorded it and in the shop's cloud, on the bill / product / customer it was recorded on. The person who
   recorded it, or the owner/manager, can delete it from both. */
async function deleteNote(n: VoiceNote) {
  if (!await confirmDelete("Delete this voice note? It is removed from this computer and the shop's cloud.")) return;
  await db.transaction("rw", [db.voice_notes, db.voice_blobs, db.outbox], async () => {
    await db.voice_blobs.delete(n.id);
    await put("voice_notes", { ...n, deleted: 1, transcript: "", url: null as any, updated_at: now() } as VoiceNote);
  });
  if (n.url) void removeCloudVoice([n.url]).catch(() => {});
  toast("Voice note deleted");
}
function NoteRow({ n, busy, onText, canDelete }: { n: VoiceNote; busy: boolean; onText: () => void; canDelete?: boolean }) {
  const [src, setSrc] = useState(n.url || "");
  useEffect(() => { db.voice_blobs.get(n.id).then(v => v && setSrc(URL.createObjectURL(v.blob))); }, [n.id]);
  return (
    <div className="vnote">
      <div className="row" style={{ flexWrap: "nowrap" }}>
        {src ? <audio controls src={src} preload="none" /> : <span className="xs mut">Audio on another device</span>}
        <span className="xs mut" style={{ whiteSpace: "nowrap" }}>{n.seconds}s · {when(n.at)}</span>
        {canDelete && <button className="iconbtn" title="Delete this voice note" aria-label="Delete voice note" onClick={() => void deleteNote(n).catch(e => toast(e.message, true))}>✕</button>}
      </div>
      {n.transcript ? <div className="sm" style={{ whiteSpace: "pre-wrap" }}>{n.transcript}</div>
        : <button className="btn sm" onClick={onText} disabled={busy}>{busy ? "Writing…" : "✨ Write it down"}</button>}
    </div>
  );
}

/* Speak instead of typing (owner, 22 Oct: daily tasks from a voice note; colours "by just speaking").
   Records, sends the clip to the shop's AI to write it down, and hands back the words. Needs internet. */
export function SpeakText({ onText, label = "Speak" }: { onText: (text: string) => void; label?: string }) {
  const [busy, setBusy] = useState(false);
  return <MicButton busy={busy} label={label} onAudio={async a => {
    setBusy(true);
    try { const t = (await transcribe(a)).split("\nSummary:")[0].trim(); if (t) onText(t); else toast("Didn't catch that — try again", true); }
    catch (e: any) { toast(e.message || "Could not write the voice down", true); }
    finally { setBusy(false); }
  }} />;
}
