import { useEffect, useState } from "react";
import { MAIN_STORE } from "../lib/scope";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type Staff } from "../lib/db";
import { PERMISSION_GROUPS, isSensitive, permsOf } from "../lib/roles";
import { toast } from "../lib/app";

/* Owner, 23 Oct: "only the name in Add person, and tick the box to allow the permission". Every tick is saved
   at once and reaches every counter. The companies this person may open are ticked here too. */
export function PersonPerms({ person }: { person: Staff }) {
  const stores = useLiveQuery(() => db.stores.filter(s => !s.deleted && !!s.active).toArray(), [], []);
  // ticks show at once; the saved row catches up a moment later
  const [have, setHave] = useState(() => new Set(Array.isArray(person.perms) ? person.perms : [...permsOf(person)]));
  useEffect(() => { if (Array.isArray(person.perms)) setHave(new Set(person.perms)); }, [person.updated_at]);
  const [companies, setCompanies] = useState(() => new Set(person.stores?.length ? person.stores : [person.store_id || MAIN_STORE]));
  // always on top of the saved row, so quick ticks in a row never undo each other
  const save = async (patch: Partial<Staff>, what: string) => { const cur = (await db.staff.get(person.id)) || person; await put("staff", { ...cur, ...patch }); toast(what); };
  const tick = (k: string, on: boolean) => { const next = new Set(have); on ? next.add(k) : next.delete(k); setHave(next); void save({ perms: [...next] }, `${person.name}: ${on ? "allowed" : "not allowed"}`); };
  return <div className="person-perms stack">
    {stores.length > 1 && <fieldset className="note"><legend className="sm b">Companies {person.name} can open</legend>
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>{stores.map(s => <label key={s.id} className="row sm" style={{ gap: 6 }}>
        <input type="checkbox" checked={companies.has(s.id)} onChange={e => {
          const next = new Set(companies); e.target.checked ? next.add(s.id) : next.delete(s.id);
          if (!next.size) return toast("Keep at least one company", true);
          setCompanies(next);
          void save({ stores: [...next], store_id: next.has(person.store_id || "") ? person.store_id : [...next][0] }, "Companies saved");
        }} />{s.name}</label>)}</div></fieldset>}
    <div className="perm-groups">{PERMISSION_GROUPS.map(g => <fieldset key={g.key} className="perm-group">
      <legend className="sm b">{g.label}</legend>
      {g.perms.map(p => <label key={p.key} className="row sm" style={{ gap: 6, alignItems: "flex-start" }}>
        <input type="checkbox" checked={have.has(p.key)} onChange={e => tick(p.key, e.target.checked)} />
        <span>{p.label}{isSensitive(p.key) && <span className="xs bad-text"> · sensitive</span>}{p.desc && <span className="xs mut"> — {p.desc}</span>}</span></label>)}
    </fieldset>)}</div>
  </div>;
}
