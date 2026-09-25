import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, getSetting, setSetting, deviceId, type Staff } from "../lib/db";
import { Head } from "../components/common";
import { useApp, toast, newStaff } from "../lib/app";
import { onSync, signIn, signOut, syncNow, exportAll, importAll, type SyncState } from "../lib/sync";
import type { Pattern } from "../lib/parse";
import { when } from "../lib/format";
import { getShop, saveShop, counterCode, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { health, type Health } from "../lib/ai";

export default function Settings() {
  const { me, setMe } = useApp();
  const staff = useLiveQuery(() => db.staff.toArray(), [], []);
  const [sync, setSync] = useState<SyncState>();
  const [nm, setNm] = useState(""); const [role, setRole] = useState<Staff["role"]>("salesman"); const [pin, setPin] = useState("");
  const [pats, setPats] = useState<Pattern[]>([]);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => onSync(setSync) as any, []);
  useEffect(() => { getSetting<Pattern[]>("patterns", []).then(setPats); }, []);

  return (
    <div>
      <Head eyebrow={"This device · " + deviceId()} title="Settings" />
      <div className="split">
        <div className="stack">
          <div className="card"><header><h3>Cloud backup &amp; sync</h3>
            <span className={"pill " + (sync?.status === "idle" ? "ok" : sync?.status === "error" ? "bad" : "warn")}>{sync?.status}</span></header>
            <div className="pad stack">
              <div className="sm">{sync?.pending || 0} changes waiting to upload{sync?.last ? ` · last synced ${when(sync.last)}` : ""}</div>
              {sync?.error && <div className="note bad">{sync.error}</div>}
              {sync?.user ? <div className="row"><span className="sm grow">Signed in as <b>{sync.user}</b></span><button className="btn sm" onClick={() => syncNow()}>Sync now</button><button className="btn sm" onClick={signOut}>Sign out</button></div>
                : <ShopLogin />}
            </div></div>
          <div className="card"><header><h3>Staff on this system</h3></header>
            <div className="pad stack">
              {staff.filter(s => !s.deleted).map(s => (
                <div key={s.id} className="row sm">
                  <span className="grow"><b>{s.name}</b> <span className="mut">· {s.role}{s.pin ? " · PIN set" : ""}</span></span>
                  {me?.id === s.id ? <span className="pill ok">you</span> : <button className="btn sm" onClick={() => setMe(s)}>Switch to</button>}
                  <button className="btn sm" onClick={async () => { const n = prompt("Name", s.name); if (n) await put("staff", { ...s, name: n }); }}>Rename</button>
                  {s.role !== "owner" && <button className="btn sm bad" onClick={async () => { await put("staff", { ...s, active: s.active ? 0 : 1 }); }}>{s.active ? "Disable" : "Enable"}</button>}
                </div>))}
              <div className="grid g3">
                <input className="in" placeholder="Name" value={nm} onChange={e => setNm(e.target.value)} />
                <select className="in" value={role} onChange={e => setRole(e.target.value as any)}>
                  {["salesman", "helper", "packer", "cashier", "manager", "owner"].map(r => <option key={r}>{r}</option>)}</select>
                <input className="in mono" placeholder="4-digit PIN (optional)" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} />
              </div>
              <button className="btn" onClick={async () => { if (!nm.trim()) return; await put("staff", newStaff(nm.trim(), role, pin)); setNm(""); setPin(""); toast("Added"); }}>Add person</button>
            </div></div>
        </div>
        <div className="stack">
          <ShopProfile />
          <Keys />
          <div className="card"><header><h3>Label layouts learnt</h3></header>
            <div className="pad stack">
              {!pats.length && <div className="mut sm">None yet. When a scanned label isn't understood, the scan screen asks you once which piece is which.</div>}
              {pats.map(p => (
                <div key={p.id} className="row sm"><span className="grow"><b>{p.name}</b> · {p.count} pieces split by “{p.sep === "\\s" ? "space" : p.sep}” → {p.map.map(m => m || "–").join(", ")}</span>
                  <button className="btn sm bad" onClick={async () => { const n = pats.filter(x => x.id !== p.id); setPats(n); await setSetting("patterns", n); }}>Forget</button></div>))}
            </div></div>
          <div className="card"><header><h3>Backup file</h3></header>
            <div className="pad stack">
              <div className="sm mut">Everything on this device in one file — keep a copy on a pen drive every week.</div>
              <div className="row">
                <button className="btn" onClick={async () => { const b = await exportAll(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `rungnna-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}>Download backup</button>
                <input ref={file} type="file" accept="application/json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { await importAll(f); toast("Backup restored"); } catch (x: any) { toast(x.message, true); } }} />
                <button className="btn" onClick={() => file.current?.click()}>Restore from file</button>
              </div>
            </div></div>
        </div>
      </div>
    </div>
  );
}

export function ShopLogin({ onDone }: { onDone?: () => void }) {
  const [email, setEmail] = useState("shop@rungnna.in");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <form className="stack" onSubmit={async e => {
      e.preventDefault(); setBusy(true);
      try { await signIn(email.trim(), pw); toast("Device connected — stock will back up automatically"); onDone?.(); }
      catch (x: any) { toast(navigator.onLine ? (x.message || "Could not sign in") : "No internet — you can connect later", true); }
      finally { setBusy(false); }
    }}>
      <label className="f">Shop login email<input className="in" type="email" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="f">Password<input className="in" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete="current-password" /></label>
      <button className="btn p" disabled={busy || !pw}>{busy ? "Connecting…" : "Connect this device"}</button>
    </form>
  );
}

/* Shown when nobody is selected on this device. */
export function WhoAreYou() {
  const { setMe } = useApp();
  const staff = useLiveQuery(() => db.staff.filter(s => !s.deleted && !!s.active).toArray(), [], []);
  const [sync, setSync] = useState<SyncState>();
  const [pick, setPick] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  const [owner, setOwner] = useState("");
  useEffect(() => onSync(setSync) as any, []);
  const needsName = staff.length === 1 && staff[0].name === "Owner";
  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <div className="card" style={{ maxWidth: 440, width: "100%" }}>
        <header style={{ background: "var(--ink)", color: "#fff", borderRadius: "14px 14px 0 0" }}>
          <span className="mark">R</span><div><b className="disp" style={{ fontSize: 22 }}>Rungnna</b><div className="xs" style={{ opacity: .7 }}>Jewellery &amp; Co · Shop OS</div></div></header>
        <div className="pad stack">
          {!sync?.user && sync?.status !== "local" && (
            <details open={!sync?.user} className="stack">
              <summary className="b sm">1 · Connect this device to the shop (once)</summary>
              <div className="xs mut" style={{ margin: "6px 0" }}>So everything recorded here is backed up and shows on every other phone. You can skip and connect later — nothing is lost.</div>
              <ShopLogin />
            </details>)}
          <div className="b sm">{sync?.user ? "Connected ✓ — " : ""}Who is using this device?</div>
          {needsName ? (
            <div className="stack">
              <label className="f">Owner's name<input className="in" value={owner} onChange={e => setOwner(e.target.value)} placeholder="e.g. Karan" /></label>
              <button className="btn p" disabled={!owner.trim()} onClick={async () => { const s = { ...staff[0], name: owner.trim() }; await put("staff", s); setMe(s); }}>Start</button>
            </div>
          ) : pick ? (
            <div className="stack">
              <div className="sm">Enter PIN for <b>{pick.name}</b></div>
              <input className="in mono" autoFocus inputMode="numeric" maxLength={4} value={pin} onChange={e => { const v = e.target.value.replace(/\D/g, ""); setPin(v); if (v.length === 4) { if (v === pick.pin) setMe(pick); else { toast("Wrong PIN", true); setPin(""); } } }} />
              <button className="btn" onClick={() => { setPick(null); setPin(""); }}>Back</button>
            </div>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {staff.map(s => <button key={s.id} className="item" onClick={() => s.pin ? setPick(s) : setMe(s)}><span className="thumb" style={{ width: 36, height: 36 }}>{s.name.slice(0, 1)}</span><span className="grow b">{s.name}</span><span className="xs mut">{s.role}</span></button>)}
            </div>)}
        </div>
      </div>
    </div>
  );
}

/* Shop profile: printed on every bill, shared by all counters. */
function ShopProfile() {
  const [s, setS] = useState<Shop>(DEFAULT_SHOP);
  const [cc, setCc] = useState("");
  const [def, setDef] = useState("estimate");
  useEffect(() => { getShop().then(setS); counterCode().then(setCc); getSetting("default_bill_type", "estimate").then(setDef); }, []);
  const f = (k: keyof Shop, lbl: string, ph = "") => <label className="f">{lbl}<input className="in" value={String(s[k] ?? "")} placeholder={ph} onChange={e => setS({ ...s, [k]: k === "gst_rate" ? Number(e.target.value) || 0 : e.target.value })} /></label>;
  return (
    <div className="card"><header><h3>Shop profile (printed on bills)</h3></header>
      <div className="pad stack">
        <div className="grid g2">
          {f("name", "Shop name")}{f("tagline", "Tagline")}
          {f("phone", "Phone")}{f("whatsapp", "WhatsApp number")}
          {f("gstin", "GSTIN", "07ABCDE1234F1Z5")}{f("state", "State", "Delhi")}
          {f("upi", "UPI ID (for pay-QR on bills)", "rungnna@okaxis")}{f("hsn", "HSN code", "7117")}
          {f("gst_rate", "GST %", "3")}
          <label className="f">GST on rates<select className="in" value={s.gst_mode} onChange={e => setS({ ...s, gst_mode: e.target.value as any })}><option value="exclusive">Added on top of rate</option><option value="inclusive">Already included in rate</option></select></label>
        </div>
        {f("address", "Address")}{f("bank", "Bank details", "HDFC · A/c 123… · IFSC …")}{f("terms", "Terms (bottom of bill)")}
        <button className="btn p" onClick={async () => { await saveShop(s); toast("Shop profile saved — every counter gets it"); }}>Save shop profile</button>
        <div className="grid g2">
          <label className="f">This counter's code (in bill numbers)<input className="in mono" value={cc} maxLength={4} onChange={e => setCc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} onBlur={() => cc && setSetting("counter_code", cc)} /></label>
          <label className="f">New bills start as<select className="in" value={def} onChange={e => { setDef(e.target.value); setSetting("default_bill_type", e.target.value); }}><option value="estimate">Estimate</option><option value="gst">GST invoice</option></select></label>
        </div>
        <div className="xs mut">Each counter numbers its own bills (e.g. RJ/26-27/C1-0001), so two counters can bill offline at the same time without ever clashing. Give every counter a different code.</div>
      </div></div>
  );
}

/* Which secret keys are filled in on Vercel (values are never shown). */
function Keys() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => { health().then(setH).catch(e => setErr(e.message)); }, []);
  const row = (ok: boolean | undefined, name: string, what: string) => (
    <div className="row sm" style={{ flexWrap: "nowrap" }}><span className={"pill " + (ok ? "ok" : "warn")}>{ok ? "ready" : "not added"}</span><span className="grow"><b>{name}</b> <span className="mut">— {what}</span></span></div>);
  return (
    <div className="card"><header><h3>AI &amp; WhatsApp keys</h3></header>
      <div className="pad stack" style={{ gap: 8 }}>
        {err && <div className="note warn sm">Can't check right now ({err}).</div>}
        {row(h?.ai, "GEMINI_API_KEY", "voice orders, photo fill, Ask the shop")}
        {row(h?.whatsapp_api, "WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID", "optional automatic sending; tap-to-send works without it")}
        {row(h?.supabase, "SUPABASE_URL + SUPABASE_ANON_KEY", "lets the server check the shop login")}
        <div className="xs mut">Keys are added in Vercel → project rungnna_shop_os → Settings → Environment Variables, then Deployments → ⋯ → Redeploy. They never go into the app itself.</div>
      </div></div>
  );
}
