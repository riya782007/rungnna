import { askText } from "../components/AskHost";
import { byRollNo, findRollNo } from "../components/SupplierNo";
import { inStore, storeStock, currentStore, MAIN_STORE } from "../lib/stores";
import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, now, type Party, type PurchaseReturnLine, type MoneyMode } from "../lib/db";
import vendorText from "../data/vendors.txt?raw";
import { parseVendorList, importVendors, duplicateSupplierGroups, mergeDuplicateSuppliers } from "../lib/vendors";
import { newParty, getShop, waLink, DEFAULT_SHOP, type Shop } from "../lib/billing";
import { supplierAging, supplierBalances, supplierLedger, savePurchaseReturn, supplierStatementText, supplierStatementPdf, type SupplierEntry } from "../lib/suppliers";
import { saveVoucher } from "../lib/vouchers";
import { sharePdf, downloadPdf, loadPdfFonts } from "../lib/pdf";
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
  /* Owner, 5 Nov ("Vendor list still duplicate"): the same roll no. + name twice is one supplier — merged by itself */
  const dupes = duplicateSupplierGroups(suppliers).length;
  useEffect(() => {
    if (!dupes || !can(me, "suppliers.manage")) return;
    mergeDuplicateSuppliers().then(n => n && toast(`${n} duplicate supplier${n > 1 ? "s" : ""} merged — bills and payments kept together`)).catch(e => toast(e.message, true));
  }, [dupes]);
  const list = useMemo(() => suppliers.filter(p => !q || ((p.vendor_code || "") + " " + p.name + " " + p.phone + " " + p.city).toLowerCase().includes(q.toLowerCase()))
    .sort(byRollNo), [suppliers, q, bal]);   // roll numbers ascending, as on the shop's vendor list
  const total = [...bal.values()].reduce((a, v) => a + Math.max(0, v), 0);
  return <div>
    <Head title="Suppliers" sub={`${suppliers.length} suppliers · ${rupees(total)} payable`}>
      <button className="btn" onClick={async () => { if (!confirm(`Load the shop vendor list (${parseVendorList(vendorText).length} vendors)? Vendors already loaded are updated, not duplicated.`)) return; const r = await importVendors(parseVendorList(vendorText)); toast(`Vendor list loaded · ${r.added} new, ${r.updated} already there`); }}>Load vendor list</button>
      {/* Owner, 3 Nov: "after the supplier's name I can't put his roll number — only the name saves". Add asks the roll
          number first (the shop finds suppliers by it), then the name; a roll number already in use is refused. */}
      <button className="btn p" onClick={async () => {
        const roll = ((await askText("Supplier roll no. (e.g. 51, 3A, M1)")) || "").trim().toUpperCase();
        if (roll) { const same = findRollNo(suppliers, roll); if (same) { toast(`Roll no. ${roll} is already ${same.name} — open it from the list, or use another number`, true); return; } }
        const n = await askText(roll ? `Name of supplier ${roll}` : "Supplier name"); if (!n?.trim()) return;
        const p = { ...newParty(n.trim().toUpperCase()), kind: "supplier" as const, ...(roll ? { vendor_code: roll } : {}) };
        await put("parties", p); toast(`${roll ? roll + " · " : ""}${p.name} added`); go("suppliers/" + p.id);
      }}><Icon n="plus" size={18} />Add</button>
    </Head>
    <input className="in" style={{ marginBottom: 12 }} placeholder="Search supplier" value={q} onChange={e => setQ(e.target.value)} />
    <div className="list">{list.map(p => {
      const a = age.get(p.id), b = bal.get(p.id) || 0;
      return <a key={p.id} href={"#/suppliers/" + p.id}>
        <span className="grow"><b className="sm">{p.vendor_code ? p.vendor_code + " · " : ""}{p.name}</b><div className="xs mut">{[p.city || "Supplier", p.less_pct ? p.less_pct + "% less" : "", p.rate_divisor && p.rate_divisor !== 1 ? "rate ÷ " + p.rate_divisor : ""].filter(Boolean).join(" · ")}</div></span>
        <span className="xs mut">0-30 {rupees(a?.d0_30 || 0)} · 31-60 {rupees(a?.d31_60 || 0)} · 60+ {rupees(a?.d60 || 0)}</span>
        <b className="mono" style={{ color: b > 0 ? "var(--bad)" : undefined }}>{rupees(Math.abs(b))}</b><Icon n="chev" size={16} />
      </a>;
    })}{!list.length && <div className="empty"><b>No suppliers yet</b>Add them here or from Stock in.</div>}</div>
  </div>;
}

