import { useEffect, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import { ownerVerified, verifyOwner, enableOwnerSecurity } from "../lib/security";
import { sb } from "../lib/sync";
import { toast, useApp } from "../lib/app";
import { ShopLogin } from "../pages/Settings";
export function OwnerGate({ children }: { children: ReactNode }) {
  const { me, setMe } = useApp(); const [ok, setOk] = useState<boolean | null>(null), [code, setCode] = useState(""), [busy, setBusy] = useState(false);
  const cfg = useLiveQuery(() => db.config.get("owner_security"), [], undefined);
  useEffect(() => { setOk(null); if (me) ownerVerified(me).then(setOk); else setOk(true); }, [me?.id, cfg?.updated_at]);
  if (ok === null) return <div className="pad">Checking device…</div>;
  if (ok) return <>{children}</>;
  return <div className="security-gate stack"><h2>Owner verification</h2><ShopLogin /><label className="f">Authenticator code<input className="in" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value.replace(/\D/g, ""))} /></label>
    <button className="btn p" disabled={busy || code.length !== 6} onClick={async () => { setBusy(true); try { await verifyOwner(code, me!); setOk(true); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } }}>Verify this device</button><button className="btn" onClick={() => setMe(null)}>Switch person</button></div>;
}
export function SecuritySettings() {
  const { me } = useApp(); const [qr, setQr] = useState(""), [factor, setFactor] = useState(""), [code, setCode] = useState(""), [busy, setBusy] = useState(false);
  const cfg = useLiveQuery(() => db.config.get("owner_security"), [], undefined);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  return <section className="stack"><h3>Owner two-step login</h3><span className={"pill " + (cfg?.value?.enabled ? "ok" : "")}>{cfg?.value?.enabled ? "Enabled" : "Off"}</span>
    {!cfg?.value?.enabled && <><button className="btn" disabled={busy} onClick={() => run(async () => { const c = await sb(); if (!c) throw new Error("Connect the owner account first"); const list = await c.auth.mfa.listFactors(); if (list.error) throw list.error; const existing = list.data.totp.find(f => f.status === "verified"); if (existing) { setFactor(existing.id); return; } const enrolled = await c.auth.mfa.enroll({ factorType: "totp", friendlyName: "Rungnna owner" }); if (enrolled.error) throw enrolled.error; setQr(enrolled.data.totp.qr_code); setFactor(enrolled.data.id); })}>Set up authenticator</button>
      {qr && <img src={qr} width={200} height={200} alt="Owner authenticator QR" />}
      {factor && <><label className="f">Six-digit code<input className="in" inputMode="numeric" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} /></label><button className="btn p" disabled={busy || code.length !== 6} onClick={() => run(async () => { await verifyOwner(code, me!, factor); await enableOwnerSecurity(me!); setQr(""); setCode(""); toast("Owner two-step login enabled"); })}>Verify and enable</button></>}
    </>}
  </section>;
}
