import { useEffect, useRef, useState } from "react";
import { sb } from "../lib/sync";

/* Online video call (owner's list R-51): the shop shows designs live on camera to a buyer far away.
   The shop opens a call and sends the link on WhatsApp; the buyer taps it — no app, no login.
   Video goes straight between the two phones (WebRTC); the shop's cloud only passes the
   "hello" between them. On some mobile networks a direct line can't be made — then the page says
   so and offers a WhatsApp video call instead. */

const ICE: RTCIceServer[] = [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }];
const turn = import.meta.env.VITE_TURN_URL as string | undefined;
if (turn) ICE.push({ urls: turn, username: import.meta.env.VITE_TURN_USER as string, credential: import.meta.env.VITE_TURN_PASS as string });

export const newRoom = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => "abcdefghjkmnpqrstuvwxyz23456789"[b % 31]).join("");
export const callLink = (room: string) => `${location.origin}/#/call/${room}`;

function CallView({ room, host, phone, name, onEnd }: { room: string; host: boolean; phone?: string; name?: string; onEnd: () => void }) {
  const me = useRef<HTMLVideoElement>(null), them = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState("Starting camera…");
  const [live, setLive] = useState(false);
  const [mic, setMic] = useState(true);
  const [back, setBack] = useState(host);
  const [slow, setSlow] = useState(false);
  const stream = useRef<MediaStream | null>(null), pc = useRef<RTCPeerConnection | null>(null), ch = useRef<any>(null);

  useEffect(() => {
    let gone = false, timer: any;
    (async () => {
      try {
        stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: host ? "environment" : "user", width: { ideal: 1280 } }, audio: true });
        if (me.current) me.current.srcObject = stream.current;
      } catch { setState("Camera / microphone not allowed. Allow it in the browser and reload."); return; }
      const c = await sb(); if (!c || gone) { setState("No internet / cloud — use WhatsApp video call."); return; }
      const send = (event: string, payload: any) => ch.current?.send({ type: "broadcast", event, payload });
      const peer = () => {
        pc.current?.close();
        const p = new RTCPeerConnection({ iceServers: ICE }); pc.current = p;
        stream.current!.getTracks().forEach(t => p.addTrack(t, stream.current!));
        p.onicecandidate = e => e.candidate && send("ice", e.candidate.toJSON());
        p.ontrack = e => { if (them.current) them.current.srcObject = e.streams[0]; setLive(true); setState("Connected"); setSlow(false); };
        p.onconnectionstatechange = () => { if (p.connectionState === "failed") { setSlow(true); setState("Could not connect directly"); } if (p.connectionState === "disconnected") setState("Connection lost…"); };
        return p;
      };
      const chan = c.channel("rj-call-" + room, { config: { broadcast: { self: false } } }); ch.current = chan;
      chan.on("broadcast", { event: "hello" }, async () => {
        if (!host) return;
        const p = peer(); const o = await p.createOffer(); await p.setLocalDescription(o); send("offer", o);
      });
      chan.on("broadcast", { event: "offer" }, async ({ payload }: any) => {
        if (host) return;
        const p = peer(); await p.setRemoteDescription(payload); const a = await p.createAnswer(); await p.setLocalDescription(a); send("answer", a);
      });
      chan.on("broadcast", { event: "answer" }, async ({ payload }: any) => { if (host && pc.current) await pc.current.setRemoteDescription(payload); });
      chan.on("broadcast", { event: "ice" }, async ({ payload }: any) => { try { await pc.current?.addIceCandidate(payload); } catch { /* early */ } });
      chan.on("broadcast", { event: "bye" }, () => { setLive(false); setState("The other side ended the call"); pc.current?.close(); });
      chan.subscribe((s: string) => {
        if (s !== "SUBSCRIBED") return;
        setState(host ? "Waiting for the customer to open the link…" : "Calling the shop…");
        if (!host) { send("hello", {}); timer = setInterval(() => { if (!pc.current || pc.current.connectionState !== "connected") send("hello", {}); else clearInterval(timer); }, 4000); }
      });
      setTimeout(() => { if (!gone && !pc.current?.connectionState?.match(/connected/)) setSlow(true); }, 30000);
    })();
    return () => { gone = true; clearInterval(timer); ch.current?.send({ type: "broadcast", event: "bye", payload: {} }); pc.current?.close(); stream.current?.getTracks().forEach(t => t.stop()); sb().then(c => ch.current && c?.removeChannel(ch.current)); };
  }, [room, host]);

  const flip = async () => {
    const nb = !back; setBack(nb);
    const v = (await navigator.mediaDevices.getUserMedia({ video: { facingMode: nb ? "environment" : "user" } })).getVideoTracks()[0];
    const old = stream.current!.getVideoTracks()[0]; stream.current!.removeTrack(old); old.stop(); stream.current!.addTrack(v);
    pc.current?.getSenders().find(s => s.track?.kind === "video")?.replaceTrack(v);
    if (me.current) me.current.srcObject = stream.current;
  };
  const link = callLink(room);
  const wa = (text: string) => `https://wa.me/${(phone || "").replace(/\D/g, "").replace(/^(?=\d{10}$)/, "91")}?text=${encodeURIComponent(text)}`;
  return <div style={{ position: "fixed", inset: 0, background: "#111", color: "#fff", zIndex: 9000, display: "flex", flexDirection: "column" }}>
    <video ref={them} autoPlay playsInline style={{ flex: 1, width: "100%", objectFit: "contain", background: "#000" }} />
    <video ref={me} autoPlay playsInline muted style={{ position: "absolute", right: 12, top: 12, width: "28vw", maxWidth: 220, borderRadius: 10, border: "2px solid #fff", background: "#222" }} />
    <div style={{ position: "absolute", left: 12, top: 12, background: "rgba(0,0,0,.55)", padding: "6px 10px", borderRadius: 8, fontSize: 14 }}>{host ? "Rungnna · video call" : "Rungnna Jewellery & Co"} · {state}</div>
    {host && !live && <div style={{ position: "absolute", left: 12, right: 12, top: "35%", textAlign: "center" }} className="stack">
      <div style={{ fontSize: 18 }}>Send this link to {name || "the customer"}:</div>
      <code style={{ wordBreak: "break-all", fontSize: 13 }}>{link}</code>
      <div className="row" style={{ justifyContent: "center" }}>
        <a className="btn g" href={wa(`Namaste${name ? " " + name : ""}, Rungnna Jewellery se video call — designs live dekhne ke liye yeh link kholiye: ${link}`)} target="_blank" rel="noopener">Send on WhatsApp</a>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(link)}>Copy link</button>
      </div></div>}
    {slow && !live && <div style={{ position: "absolute", left: 12, right: 12, bottom: 90, textAlign: "center", background: "rgba(0,0,0,.6)", padding: 10, borderRadius: 8 }}>
      Not connecting on this network? {phone ? <a style={{ color: "#7fd" }} href={wa("Video call karein? Main WhatsApp par call kar raha hoon.")} target="_blank" rel="noopener">Use WhatsApp video call</a> : "Use a WhatsApp video call instead."}</div>}
    <div className="row" style={{ justifyContent: "center", padding: 14, gap: 12, background: "#000" }}>
      <button className="btn" onClick={() => { const t = stream.current?.getAudioTracks()[0]; if (t) { t.enabled = !mic; setMic(!mic); } }}>{mic ? "🎙 Mute" : "🔇 Unmute"}</button>
      <button className="btn" onClick={flip}>🔄 Camera</button>
      <button className="btn bad" onClick={onEnd}>End</button>
    </div>
  </div>;
}

/** The call screen; after End it shows a short note (the camera is switched off). */
export default function Call({ room, host, phone, name }: { room: string; host: boolean; phone?: string; name?: string }) {
  const [ended, setEnded] = useState(false);
  if (ended) return <div className="card empty" style={{ margin: 24 }}><b>Call ended</b>{host ? <a className="btn" href="#/customers">Back to customers</a> : "Thank you — Rungnna Jewellery & Co, Sadar Bazar, Delhi."}</div>;
  return <CallView room={room} host={host} phone={phone} name={name} onEnd={() => setEnded(true)} />;
}
