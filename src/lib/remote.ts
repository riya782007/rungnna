import { sb } from "./sync";

/* Phone as a scanner for a laptop / counter PC.
   The counter shows a QR; the phone opens it and every sticker it reads appears on the counter's bill instantly
   (Supabase Realtime broadcast — nothing is stored, it's only a live pipe; needs internet on both). */
export const remoteChannel = (id: string) => "rj-scan-" + id;

export async function hostRemote(id: string, onCode: (text: string, from: string) => Promise<string> | string, onPeer?: (n: number) => void) {
  const c = await sb(); if (!c) return () => {};
  const ch = c.channel(remoteChannel(id), { config: { broadcast: { self: false }, presence: { key: "counter" } } });
  ch.on("broadcast", { event: "code" }, async ({ payload }: any) => {
    const label = await onCode(String(payload.text || ""), String(payload.from || "phone"));
    ch.send({ type: "broadcast", event: "ack", payload: { n: payload.n, label } });
  });
  ch.on("presence", { event: "sync" }, () => onPeer?.(Object.keys(ch.presenceState()).filter(k => k !== "counter").length));
  ch.subscribe(s => { if (s === "SUBSCRIBED") ch.track({ role: "counter" }); });
  return () => { c.removeChannel(ch); };
}

export async function joinRemote(id: string, name: string, onAck: (n: number, label: string) => void, onState: (s: string) => void) {
  const c = await sb(); if (!c) { onState("offline"); return { send: (_: string, __: number) => false, close: () => {} }; }
  const ch = c.channel(remoteChannel(id), { config: { broadcast: { self: false }, presence: { key: "phone-" + name } } });
  ch.on("broadcast", { event: "ack" }, ({ payload }: any) => onAck(payload.n, payload.label));
  ch.subscribe(s => { onState(s === "SUBSCRIBED" ? "connected" : s === "CHANNEL_ERROR" || s === "TIMED_OUT" ? "error" : "connecting"); if (s === "SUBSCRIBED") ch.track({ role: "phone", name }); });
  return {
    send: (text: string, n: number) => { ch.send({ type: "broadcast", event: "code", payload: { text, n, from: name } }); return true; },
    close: () => { c.removeChannel(ch); },
  };
}
