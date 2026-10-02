import { useEffect, useState } from "react";
import { FIELDS } from "../lib/importer";
import { loadMigration, migrationMap, mappedRows, migrationPreview, importMigration, undoMigration, type MappedSheet, type MigrationKind } from "../lib/migration";
import { useApp, toast } from "../lib/app";
import { Head, LocationSelect } from "../components/common";
export default function Import() {
  const { me } = useApp(); const [kind, setKind] = useState<MigrationKind>("products"), [sheets, setSheets] = useState<MappedSheet[]>([]), [filename, setFilename] = useState(""), [preview, setPreview] = useState<{ issues: string[]; added: number; updated: number } | null>(null), [busy, setBusy] = useState(false), [done, setDone] = useState("");
  useEffect(() => { let active = true; migrationPreview(sheets).then(p => active && setPreview(p)); return () => { active = false; }; }, [sheets]);
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  const change = (i: number, patch: Partial<MappedSheet>) => setSheets(s => s.map((x, j) => j === i ? { ...x, ...patch } : x));
  return <div className="stack"><Head title="Migration from Invock / Tally"><button className="btn" disabled={busy} onClick={() => run(async () => { const b = await undoMigration(); setDone("Undone: " + b.filename); toast("Last import undone"); })}>Undo last import</button></Head>
    <div className="seg">{(["products", "parties", "stock"] as const).map(k => <button key={k} aria-pressed={kind === k} onClick={() => { setKind(k); setSheets([]); }}>{k === "products" ? "Items" : k === "parties" ? "Parties & balances" : "Opening stock"}</button>)}</div>
    <input type="file" accept=".csv,.xlsx,.xml" disabled={busy} onChange={e => { const f = e.target.files?.[0]; if (f) run(async () => { const data = await loadMigration(f, kind); setSheets(data.map(s => ({ ...s, map: migrationMap(s) }))); setFilename(f.name); setDone(""); }); e.target.value = ""; }} />
    {sheets.map((sheet, i) => { const fields = sheet.kind === "stock" ? [{ key: "item_code", label: "Item code" }, { key: "item", label: "Item name" }, { key: "rack", label: "Rack" }, { key: "qty", label: "Pieces" }] : [...FIELDS[sheet.kind], { key: sheet.kind === "products" ? "rack" : "pin", label: sheet.kind === "products" ? "Rack" : "PIN" }]; return <section className="stack" key={i}>
      <h3>{sheet.kind} · {sheet.rows.length} rows</h3><div className="grid g3">{fields.map(f => <label className="f" key={f.key}>{f.label}<select className="in" value={sheet.map[f.key] ?? ""} onChange={e => { const m = { ...sheet.map }; if (e.target.value === "") delete m[f.key]; else m[f.key] = Number(e.target.value); change(i, { map: m }); }}><option value="">None</option>{sheet.headers.map((h, j) => <option key={j} value={j}>{h}</option>)}</select></label>)}</div>
      {sheet.kind !== "parties" && <LocationSelect buckets={false} value={sheet.rack || ""} onChange={rack => change(i, { rack })} allowNone="Use rack column" label="Default rack" />}
      <div className="tw"><table><thead><tr>{Object.keys(sheet.map).map(k => <th key={k}>{k.replace(/_/g, " ")}</th>)}</tr></thead><tbody>{mappedRows(sheet).slice(0, 10).map((r, j) => <tr key={j}>{Object.keys(sheet.map).map(k => <td key={k}>{String(r[k] ?? "")}</td>)}</tr>)}</tbody></table></div>
    </section>; })}
    {!!sheets.length && <><div className={"note " + (preview?.issues.length ? "bad" : "")}>{preview?.issues.length ? preview.issues.slice(0, 12).join(" · ") : `${preview?.added || 0} new · ${preview?.updated || 0} existing records will be updated`}</div><button className="btn p" disabled={busy || !!preview?.issues.length || !preview} onClick={() => run(async () => { const b = await importMigration(sheets, filename, me!.id); setDone(`${b.changes.length} changes imported from ${filename}`); setSheets([]); toast("Import complete"); })}>Import {filename}</button></>}
    {done && <div className="note">{done}</div>}
  </div>;
}
