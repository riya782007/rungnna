import { useEffect, useRef, useState } from "react";
import { Camera } from "lucide-react";
import { Modal } from "./common";
import { savePhoto } from "../lib/image";
import { getSetting, setSetting } from "../lib/db";

/* The customer photo camera, also used for purchase bills: `facing="environment"` starts on the back camera,
   and `onBlob` hands back the picture itself instead of saving it as a photo. */
/* `preferExternal`: with no camera chosen yet, a plugged-in USB camera is used instead of the laptop's own
   (owner, 27 Oct: a second camera on USB for jewellery photos). Choosing one in the list remembers it. */
/* Owner, 27 Oct (photo, Labels › Camera): it still opened only the laptop's camera. Two reasons: "HD Webcam" counted
   as built-in, which is the name of common plug-in cameras (Logitech HD Webcam C270), and laptop cameras are often
   named "USB2.0 HD UVC WebCam", so "usb" in the name does not mean plugged in. Each camera now gets points; the one
   Windows opens by default (nearly always the laptop's own) loses to any other unless that one looks built in. */
const BUILT_IN = /integrated|built-?in|internal|truevision|easycamera|facetime|front|user facing|ir camera/i;
const EXTERNAL = /external|logitech|c270|c310|c505|c615|c920|c922|c930|brio|lifecam|droidcam|iriun|camo|obs virtual|zebronics|frontech|a4tech|elgato|document camera|visualizer/i;
export function pickExternal(cams: Pick<MediaDeviceInfo, "deviceId" | "label">[], activeId = ""): string {
  if (cams.length < 2) return "";
  const score = (c: Pick<MediaDeviceInfo, "deviceId" | "label">) =>
    (EXTERNAL.test(c.label) ? 4 : 0) - (BUILT_IN.test(c.label) ? 4 : 0) + (/usb/i.test(c.label) ? 1 : 0) + (c.deviceId !== (activeId || cams[0].deviceId) ? 2 : 0);
  const act = activeId || cams[0].deviceId;
  const best = cams.reduce((a, c) => (score(c) > score(a) ? c : a));
  return best.deviceId === act ? "" : best.deviceId;
}
const NO_CAMERA = new Set(["OverconstrainedError", "NotFoundError"]);
export default function CustomerCamera({ onPhoto, onBlob, onClose, title = "Customer photo", facing = "user", settingKey = "customer_camera", preferExternal = false }:
  { onPhoto?: (id: string) => void; onBlob?: (b: Blob) => void; onClose: () => void; title?: string; facing?: "user" | "environment"; settingKey?: string; preferExternal?: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const [device, setDevice] = useState<string | null>(null), [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  // auto: move to the plug-in camera by itself; off once "Use default camera" is pressed. tryNo opens the camera again.
  const [auto, setAuto] = useState(true), [tryNo, setTryNo] = useState(0);
  const tried = useRef(new Set<string>());   // cameras already switched to by itself: never twice, so a dead one can't loop
  const autoPick = (cameras: MediaDeviceInfo[], activeId?: string) => {
    const ext = pickExternal(cameras, activeId);
    if (!ext || tried.current.has(ext)) return "";
    tried.current.add(ext); return ext;
  };
  const [error, setError] = useState(""), [ready, setReady] = useState(false), [busy, setBusy] = useState(false);
  useEffect(() => { getSetting(settingKey, "").then(setDevice); }, []);
  useEffect(() => {
    if (device === null) return;
    let dead = false, stream: MediaStream | undefined;
    setReady(false); setError("");
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Camera needs HTTPS and browser permission. Use Upload instead.");
      const which = device ? { deviceId: { exact: device } } : { facingMode: facing };
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...which, width: { ideal: 1920 }, height: { ideal: 1080 } } }); }
      catch (e: any) {
        // the remembered camera is unplugged, or Windows gave it a new id: forget it and pick again automatically
        if (device && NO_CAMERA.has(e?.name)) { if (!dead) { setSetting(settingKey, ""); setDevice(""); } return; }
        if (e?.name === "NotAllowedError") throw e;
        // some plug-in cameras refuse the full-HD request ("Could not start video source"): open at their own size
        stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: which });
      }
      if (dead) { stream.getTracks().forEach(t => t.stop()); return; }
      if (video.current) { video.current.srcObject = stream; await video.current.play(); }
      const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      if (dead) return;
      setDevices(cameras);
      // camera names are known only after permission: now move to the plugged-in camera if nothing was chosen
      const ext = !device && preferExternal && auto ? autoPick(cameras, stream.getVideoTracks()[0]?.getSettings?.().deviceId) : "";
      if (ext) setDevice(ext);
    })().catch(e => {
      if (dead) return;
      setError(e.name === "NotAllowedError" ? "Camera permission denied. Allow camera access in the browser, or use Upload."
        : e.name === "NotReadableError" ? "This camera is busy or would not start. Close any other app using it (Windows Camera, WhatsApp, Zoom), unplug and plug it in again, or pick another camera in the list."
        : e.message);
    });
    return () => { dead = true; stream?.getTracks().forEach(t => t.stop()); };
  }, [device, tryNo]);
  // a camera plugged in (or out) while this is open shows in the list at once, and is used if nothing was chosen
  useEffect(() => {
    const md = navigator.mediaDevices; if (!md?.addEventListener) return;
    const changed = async () => {
      const cameras = (await md.enumerateDevices()).filter(d => d.kind === "videoinput");
      setDevices(cameras);
      if (preferExternal && auto && !device) { const ext = autoPick(cameras, (video.current?.srcObject as MediaStream | null)?.getVideoTracks()[0]?.getSettings?.().deviceId); if (ext) setDevice(ext); }
    };
    md.addEventListener("devicechange", changed);
    return () => md.removeEventListener("devicechange", changed);
  }, [device, preferExternal, auto]);
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
    <label className="f">Camera<select className="in" value={device || ""} onChange={e => { setAuto(true); setDevice(e.target.value); setSetting(settingKey, e.target.value); }}><option value="">{preferExternal ? "Automatic (USB camera if plugged in)" : "Default camera"}</option>{devices.map((d, i) => <option key={d.deviceId} value={d.deviceId}>{d.label || `Camera ${i + 1}`}</option>)}</select></label>
    {error && <div role="alert" className="note warn">{error}<button className="btn sm" onClick={() => { setAuto(false); setDevice(""); setSetting(settingKey, ""); setTryNo(n => n + 1); }}>Use default camera</button></div>}
    <button className="btn p" disabled={!ready || busy || !!error} onClick={capture}><Camera size={18} />{busy ? "Saving…" : "Take photo"}</button>
  </div></Modal>;
}
