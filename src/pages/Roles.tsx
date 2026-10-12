import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, uid, type Config, type Staff } from "../lib/db";
import { Head } from "../components/common";
import { useApp, toast } from "../lib/app";
import { PERMISSION_GROUPS, BUILTIN, ROLE_NOTE, permLabel, customRoles, type CustomRole } from "../lib/roles";

/* Roles & permissions — granular, grouped control in the style of the reference console.
   The built-in roles keep the shop's original rules; the owner makes new roles from scratch
   or by copying one, ticks exactly what they may do, and gives each person a role. */

const BASES: Staff["role"][] = ["manager", "cashier", "salesman", "helper", "packer"];

async function saveRoles(roles: CustomRole[]) {
  await put("config", { id: "roles", value: { roles }, updated_at: now() } as Config);
}

export default function Roles() {
  const { me } = useApp();
  const row = useLiveQuery(() => db.config.get("roles"), []);
  const roles: CustomRole[] = ((row?.value as any)?.roles as CustomRole[]) || customRoles();
  const staff = useLiveQuery(() => db.staff.filter(s => !s.deleted).toArray(), [], [] as Staff[]);
  const [draft, setDraft] = useState<CustomRole | null>(null);
  const users = (id: string) => staff.filter(s => s.role_id === id);

  const save = async (r: CustomRole) => {
    const name = r.name.trim();
    if (!name) return toast("Give the role a name", true);
    if (roles.some(x => x.id !== r.id && x.name.trim().toLowerCase() === name.toLowerCase())) return toast("A role with this name already exists", true);
    const next = roles.some(x => x.id === r.id) ? roles.map(x => (x.id === r.id ? { ...r, name } : x)) : [...roles, { ...r, name }];
    await saveRoles(next); setDraft(null); toast("Role saved — applies on every counter after sync");
  };
  const remove = async (r: CustomRole) => {
    if (users(r.id).length) return toast(`${users(r.id).map(s => s.name).join(", ")} still ${users(r.id).length > 1 ? "have" : "has"} this role — give them another role first`, true);
    if (!confirm(`Delete the role "${r.name}"?`)) return;
    await saveRoles(roles.filter(x => x.id !== r.id)); toast("Role deleted");
  };

  return <div className="roles-page">
    <Head eyebrow="Control" title="Roles & permissions" sub="Grant exactly what each role can do — e.g. a packer who can move stock but never cancel a bill. The owner always has everything.">
      <button className="btn p" onClick={() => setDraft({ id: uid(), name: "", perms: [...BUILTIN.salesman], base: "salesman" })}>New role</button>
    </Head>
    <div className="note sm">Everyone signs in with their own PIN, as today. Give a person a role here or in Settings › Staff. Changes reach every counter on the next sync.</div>

    {draft && <RoleEditor key={draft.id} role={draft} onCancel={() => setDraft(null)} onSave={save} />}

    <h3 className="sec-title">Your roles</h3>
    {!roles.length && <div className="card empty"><b>No custom roles yet</b>Start from a built-in role below with “Copy”, or press New role.</div>}
    <div className="stack">{roles.map(r => <details key={r.id} className="card role-card">
      <summary className="pad row"><span className="grow"><b>{r.name}</b><span className="xs mut"> · {r.perms.length} permissions · {users(r.id).length} {users(r.id).length === 1 ? "person" : "people"}</span>
        <span className="chips perm-chips">{r.perms.slice(0, 8).map(p => <span key={p} className="pill ok">{permLabel(p)}</span>)}{r.perms.length > 8 && <span className="xs mut">+{r.perms.length - 8} more</span>}</span></span>
        <span className="xs mut">Edit ⌄</span></summary>
      <div className="pad" style={{ borderTop: "1px solid var(--line-2)" }}>
        <RoleEditor role={r} onSave={save} />
        <div className="row" style={{ marginTop: 10 }}><button className="btn bad sm" onClick={() => remove(r)}>Delete this role</button>
          {users(r.id).length > 0 && <span className="xs mut">Used by {users(r.id).map(s => s.name).join(", ")}</span>}</div>
      </div>
    </details>)}</div>

    <h3 className="sec-title">Built-in roles</h3>
    <div className="grid g2">{(["owner", ...BASES] as Staff["role"][]).map(b => <div key={b} className="card pad">
      <div className="row"><b className="grow" style={{ textTransform: "capitalize" }}>{b}</b>
        {b !== "owner" && <button className="btn sm" onClick={() => setDraft({ id: uid(), name: b[0].toUpperCase() + b.slice(1) + " (custom)", perms: [...BUILTIN[b]], base: b })}>Copy</button>}</div>
      <div className="xs mut">{ROLE_NOTE[b]} · {b === "owner" ? "all" : BUILTIN[b].length} permissions · {staff.filter(s => s.role === b && !s.role_id).length} people</div>
    </div>)}</div>
    {me?.role !== "owner" && <div className="note warn sm" style={{ marginTop: 12 }}>Only the owner's own permissions can never be reduced.</div>}
  </div>;
}

export function RoleEditor({ role, onSave, onCancel }: { role: CustomRole; onSave: (r: CustomRole) => void; onCancel?: () => void }) {
  const [name, setName] = useState(role.name);
  const [checked, setChecked] = useState(new Set(role.perms));
  const toggle = (k: string) => setChecked(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  const group = (keys: string[], on: boolean) => setChecked(s => { const n = new Set(s); keys.forEach(k => (on ? n.add(k) : n.delete(k))); return n; });
  return <div className="card role-editor"><div className="pad stack">
    <input className="in" placeholder="Role name (e.g. Counter staff)" value={name} autoFocus={!role.name} onChange={e => setName(e.target.value)} />
    <div className="perm-grid">{PERMISSION_GROUPS.map(g => {
      const keys = g.perms.map(p => p.key), all = keys.every(k => checked.has(k));
      return <div key={g.key} className="perm-group">
        <div className="row"><b className="grow perm-group-title">{g.label}</b><button type="button" className="linkbtn" onClick={() => group(keys, !all)}>{all ? "Clear" : "All"}</button></div>
        {g.perms.map(p => <label key={p.key} className="perm">
          <input type="checkbox" checked={checked.has(p.key)} onChange={() => toggle(p.key)} />
          <span>{p.label}{p.desc && <span className="xs mut"> · {p.desc}</span>}</span></label>)}
      </div>;
    })}</div>
    <div className="row"><button className="btn p" onClick={() => onSave({ ...role, name, perms: [...checked] })}>Save role</button>
      {onCancel && <button className="btn" onClick={onCancel}>Cancel</button>}<span className="xs mut">{checked.size} selected</span></div>
  </div></div>;
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
