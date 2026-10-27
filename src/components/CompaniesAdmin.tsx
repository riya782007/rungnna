import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type Staff, type Store } from "../lib/db";
import { MAIN_STORE } from "../lib/scope";
import { toast } from "../lib/app";
import { PERMISSION_GROUPS, ALL_PERMS, isRoleLogin } from "../lib/roles";
import { createCompany, companyCfg, setCompanyCode, hasMasterCode, liveCompanies, setCompanyFeaturesFor, setCompanyIdle, setMasterCode, worksIn, type CompanyCfg } from "../lib/companies";

/* The master view (owner, 27 Oct; docs/companies.md): make companies, give each its entry code, the features it
   has, its auto-logout, and who may open it. Shown only when the owner came in with the master code. */
export function CompaniesAdmin() {
  const companies = useLiveQuery(liveCompanies, [], [] as Store[]);
  const people = useLiveQuery(() => db.staff.filter(s => !s.deleted && !isRoleLogin(s) && s.role !== "owner").toArray(), [], [] as Staff[]);
  const masterSet = useLiveQuery(hasMasterCode, [], false);
  const [name, setName] = useState(""), [code, setCode] = useState(""), [entry, setEntry] = useState(""), [busy, setBusy] = useState(false);
  const make = async () => {
    setBusy(true);
    try { await createCompany(name, code, entry); setName(""); setCode(""); setEntry(""); toast("Company made — give its entry code to its staff"); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  return <section className="stack">
    <h3>Companies</h3>
    <div className="card pad stack">
      <b className="sm">Master code {masterSet ? <span className="pill">set</span> : <span className="pill gold">not set</span>}</b>
      <div className="xs mut">Only for you. The master code with your PIN opens this view, with every company. Through a company's own entry code you see only that company, like everyone else.
        {!masterSet && " Until you set it, signing in with the shop's common entry code opens this view for the owner."}</div>
      <CodeForm label="New master code" placeholder="Only you know this" save={setMasterCode} done="Master code saved" />
    </div>
    <div className="card pad stack">
      <b className="sm">Make a company</b>
      <div className="xs mut">It gets the same layout and bill details as the main company (GSTIN left blank: set it inside the company, Settings › Shop). Its stock, bills and accounts are its own.</div>
      <div className="grid g3">
        <input className="in" aria-label="Company name" placeholder="Company name, e.g. AJ" value={name} onChange={e => setName(e.target.value)} />
        <input className="in" aria-label="Short code" placeholder="Short code (1–4), e.g. AJ" maxLength={4} value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} />
        <input className="in" aria-label="Entry code" type="password" autoComplete="new-password" placeholder="Its entry code, e.g. AJ 2026" value={entry} onChange={e => setEntry(e.target.value)} />
      </div>
      <div className="row"><button className="btn p" disabled={busy || !name.trim() || !code || entry.trim().length < 4} onClick={make}>Make company</button></div>
    </div>
    {companies.map(c => <CompanyCard key={c.id} company={c} people={people} />)}
  </section>;
}

function CodeForm({ label, placeholder, save, done }: { label: string; placeholder: string; save: (code: string) => Promise<void>; done: string }) {
  const [code, setCode] = useState("");
  return <form className="row" onSubmit={async e => { e.preventDefault(); try { await save(code); setCode(""); toast(done); } catch (x: any) { toast(x.message, true); } }}>
    <input className="in grow" type="password" autoComplete="new-password" aria-label={label} placeholder={placeholder} value={code} onChange={e => setCode(e.target.value)} />
    <button className="btn p" disabled={code.trim().length < 4}>Save</button>
  </form>;
}

function CompanyCard({ company: c, people }: { company: Store; people: Staff[] }) {
  const cfgRow = useLiveQuery(() => db.config.get("company_" + c.id), [c.id]);
  const [cfg, setCfg] = useState<CompanyCfg>({});
  useEffect(() => { void companyCfg(c.id).then(setCfg); }, [cfgRow?.updated_at]);
  const all = !Array.isArray(cfg.features);
  const on = new Set(all ? ALL_PERMS : cfg.features!);
  const setFeatures = async (next: string[] | null, what: string) => { try { await setCompanyFeaturesFor(c.id, next); toast(`${c.name}: ${what}`); } catch (e: any) { toast(e.message, true); } };
  const tick = (k: string, yes: boolean) => { const next = new Set(on); yes ? next.add(k) : next.delete(k); void setFeatures([...next], yes ? "feature on" : "feature off"); };
  const opens = (p: Staff) => p.stores?.length ? p.stores : [p.store_id || MAIN_STORE];
  const allow = async (p: Staff, yes: boolean) => {
    const cur = (await db.staff.get(p.id)) || p;
    const next = new Set(opens(cur)); yes ? next.add(c.id) : next.delete(c.id);
    if (!next.size) return toast(`${p.name} must be able to open at least one company`, true);
    await put("staff", { ...cur, stores: [...next], store_id: next.has(cur.store_id || MAIN_STORE) ? cur.store_id : [...next][0] });
    toast(`${p.name}: ${yes ? "can open" : "cannot open"} ${c.name}`);
  };
  return <details className="card pad stack">
    <summary className="row"><b className="grow">{c.code} · {c.name}</b><span className="xs mut">{people.filter(p => worksIn(p, c.id)).length} people · {all ? "every feature" : `${on.size} features`}{cfg.idle_minutes ? ` · logs out after ${cfg.idle_minutes} min` : ""}</span></summary>
    <label className="f">Address<input className="in" defaultValue={c.address} onBlur={e => { if (e.target.value !== c.address) void put("stores", { ...c, address: e.target.value }); }} /></label>
    {c.id === MAIN_STORE
      ? <div className="xs mut">The main company opens with the shop's common entry code (Settings › People › Shop passcode).</div>
      : <CompanyCodeSetting id={c.id} label={`${c.name}'s entry code`} />}
    <label className="f">Auto-logout after (minutes without a tap or key; 0 = never)
      <input className="in" type="number" min={0} max={240} defaultValue={cfg.idle_minutes || 0} key={"idle" + (cfgRow?.updated_at || "")}
        onBlur={e => void setCompanyIdle(c.id, Number(e.target.value)).then(() => toast(`${c.name}: auto-logout saved`), (x: any) => toast(x.message, true))} /></label>
    <fieldset className="note"><legend className="sm b">Who can open {c.name}</legend>
      <div className="xs mut">You can always open every company. Anyone not ticked here gets "Name or PIN not recognised" with this company's code.</div>
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>{people.map(p => <label key={p.id} className="row sm" style={{ gap: 6 }}>
        <input type="checkbox" checked={opens(p).includes(c.id)} onChange={e => void allow(p, e.target.checked)} />{p.name}</label>)}</div>
    </fieldset>
    <fieldset className="note"><legend className="sm b">Features in {c.name}</legend>
      <label className="row sm" style={{ gap: 6 }}><input type="checkbox" checked={all} onChange={e => void setFeatures(e.target.checked ? null : [...ALL_PERMS], e.target.checked ? "every feature" : "choose features")} />Every feature</label>
      <div className="xs mut">A person here gets only what both their own ticks and this company allow. What is off is not shown anywhere in this company: menu, tabs or search.</div>
      {!all && <div className="perm-groups">{PERMISSION_GROUPS.map(g => <fieldset key={g.key} className="perm-group">
        <legend className="sm b">{g.label}</legend>
        {g.perms.map(p => <label key={p.key} className="row sm" style={{ gap: 6 }}>
          <input type="checkbox" checked={on.has(p.key)} onChange={e => tick(p.key, e.target.checked)} />{p.label}</label>)}
      </fieldset>)}</div>}
    </fieldset>
  </details>;
}

/* A company's own entry code. Kept only as a hash, so it is set, never shown. */
export function CompanyCodeSetting({ id, label = "This company's entry code" }: { id: string; label?: string }) {
  const [code, setCode] = useState("");
  return <form className="stack" onSubmit={async e => {
    e.preventDefault();
    try { await setCompanyCode(id, code); setCode(""); toast("Entry code saved — other counters receive it when cloud sync is allowed"); }
    catch (x: any) { toast(x.message, true); }
  }}>
    <label className="f">{label}<input className="in" type="password" autoComplete="new-password" value={code} onChange={e => setCode(e.target.value)} placeholder="New code, e.g. AJ 2026" /></label>
    <div className="row"><button className="btn p" disabled={code.trim().length < 4}>Save entry code</button></div>
    <div className="xs mut">Spaces and capitals do not matter. It is kept only as a hidden check, so write it down somewhere safe; you can always set a new one here.</div>
  </form>;
}
