import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Eye, EyeOff, Copy, RefreshCw } from "lucide-react";
import { db, uid, type Staff } from "../lib/db";
import { Head } from "../components/common";
import { useApp, toast } from "../lib/app";
import { PERMISSION_GROUPS, BUILTIN, ROLE_NOTE, permLabel, customRoles, isSensitive, isRoleLogin, can, type CustomRole } from "../lib/roles";
import { saveRoles, regenerated } from "../lib/roleLogins";

/* ===========================================================================
   Roles & Permissions, laid out like the reference console
   (riya782007/Yogendra › app/(admin)/admin/roles):

     · the explanation, then the line about passcodes
     · "Create a role", always open at the top
     · "Existing roles": each one a card with its name, its PASSCODE (masked,
       reveal / copy), the first permissions as chips, and "Edit ⌄"; opened, it
       is the same form, then "↻ Regenerate passcode" and "Delete this role"

   Kept from Rungnna, because the shop needs them: the built-in roles (owner,
   manager, cashier, salesman, helper, packer) to start from, people per role,
   the sensitive-permission flags, the search, and the lock-out warning.
=========================================================================== */

const BASES: Staff["role"][] = ["manager", "cashier", "salesman", "helper", "packer"];
const fresh = (base: Staff["role"] = "salesman", perms: string[] = []): CustomRole => ({ id: uid(), name: "", perms, base });