function SupplierView({ id }: { id: string }) {
  const { me } = useApp();
  const p0 = useLiveQuery(() => db.parties.get(id), [id]);
  const purchases = useLiveQuery(() => db.purchases.filter(p => inStore(p) && !p.deleted && (p.supplier_id === id || p.supplier_name === p0?.name)).reverse().sortBy("at"), [id, p0?.name], []);
  const [led, setLed] = useState<{ entries: SupplierEntry[]; balance: number } | null>(null);
  const [pay, setPay] = useState(false);
  const [ret, setRet] = useState(false);
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  useEffect(() => { if (p0) supplierLedger(p0).then(setLed); }, [p0?.updated_at, purchases.length, pay, ret]);
  useEffect(() => { getShop().then(setShop); loadPdfFonts(); }, []);
  if (!p0) return <div className="skel" style={{ height: 200 }} />;
  const balance = led?.balance || 0;
  return <div>
    <Head title={p0.name} sub={[p0.phone, p0.city, "supplier"].filter(Boolean).join(" · ")}>
      <button className="btn p" onClick={() => setPay(true)}>Pay supplier</button>
      <button className="btn" onClick={() => setRet(true)}>Purchase return</button>
      <button className="btn g" onClick={async () => {
        await loadPdfFonts();
        const bytes = supplierStatementPdf(p0, led?.entries || [], shop);
        const text = supplierStatementText(p0, led?.entries || [], balance, shop);
        const r = await sharePdf(bytes, `Supplier-${p0.name}.pdf`, text);
        if (r === "downloaded") toast("PDF saved — attach it in WhatsApp");
      }}><Icon n="wa" size={18} />Share statement</button>
      {p0.phone && <a className="btn" target="_blank" rel="noreferrer" href={waLink(p0.phone, supplierStatementText(p0, led?.entries || [], balance, shop))}>WhatsApp text</a>}
    </Head>
    <VendorTerms p={p0} />
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

/* Vendor code and terms, used by Purchase bill photos: printed cost ÷ divisor, then less %. */
/* Owner, 3 Nov: "I wrote the roll number and saved, but the sticker screen doesn't pick it up". The box was called
   "Vendor code" and kept only after "Save terms"; it is now "Roll no.", saves by itself when he leaves the box or
   presses Enter, and refuses a number another supplier already has (which made the sticker screen find that one). */
function VendorTerms({ p }: { p: Party }) {
  const [code, setCode] = useState(p.vendor_code || ""), [less, setLess] = useState(String(p.less_pct || 0)), [div, setDiv] = useState(String(p.rate_divisor || 1));
  useEffect(() => { setCode(p.vendor_code || ""); }, [p.id, p.vendor_code]);
  const l = Number(less), d = Number(div), bad = !(l >= 0 && l < 100) || !(d > 0);
  const others = useLiveQuery(() => db.parties.filter(x => !x.deleted && x.kind === "supplier" && x.id !== p.id).toArray(), [p.id], []);
  const clash = code.trim() ? findRollNo(others, code) : undefined;
  const save = async (quiet = false) => {
    if (bad) return toast("Check less % and rate ÷", true);
    if (clash) return toast(`Roll no. ${code.trim()} is already ${clash.name}`, true);
    const fresh = (await db.parties.get(p.id)) || p;
    if ((fresh.vendor_code || "") === code.trim() && (fresh.less_pct || 0) === l && (fresh.rate_divisor || 1) === d) { if (!quiet) toast("Saved"); return; }
    await put("parties", { ...fresh, vendor_code: code.trim(), less_pct: l, rate_divisor: d, updated_at: now() });
    toast(`Saved · roll no. ${code.trim() || "—"}`);
  };
  return <div className="card row" style={{ gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
    <label className="f">Roll no.<input className="in mono" value={code} onChange={e => setCode(e.target.value.toUpperCase())} onBlur={() => void save(true)} onKeyDown={e => { if (e.key === "Enter") void save(); }} style={{ width: 90 }} placeholder="e.g. 51" />
      {clash && <span className="xs bad-text">Already {clash.name}</span>}</label>
    <label className="f">Less %<input className="in mono" inputMode="decimal" value={less} onChange={e => setLess(e.target.value)} onBlur={() => void save(true)} style={{ width: 80 }} /></label>
    <label className="f">Rate ÷<input className="in mono" inputMode="decimal" value={div} onChange={e => setDiv(e.target.value)} onBlur={() => void save(true)} style={{ width: 80 }} /></label>
    <button className="btn" disabled={bad || !!clash} onClick={() => void save()}>Save</button>
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
  const purchases = useLiveQuery(() => db.purchases.filter(x => inStore(x) && x.status === "final" && !x.deleted && (x.supplier_id === p.id || x.supplier_name === p.name)).reverse().sortBy("at"), [p.id, p.name], []);
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
