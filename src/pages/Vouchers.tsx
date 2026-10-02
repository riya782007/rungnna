import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, type ExpenseCategory, type MoneyMode, type VoucherType } from "../lib/db";
import { EXPENSES, saveVoucher } from "../lib/vouchers";
import { useApp, toast } from "../lib/app";
import { rupees, toPaise, when } from "../lib/format";
import { Head } from "../components/common";
import { Icon } from "../components/Icon";

export default function Vouchers() {
  const { me } = useApp();
  const [type, setType] = useState<VoucherType>("expense");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<MoneyMode>("cash");
  const [party, setParty] = useState("");
  const [category, setCategory] = useState<ExpenseCategory>("other");
  const [note, setNote] = useState("");
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted).toArray(), [], []);
  const vouchers = useLiveQuery(() => db.vouchers.orderBy("at").reverse().limit(80).toArray(), [], []);
  const picked = parties.find(p => p.id === party);
  const save = async () => {
    const a = toPaise(amount);
    if (!a) return toast("Enter amount", true);
    if ((type === "payment" || type === "receipt") && !picked) return toast("Choose party", true);
    const v = await saveVoucher({ type, amount: a, mode, party: picked, category: type === "expense" ? category : undefined, note, by: me?.id || "" });
    toast("Saved " + v.no);
    setAmount(""); setNote("");
  };
  return <div>
    <Head title="Vouchers" sub="Payment, receipt, expense and journal entries feed cash in hand and end of day." />
    <div className="split">
      <div className="card pad stack">
        <div className="seg">{(["payment", "receipt", "expense", "journal"] as VoucherType[]).map(t => <button key={t} aria-pressed={type === t} onClick={() => setType(t)}>{t.toUpperCase()}</button>)}</div>
        <input className="in mono" inputMode="decimal" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
        {type !== "journal" && <div className="seg">{(["cash", "upi", "bank", "cheque"] as MoneyMode[]).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m.toUpperCase()}</button>)}</div>}
        {(type === "payment" || type === "receipt") && <label className="f">Party<select className="in" value={party} onChange={e => setParty(e.target.value)}><option value="">Choose</option>{parties.map(p => <option key={p.id} value={p.id}>{p.name} · {p.kind}</option>)}</select></label>}
        {type === "expense" && <label className="f">Category<select className="in" value={category} onChange={e => setCategory(e.target.value as ExpenseCategory)}>{EXPENSES.map(x => <option key={x} value={x}>{x}</option>)}</select></label>}
        {type === "journal" && <div className="grid g2"><input className="in" placeholder="Debit account" onChange={e => setNote(n => n || e.target.value)} /><input className="in" placeholder="Credit account" /></div>}
        <input className="in" placeholder="Note" value={note} onChange={e => setNote(e.target.value)} />
        <button className="btn p big" onClick={save}><Icon n="plus" size={18} />Save voucher</button>
      </div>
      <div className="list">{vouchers.map(v => <div key={v.id} className="li"><span className="grow"><b className="mono sm">{v.no}</b><div className="xs mut">{when(v.at)} · {v.type} · {v.party_name || v.category || ""}</div></span><b className="mono">{rupees(v.amount)}</b></div>)}
        {!vouchers.length && <div className="empty"><b>No vouchers yet</b></div>}</div>
    </div>
  </div>;
}