export default function Roles() {
  const { me } = useApp();
  const row = useLiveQuery(() => db.config.get("roles"), []);
  const roles: CustomRole[] = ((row?.value as any)?.roles as CustomRole[]) || customRoles();
  const staff = useLiveQuery(() => db.staff.filter(s => !s.deleted).toArray(), [], [] as Staff[]);
  const people = staff.filter(s => !isRoleLogin(s));
  const users = (id: string) => people.filter(s => s.role_id === id);
  const [draft, setDraft] = useState<CustomRole>(() => fresh());
  const createRef = useRef<HTMLDivElement>(null);
  const manage = can(me, "staff.manage");

  /* Roles made before passcodes existed get one the first time someone who may manage roles
     opens this page — once, and synced, so every counter can then sign in with it. */
  const backfilled = useRef(false);
  useEffect(() => {
    if (!row || !manage || backfilled.current) return;
    if (!roles.some(r => !r.passcode || !r.login_id)) return;
    backfilled.current = true;
    saveRoles(roles).then(() => toast("Every role now has its own passcode")).catch(e => toast(e.message, true));
  }, [row?.updated_at, manage]);

  const save = async (r: CustomRole, isNew: boolean) => {
    const name = r.name.trim();
    if (!name) return toast("Give the role a name", true);
    if (roles.some(x => x.id !== r.id && x.name.trim().toLowerCase() === name.toLowerCase())) return toast("A role with this name already exists", true);
    const next = isNew ? [...roles, { ...r, name }] : roles.map(x => (x.id === r.id ? { ...x, ...r, name } : x));
    try {
      const saved = await saveRoles(next);
      if (isNew) {
        const made = saved.find(x => x.id === r.id);
        setDraft(fresh());
        toast(`“${name}” created — its passcode is ${made?.passcode}. Share it with that staff member.`);
      } else toast("Saved — applies on every counter after sync");
    } catch (e: any) { toast(e.message, true); }
  };
  const regenerate = async (r: CustomRole) => {
    if (!confirm(`Make a new passcode for “${r.name}”?\n\nThe old one stops working at once, and anyone signed in with it is signed out on their next sync.`)) return;
    try { const saved = await saveRoles(regenerated(roles, r.id)); toast(`New passcode for “${r.name}”: ${saved.find(x => x.id === r.id)?.passcode}`); }
    catch (e: any) { toast(e.message, true); }
  };
  const remove = async (r: CustomRole) => {
    const u = users(r.id);
    if (u.length) return toast(`${u.map(s => s.name).join(", ")} still ${u.length > 1 ? "have" : "has"} this role — give them another role first`, true);
    if (!confirm(`Delete the role “${r.name}”?\n\nIts passcode stops working and anyone signed in with it is signed out.`)) return;
    try { await saveRoles(roles.filter(x => x.id !== r.id)); toast("Role deleted"); } catch (e: any) { toast(e.message, true); }
  };
  const startFrom = (b: Staff["role"]) => {
    setDraft({ ...fresh(b, [...BUILTIN[b]]), name: b[0].toUpperCase() + b.slice(1) + " (custom)" });
    createRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return <div className="roles-page">
    <Head eyebrow="Control" title="Roles & Permissions"
      sub="Discord-style granular control. Grant exactly what a role can do — e.g. a packer who can move stock but never cancel a bill." />
    <div className="note ok sm roles-banner">
      Each role has its own <b>passcode</b> (below). Share it with that staff member — they type it on the opening screen, in the same box as the shop passcode, and see only their permitted sections. The shop passcode always opens everything as the owner.
    </div>

    <div className="card" ref={createRef}>
      <header><h3>Create a role</h3></header>
      <RoleEditor key={draft.id} role={draft} isNew submitLabel="Create role" onSave={r => save(r, true)} />
    </div>

    <h3 className="sec-title">Existing roles</h3>
    {!roles.length && <div className="card empty"><b>No roles yet.</b>Create one above, or copy a built-in role below.</div>}
    <div className="stack">{roles.map(r => <details key={r.id} className="card role-card">
      <summary className="pad row">
        <span className="grow" style={{ minWidth: 0 }}>
          <span className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <b>{r.name}</b>
            <span className="passcode-label">passcode</span>
            <PasscodeChip code={r.passcode} />
            <span className="xs mut">{users(r.id).length ? `· ${users(r.id).length} ${users(r.id).length === 1 ? "person" : "people"}` : ""}</span>
          </span>
          <span className="chips perm-chips">
            {!r.perms.length && <span className="xs mut">No permissions</span>}
            {r.perms.slice(0, 8).map(p => <span key={p} className={"pill " + (isSensitive(p) ? "bad" : "ok")}>{permLabel(p)}</span>)}
            {r.perms.length > 8 && <span className="xs mut">+{r.perms.length - 8} more</span>}
          </span>
        </span>
        <span className="xs mut">Edit ⌄</span>
      </summary>
      <div style={{ borderTop: "1px solid var(--line-2)" }}>
        <RoleEditor role={r} submitLabel="Save changes" onSave={x => save(x, false)} />
        <div className="pad row" style={{ paddingTop: 0, gap: 16 }}>
          <button className="linkbtn" onClick={() => regenerate(r)}><RefreshCw size={13} /> Regenerate passcode</button>
          <button className="linkbtn bad-text" onClick={() => remove(r)}>Delete this role</button>
          {users(r.id).length > 0 && <span className="xs mut">Used by {users(r.id).map(s => s.name).join(", ")}</span>}
        </div>
      </div>
    </details>)}</div>

    <h3 className="sec-title">Built-in roles</h3>
    <div className="xs mut" style={{ marginBottom: 8 }}>People with a PIN sign in under these, as today. Copy one to start a role with its permissions.</div>
    <div className="grid g2">{(["owner", ...BASES] as Staff["role"][]).map(b => <div key={b} className="card pad">
      <div className="row"><b className="grow" style={{ textTransform: "capitalize" }}>{b}</b>
        {b !== "owner" && <button className="btn sm" onClick={() => startFrom(b)}>Copy</button>}</div>
      <div className="xs mut">{ROLE_NOTE[b]} · {b === "owner" ? "all" : BUILTIN[b].length} permissions · {(n => `${n} ${n === 1 ? "person" : "people"}`)(people.filter(s => s.role === b && !s.role_id).length)}</div>
    </div>)}</div>
  </div>;
}

/** Masked by default, so a passcode cannot be read off the screen over someone's shoulder. Reveal or copy. */
export function PasscodeChip({ code }: { code?: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!code) return <span className="passcode-chip mut">— making…</span>;
  const stop = (e: React.MouseEvent) => { e.preventDefault(); e.stopPropagation(); };   // inside <summary>: don't open the card
  return <span className="passcode-chip">
    <span className="mono" aria-label={shown ? `Passcode ${code.split("").join(" ")}` : "Passcode hidden"}>{shown ? code : "•".repeat(code.length)}</span>
    <button type="button" className="iconbtn xs" title={shown ? "Hide" : "Reveal"} aria-label={shown ? "Hide passcode" : "Reveal passcode"}
      onClick={e => { stop(e); setShown(s => !s); }}>{shown ? <EyeOff size={14} /> : <Eye size={14} />}</button>
    <button type="button" className="iconbtn xs" title="Copy passcode" aria-label="Copy passcode"
      onClick={async e => { stop(e); try { await navigator.clipboard.writeText(code); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { toast("Could not copy — reveal it and read it out", true); } }}>
      {copied ? <span className="xs">copied ✓</span> : <Copy size={14} />}</button>
  </span>;
}

export function RoleEditor({ role, onSave, submitLabel = "Save role", isNew }: { role: CustomRole; onSave: (r: CustomRole) => void; submitLabel?: string; isNew?: boolean }) {
  const { me } = useApp();
  const [name, setName] = useState(role.name);
  const [base, setBase] = useState<Staff["role"]>(role.base);
  const [checked, setChecked] = useState(new Set(role.perms));
  const [find, setFind] = useState("");
  const toggle = (k: string) => setChecked(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const group = (keys: string[], on: boolean) => setChecked(s => { const n = new Set(s); keys.forEach(k => (on ? n.add(k) : n.delete(k))); return n; });

  const q = find.trim().toLowerCase();
  const match = (p: { key: string; label: string; desc?: string }) =>
    !q || [p.label, p.desc, p.key].filter(Boolean).join(" ").toLowerCase().includes(q);
  const groups = PERMISSION_GROUPS.map(g => ({ ...g, perms: g.perms.filter(match) })).filter(g => g.perms.length);

  // what this role gains and loses against the built-in role it starts from
  const baseSet = new Set(BUILTIN[base] || []);
  const added = [...checked].filter(k => !baseSet.has(k)).length;
  const dropped = [...baseSet].filter(k => !checked.has(k)).length;

  // the owner is never locked out, but someone editing their OWN role can remove the
  // very permission that lets them reach this page, and only the owner could undo it
  const ownRole = !!me && me.role !== "owner" && me.role_id === role.id;
  const lockout = ownRole && !checked.has("staff.manage");

  return <div className="pad stack role-editor">
    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
      <input className="in grow" style={{ minWidth: 220 }} placeholder="Role name (e.g. Counter staff)" value={name} onChange={e => setName(e.target.value)} />
      {isNew && <label className="f" style={{ margin: 0 }}>Start from
        <select className="in" value={base} onChange={e => { const b = e.target.value as Staff["role"]; setBase(b); setChecked(new Set(BUILTIN[b])); }}>
          {BASES.map(b => <option key={b} value={b}>{b}</option>)}
        </select></label>}
    </div>
    <input className="in" placeholder="Find a permission…" value={find} onChange={e => setFind(e.target.value)} />
    {lockout && <div className="note bad sm">This is your own role. Saving without “Staff, roles &amp; permissions” will lock you out of this page — only the owner could give it back.</div>}
    {!groups.length && <div className="note sm">No permission matches “{find}”.</div>}
    <div className="perm-grid">{groups.map(g => {
      const keys = g.perms.map(p => p.key), all = keys.every(k => checked.has(k));
      return <div key={g.key} className="perm-group">
        <div className="row"><b className="grow perm-group-title">{g.label}</b><button type="button" className="linkbtn" onClick={() => group(keys, !all)}>{all ? "Clear" : "All"}</button></div>
        {g.perms.map(p => <label key={p.key} className="perm">
          <input type="checkbox" checked={checked.has(p.key)} onChange={() => toggle(p.key)} />
          <span>{p.label}{isSensitive(p.key) && <span className="pill bad xs perm-flag">sensitive</span>}{p.desc && <span className="xs mut"> · {p.desc}</span>}</span></label>)}
      </div>;
    })}</div>
    <div className="row">
      <button className="btn p" onClick={() => onSave({ ...role, name, base, perms: [...checked] })}>{submitLabel}</button>
      <span className="xs mut">{checked.size} selected{added || dropped ? ` · +${added} / −${dropped} vs ${base}` : ` · same as ${base}`}</span>
    </div>
  </div>;
}

/** One select for a person's role: built-in roles and the owner's custom roles. */
export function RoleSelect({ value, onChange, disabled, allowOwner = true }: { value: Pick<Staff, "role" | "role_id">; onChange: (v: Pick<Staff, "role" | "role_id">) => void; disabled?: boolean; allowOwner?: boolean }) {
  const roles = useMemo(() => customRoles(), [useLiveQuery(() => db.config.get("roles"), [])?.updated_at]);
  const current = value.role_id && roles.some(r => r.id === value.role_id) ? "c:" + value.role_id : value.role;
  return <select className="in" style={{ minWidth: 120, height: 34 }} value={current} disabled={disabled} onChange={e => {
    const v = e.target.value;
    if (v.startsWith("c:")) { const r = roles.find(x => x.id === v.slice(2)); if (r) onChange({ role: r.base === "owner" ? "salesman" : r.base, role_id: r.id }); }
    else onChange({ role: v as Staff["role"], role_id: "" });
  }}>
    <optgroup label="Built-in">{(allowOwner ? ["owner", ...BASES] : BASES).map(r => <option key={r} value={r}>{r}</option>)}</optgroup>
    {roles.length > 0 && <optgroup label="Custom roles">{roles.map(r => <option key={r.id} value={"c:" + r.id}>{r.name}</option>)}</optgroup>}
  </select>;
}
