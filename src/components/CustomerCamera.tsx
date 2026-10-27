import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Modal } from "./common";
import { savePhoto } from "../lib/image";
import { getSetting, setSetting } from "../lib/db";

/* The customer photo camera, also used for purchase bills: `facing="environment"` starts on the back camera,
   and `onBlob` hands back the picture itself instead of saving it as a photo. */
/* `preferExternal`: with no camera chosen yet, a plugged-in USB camera is used instead of the laptop's own
   (owner, 27 Oct: a second camera on USB for jewellery photos). Choosing one in the list remembers it. */
const BUILT_IN = /integrated|built-?in|internal|facetime|front|hd webcam|user facing/i;
export function pickExternal(cams: Pick<MediaDeviceInfo, "deviceId" | "label">[]): string {
  if (cams.length < 2) return "";
  return (cams.find(c => /usb/i.test(c.label)) || cams.find(c => c.label && !BUILT_IN.test(c.label)))?.deviceId || "";
}
export default function CustomerCamera({ onPhoto, onBlob, onClose, title = "Customer photo", facing = "user", settingKey = "customer_camera", preferExternal = false }:
  { onPhoto?: (id: string) => void; onBlob?: (b: Blob) => void; onClose: () => void; title?: string; facing?: "user" | "environment"; settingKey?: string; preferExternal?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [device, setDevice] = useState<string | null>(null), [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [error, setError] = useState(""), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { getSetting(settingKey, "").then(setDevice); }, []);
  useEffect(() => {
    if (device === null) return;
    let dead = false, stream: MediaStream | undefined;
    setReady(false); setError("");
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs HTTPS and browser permission. Use Upload instead.");
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...(device ? { deviceId: { exact: device } } : { facingMode: facing }), width: { ideal: 1920 }, height: { ideal: 1080 } } });
      if (dead) { stream.getTracks().forEach(t => t.stop()); return; }
      if (video.current) { video.current.srcObject = stream; await video.current.play(); }
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      if (dead) return;
      setDevices(cameras);
      // camera names are known only after permission: now move to the USB camera if nothing was chosen
      const usb = !device && preferExternal ? pickExternal(cameras) : "";
      if (usb && usb !== stream?.getVideoTracks()[0]?.getSettings?.().deviceId) setDevice(usb);
    })().catch(e => { if (!dead) setError(e.name === "NotAllowedError" ? "Camera permission denied. Allow camera access in the browser, or use Upload." : e.message); });
    return () => { dead = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [device]);
  const capture = async () => {
    const v = video.current; if (!v?.videoWidth || busy) return;
    setBusy(true);
    try {
      const c = document.createElement("canvas"); c.width = v.videoWidth; c.height = v.videoHeight;
      c.getContext("2d")!.drawImage(v, 0, 0);
      const blob = await new Promise<Blob | null>(r => c.toBlob(r, "image/jpeg", 0.9));
      if (!blob) throw new Error("Could not capture photo");
      if (onBlob) onBlob(blob); else onPhoto?.(await savePhoto(blob));
      onClose();
    } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  return <Modal title={title} onClose={onClose}><div className="stack">
    <video ref={video} autoPlay muted playsInline className="customer-camera" onLoadedData={() => setReady(true)} />
    <label className="f">Camera<select className="in" value={device || ""} onChange={e => { setDevice(e.target.value); setSetting(settingKey, e.target.value); }}><option value="">{preferExternal ? "Automatic (USB camera if plugged in)" : "Default camera"}</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>
    {error && <div role="alert" className="note warn">{error}<button className="btn sm" onClick={() => setDevice("")}>Use default camera</button></div>}
    <button className="btn p" disabled={!ready || busy || !!error} onClick={capture}><Camera size={18} />{busy ? "Saving…" : "Take photo"}</button>
  </div></Modal>;
}
