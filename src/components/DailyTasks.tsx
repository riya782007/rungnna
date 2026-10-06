import { useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Printer } from "lucide-react";
import { db, put, uid, now } from "../lib/db";
import { useApp, toast } from "../lib/app";
import { currentStore, inStore } from "../lib/scope";
import { localDay } from "../lib/ledger";
import { usePrintJob } from "../lib/printing";

type Task = { id: string; title: string; staff: string; name: string; done: boolean };
export default function DailyTasks() {
  const { me } = useApp();
  const [day, setDay] = useState(localDay(now())), [title, setTitle] = useState(""), [staff, setStaff] = useState("");
  const [printing, setPrinting] = useState(false);
  const key = `tasks:${currentStore()}:${day}`;
  const record = useLiveQuery(() => db.config.get(key), [key]);
  const people = useLiveQuery(() => db.staff.filter(s => !!s.active && !s.deleted && inStore(s)).toArray(), [], []);
  const tasks: Task[] = Array.isArray(record?.value) ? record.value : [];
  const visible = me?.role === "owner" ? tasks : tasks.filter(t => !t.staff || t.staff === me?.id);
  usePrintJob(printing, () => setPrinting(false));
  const save = async (update: (tasks: Task[]) => Task[]) => {
    try { await db.transaction("rw", [db.config, db.outbox], async () => {
      const latest = await db.config.get(key);
      await put("config", { id: key, value: update(Array.isArray(latest?.value) ? latest!.value : []), updated_at: now() });
    }); } catch (e: any) { toast(e.message, true); }
  };
  return <section className="daily-tasks">
    <div className="row"><h3 className="grow">Daily staff tasks</h3><input className="in" type="date" aria-label="Task date" value={day} onChange={e => setDay(e.target.value)} style={{ width: 150 }} /><button className="iconbtn" title="Print tasks" aria-label="Print tasks" disabled={!visible.length} onClick={() => setPrinting(true)}><Printer size={18} /></button></div>
    {me?.role === "owner" && <form className="row" onSubmit={e => { e.preventDefault(); if (!title.trim()) return; void save(list => [...list, { id: uid(), title: title.trim(), staff, name: people.find(p => p.id === staff)?.name || "Everyone", done: false }]); setTitle(""); }}><input className="in grow" aria-label="New task" value={title} onChange={e => setTitle(e.target.value)} placeholder="Task" maxLength={300} /><select className="in" aria-label="Assign to" value={staff} onChange={e => setStaff(e.target.value)} style={{ width: 150 }}><option value="">Everyone</option>{people.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select><button className="iconbtn" title="Add task" aria-label="Add task"><Plus size={18} /></button></form>}
    {visible.map(t => <label className="row task-line" key={t.id}><input type="checkbox" checked={t.done} onChange={e => { const checked = e.target.checked; void save(list => list.map(x => x.id === t.id ? { ...x, done: checked } : x)); }} /><span className="grow">{t.title}</span><span className="mut sm">{t.name}</span></label>)}
    {printing && createPortal(<div className="inv"><style>{"@page{size:A4;margin:12mm}"}</style><h2>Rungnna · Daily tasks</h2><p>{day}</p>{visible.map(t => <p key={t.id}>[ {t.done ? "x" : " "} ] {t.name}: {t.title}</p>)}</div>, document.getElementById("printroot")!)}
  </section>;
}
