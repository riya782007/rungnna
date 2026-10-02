import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, type Party, type PurchaseReturnLine, type MoneyMode } from "../lib/db";
import { newParty, getShop, waLink, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { supplierAging, supplierBalances, supplierLedger, savePurchaseReturn, supplierStatementText, supplierStatementPdf, type SupplierEntry } from "../lib/suppliers";
import { saveVoucher } from "../lib/vouchers";
import { sharePdf, downloadPdf } from "../lib/pdf";
import { useApp, go, toast } from "../lib/app";
import { can } from "../lib/roles";
import { rupees, toPaise, when } from "../lib/format";
import { Head, Modal, useLocations } from "../components/common";
import { Icon } from "../components/Icon";

export default function Suppliers({ args }: { args: string[] }) {
  return args[0] ? <SupplierView id={args[0]} /> : <SupplierList />;
}

function SupplierList() {
  const { me } = useApp();
  if (!can(me, "rates")) return <div className="card empty"><b>Not available for your role</b>Supplier dues include cost.</div>;
  const [q, setQ] = useState("");
  const suppliers = useLiveQuery(() => db.parties.filter(p => !p.deleted && p.kind === "supplier").toArray(), [], []);
  const stamp = useLiveQuery(async () => (await db.purchases.count()) + ":" + (await db.vouchers.count()) + ":" + (await db.purchase_returns.count()), [], "");
  const [bal, setBal] = useState(new Map<string, number>());
  const [age, setAge] = useState(new Map<string, { d0_30: number; d31_60: number; d60: number; total: number }>());
  useEffect(() => { supplierBalances().then(setBal); supplierAging().then(setAge); }, [stamp, suppliers.length]);
  const list = useMemo(() => suppliers.filter(p => !q || (p.name + " " + p.phone + " " + p.city).toLowerCase().includes(q.toLowerCase()))
    .sort((a, z) => (bal.get(z.id) || 0) - (bal.get(a.id) || 0)), [suppliers, q, bal]);
  const total = [...bal.values()].reduce((a, v) => a + Math.max(0, v), 0);
  return <div>
    <Head title="Suppliers" sub={`${suppliers.length} suppliers · ${rupees(total)} payable`}>
      <button className="btn p" onClick={async () => { const n = prompt("Supplier name"); if (!n) return; const p = { ...newParty(n.toUpperCase()), kind: "supplier" as const }; await put("parties", p); go("suppliers/" + p.id); }}><Icon n="plus" size={18} />Add</button>
    </Head>
    <input className="in" style={{ marginBottom: 12 }} placeholder="Search supplier" value={q} onChange={e => setQ(e.target.value)} />
    <div className="list">{list.map(p => {
      const a = age.get(p.id), b = bal.get(p.id) || 0;
      return <a key={p.id} href={"#/suppliers/" + p.id}>
        <span className="grow"><b className="sm">{p.name}</b><div className="xs mut">{[p.phone, p.city].filter(Boolean).join(" · ") || "Supplier"}</div></span>
        <span className="xs mut">0-30 {rupees(a?.d0_30 || 0)} · 31-60 {rupees(a?.d31_60 || 0)} · 60+ {rupees(a?.d60 || 0)}</span>
        <b className="mono" style={{ color: b > 0 ? "var(--bad)" : undefined }}>{rupees(Math.abs(b))}</b><Icon n="chev" size={16} />
      </a>;
    })}{!list.length && <div className="empty"><b>No suppliers yet</b>Add them here or from Stock in.</div>}</div>
  </div>;
}

function SupplierView({ id }: { id: string }) {
  const { me } = useApp();
  const p0 = useLiveQuery(() => db.parties.get(id), [id]);
  const purchases = useLiveQuery(() => db.purchases.filter(p => !p.deleted && (p.supplier_id === id || p.supplier_name === p0?.name)).reverse().sortBy("at"), [id, p0?.name], []);
  const [led, setLed] = useState<{ entries: SupplierEntry[]; balance: number } | null>(null);
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  useEffect(() => { if (p0) supplierLedger(p0).then(setLed); }, [p0?.updated_at, purchases.length, pay, ret]);
  useEffect(() => { getShop().then(setShop); }, []);
  if (!p0) return <div className="skel" style={{ height: 200 }} />;
  const balance = led?.balance || 0;
  return <div>
    <Head title={p0.name} sub={[p0.phone, p0.city, "supplier"].filter(Boolean).join(" · ")}>
      <button className="btn p" onClick={() => setPay(true)}>Pay supplier</button>
      <button className="btn" onClick={() => setRet(true)}>Purchase return</button>
      <button className="btn g" onClick={async () => {
        const bytes = supplierStatementPdf(p0, led?.entries || [], shop);
        const text = supplierStatementText(p0, led?.entries || [], balance, shop);
        const r = await sharePdf(bytes, `Supplier-${p0.name}.pdf`, text);
        if (r === "downloaded") toast("PDF saved — attach it in WhatsApp");
      }}><Icon n="wa" size={18} />Share statement</button>
      {p0.phone && <a className="btn" target="_blank" rel="noreferrer" href={waLink(p0.phone, supplierStatementText(p0, led?.entries || [], balance, shop))}>WhatsApp text</a>}
    </Head>
    <div className="hero three">
      <div><span className="k">{balance >= 0 ? "Payable" : "Debit balance"}</span><b>{rupees(Math.abs(balance))}</b></div>
      <div><span className="k">Bills</span><b>{purchases.length}</b></div>
      <div><span className="k">Last purchase</span><b style={{ fontSize: 18 }}>{purchases[0] ? when(purchases[0].at) : "—"}</b></div>
    </div>
    <div className="card tw"><table><thead><tr><th>Date</th><th>Entry</th><th className="r">Bill</th><th className="r">Paid / DN</th><th className="r">Balance</th></tr></thead>
      <tbody>{(led?.entries || []).slice().reverse().map((e, i) => <tr key={i}><td className="xs mut">{e.kind === "opening" ? "—" : new Date(e.at).toLocaleDateString("en-IN")}</td><td>{e.ref}<div className="xs mut">{e.note}</div></td><td className="r mono">{e.debit ? rupees(e.debit) : ""}</td><td className="r mono">{e.credit ? rupees(e.credit) : ""}</td><td className="r mono b">{rupees(e.balance)}</td></tr>)}</tbody></table></div>
    {pay && <PaySupplier p={p0} by={me?.id || ""} onClose={() => setPay(false)} />}
    {ret && <ReturnSupplier p={p0} by={me?.id || ""} onClose={() => setRet(false)} />}
  </div>;
}

function PaySupplier({ p, by, onClose }: { p: Party; by: string; onClose: () => void }) {
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<MoneyMode>("cash");
  const [note, setNote] = useState("");
  return <Modal title={"Pay supplier · " + p.name} onClose={onClose}><div className="stack">
    <input className="in mono" autoFocus inputMode="decimal" placeholder="Amount" value={amount} onChange={e => setAmount(e.target.value)} />
    <div className="seg">{(["cash", "upi", "bank", "cheque"] as const).map(m => <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>{m.toUpperCase()}</button>)}</div>
    <input className="in" placeholder="Note / UTR / cheque no." value={note} onChange={e => setNote(e.target.value)} />
    <button className="btn p big" onClick={async () => { const a = toPaise(amount); if (!a) return toast("Enter amount", true); const v = await saveVoucher({ type: "payment", party: p, amount: a, mode, note, by }); toast("Saved " + v.no); onClose(); }}>Save payment</button>
  </div></Modal>;
}

function ReturnSupplier({ p, by, onClose }: { p: Party; by: string; onClose: () => void }) {
  const locs = useLocations();
  const purchases = useLiveQuery(() => db.purchases.filter(x => x.status === "final" && !x.deleted && (x.supplier_id === p.id || x.supplier_name === p.name)).reverse().sortBy("at"), [p.id, p.name], []);
  const [pick, setPick] = useState("");
  const [lines, setLines] = useState<PurchaseReturnLine[]>([]);
  const purchase = purchases.find(x => x.id === pick);
  useEffect(() => { if (!purchase) return; setLines(purchase.items.slice(0, 20).map(l => ({ id: l.id, product_id: l.product_id, code: l.code, item: l.item, style: l.style, color: l.color, qty: 0, cost: l.cost, loc_id: purchase.loc_id }))); }, [pick]);
  const total = lines.reduce((a, l) => a + l.qty * l.cost, 0);
  return <Modal title={"Purchase return · " + p.name} onClose={onClose}><div className="stack">
    <label className="f">Purchase bill<select className="in" value={pick} onChange={e => setPick(e.target.value)}><option value="">Choose bill</option>{purchases.map(x => <option key={x.id} value={x.id}>{x.no} · {when(x.at)} · {rupees(x.total_cost)}</option>)}</select></label>
    <div className="list">{lines.map(l => <div key={l.id} className="li"><span className="grow"><b className="sm">{l.item}</b> <span className="mono sm">{l.style}</span><div className="xs mut">{rupees(l.cost)} cost</div></span>
      <select className="cell" value={l.loc_id} onChange={e => setLines(xs => xs.map(x => x.id === l.id ? { ...x, loc_id: e.target.value } : x))}>{locs.map(loc => <option key={loc.id} value={loc.id}>{loc.code}</option>)}</select>
      <input className="cell r" style={{ width: 64 }} inputMode="numeric" value={l.qty || ""} onChange={e => setLines(xs => xs.map(x => x.id === l.id ? { ...x, qty: parseInt(e.target.value) || 0 } : x))} /></div>)}</div>
    <div className="net"><span>DEBIT NOTE</span><b>{rupees(total)}</b></div>
    <button className="btn p big" disabled={!lines.some(l => l.qty > 0)} onClick={async () => { const dn = await savePurchaseReturn({ supplier: p, purchase, items: lines.filter(l => l.qty > 0), by }); toast("Saved " + dn.no); onClose(); }}>Save DN</button>
  </div></Modal>;
}

