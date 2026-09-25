import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type Party, type Payment } from "../lib/db";
import { newParty, waLink, normPhone, getShop, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { ledger, receive, balances, statementText, type Entry } from "../lib/ledger";
import { go, toast, useApp } from "../lib/app";
import { rupees, toPaise, when } from "../lib/format";
import { Head, PhotoButton, Thumb } from "../components/common";
import { Icon } from "../components/Icon";
import { VoiceNotes } from "../components/Voice";

/* Customers: who buys, what they owe, one tap to collect or remind. */
export default function Customers({ args }: { args: string[] }) {
  return args[0] ? <PartyView id={args[0]} /> : <PartyList />;
}

function PartyList() {
  const [q, setQ] = useState("");
  const [onlyDue, setOnlyDue] = useState(false);
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted).toArray(), [], []);
  const stamp = useLiveQuery(async () => (await db.bills.count()) + ":" + (await db.receipts.count()) + ":" + (await db.bills.orderBy("updated_at").last())?.updated_at, [], "");
  const [bal, setBal] = useState<Map<string, number>>(new Map());
  useEffect(() => { balances().then(setBal); }, [stamp, parties.length]);
  const list = useMemo(() => parties
    .filter(p => (!q || (p.name + " " + p.phone + " " + p.city).toLowerCase().includes(q.toLowerCase())) && (!onlyDue || (bal.get(p.id) || 0) > 0))
    .sort((a, z) => (bal.get(z.id) || 0) - (bal.get(a.id) || 0) || a.name.localeCompare(z.name)), [parties, q, onlyDue, bal]);
  const toCollect = [...bal.values()].reduce((a, v) => a + Math.max(0, v), 0);
  return (
    <div>
      <Head title="Customers" sub={`${parties.length} customers · ${rupees(toCollect)} to collect`}>
        <button className="btn p" onClick={async () => { const n = prompt("Customer / shop name"); if (!n) return; const ph = prompt("Mobile number") || ""; const p = newParty(n.toUpperCase(), ph.replace(/\D/g, "")); await put("parties", p); go("customers/" + p.id); }}><Icon n="plus" size={18} />Add</button>
      </Head>
      <div className="row" style={{ marginBottom: 12, flexWrap: "nowrap" }}>
        <div className="wedge grow"><Icon n="search" size={18} /><input placeholder="Name, mobile or city" value={q} onChange={e => setQ(e.target.value)} /></div>
        <button className="chip" aria-pressed={onlyDue} onClick={() => setOnlyDue(!onlyDue)}>With dues</button>
      </div>
      <div className="list">
        {list.map(p => { const b = bal.get(p.id) || 0; return (
          <a key={p.id} href={"#/customers/" + p.id}>
            <Thumb photo_id={p.photo_id} url={p.photo_url} text={p.name} size={40} />
            <span className="grow"><b className="sm">{p.name}</b><div className="xs mut">{[p.phone, p.city].filter(Boolean).join(" · ") || p.tier}</div></span>
            {b > 0 ? <b className="mono" style={{ color: "var(--bad)" }}>{rupees(b)}</b> : b < 0 ? <span className="pill ok">advance {rupees(-b)}</span> : <span className="xs mut">clear</span>}
            <Icon n="chev" size={16} />
          </a>); })}
        {!list.length && <div className="empty"><b>No customers yet</b>They're added from the bill screen (F3) or with Add.</div>}
      </div>
    </div>
  );
}

