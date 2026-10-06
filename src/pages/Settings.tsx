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
import { can, ROLE_NOTE } from "../lib/roles";
import { getPrivate, setCode, lockNow, usePrivate } from "../lib/privacy";
import { getRule, saveRule, validateKey, priceFromCost, DEFAULT_RULE, type PricingRule, type RoundTo } from "../lib/pricing";
import { rupees, toPaise } from "../lib/format";
import { getTaxonomy, addTo, removeFrom, addColour, removeColour, colourCodeFor, type Taxonomy } from "../lib/taxonomy";
import { initLang, setLang, type Lang } from "../lib/i18n";
import { closeFinancialYear, lockedUpto, setVoucherLock } from "../lib/finance";
import { SecuritySettings } from "../components/OwnerSecurity";
import { gstRequest } from "../lib/compliance";

export default function Settings() {
  const { me, setMe } = useApp();
  const staff = useLiveQuery(() => db.staff.toArray(), [], []);
  const [sync, setSync] = useState<SyncState>();
  const [nm, setNm] = useState(""); const [role, setRole] = useState<Staff["role"]>("salesman"); const [pin, setPin] = useState("");
  const [pats, setPats] = useState<Pattern[]>([]);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => onSync(setSync) as any, []);
  useEffect(() => { getSetting<Pattern[]>("patterns", []).then(setPats); }, []);
  const admin = can(me, "settings"), boss = can(me, "staff");

  return (
    <div>
      <Head title="Settings" sub={"This device · " + deviceId()} />
      <div className="split">
        <div className="stack">
          <div className="card pad stack">
            <div className="row"><span className="avatar" style={{ width: 44, height: 44, fontSize: 17 }}>{me?.name.slice(0, 1)}</span>
              <span className="grow"><b>{me?.name}</b><div className="xs mut">{me?.role} · {me ? ROLE_NOTE[me.role] : ""}</div></span>
              <button className="btn sm" onClick={() => setMe(null)}>Switch person</button></div>
            {me && <button className="btn sm" onClick={async () => {
              const p = prompt(me.pin ? "New 4-digit PIN (leave empty to remove)" : "Set a 4-digit PIN so nobody else can use your name") ?? null;
              if (p === null) return; if (p && !/^\d{4}$/.test(p)) return toast("PIN must be 4 digits", true);
              const u = { ...me, pin: p }; await put("staff", u); setMe(u); toast(p ? "PIN saved" : "PIN removed");
            }}>{me.pin ? "Change my PIN" : "Set my PIN"}</button>}
            {me?.role === "owner" && !me.pin && <div className="note warn sm">Set a PIN — it's needed to approve big discounts and to keep your owner access safe.</div>}
          </div>

          <div className="card"><header><h3>Cloud backup</h3><span className="grow" />
            <span className={"pill " + (!sync?.user ? "warn" : sync?.status === "idle" ? "ok" : sync?.status === "error" ? "bad" : "warn")}>{!sync?.user ? "not connected" : sync?.status === "idle" ? "all saved" : sync?.status}</span></header>
            <div className="pad stack">
              <div className="sm mut">{sync?.pending || 0} changes waiting{sync?.last ? ` · last saved ${when(sync.last)}` : ""}</div>
              {sync?.error && <div className="note bad">{sync.error}</div>}
              {sync?.user ? <div className="row"><span className="sm grow">Connected as <b>{sync.user}</b></span><button className="btn sm" onClick={() => syncNow()}>Sync now</button>{admin && <button className="btn sm" onClick={signOut}>Disconnect</button>}</div>
                : <ShopLogin />}
            </div></div>

          {boss && <div className="card"><header><h3>People</h3></header>
            <div className="list" style={{ border: 0, borderRadius: 0, boxShadow: "none" }}>
              {staff.filter(s => !s.deleted).map(s => (
                <div key={s.id} className="li">
                  <span className="grow"><b className="sm">{s.name}</b>{me?.id === s.id && <span className="pill ok" style={{ marginLeft: 6 }}>you</span>}
                    <div className="xs mut">{ROLE_NOTE[s.role]}{s.pin ? " · PIN set" : ""}{!s.active ? " · disabled" : ""}</div></span>
                  <select className="in" style={{ width: 120, height: 34 }} value={s.role} disabled={s.id === me?.id}
                    onChange={async e => { await put("staff", { ...s, role: e.target.value as Staff["role"] }); toast("Role changed"); }}>
                    {ROLES.map(r => <option key={r}>{r}</option>)}</select>
                  <button className="btn sm" onClick={async () => { const n = prompt("Name", s.name); if (n) await put("staff", { ...s, name: n }); }}>Rename</button>
                  {s.id !== me?.id && <button className="btn sm" onClick={async () => { await put("staff", { ...s, active: s.active ? 0 : 1 }); }}>{s.active ? "Disable" : "Enable"}</button>}
                </div>))}
            </div>
            <div className="pad stack" style={{ borderTop: "1px solid var(--line-2)" }}>
              <div className="grid g3">
                <input className="in" placeholder="Name" value={nm} onChange={e => setNm(e.target.value)} />
                <select className="in" value={role} onChange={e => setRole(e.target.value as any)}>{ROLES.map(r => <option key={r}>{r}</option>)}</select>
                <input className="in mono" placeholder="PIN (optional)" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} />
              </div>
              <button className="btn" onClick={async () => { if (!nm.trim()) return; await put("staff", newStaff(nm.trim(), role, pin)); setNm(""); setPin(""); toast("Added"); }}>Add person</button>
            </div></div>}
        </div>
        <div className="stack">
          {boss && <PrivateCard />}
          <PrintingSettings />
          {boss && <><SecuritySettings /><GstSettings /><a className="btn" href="#/bank">Bank reconciliation</a><a className="btn" href="#/stores">Store setup &amp; transfers</a></>}
          {!boss && <a className="btn" href="#/stores">Stock transfers</a>}
          {can(me, "lock") && <OperationsCard by={me?.id || ""} />}
          {admin && <ShopProfile />}
          {admin && <PricingCard />}
          {admin && <TaxonomyCard />}
          {admin && <Keys />}
          {admin && <div className="card"><header><h3>Label layouts learnt</h3></header>
            <div className="pad stack">
              {!pats.length && <div className="mut sm">None yet. When a label isn't understood, the scan screen asks once which piece is which.</div>}
              {pats.map(p => (
                <div key={p.id} className="row sm"><span className="grow"><b>{p.name}</b> · {p.count} pieces → {p.map.map(m => m || "–").join(", ")}</span>
                  <button className="btn sm bad" onClick={async () => { const n = pats.filter(x => x.id !== p.id); setPats(n); await setSetting("patterns", n); }}>Forget</button></div>))}
            </div></div>}
          {boss && <div className="card"><header><h3>Backup file</h3></header>
            <div className="pad stack">
              <div className="sm mut">Everything on this device in one file. Keep a copy on a pen drive every week.</div>
              <div className="row">
                <button className="btn" onClick={async () => { const b = await exportAll(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `rungnna-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}>Download backup</button>
                <input ref={file} type="file" accept="application/json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { await importAll(f); toast("Backup restored"); } catch (x: any) { toast(x.message, true); } }} />
                {admin && <button className="btn" onClick={() => file.current?.click()}>Restore from file</button>}
              </div>
            </div></div>}
        </div>
      </div>
    </div>
  );
}

const ROLES: Staff["role"][] = ["owner", "manager", "cashier", "salesman", "helper", "packer"];

function PrintingSettings() {
  const [width, setWidth] = useState("80mm");
  useEffect(() => { getSetting("thermal_width", "80mm").then(setWidth); }, []);
  return <section className="stack"><h3>Printing</h3><label className="f">Thermal paper width<select className="in" value={width} onChange={async e => { const value = e.target.value; setWidth(value); await db.transaction("rw", db.settings, async () => { await setSetting("thermal_width", value); await setSetting("print_fmt", value); }); toast("Printer preference saved"); }}><option value="58mm">58 mm</option><option value="80mm">80 mm</option></select></label><span className="sm">Receipt size: fitted to each bill · Cut: Windows printer driver</span><a className="btn" href="#/labels">Label printer settings</a></section>;
}
function GstSettings() {
  const [status, setStatus] = useState("Download JSON only");
  useEffect(() => { gstRequest().then(j => setStatus(j.configured ? j.sandbox ? "Sandbox provider connected" : "Production provider connected" : "Download JSON only")).catch(() => {}); }, []);
  return <section className="stack"><h3>E-invoice &amp; e-way bill</h3><span className="pill">{status}</span></section>;
}

function OperationsCard({ by }: { by: string }) {
  const [language, setLanguage] = useState<Lang>("en");
  const [lock, setLock] = useState("");
  const [closeDate, setCloseDate] = useState("");
  useEffect(() => { initLang().then(setLanguage); lockedUpto().then(setLock); }, []);
  return (
    <div className="card"><header><h3>Language, lock &amp; year close</h3></header>
      <div className="pad stack">
        <label className="f">Language<select className="in" value={language} onChange={async e => { const l = e.target.value as Lang; setLanguage(l); await setLang(l); toast(l === "hi" ? "भाषा सेव हो गई" : "Language saved"); }}>
          <option value="en">English</option><option value="hi">हिन्दी</option></select></label>
        <div className="grid g2">
          <label className="f">Lock vouchers up to<input className="in" type="date" value={lock} onChange={e => setLock(e.target.value)} /></label>
          <button className="btn p" style={{ alignSelf: "end" }} onClick={async () => { await setVoucherLock(lock); toast("Locked up to " + lock); }}>Save lock</button>
        </div>
        <div className="grid g2">
          <label className="f">Close financial year up to<input className="in" type="date" value={closeDate} onChange={e => setCloseDate(e.target.value)} /></label>
          <button className="btn bad" style={{ alignSelf: "end" }} onClick={async () => {
            if (!closeDate) return toast("Choose date", true);
            if (!confirm("Carry all current customer and supplier balances forward as opening balances and lock old vouchers?")) return;
            const r = await closeFinancialYear(by, closeDate); toast("Closed " + r.fy);
          }}>Close year</button>
        </div>
        <div className="xs mut">Locked vouchers cannot be edited, deleted or voided on any role. Year close carries customer and supplier balances forward as opening balances.</div>
      </div></div>
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
          <label className="f">Max discount without PIN (%)<input className="in" inputMode="decimal" value={s.max_disc ?? 10} onChange={e => setS({ ...s, max_disc: Number(e.target.value) || 0 })} /></label>
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

/* Owner/admin: the fixed rule that turns a COST into the sell rate + the secret
   cost code on every label — so the same cost always encodes the same way, on
   every device. The 10-letter code word is the whole secret, so it lives only in
   the shop's own synced config, never in the app code. */
function PricingCard() {
  const [rule, setRule] = useState<PricingRule>(DEFAULT_RULE);
  const [sample, setSample] = useState("120");   // ₹ cost to preview
  const [keyErr, setKeyErr] = useState<string | null>(null);
  useEffect(() => { getRule().then(r => { setRule(r); setKeyErr(validateKey(r.code.key)); }); }, []);

  const m = rule.margin, c = rule.code;
  const setM = (patch: Partial<PricingRule["margin"]>) => setRule(r => ({ ...r, margin: { ...r.margin, ...patch } }));
  const setC = (patch: Partial<PricingRule["code"]>) => setRule(r => ({ ...r, code: { ...r.code, ...patch } }));

  const preview = (() => {
    const paise = toPaise(sample);
    if (!paise) return null;
    if (c.method === "letters" && validateKey(c.key)) return null; // don't preview with a broken key
    try { return priceFromCost(paise, rule, 12, "PCS"); } catch { return null; }
  })();

  const save = async () => {
    const err = c.method === "letters" ? validateKey(c.key) : null;
    if (err) { setKeyErr(err); toast(err, true); return; }
    await saveRule(rule);
    toast("Pricing rule saved — every counter now encodes the same way");
  };

  return (
    <div className="card"><header><h3>Pricing &amp; cost code</h3><span className="grow" /><span className="pill ok">used on every label</span></header>
      <div className="pad stack">
        <div className="xs mut">Enter a cost on the Labels screen and the sell rate + secret code fill in by themselves. Change the rule here and it reaches every counter.</div>

        {/* --- margin: cost -> sell rate --- */}
        <div className="grid g2">
          <label className="f">Sell price is cost
            <select className="in" value={m.mode} onChange={e => setM({ mode: e.target.value as any })}>
              <option value="multiply">× a factor</option>
              <option value="divide">÷ a factor</option>
              <option value="percent">+ a percent markup</option>
            </select></label>
          {m.mode === "percent"
            ? <label className="f">Markup %<input className="in mono" inputMode="decimal" value={m.percent} onChange={e => setM({ percent: Number(e.target.value) || 0 })} /></label>
            : <label className="f">Factor<input className="in mono" inputMode="decimal" value={m.factor} onChange={e => setM({ factor: Number(e.target.value) || 0 })} /></label>}
          <label className="f">Round the price to
            <select className="in" value={m.round_to} onChange={e => setM({ round_to: Number(e.target.value) as RoundTo })}>
              <option value={0}>Exact (paise)</option><option value={1}>₹1</option><option value={5}>₹5</option>
              <option value={10}>₹10</option><option value={50}>₹50</option><option value={100}>₹100</option>
            </select></label>
          <label className="f">Rounding
            <select className="in" value={m.round_dir} onChange={e => setM({ round_dir: e.target.value as any })}>
              <option value="nearest">Nearest</option><option value="up">Always up</option>
            </select></label>
        </div>

        {/* --- how the cost is hidden on the label --- */}
        <div className="grid g2">
          <label className="f">Hide the cost as
            <select className="in" value={c.method} onChange={e => { setC({ method: e.target.value as any }); setKeyErr(e.target.value === "letters" ? validateKey(c.key) : null); }}>
              <option value="letters">Code word (letters)</option>
              <option value="shift">Maths shift (× / +)</option>
              <option value="plain">Plain number (no hiding)</option>
            </select></label>
          <label className="f">Code prefix (optional)<input className="in mono" value={c.prefix} maxLength={4} onChange={e => setC({ prefix: e.target.value.toUpperCase() })} /></label>

          {c.method === "letters" && (
            <label className="f" style={{ gridColumn: "1/-1" }}>Secret code word — 10 different letters, one per digit 0–9
              <input className={"in mono" + (keyErr ? " bad" : "")} value={c.key} maxLength={10}
                onChange={e => { const k = e.target.value.toUpperCase().replace(/[^A-Z]/g, ""); setC({ key: k }); setKeyErr(validateKey(k)); }} />
              {keyErr ? <span className="xs bad">{keyErr}</span>
                : <span className="xs mut">{c.key.split("").map((ch, i) => `${i}=${ch}`).join("  ")}</span>}
            </label>
          )}
          {c.method === "shift" && <>
            <label className="f">Multiply cost by<input className="in mono" inputMode="decimal" value={c.mult} onChange={e => setC({ mult: Number(e.target.value) || 1 })} /></label>
            <label className="f">Then add<input className="in mono" inputMode="decimal" value={c.add} onChange={e => setC({ add: Number(e.target.value) || 0 })} /></label>
          </>}
          <label className="row sm" style={{ gridColumn: "1/-1" }}><input type="checkbox" checked={c.suffix_pack} onChange={e => setC({ suffix_pack: e.target.checked })} /> Append the packing to the code (e.g. X12PCS)</label>
        </div>

        {/* --- live preview --- */}
        <div className="note stack" style={{ gap: 6 }}>
          <div className="row sm" style={{ flexWrap: "nowrap" }}>
            <label className="f" style={{ margin: 0 }}>Try a cost ₹<input className="in mono" style={{ width: 110 }} inputMode="decimal" value={sample} onChange={e => setSample(e.target.value)} /></label>
            <span className="grow" />
          </div>
          {preview ? (
            <div className="row sm" style={{ gap: 16 }}>
              <span>Sell rate: <b className="mono">{rupees(preview.rate)}</b></span>
              <span>Label code: <b className="mono">{preview.cost_code}</b></span>
            </div>
          ) : <div className="xs mut">{c.method === "letters" && keyErr ? "Fix the code word to see the preview." : "Enter a cost to preview."}</div>}
        </div>

        <button className="btn p" onClick={save} disabled={c.method === "letters" && !!keyErr}>Save pricing rule</button>
        <div className="xs mut">Tip: the code word is the whole secret — anyone who knows it can read a cost off a shelf tag. Share it only with people you trust, and change it here if it ever leaks.</div>
      </div></div>
  );
}

/* Owner/admin: the shop's master lists for CATEGORIES, STYLES, COLOURS and SIZES.
   These power the dropdowns on the product screen and the catalogue. Add a colour
   once and it's available on every device. Free text is still allowed on products;
   this just keeps things consistent. */
function TaxonomyCard() {
  const [t, setT] = useState<Taxonomy | null>(null);
  const [newCat, setNewCat] = useState("");
  const [newStyle, setNewStyle] = useState("");
  const [newSize, setNewSize] = useState("");
  const [newColour, setNewColour] = useState("");
  useEffect(() => { getTaxonomy().then(setT); }, []);
  if (!t) return null;

  const chipList = (field: "categories" | "styles" | "sizes", value: string, setValue: (v: string) => void, label: string) => (
    <div className="stack" style={{ gap: 6 }}>
      <div className="sm b">{label}</div>
      <div className="chips">
        {t[field].map(x => (
          <span key={x} className="chip" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
            {x}<button className="linkbtn" title="Remove" onClick={async () => setT(await removeFrom(field, x))}>✕</button>
          </span>
        ))}
        {!t[field].length && <span className="xs mut">None yet.</span>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="in" style={{ minHeight: 34 }} placeholder={"Add " + label.toLowerCase().replace(/s$/, "")} value={value}
          onChange={e => setValue(e.target.value)} onKeyDown={async e => { if (e.key === "Enter" && value.trim()) { setT(await addTo(field, value.trim())); setValue(""); } }} />
        <button className="btn sm" onClick={async () => { if (value.trim()) { setT(await addTo(field, value.trim())); setValue(""); } }}>Add</button>
      </div>
    </div>
  );

  return (
    <div className="card"><header><h3>Categories, styles &amp; colours</h3><span className="grow" /><span className="pill ok">used across the app</span></header>
      <div className="pad stack" style={{ gap: 14 }}>
        {chipList("categories", newCat, setNewCat, "Categories")}
        {chipList("styles", newStyle, setNewStyle, "Styles")}
        {chipList("sizes", newSize, setNewSize, "Sizes")}

        <div className="stack" style={{ gap: 6 }}>
          <div className="sm b">Colours <span className="xs mut">(the code prints on the label as {"{style}-{code}"})</span></div>
          <div className="stack" style={{ gap: 4, maxHeight: 200, overflow: "auto" }}>
            {t.colours.map(c => (
              <div key={c.name} className="row between sm">
                <span className="grow">{c.name}</span>
                <span className="mono xs mut">{c.code}</span>
                <button className="btn sm bad" onClick={async () => setT(await removeColour(c.name))}>Remove</button>
              </div>
            ))}
            {!t.colours.length && <span className="xs mut">None yet.</span>}
          </div>
          <div className="row" style={{ gap: 6 }}>
            <input className="in" style={{ minHeight: 34 }} placeholder="Add colour (e.g. Rani Pink)" value={newColour}
              onChange={e => setNewColour(e.target.value)} onKeyDown={async e => { if (e.key === "Enter" && newColour.trim()) { setT(await addColour(newColour.trim())); setNewColour(""); } }} />
            {newColour.trim() && <span className="pill">{colourCodeFor(newColour)}</span>}
            <button className="btn sm" onClick={async () => { if (newColour.trim()) { setT(await addColour(newColour.trim())); setNewColour(""); } }}>Add</button>
          </div>
        </div>

        <div className="xs mut">Changes save instantly and sync to every counter. To reset to a fresh starter set, clear a list and re-add — nothing here is fixed in code.</div>
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
        {row(h?.ai, "GEMINI_API_KEY", "reads product photos, voice orders, Ask the shop")}
        {row(h?.openai, "OPENAI_API_KEY", `writes product pages from the photo facts${h?.openai_model ? " · " + h.openai_model : ""}`)}
        {row(h?.groq, "GROQ_API_KEY", `takes over when OpenAI is out of credits or busy${h?.groq_model ? " · " + h.groq_model : ""}`)}
        {row(h?.r2, "R2_ACCOUNT_ID · R2_ACCESS_KEY_ID · R2_SECRET_ACCESS_KEY · R2_BUCKET · R2_PUBLIC_URL", "Cloudflare R2 — where every product photo is stored")}
        {row(h?.whatsapp_api, "WHATSAPP_TOKEN + WHATSAPP_PHONE_NUMBER_ID", "optional automatic sending; tap-to-send works without it")}
        {row(h?.supabase, "SUPABASE_URL + SUPABASE_ANON_KEY", "lets the server check the shop login")}
        <div className="xs mut">Keys are added in Vercel → project rungnna_shop_os → Settings → Environment Variables, then Deployments → ⋯ → Redeploy. They never go into the app itself.</div>
      </div></div>
  );
}

/* Owner only: the code that opens estimates. Staff never see estimates or this card. */
function PrivateCard() {
  const open = usePrivate();
  const [has, setHas] = useState<boolean | null>(null);
  const [code, setCodeV] = useState(""); const [again, setAgain] = useState(""); const [hint, setHint] = useState(""); const [min, setMin] = useState(10);
  useEffect(() => { getPrivate().then(c => { setHas(!!c); if (c) { setHint(c.hint); setMin(c.minutes || 10); } }); }, []);
  return (
    <div className="card"><header><h3>Private estimates</h3><span className="grow" /><span className={"pill " + (open ? "warn" : "ok")}>{open ? "open on this device" : "hidden"}</span></header>
      <div className="pad stack">
        <div className="sm mut">Estimates are hidden from everyone. To open them on the bill screen: long-press or double-tap “Tax invoice”, or type # and your code in the scan box, then Enter. They lock again after {min} idle minutes or when the app is closed.</div>
        <div className="grid g2">
          <input className="in mono" type="password" inputMode="numeric" autoComplete="new-password" placeholder={has ? "New code" : "Choose a code (4+ digits)"} value={code} onChange={e => setCodeV(e.target.value)} />
          <input className="in mono" type="password" inputMode="numeric" autoComplete="new-password" placeholder="Same code again" value={again} onChange={e => setAgain(e.target.value)} />
          <input className="in" placeholder="Hint only you understand (optional)" value={hint} onChange={e => setHint(e.target.value)} />
          <label className="f">Lock after (minutes idle)<input className="in mono" inputMode="numeric" value={min} onChange={e => setMin(parseInt(e.target.value) || 10)} /></label>
        </div>
        <div className="row">
          <button className="btn p" onClick={async () => {
            if (code.length < 4) return toast("Use at least 4 characters", true);
            if (code !== again) return toast("The two codes don't match", true);
            await setCode(code, hint.trim(), Math.max(1, Math.min(120, min))); setCodeV(""); setAgain(""); setHas(true); lockNow(); toast("Code saved on every counter");
          }}>{has ? "Change code" : "Set code"}</button>
          {open && <button className="btn" onClick={() => lockNow()}>Lock now</button>}
        </div>
      </div></div>
  );
}
