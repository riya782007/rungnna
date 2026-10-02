import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type BankLine } from "../lib/db";
import { bankMap, parseBankRows, importBank, bankCandidates, matchScore, acceptMatch, voucherFromBank, type BankMap, type BankCandidate } from "../lib/bank";
import { readSheetFile } from "../lib/migration";
import { inStore } from "../lib/scope";
import { toast, useApp } from "../lib/app";
import { rupees } from "../lib/format";
import { Head, Modal } from "../components/common";
import { EXPENSES } from "../lib/vouchers";
export default function Bank() {
  const [account, setAccount] = useState(""), [headers, setHeaders] = useState<string[]>([]), [rows, setRows] = useState<unknown[][]>([]), [mapping, setMapping] = useState<BankMap>({}), [busy, setBusy] = useState(false), [filter, setFilter] = useState("unreconciled"), [selected, setSelected] = useState<BankLine | null>(null);
  const lines = useLiveQuery(() => db.bank_lines.filter(l => !l.deleted && inStore(l)).sortBy("date"), [], []);
  const candidates = useLiveQuery(bankCandidates, [], []);
  const matched = new Set(lines.filter(l => l.match_key).map(l => l.match_key));
  const available = candidates.filter(c => !matched.has(c.key));
  let preview: ReturnType<typeof parseBankRows> = [], error = "";
  if (rows.length) { try { preview = parseBankRows(rows, mapping, account); } catch (e: any) { error = e.message; } }
  const run = async (f: () => Promise<void>) => { setBusy(true); try { await f(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  return <div className="stack"><Head title="Bank reconciliation" />
    <section className="stack"><label className="f">Bank account<input className="in" value={account} onChange={e => setAccount(e.target.value)} placeholder="Bank name / last four digits" /></label>
      <input type="file" accept=".csv,.xlsx" onChange={e => { const f = e.target.files?.[0]; if (f) run(async () => { const all = await readSheetFile(f); const i = all.findIndex(r => { const m = bankMap(r); return m.date !== undefined && m.narration !== undefined; }); if (i < 0) throw new Error("Statement header not found"); setHeaders(all[i].map(String)); setMapping(bankMap(all[i])); setRows(all.slice(i + 1).filter(r => r.some(v => String(v || "").trim()))); }); e.target.value = ""; }} />
      {!!rows.length && <><div className="grid g3">{(["date", "narration", "debit", "credit", "ref", "amount", "direction"] as const).map(k => <label className="f" key={k}>{k}<select className="in" value={mapping[k] ?? ""} onChange={e => setMapping(m => ({ ...m, [k]: e.target.value === "" ? undefined : Number(e.target.value) }))}><option value="">None</option>{headers.map((h, i) => <option key={i} value={i}>{h}</option>)}</select></label>)}</div>{error && <div className="note bad">{error}</div>}
        <div className="tw"><table><thead><tr><th>Date</th><th>Narration</th><th>Debit</th><th>Credit</th></tr></thead><tbody>{preview.slice(0, 10).map((l, i) => <tr key={i}><td>{l.date}</td><td>{l.narration}</td><td>{rupees(l.debit)}</td><td>{rupees(l.credit)}</td></tr>)}</tbody></table></div>
        <button className="btn p" disabled={busy || !account.trim() || !!error || !preview.length} onClick={() => run(async () => { const n = await importBank(preview); setRows([]); toast(`${n} bank lines imported`); })}>Import {preview.length} lines</button></>}
    </section>
    <div className="seg">{["unreconciled", "reconciled", "all"].map(s => <button key={s} aria-pressed={filter === s} onClick={() => setFilter(s)}>{s}</button>)}</div>
    <div className="tw"><table><thead><tr><th>Date / Account</th><th>Narration</th><th>Debit</th><th>Credit</th><th>Match</th></tr></thead><tbody>{lines.filter(l => filter === "all" || !!l.match_key === (filter === "reconciled")).map(l => {
      const scores = available.map(c => ({ c, score: matchScore(l, c) })).filter(x => x.score).sort((a, b) => b.score - a.score), best = scores[0], ambiguous = scores[1]?.score === best?.score;
      return <tr key={l.id}><td>{l.date}<div className="xs mut">{l.account}</div></td><td>{l.narration}<div className="xs mut">{l.ref}</div></td><td>{rupees(l.debit)}</td><td>{rupees(l.credit)}</td><td>{l.match_key ? <span className="pill ok">Reconciled</span> : <div className="stack">{best && !ambiguous && <button className="btn sm p" disabled={busy} onClick={() => run(async () => { await acceptMatch(l.id, best.c.key); toast("Matched"); })}>Accept {best.c.no}</button>}<button className="btn sm" onClick={() => setSelected(l)}>Match / create voucher</button></div>}</td></tr>;
    })}</tbody></table></div>
    <h3>Unreconciled book entries</h3><div className="tw"><table><thead><tr><th>Voucher</th><th>Party</th><th>Amount</th></tr></thead><tbody>{available.map(c => <tr key={c.key}><td>{c.no}</td><td>{c.name}</td><td>{rupees(c.amount)}</td></tr>)}</tbody></table></div>
    {selected && <MatchDialog line={selected} candidates={available} onClose={() => setSelected(null)} />}
  </div>;
}
function MatchDialog({ line, candidates, onClose }: { line: BankLine; candidates: BankCandidate[]; onClose: () => void }) {
  const { me } = useApp(); const [party, setParty] = useState(""), [type, setType] = useState<"receipt" | "payment" | "expense">(line.credit ? "receipt" : "expense"), [category, setCategory] = useState("other"), [busy, setBusy] = useState(false);
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted).toArray(), [], []);
  const run = async (f: () => Promise<unknown>) => { setBusy(true); try { await f(); toast("Reconciled"); onClose(); } catch (e: any) { toast(e.message, true); } finally { setBusy(false); } };
  return <Modal title="Match bank line" onClose={onClose}><div className="stack"><b>{line.narration} · {rupees(line.debit || line.credit)}</b>
    <label className="f">Book entry<select className="in" defaultValue="" disabled={busy} onChange={e => e.target.value && run(() => acceptMatch(line.id, e.target.value, true))}><option value="">Choose matching entry</option>{candidates.filter(c => c.amount === (line.debit || line.credit) && c.credit === !!line.credit).map(c => <option key={c.key} value={c.key}>{c.no} · {c.name} · {c.at.slice(0, 10)}</option>)}</select></label>
    <h3>Create voucher</h3><select className="in" value={type} onChange={e => setType(e.target.value as any)}>{line.credit ? <option value="receipt">Customer receipt</option> : <><option value="expense">Expense</option><option value="payment">Supplier payment</option></>}</select>
    {type === "expense" ? <select className="in" value={category} onChange={e => setCategory(e.target.value)}>{EXPENSES.map(c => <option key={c}>{c}</option>)}</select> : <select className="in" value={party} onChange={e => setParty(e.target.value)}><option value="">Choose party</option>{parties.filter(p => type === "payment" ? p.kind === "supplier" : p.kind !== "supplier").map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
    <button className="btn p" disabled={busy || (type !== "expense" && !party)} onClick={() => run(() => voucherFromBank(line.id, type, me!.id, parties.find(p => p.id === party), category))}>Create and reconcile</button>
  </div></Modal>;
}