function PartyView({ id }: { id: string }) {
  const { me } = useApp();
  const p0 = useLiveQuery(() => db.parties.get(id), [id]);
  const bills = useLiveQuery(() => db.bills.where("party_id").equals(id).filter(b => !b.deleted).reverse().sortBy("at"), [id], []);
  const rc = useLiveQuery(() => db.receipts.where("party_id").equals(id).count(), [id], 0);
  const [p, setP] = useState<Party | null>(null);
  const [led, setLed] = useState<{ entries: Entry[]; balance: number } | null>(null);
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [amt, setAmt] = useState("");
  const [mode, setMode] = useState<Payment["mode"]>("cash");
  const [note, setNote] = useState("");
  const [tab, setTab] = useState<"account" | "bills" | "details">("account");
  const [printing, setPrinting] = useState(false);
  useEffect(() => { if (p0) setP({ ...p0 }); }, [p0?.updated_at]);
  useEffect(() => { if (p0) ledger(p0).then(setLed); }, [p0?.updated_at, bills, rc]);
  useEffect(() => { getShop().then(setShop); }, []);
  useEffect(() => { if (!printing) return; const t = setTimeout(() => { window.print(); setPrinting(false); }, 200); return () => clearTimeout(t); }, [printing]);
  if (!p || !p0) return <div className="skel" style={{ height: 200 }} />;
  const set = (k: keyof Party, v: any) => setP({ ...p, [k]: v });
  const bal = led?.balance || 0;
  const collect = async () => {
    const a = toPaise(amt); if (!a) return toast("Enter the amount", true);
    const r = await receive(p0, a, mode, note, me?.id || "");
    toast(`Received ${rupees(a)} · ${r.no}${r.unallocated ? " · " + rupees(r.unallocated) + " kept as advance" : ""}`);
    setAmt(""); setNote("");
  };
  return (
    <div>
      <Head title={p.name} sub={[p.phone, p.city, p.kind].filter(Boolean).join(" · ")}>
        {p.phone && <a className="btn" href={"tel:" + p.phone}>Call</a>}
        {p.phone && <a className="btn" target="_blank" rel="noreferrer" href={waLink(p.phone, `Namaste ${p.name} ji,`)}><Icon n="wa" size={18} />WhatsApp</a>}
        <button className="btn p" onClick={() => go("bill")}>New bill</button>
      </Head>

      <div className="hero three">
        <div><span className="k">{bal >= 0 ? "Balance due" : "Advance with us"}</span><b>{rupees(Math.abs(bal))}</b><span className="xs">{bills.filter(b => b.status === "final").length} bills</span></div>
        <div><span className="k">Bought (all time)</span><b>{rupees(bills.filter(b => b.status === "final").reduce((a, b) => a + b.net, 0))}</b></div>
        <div><span className="k">Last bill</span><b style={{ fontSize: 18 }}>{bills[0] ? when(bills[0].at) : "—"}</b></div>
      </div>

      <div className="tabs" style={{ marginBottom: 14 }}>
        {(["account", "bills", "details"] as const).map(t => <a key={t} href={"#/customers/" + id} className={tab === t ? "on" : ""} onClick={e => { e.preventDefault(); setTab(t); }}>{t === "account" ? "Account" : t === "bills" ? "Bills" : "Details"}</a>)}
      </div>

      {tab === "account" && <div className="split">
        <div className="card pad stack">
          <b>Receive payment</b>
          <input className="in mono" style={{ fontSize: 22, height: 54 }} inputMode="decimal" placeholder={bal > 0 ? String(bal / 100) : "0"} value={amt} onChange={e => setAmt(e.target.value)} />
          <div className="seg">{(["cash", "upi", "bank", "card"] as const).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m.toUpperCase()}</button>)}</div>
          <input className="in" placeholder="Note (cheque no., UTR…)" value={note} onChange={e => setNote(e.target.value)} />
          <button className="btn p big" onClick={collect}>Receive {amt ? rupees(toPaise(amt)) : ""}</button>
          <div className="xs mut">Clears the opening balance first, then the oldest bills. Any extra is kept as advance.</div>
          <div className="row">
            {p.phone && <a className="btn sm" target="_blank" rel="noreferrer" href={waLink(p.phone, statementText(p0, led?.entries || [], bal, shop))}><Icon n="wa" size={16} />Send statement</a>}
            <button className="btn sm" onClick={() => setPrinting(true)}><Icon n="print" size={16} />Print statement</button>
          </div>
        </div>
        <div className="card tw"><table>
          <thead><tr><th>Date</th><th>Entry</th><th className="r">Debit</th><th className="r">Credit</th><th className="r">Balance</th></tr></thead>
          <tbody>{(led?.entries || []).slice().reverse().map((e, i) => (
            <tr key={i} className={e.kind === "bill" ? "click" : ""} onClick={() => e.kind === "bill" && go("bills/" + e.id)}>
              <td className="xs mut">{e.kind === "opening" ? "—" : new Date(e.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</td>
              <td className="sm">{e.ref}{e.note ? <div className="xs mut">{e.note}</div> : null}</td>
              <td className="r mono">{e.debit ? rupees(e.debit) : ""}</td><td className="r mono" style={{ color: "var(--ok)" }}>{e.credit ? rupees(e.credit) : ""}</td>
              <td className="r mono b">{rupees(e.balance)}</td></tr>))}
            {!led?.entries.length && <tr><td colSpan={5} className="empty">No entries yet.</td></tr>}
          </tbody></table></div>
      </div>}

      {tab === "bills" && <div className="list">
        {bills.map(b => <a key={b.id} href={"#/bills/" + b.id}><span className="grow"><b className="mono sm">{b.no || "on hold"}</b><div className="xs mut">{when(b.at)} · {b.total_qty} pcs · {b.status}</div></span><b className="mono">{rupees(b.net)}</b><Icon n="chev" size={16} /></a>)}
        {!bills.length && <div className="empty"><b>No bills yet</b></div>}
      </div>}

      {tab === "details" && <div className="split">
        <div className="card pad stack">
          <div className="row"><Thumb photo_id={p.photo_id} url={p.photo_url} text={p.name} size={72} /><PhotoButton value={p.photo_id} onChange={v => set("photo_id", v)} label="Photo" /></div>
          <div className="grid g2">
            <label className="f">Name<input className="in" value={p.name} onChange={e => set("name", e.target.value.toUpperCase())} /></label>
            <label className="f">Mobile / WhatsApp<input className="in mono" inputMode="tel" value={p.phone} onChange={e => set("phone", e.target.value.replace(/[^\d+]/g, ""))} /></label>
            <label className="f">Type<select className="in" value={p.kind} onChange={e => set("kind", e.target.value)}><option value="customer">Customer</option><option value="dealer">Dealer</option><option value="supplier">Supplier</option></select></label>
            <label className="f">Price tier<select className="in" value={p.tier} onChange={e => set("tier", e.target.value)}><option value="retail">Retail</option><option value="wholesale">Wholesale</option><option value="dealer">Dealer</option></select></label>
            <label className="f">GSTIN<input className="in mono" value={p.gstin} onChange={e => set("gstin", e.target.value.toUpperCase())} /></label>
            <label className="f">State<input className="in" value={p.state} onChange={e => set("state", e.target.value)} placeholder="Delhi" /></label>
            <label className="f">City<input className="in" value={p.city} onChange={e => set("city", e.target.value)} /></label>
            <label className="f">Credit limit ₹<input className="in mono" inputMode="decimal" value={p.credit_limit ? p.credit_limit / 100 : ""} onChange={e => set("credit_limit", toPaise(e.target.value))} /></label>
            <label className="f">Opening balance ₹ (old khata)<input className="in mono" inputMode="decimal" placeholder="0" value={p.opening_balance ? p.opening_balance / 100 : ""} onChange={e => { const neg = e.target.value.trim().startsWith("-"); set("opening_balance", (neg ? -1 : 1) * toPaise(e.target.value)); }} /></label>
          </div>
          <label className="f">Address<textarea className="in" rows={2} value={p.address} onChange={e => set("address", e.target.value)} /></label>
          <label className="f">Notes<textarea className="in" rows={2} value={p.notes} onChange={e => set("notes", e.target.value)} placeholder="Likes kundan sets, pays on Saturdays…" /></label>
          <button className="btn p" onClick={async () => { await put("parties", { ...p, phone: normPhone(p.phone).replace(/^91(?=\d{10}$)/, "") }); toast("Saved"); }}>Save</button>
        </div>
        <div className="card pad"><VoiceNotes entity="party" entityId={p.id} /></div>
      </div>}

      {printing && createPortal(
        <div className="inv">
          <style>{"@page{size:A5;margin:8mm}"}</style>
          <div className="inv-head"><div><div className="inv-shop">{shop.name}</div><div className="inv-sub">{[shop.address, shop.phone].filter(Boolean).join(" · ")}</div></div><div className="inv-title">STATEMENT</div></div>
          <div className="inv-meta"><div><b>{p.name}</b><br />{p.phone}</div><div>{new Date().toLocaleDateString("en-IN")}</div></div>
          <table className="inv-t"><thead><tr><th>Date</th><th>Entry</th><th>Debit</th><th>Credit</th><th>Balance</th></tr></thead>
            <tbody>{(led?.entries || []).map((e, i) => <tr key={i}><td>{e.kind === "opening" ? "" : new Date(e.at).toLocaleDateString("en-IN")}</td><td>{e.ref}</td><td style={{ textAlign: "right" }}>{e.debit ? (e.debit / 100).toFixed(2) : ""}</td><td style={{ textAlign: "right" }}>{e.credit ? (e.credit / 100).toFixed(2) : ""}</td><td style={{ textAlign: "right" }}>{(e.balance / 100).toFixed(2)}</td></tr>)}</tbody></table>
          <div className="inv-foot"><div /><table className="inv-sum"><tbody><tr className="inv-net"><td>{bal >= 0 ? "Balance due" : "Advance"}</td><td style={{ textAlign: "right" }}>{rupees(Math.abs(bal))}</td></tr></tbody></table></div>
        </div>, document.getElementById("printroot")!)}
    </div>
  );
}
