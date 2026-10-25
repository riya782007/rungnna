import { setViewCode } from "../lib/viewCode";
import { PersonPerms } from "../components/PersonPerms";
import { currentStore } from "../lib/scope";
import { askText } from "../components/AskHost";
import { DeleteButton } from "../components/DeleteButton";
import { confirmDelete } from "../lib/confirm-delete";
import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, getSetting, setSetting, deviceId, uid, type Staff } from "../lib/db";
import { Head } from "../components/common";
import { useApp, toast, newStaff, SEED_OWNER, logoutEveryone } from "../lib/app";
import { onSync, signIn, signOut, syncNow, exportAll, importAll, createShopLogin, sb, ensureSession, markShopDevice, type SyncState } from "../lib/sync";
import type { Pattern } from "../lib/parse";
import { when } from "../lib/format";
import { getShop, saveShop, counterCode, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { health, type Health } from "../lib/ai";
import { can, ROLE_NOTE, roleName, isRoleLogin } from "../lib/roles";
import { RoleSelect } from "./Roles";
import { entryWait, recordEntryAttempt, personForPin, staffForRolePasscode } from "../lib/entryAuth";
import { codeMatches, getOpenCode, setOpenCode, DEFAULT_OPEN_CODE } from "../lib/openCode";
import { getPrivate, setCode, lockNow, usePrivate } from "../lib/privacy";
import { DeleteEstimates } from "../components/DeleteEstimates";
import { getTaxonomy, addTo, removeFrom, addColour, removeColour, colourCodeFor, type Taxonomy } from "../lib/taxonomy";
import { initLang, setLang, type Lang } from "../lib/i18n";
import { closeFinancialYear, lockedUpto, setVoucherLock } from "../lib/finance";
import { SecuritySettings } from "../components/OwnerSecurity";
import { CloudSyncControl } from "../components/CloudSyncControl";
import { OldCodesCard } from "../components/OldCodesCard";
import { PricingCard, StickerLookCard, SupplierTermsCard, PrintingCard, GstCard, SaveState, NoLessCard } from "../components/SettingsCards";

/* Settings in five plain groups, one at a time (owner, 18 Oct: the long page left half the screen empty and
   things were hard to find). Each group is a tab; its cards flow into balanced columns. */
type TabKey = "shop" | "prices" | "suppliers" | "people" | "backup";
const TABS: { key: TabKey; label: string; intro: string }[] = [
  { key: "shop", label: "Shop & bills", intro: "Your shop's details on every bill, bill printing, GST and the financial year." },
  { key: "prices", label: "Prices & stickers", intro: "How a cost becomes a selling rate and a secret cost code, and what the stickers look like." },
  { key: "suppliers", label: "Suppliers", intro: "Each supplier's rate ÷ and less %, used when their bill is read." },
  { key: "people", label: "People & safety", intro: "Who works here, what they may do, passcodes and the private estimates." },
  { key: "backup", label: "Backup & devices", intro: "Cloud saving, a backup file for the pen drive, and the AI / WhatsApp connections." },
];

export default function Settings({ tab: tabArg }: { tab?: string } = {}) {
  const { me, setMe } = useApp();
  const staff = useLiveQuery(() => db.staff.toArray(), [], []);
  const [sync, setSync] = useState<SyncState>();
  const [nm, setNm] = useState(""); const [pin, setPin] = useState(""); const [open, setOpen] = useState("");
  const [pats, setPats] = useState<Pattern[]>([]);
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => onSync(setSync) as any, []);
  useEffect(() => { getSetting<Pattern[]>("patterns", []).then(setPats); }, []);
  const admin = can(me, "settings"), boss = can(me, "staff");
  const tabs = TABS.filter(t => t.key === "people" || t.key === "backup" || t.key === "shop" || admin);
  const tab: TabKey = (tabs.find(t => t.key === tabArg)?.key) || "shop";
  const cur = TABS.find(t => t.key === tab)!;

  const meCard = (
    <div className="card pad stack">
      <div className="row"><span className="avatar" style={{ width: 44, height: 44, fontSize: 17 }}>{me?.name.slice(0, 1)}</span>
        <span className="grow"><b>{me?.name}</b><div className="xs mut">{roleName(me)}{me?.role_id ? "" : " · " + (me ? ROLE_NOTE[me.role] : "")}</div></span>
        <button className="btn sm" onClick={() => setMe(null)}>Switch person</button></div>
      {me?.role === "owner" && <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <button className="btn sm bad" onClick={async () => {
          if (!confirm("Log out everyone on every other computer and phone now?\n\nEstimates close everywhere. Each person signs in again with the shop code, name and PIN.")) return;
          await logoutEveryone(me.name); toast("Everyone else is logged out (computers that are offline log out as soon as they connect)");
        }}>Log out everyone</button>
        <span className="xs mut">For an emergency — from your phone too.</span></div>}
      {me && isRoleLogin(me) && <div className="xs mut">Signed in with this role's passcode. The owner changes it on Roles &amp; Permissions.</div>}
      {me && !isRoleLogin(me) && <button className="btn sm" onClick={async () => {
        const p = await askText(me.pin ? "New 4-digit personal PIN" : "Set a 4-digit PIN so nobody else can use your name", "", { secret: true, numeric: true });
        if (p === null) return; if (!/^\d{4}$/.test(p)) return toast("PIN must be 4 digits", true);
        const u = { ...me, pin: p }; await put("staff", u); setMe(u); toast(p ? "PIN saved" : "PIN removed");
      }}>{me.pin ? "Change my PIN" : "Set my PIN"}</button>}
      {me?.role === "owner" && !me.pin && <div className="note warn sm">Set a PIN — it's needed to approve big discounts and to keep your owner access safe.</div>}
    </div>);

  return (
    <div>
      <Head title="Settings" sub={"This device · " + deviceId()} />
      <nav className="tabs set-tabs" aria-label="Settings sections">
        {tabs.map(t => <a key={t.key} href={"#/settings/" + t.key} className={t.key === tab ? "on" : ""} aria-current={t.key === tab ? "page" : undefined}>{t.label}</a>)}
      </nav>
      <p className="set-tab-intro">{cur.intro}</p>

      {tab === "shop" && <div className="set-grid">
        {admin && <ShopProfile />}
        {can(me, "printers.manage") && <PrintingCard />}
        {boss && <GstCard />}
        {can(me, "lock") && <OperationsCard by={me?.id || ""} />}
        <div className="card"><header><h3>Elsewhere</h3></header><div className="pad stack">
          {boss && <a className="btn" href="#/bank">Bank reconciliation →</a>}
          <a className="btn" href="#/stores">{boss ? "Store setup & transfers →" : "Stock transfers →"}</a>
        </div></div>
      </div>}

      {tab === "prices" && admin && <div className="set-grid">
        <PricingCard />
        <NoLessCard />
        <StickerLookCard />
        <AllOldCodes />
        <TaxonomyCard />
      </div>}

      {tab === "suppliers" && admin && <div className="set-grid set-grid-1">
        <SupplierTermsCard />
      </div>}

      {tab === "people" && <div className="set-grid">
        {meCard}
        {boss && <div className="card"><header><h3>Shop passcode</h3></header>
          <div className="pad stack">
            <div className="set-intro">The common entry code opens the sign-in screen on every counter. Each person then uses their own PIN or role passcode; the entry code does not grant owner access.</div>
            <OpenCodeSetting />
          </div></div>}
        {boss && <div className="card"><header><h3>People</h3><span className="grow" /><a className="btn sm" href="#/roles">Roles &amp; permissions</a></header>
          <div className="list" style={{ border: 0, borderRadius: 0, boxShadow: "none" }}>
            {staff.filter(s => !s.deleted && !isRoleLogin(s)).map(s => (
              <div key={s.id} className="li person-row">
                <div className="person-info"><div className="person-name"><b>{s.name}</b>{me?.id === s.id && <span className="pill ok">you</span>}{!s.active && <span className="pill warn">disabled</span>}</div>
                  <div className="xs mut">{s.role === "owner" ? "owner · everything" : Array.isArray(s.perms) ? `own ticks · ${s.perms.length} allowed` : roleName(s) + (s.role_id ? "" : " · " + ROLE_NOTE[s.role])}{s.pin ? " · PIN set" : " · no PIN yet"}</div></div>
                <div className="person-actions">
                {s.role !== "owner" && s.id !== me?.id && <button className="btn sm" aria-expanded={open === s.id} onClick={() => setOpen(open === s.id ? "" : s.id)}>{open === s.id ? "Done" : "Permissions"}</button>}
                {(s.role !== "owner" || me?.role === "owner") && <button className="btn sm" onClick={async () => {
                  const value = await askText(`New 4-digit PIN for ${s.name}`, "", { secret: true, numeric: true }); if (value === null) return;
                  if (!/^\d{4}$/.test(value)) return toast("PIN must be 4 digits", true);
                  const changed = { ...s, pin: value }; await put("staff", changed); if (s.id === me?.id) setMe(changed); toast("Personal PIN saved");
                }}>Set PIN</button>}
                <button className="btn sm" onClick={async () => { const n = await askText("Name", s.name); if (n?.trim()) { await put("staff", { ...s, name: n.trim() }); toast(`Renamed to ${n.trim()}`); } }}>Rename</button>
                {s.id !== me?.id && <button className="btn sm" onClick={async () => { await put("staff", { ...s, active: s.active ? 0 : 1 }); }}>{s.active ? "Disable" : "Enable"}</button>}
                </div>
                {open === s.id && <div style={{ flexBasis: "100%" }}><PersonPerms person={s} /></div>}
              </div>))}
          </div>
          <div className="pad stack" style={{ borderTop: "1px solid var(--line-2)" }}>
            <div className="sm b">Add a person</div>
            <div className="xs mut">Just the name. Then tick what they may do — the boxes open by themselves. A PIN can be set now or later.</div>
            <div className="grid g3">
              <input className="in" placeholder="Name" value={nm} onChange={e => setNm(e.target.value)} />
              <input className="in mono" placeholder="PIN (optional)" inputMode="numeric" maxLength={4} value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} />
            </div>
            <button className="btn" disabled={!nm.trim()} onClick={async () => {
              if (pin && !/^\d{4}$/.test(pin)) return toast("A PIN has 4 digits — or leave it empty", true);
              const p = { ...newStaff(nm.trim().toUpperCase(), "salesman", pin), perms: [] as string[], store_id: currentStore() };
              await put("staff", p); setNm(""); setPin(""); setOpen(p.id); toast(`${p.name} added — tick what they may do`);
            }}>Add person</button>
          </div></div>}
        {me?.role === "owner" && <ViewCodeCard />}
        {boss && <PrivateCard />}
        {boss && <SecuritySettings />}
      </div>}

      {tab === "backup" && <div className="set-grid">
        <div className="card"><header><h3>Cloud backup</h3><span className="grow" />
          <span className={"pill " + (!sync?.cloudEnabled || !sync?.user ? "warn" : sync?.status === "idle" && !sync.pending ? "ok" : sync?.status === "error" ? "bad" : "warn")}>{!sync?.cloudEnabled ? "offline mode" : !sync?.user ? "not connected" : sync?.status === "idle" && !sync.pending ? "✓ all saved" : sync?.status}</span></header>
          <div className="pad stack">
            <div className="set-intro">Every bill, product and payment is saved to the cloud and shared with the other counters automatically.</div>
            <CloudSyncControl />
            <div className="sm mut">{sync?.pending || 0} changes waiting{sync?.last ? ` · last saved ${when(sync.last)}` : ""}</div>
            {sync?.error && <div className="note bad">{sync.error}</div>}
            <StuckChanges />
            {sync?.user ? <div className="row"><span className="sm grow">Connected as <b>{sync.user}</b></span><button className="btn sm" disabled={!sync.cloudEnabled} onClick={() => syncNow()}>Sync now</button>{admin && <button className="btn sm" onClick={signOut}>Disconnect</button>}</div>
              : <ShopLogin />}
          </div></div>
        {boss && <div className="card"><header><h3>Backup file</h3></header>
          <div className="pad stack">
            <div className="set-intro">Everything on this device in one file. Keep a copy on a pen drive every week.</div>
            <div className="row">
              <button className="btn" onClick={async () => { const b = await exportAll(); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `rungnna-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}>Download backup</button>
              <input ref={file} type="file" accept="application/json" hidden onChange={async e => { const f = e.target.files?.[0]; if (!f) return; try { await importAll(f); toast("Backup restored"); } catch (x: any) { toast(x.message, true); } }} />
              {admin && <button className="btn" onClick={() => file.current?.click()}>Restore from file</button>}
            </div>
          </div></div>}
        {admin && <Keys />}
        {admin && <div className="card"><header><h3>Label layouts learnt</h3></header>
          <div className="pad stack">
            <div className="set-intro">Supplier labels the scan screen has learnt to read.</div>
            {!pats.length && <div className="mut sm">None yet. When a label isn't understood, the scan screen asks once which piece is which.</div>}
            {pats.map(p => (
              <div key={p.id} className="row sm"><span className="grow"><b>{p.name}</b> · {p.count} pieces → {p.map.map(m => m || "–").join(", ")}</span>
                <DeleteButton className="btn sm bad" onDelete={async () => { if (!await confirmDelete("Forget this learned label layout?")) return; const n = pats.filter(x => x.id !== p.id); setPats(n); await setSetting("patterns", n); }}>Forget</DeleteButton></div>))}
          </div></div>}
      </div>}
    </div>
  );
}

const ROLES: Staff["role"][] = ["owner", "manager", "cashier", "salesman", "helper", "packer"];

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

export function ShopLogin({ onDone, emailOnly }: { onDone?: () => void; emailOnly?: boolean }) {
  // no made-up default: Supabase only accepts an address that can really receive mail
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState(false);
  const [first, setFirst] = useState(false);
  /* Owner, 22 Oct: "it keeps asking me to create the company again". This form used to be the only way
     to connect, and a wrong password ticked "First time" by itself, so every computer made a brand-new
     login. A computer now connects with one tap (and by itself after the entry code); the email login
     is folded away for the owner's own use. */
  const connect = async () => {
    setJoining(true);
    try {
      await markShopDevice();
      if (await ensureSession()) { await syncNow(); toast("This computer is connected — stock, bills and the bill reader are on"); onDone?.(); }
      else toast(!navigator.onLine ? "No internet — it will connect by itself when the internet is back" : "The cloud did not let this computer in by itself. Use the owner's email login below.", true);
    } finally { setJoining(false); }
  };
  return (
    <div className="stack">
      <div className="xs mut">Connects this computer to the shop's cloud: the same stock and bills as the other floors, the backup, product photos and the purchase-bill reader.</div>
      {!emailOnly && <button type="button" className="btn p" disabled={joining} onClick={() => void connect()}>{joining ? "Connecting…" : "Connect this computer"}</button>}
      <details open={emailOnly}>
        <summary className="sm">Use the owner's email login instead</summary>
        <form className="stack" style={{ marginTop: 8 }} onSubmit={async e => {
          e.preventDefault(); setBusy(true);
          try {
            if (first) {
              const r = await createShopLogin(email.trim(), pw);
              toast(r === "confirm" ? "Login made — open the confirmation e-mail, then sign in here" : "Shop login made and this computer is connected", r === "confirm");
            } else {
              await signIn(email.trim(), pw);
              toast("Computer connected — stock will back up automatically");
            }
            await markShopDevice();
            onDone?.();
          }
          catch (x: any) {
            const m = String(x?.message || "");
            toast(!navigator.onLine ? "No internet — you can connect later"
              : /invalid login credentials/i.test(m) && !first ? "Email or password is not right. Use the same email as on the other computers — you don't need a new login."
              : m || "Could not sign in", true);
          }
          finally { setBusy(false); }
        }}>
          <label className="f">Owner's email<input className="in" type="email" inputMode="email" autoComplete="username" placeholder="the same email as on the other computers" value={email} onChange={e => setEmail(e.target.value)} /></label>
          <label className="f">Password<input className="in" type="password" value={pw} onChange={e => setPw(e.target.value)} autoComplete={first ? "new-password" : "current-password"} /></label>
          <label className="row sm" style={{ gap: 8 }}>
            <input type="checkbox" checked={first} onChange={e => setFirst(e.target.checked)} />
            <span>Make a new email login (not needed if the shop already has one)</span>
          </label>
          <button className="btn" disabled={busy || !pw || !/^\S+@\S+\.\S+$/.test(email.trim())}>{busy ? (first ? "Making…" : "Connecting…") : first ? "Make the login" : "Sign in"}</button>
        </form>
      </details>
    </div>
  );
}

/* Every counter shares the entrance code; identity and permissions remain personal. */
export function WhoAreYou() {
  const { setMe } = useApp();
  const staff = useLiveQuery(() => db.staff.filter(s => !s.deleted && !!s.active).toArray(), [], []);
  // the blank "Owner" every new install starts with is only a placeholder: once the shop's real owner has
  // arrived from the cloud it is not offered (picking it is what "made the company again", 22 Oct)
  const realOwner = staff.some(s => s.role === "owner" && s.id !== SEED_OWNER && !isRoleLogin(s));
  const persons = staff.filter(s => !isRoleLogin(s) && !(realOwner && s.id === SEED_OWNER && !s.pin));
  const [unlocked, setUnlocked] = useState(false);
  const [code, setCode] = useState("");
  const [bad, setBad] = useState("");
  const [pick, setPick] = useState<Staff | null>(null);
  const [pin, setPin] = useState("");
  /* Owner, 23–24 Oct: "the sign-in must not show the names of who can open it. Only the shop's password, then the
     person types his own name, then his password." So no list of names: the name is typed and checked with the PIN. */
  const [typed, setTyped] = useState("");
  const [roleMode, setRoleMode] = useState(false);
  const [owner, setOwner] = useState("");
  const [newPin, setNewPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [wait, setWait] = useState(0);
  const [reset, setReset] = useState(false);
  const needsName = persons.length === 1 && persons[0].name === "Owner" && persons[0].role === "owner" && !persons[0].pin;
  const stage = unlocked ? "identity" : "shop";
  // the sign-in screen is a safe moment for the Windows app to switch to a waiting new version
  useEffect(() => { document.documentElement.dataset.locked = "1"; return () => { delete document.documentElement.dataset.locked; }; }, []);
  /* A new computer, browser or app: bring the shop's people (and stock) from the cloud BEFORE offering to
     set up an owner, so the owner signs in with the PIN he already has instead of starting a new shop. */
  const [joining, setJoining] = useState(false);
  useEffect(() => {
    if (!unlocked) return;
    let live = true;
    (async () => {
      await markShopDevice();
      if (!needsName || !navigator.onLine) { void ensureSession().then(ok => { if (ok) void syncNow(); }); return; }
      setJoining(true);
      const stop = setTimeout(() => live && setJoining(false), 25_000);
      try { if (await ensureSession()) await syncNow(); } finally { clearTimeout(stop); if (live) setJoining(false); }
    })();
    return () => { live = false; };
  }, [unlocked]);
  useEffect(() => { entryWait(stage).then(setWait); }, [stage]);
  useEffect(() => { if (wait <= 0) return; const timer = setTimeout(() => setWait(w => Math.max(0, w - 1000)), 1000); return () => clearTimeout(timer); }, [wait]);

  const attempt = async (action: () => Promise<boolean>) => {
    if (busy) return;
    setBusy(true); setBad("");
    try {
      const remaining = await entryWait(stage); if (remaining > 0) { setWait(remaining); return; }
      if (await action()) { await recordEntryAttempt(true, stage); setCode(""); setPin(""); }
      else { setWait(await recordEntryAttempt(false, stage)); setBad(unlocked ? "Name or PIN not recognised. Check the spelling of your name, or ask the owner." : "Entry code not recognised. Ask the owner."); setCode(""); setPin(""); }
    } catch (e: any) { setBad(e.message || "Could not open. Try again."); }
    finally { setBusy(false); }
  };
  const open = (e: React.FormEvent) => {
    e.preventDefault();
    void attempt(async () => {
      if (!unlocked) { if (!codeMatches(code, await getOpenCode())) return false; setUnlocked(true); return true; }
      if (roleMode) { const person = await staffForRolePasscode(code); if (!person) return false; setMe(person); return true; }
      const want = typed.trim().toUpperCase().replace(/\s+/g, " ");
      const named = persons.filter(s => s.name.trim().toUpperCase().replace(/\s+/g, " ") === want);
      // an owner with no PIN yet sets one now (one-time); anyone else without a PIN asks the owner
      const fresh = named.find(s => s.role === "owner" && !s.pin);
      if (fresh) { setPick(fresh); return true; }
      for (const s of named) { const person = s.pin ? await personForPin(s.id, pin) : null; if (person) { setMe(person); return true; } }
      return false;
    });
  };
  const setupOwner = async (person: Staff, name = person.name) => {
    if (busy || !/^\d{4}$/.test(newPin) || !name.trim()) return;
    setBusy(true);
    try {
      const current = await db.staff.get(person.id);
      if (!current || current.pin || !current.active || current.deleted || current.role !== "owner") throw new Error("Owner setup changed. Lock and sign in again.");
      /* The placeholder has the same id on every install, so saving it as the owner replaced the shop's
         real owner in the cloud (22 Oct: "karan" became "m"). A new owner gets an id of its own. */
      const saved = current.id === SEED_OWNER ? { ...current, id: uid(), name: name.trim(), pin: newPin } : { ...current, name: name.trim(), pin: newPin };
      await put("staff", saved);
      if (current.id === SEED_OWNER) await db.staff.delete(SEED_OWNER);
      setMe(saved);
    } catch (e: any) { setBad(e.message); } finally { setBusy(false); }
  };

  return <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
    <div className="card" style={{ maxWidth: 440, width: "100%" }}>
      <header style={{ background: "linear-gradient(140deg,var(--emerald-dk),var(--emerald))", color: "#fff", borderRadius: "14px 14px 0 0" }}>
        <span className="mark">R</span><div><b style={{ font: "700 26px/1 var(--display)", color: "var(--gold-l)" }}>Rungnna</b><div className="xs" style={{ opacity: .7 }}>Jewellery &amp; Co · Shop OS</div></div></header>
      <div className="pad stack">
        {unlocked && reset ? <OwnerPinReset onDone={person => { setReset(false); if (person) setMe(person); }}
            onUseCloud={o => { setReset(false); setPick(null); setTyped(o.name); setRoleMode(false); setPin(""); setCode(""); setBad(""); }} />
        : unlocked && joining ? <div className="stack" role="status">
          <div className="b sm">Getting the shop from the cloud…</div>
          <div className="xs mut">Names, PINs, stock and bills are coming to this computer. Then sign in with your usual PIN — no new setup needed.</div>
          <button type="button" className="linkbtn" onClick={() => setJoining(false)}>This is a new shop — set it up here</button>
        </div>
        : unlocked && (needsName || (pick?.role === "owner" && !pick.pin)) ? <form className="stack" onSubmit={e => { e.preventDefault(); void setupOwner(needsName ? persons[0] : pick!, needsName ? owner : pick!.name); }}>
          <div className="b sm">Set up the owner's personal PIN</div>
          <div className="xs mut">One-time setup for an owner who has no PIN yet. Keep this PIN private; staff use their own access.</div>
          {needsName && <label className="f">Owner's name<input className="in" autoFocus value={owner} onChange={e => setOwner(e.target.value)} placeholder="e.g. Karan" /></label>}
          <label className="f">New 4-digit personal PIN<input className="in mono" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={newPin} onChange={e => setNewPin(e.target.value.replace(/\D/g, ""))} /></label>
          <button className="btn p" disabled={busy || !/^\d{4}$/.test(newPin) || (needsName && !owner.trim())}>Save PIN &amp; open</button>
        </form> : <form className="stack" onSubmit={open}>
          {unlocked && !roleMode && <label className="f">Your name
            <input className="in" autoFocus key={"name" + stage} autoComplete="username" autoCapitalize="words" spellCheck={false} placeholder="Type your name" value={typed}
              onChange={e => { setTyped(e.target.value); setBad(""); }} /></label>}
          <label className="f">{!unlocked ? "Common shop entry code" : roleMode ? "Your role passcode" : "Your password (PIN)"}
            <input className="in" autoFocus={!unlocked || roleMode} key={stage + (roleMode ? "r" : "p")} type="password" autoComplete="current-password" inputMode={unlocked && !roleMode ? "numeric" : "text"} maxLength={unlocked && !roleMode ? 4 : undefined}
              placeholder={!unlocked ? "Same entry code for everyone" : roleMode ? "Type your own role passcode" : "Your 4-digit PIN"} value={unlocked && !roleMode ? pin : code}
              onChange={e => { unlocked && !roleMode ? setPin(e.target.value.replace(/\D/g, "")) : setCode(e.target.value); setBad(""); }} /></label>
          <button className="btn p" disabled={busy || wait > 0 || (unlocked && !roleMode ? !typed.trim() || (pin.length !== 4 && !persons.some(s => s.role === "owner" && !s.pin)) : !code.trim())}>{busy ? "Checking…" : unlocked ? "Sign in" : "Continue"}</button>
          {unlocked && <>
            <button type="button" className="linkbtn" onClick={() => { setRoleMode(m => !m); setPin(""); setCode(""); setBad(""); }}>{roleMode ? "Sign in with your name and PIN" : "Use a role passcode"}</button>
            <button type="button" className="linkbtn" onClick={() => { setReset(true); setBad(""); setPick(null); setPin(""); }}>Forgot the owner PIN? Set a new one with the shop's cloud login</button>
          </>}
        </form>}
        {bad && <div className="note warn" role="alert">{bad}</div>}
        {wait > 0 && <div className="note bad sm" role="status">Too many wrong attempts — try again in {Math.ceil(wait / 1000)}s.</div>}
        {unlocked && <button type="button" className="linkbtn" onClick={() => { setUnlocked(false); setPick(null); setTyped(""); setRoleMode(false); setPin(""); setCode(""); setBad(""); }}>Lock shop</button>}
        <div className="xs mut">Works offline after this counter has loaded the app and received its staff and stock. Role and PIN changes reach other counters when sync is allowed and connected.</div>
      </div>
    </div>
  </div>;
}

/* Owner, 22 Oct: on one counter the owner's PIN was not known (the owner there was named "m", set on that
   computer and never synced), so nobody could open the app. The shop's cloud login proves it is the shop —
   checked by the cloud, so a passer-by can't use this — and then a new owner PIN (and the owner's name) is
   set on this computer. Staff PINs are not touched. */
function OwnerPinReset({ onDone, onUseCloud }: { onDone: (person?: Staff) => void; onUseCloud: (owner: Staff) => void }) {
  const owners = useLiveQuery(() => db.staff.filter(s => !s.deleted && !!s.active && s.role === "owner" && !isRoleLogin(s)).toArray(), [], []);
  const [email, setEmail] = useState(""), [pw, setPw] = useState("");
  const [ok, setOk] = useState(false), [busy, setBusy] = useState(false), [err, setErr] = useState("");
  const [id, setId] = useState(""), [name, setName] = useState(""), [pin, setPin] = useState(""), [again, setAgain] = useState("");
  const owner = owners.find(o => o.id === id) || (owners.length === 1 ? owners[0] : undefined);
  const [cloud, setCloud] = useState<Staff[] | null>(null);
  /* The owner as kept in the shop's cloud, i.e. the PIN made in the web app (22 Oct). Its PIN is never
     shown: it replaces this computer's copy, and the owner then signs in with the PIN they already know. */
  const loadCloud = async () => {
    try {
      const c = await sb(); if (!c) return setCloud([]);
      const { data, error } = await c.from("staff").select("*").eq("role", "owner");
      if (error) throw error;
      setCloud(((data || []) as Staff[]).filter(o => !o.deleted && (o.active ?? 1) && o.pin));
    } catch { setCloud([]); }
  };
  const useCloud = async (o: Staff) => {
    setBusy(true); setErr("");
    try {
      await db.transaction("rw", db.staff, db.outbox, async () => {
        // this computer's unsent change to the owner (e.g. "m" with a forgotten PIN) must not overwrite the cloud
        await db.outbox.where("table").equals("staff").filter(x => x.row_id === o.id).delete();
        await db.staff.put(o);
      });
      toast(`${o.name}: sign in with the PIN made in the web app`);
      onUseCloud(o);
    } catch (x: any) { setErr(x.message || "Could not load the owner from the cloud"); } finally { setBusy(false); }
  };
  useEffect(() => { if (owner && !name) setName(owner.name); }, [owner?.id]);
  const verify = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy) return;
    setBusy(true); setErr("");
    try { await signIn(email.trim(), pw); setPw(""); setOk(true); void loadCloud(); }
    catch (x: any) {
      const m = String(x?.message || "");
      setErr(/fetch|network|offline/i.test(m) ? "This computer is offline. Connect to the internet and try again."
        : /not connected yet/i.test(m) ? "This app has no cloud set up, so the shop login can't be checked here. Ask Riya to reset the owner PIN."
        : "That is not the shop's cloud login. Check the email and password.");
    }
    finally { setBusy(false); }
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); if (busy || !owner) return;
    if (!/^\d{4}$/.test(pin)) return setErr("The PIN must be 4 digits.");
    if (pin !== again) return setErr("The two PINs are not the same.");
    if (!name.trim()) return setErr("Type the owner's name.");
    setBusy(true); setErr("");
    try { const saved = { ...owner, name: name.trim(), pin }; await put("staff", saved); toast("Owner PIN saved on this computer"); onDone(saved); }
    catch (x: any) { setErr(x.message || "Could not save"); } finally { setBusy(false); }
  };
  return <div className="stack">
    <div className="b sm">Owner PIN</div>
    {!ok ? <form className="stack" onSubmit={verify}>
      <div className="xs mut">First the shop's cloud login, the one used to connect this computer (owner's email and password). It proves this is the shop; the cloud checks it.</div>
      <label className="f">Shop login email<input className="in" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></label>
      <label className="f">Password<input className="in" type="password" autoComplete="current-password" value={pw} onChange={e => setPw(e.target.value)} /></label>
      <button className="btn p" disabled={busy || !pw || !/^\S+@\S+\.\S+$/.test(email.trim())}>{busy ? "Checking…" : "Check the shop login"}</button>
    </form> : <form className="stack" onSubmit={save}>
      <div className="note ok sm" role="status">✓ Shop login correct.</div>
      {cloud === null ? <div className="xs mut">Looking for the owner in the shop's cloud…</div>
        : cloud.length ? <div className="stack" style={{ gap: 6 }}>
          <div className="sm b">Use the PIN made in the web app</div>
          {cloud.map(o => <button key={o.id} type="button" className="btn p" disabled={busy} onClick={() => void useCloud(o)}>Use {o.name}'s PIN from the web app</button>)}
          <div className="xs mut">This computer takes the owner from the cloud; then sign in with the same PIN as in the web app. Or set a new PIN below.</div>
        </div> : null}
      <div className="sm b" style={{ marginTop: 6 }}>Or set a new owner PIN</div>
      <div className="xs mut">The new PIN becomes the owner's PIN on every counter and in the web app once this computer syncs.</div>
      {owners.length > 1 && <label className="f">Owner<select className="in" value={owner?.id || ""} onChange={e => { setId(e.target.value); setName(owners.find(o => o.id === e.target.value)?.name || ""); }}>
        <option value="">Choose</option>{owners.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>}
      <label className="f">Owner's name<input className="in" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Karan" /></label>
      <label className="f">New 4-digit PIN<input className="in mono" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={pin} onChange={e => setPin(e.target.value.replace(/\D/g, ""))} /></label>
      <label className="f">Same PIN again<input className="in mono" type="password" inputMode="numeric" maxLength={4} autoComplete="new-password" value={again} onChange={e => setAgain(e.target.value.replace(/\D/g, ""))} /></label>
      <button className="btn p" disabled={busy || !owner || pin.length !== 4 || again.length !== 4}>Save PIN &amp; open</button>
    </form>}
    {err && <div className="note warn sm" role="alert">{err}</div>}
    <button type="button" className="linkbtn" onClick={() => onDone()}>Back to sign in</button>
  </div>;
}

/* The phrase that opens the app on a counter (lib/openCode). */
function OpenCodeSetting() {
  const [code, setCode] = useState("");
  const [show, setShow] = useState(false);
  useEffect(() => { getOpenCode().then(setCode); }, []);
  return (
    <div className="stack">
      <label className="f">Common entry code
        <input className="in" type={show ? "text" : "password"} value={code} onChange={e => setCode(e.target.value)} placeholder={DEFAULT_OPEN_CODE} /></label>
      <div className="row">
        <button className="btn" onClick={() => setShow(!show)}>{show ? "Hide" : "Show"}</button>
        <button className="btn p" onClick={async () => { const saved = await setOpenCode(code); setCode(saved); toast("Entry code saved — other counters receive it when cloud sync is allowed"); }}>Save passcode</button>
        <span className="grow" />
        <button className="btn sm" onClick={async () => { const saved = await setOpenCode(DEFAULT_OPEN_CODE); setCode(saved); toast("Back to " + DEFAULT_OPEN_CODE); }}>Reset</button>
      </div>
      <div className="xs mut">Spaces and capitals do not matter. Leaving it empty puts it back to “{DEFAULT_OPEN_CODE}”, so a counter can never lock the shop out.</div>
    </div>
  );
}

/* Shop profile: printed on every bill, shared by all counters. */
function ShopProfile() {
  const [s, setS] = useState<Shop>(DEFAULT_SHOP);
  const [saved, setSaved] = useState<Shop>(DEFAULT_SHOP);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(s) !== JSON.stringify(saved);
  const [cc, setCc] = useState("");
  const [def, setDef] = useState("estimate");
  useEffect(() => { getShop().then(x => { setS(x); setSaved(x); }); counterCode().then(setCc); getSetting("default_bill_type", "estimate").then(setDef); }, []);
  const f = (k: keyof Shop, lbl: string, ph = "") => <label className="f">{lbl}<input className="in" value={String(s[k] ?? "")} placeholder={ph} onChange={e => { setJustSaved(false); setS({ ...s, [k]: k === "gst_rate" ? Number(e.target.value) || 0 : e.target.value }); }} /></label>;
  return (
    <div className="card"><header><h3>Shop profile (printed on bills)</h3><span className="grow" /><SaveState dirty={dirty} /></header>
      <div className="pad stack">
        <div className="set-intro">Printed at the top and bottom of every bill, on every counter.</div>
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
        <button className={"btn" + (dirty ? " p" : "")} disabled={!dirty} onClick={async () => { await saveShop(s); setSaved(s); setJustSaved(true); toast("Shop profile saved — every counter gets it"); }}>{dirty ? "Save shop profile" : "Saved"}</button>
        {justSaved && !dirty && <div className="note ok applied-note sm" role="status">✓ Saved. The next bill on every counter prints these details.</div>}
        <div className="grid g2">
          <label className="f">This counter's code (in bill numbers)<input className="in mono" value={cc} maxLength={4} onChange={e => setCc(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} onBlur={() => cc && setSetting("counter_code", cc)} /></label>
          <label className="f">New bills start as<select className="in" value={def} onChange={e => { setDef(e.target.value); setSetting("default_bill_type", e.target.value); }}><option value="estimate">Estimate</option><option value="gst">GST invoice</option></select></label>
        </div>
        <div className="xs mut">Each counter numbers its own bills (e.g. INV/26C10001, EST/26C10001), so two counters can bill offline at the same time without ever clashing. Give every counter a different code.</div>
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
            {x}<DeleteButton className="linkbtn" aria-label={"Remove " + x} onDelete={async () => { if (await confirmDelete("Remove " + x + " from " + label + "?")) setT(await removeFrom(field, x)); }}>✕</DeleteButton>
          </span>
        ))}
        {!t[field].length && <span className="xs mut">None yet.</span>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        <input className="in" style={{ minHeight: 34 }} placeholder={"Add " + label.toLowerCase().replace(/ies$/, "y").replace(/s$/, "")} value={value}
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
                <DeleteButton className="btn sm bad" onDelete={async () => { if (await confirmDelete("Remove colour " + c.name + "?")) setT(await removeColour(c.name)); }}>Remove</DeleteButton>
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
  const { me } = useApp(); const [delAll, setDelAll] = useState(false);
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
          {open && can(me, "estimates.delete") && <DeleteButton className="btn bad" onDelete={() => setDelAll(true)}>Delete all estimates</DeleteButton>}
        </div>
      </div>
      {delAll && <DeleteEstimates all onClose={() => setDelAll(false)} />}
    </div>
  );
}

/* Changes the cloud refused (kept safely on this device and retried every sync). Shown so nothing fails silently. */
function StuckChanges() {
  const rows = useLiveQuery(() => db.outbox.filter(o => !!o.last_error).limit(20).toArray(), [], []);
  if (!rows.length) return null;
  return <div className="note warn"><b>{rows.length} change{rows.length > 1 ? "s" : ""} not yet in the cloud</b>
    {rows.map(r => <div key={r.seq} className="xs mono">{r.table} · {r.row_id.slice(0, 8)} · tried {r.tries}× · {r.last_error}</div>)}</div>;
}

/** Every item name in the shop, matched to the old software's items (owner, 23 Oct). */
function AllOldCodes() {
  const names = useLiveQuery(async () => [...new Set((await db.products.filter(p => !p.deleted).toArray()).map(p => p.item))], [], [] as string[]);
  return <div className="card"><div className="pad stack"><OldCodesCard names={names} title="Old software item for each name" /></div></div>;
}

/** Owner, 23 Oct: the code staff type to open Reports, Bills, Activity and Products (777 until changed). */
function ViewCodeCard() {
  const [code, setCodeV] = useState("");
  return <div className="card"><header><h3>Code for reports, sales, activity &amp; stock</h3></header>
    <div className="pad stack">
      <div className="set-intro">Everyone except you types this code once after signing in to open Reports, Bills, Activity and Products. It is 777 until you change it.</div>
      <div className="row"><input className="in mono" type="password" inputMode="numeric" placeholder="New code, 3–8 digits" value={code} onChange={e => setCodeV(e.target.value.replace(/\D/g, ""))} style={{ maxWidth: 200 }} />
        <button className="btn p" disabled={code.length < 3} onClick={async () => { try { await setViewCode(code); setCodeV(""); toast("Code changed on every counter"); } catch (e: any) { toast(e.message, true); } }}>Change code</button></div>
    </div></div>;
}
