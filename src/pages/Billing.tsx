import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, getSetting, setSetting, type Bill, type BillLine, type Party, type Payment, type Product } from "../lib/db";
import { findByScan, fromParsed, saveProduct, patterns, itemNameFor, label } from "../lib/products";
import { parseLabel } from "../lib/parse";
import { newBill, lineFrom, totals, fixLine, finalize, holdBill, due, getShop, newParty, partyDue, shareBill, DEFAULT_SHOP, seriesOf, fy, counterCode, type Shop } from "../lib/billing";
import { voiceBill } from "../lib/ai";
import { useApp, toast, beep, go } from "../lib/app";
import { rupees, toPaise } from "../lib/format";
import { CameraScanner } from "../components/Scanner";
import { MicButton } from "../components/Voice";
import { Modal, PhotoButton, Thumb } from "../components/common";
import { PrintBill, type PrintFormat } from "../components/Invoice";

/* The counter screen. Built like the shop's current PACKING SLIP: scan → lines → totals → save/print,
   every action on a function key, works with no internet (numbers come from this counter's own series). */

const KEYS: [string, string][] = [["F2", "New"], ["F3", "Customer"], ["F4", "Hold"], ["F5", "Held"], ["F6", "Next box"], ["F7", "Scan"],
  ["F8", "Save"], ["F9", "Save+Print"], ["F10", "WhatsApp"], ["F12", "GST/Est"]];

export default function Billing({ args }: { args: string[] }) {
  const { me } = useApp();
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [b, setB] = useState<Bill | null>(null);
  const [box, setBox] = useState(1);
  const [q, setQ] = useState("");
  const [cam, setCam] = useState(false);
  const [held, setHeld] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [printing, setPrinting] = useState<{ bill: Bill; fmt: PrintFormat } | null>(null);
  const [fmt, setFmt] = useState<PrintFormat>("a5");
  const [aiBusy, setAiBusy] = useState(false);
  const [nextNo, setNextNo] = useState("");
  const [due0, setDue0] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], []);
  const staff = useLiveQuery(() => db.staff.filter(s => !!s.active && !s.deleted).toArray(), [], []);

  /* load shop profile + a resumed bill (#/bill/<id>) or the unsaved draft on this device */
  useEffect(() => {
    (async () => {
      const s = await getShop(); setShop(s);
      setFmt(await getSetting<PrintFormat>("print_fmt", "a5"));
      if (args[0]) { const x = await db.bills.get(args[0]); if (x) { setB(x); return; } }
      const d = await getSetting<Bill | null>("draft_bill", null);
      setB(d && d.status === "hold" && !d.no ? d : newBill(me?.id || "", s, await getSetting("default_bill_type", "estimate")));
    })();
  }, [args[0]]);
  useEffect(() => { if (b && !b.no) setSetting("draft_bill", b); }, [b]);
  useEffect(() => { if (!b) return; (async () => {
    const cc = await counterCode(); const n = (await getSetting<number>(`seq_${seriesOf(b.bill_type)}_${fy()}_${cc}`, 0)) + 1;
    setNextNo(`${seriesOf(b.bill_type)}/${fy()}/${cc}-${String(n).padStart(4, "0")}`);
  })(); }, [b?.bill_type]);
  useEffect(() => { b?.party_id ? partyDue(b.party_id).then(setDue0) : setDue0(0); }, [b?.party_id]);

  const t = useMemo(() => (b ? totals(b, shop.state) : null), [b, shop.state]);
  const set = (patch: Partial<Bill>) => setB(x => (x ? { ...x, ...patch } : x));
  const setLine = (id: string, patch: Partial<BillLine>) => setB(x => x ? { ...x, items: x.items.map(l => (l.id === id ? fixLine({ ...l, ...patch }) : l)) } : x);
  const dropLine = (id: string) => setB(x => x ? { ...x, items: x.items.filter(l => l.id !== id) } : x);

  function addProduct(p: Product, pkts = 1, pieces = 0, rate = 0) {
    setB(x => {
      if (!x) return x;
      const same = x.items.find(l => l.product_id === p.id && l.box_no === box);
      if (same && !pieces && !rate) {
        return { ...x, items: x.items.map(l => l.id === same.id ? fixLine(l.pack > 1 ? { ...l, pkts: l.pkts + pkts } : { ...l, qty: l.qty + pkts }) : l) };
      }
      let line = lineFrom(p, box, pkts);
      if (pieces) line = fixLine({ ...line, pkts: 0, qty: pieces });
      if (rate) line = fixLine({ ...line, rate: toPaise(rate) });
      return { ...x, items: [...x.items, line] };
    });
  }

  /* a scan or Enter in the box: find the product; unknown shop labels create the product on the spot */
  async function onCode(raw: string) {
    const r = raw.trim(); if (!r) return;
    let p = await findByScan(r);
    if (!p) {
      const parsed = parseLabel(r, await patterns());
      if (parsed.style && (parsed.how === "shop label" || parsed.how === "rungnna")) {
        const np = fromParsed(parsed, me?.id || "");
        np.item = np.item || (await itemNameFor(np.item_code)) || "";
        p = await saveProduct(np);
        toast(`New product added from label: ${label(p)}`);
      }
    }
    if (!p) {
      const hits = products.filter(x => (x.style + " " + x.code + " " + x.item).toUpperCase().includes(r.toUpperCase()));
      if (hits.length === 1) p = hits[0];
    }
    if (!p) { beep(false); toast("Not found — scan the label or record it in Scan & record", true); return; }
    beep(true); addProduct(p); setQ("");
  }

  const suggestions = useMemo(() => {
    const w = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (!w.length) return [];
    return products.filter(p => w.every(x => (p.style + " " + p.item + " " + p.color + " " + p.code).toUpperCase().includes(x))).slice(0, 8);
  }, [q, products]);

  async function doSave(print = false, share = false) {
    if (!b || !t) return;
    if (!t.items.length) return toast("No items on the bill", true);
    if (b.bill_type === "gst" && !shop.gstin) toast("Tip: add the shop GSTIN in Settings → Shop profile", true);
    const done = await finalize(b, shop.state, b.party_name);
    toast(`Saved ${done.no} · ${rupees(done.net)}`);
    await setSetting("draft_bill", null);
    if (print) setPrinting({ bill: done, fmt });
    if (share) await shareBill(done, shop);
    setB(newBill(me?.id || "", shop, b.bill_type)); setBox(1);
    setNextNo("");
  }
  async function doHold() {
    if (!b?.items.length) return toast("Nothing to hold", true);
    await holdBill(totals(b, shop.state)); await setSetting("draft_bill", null);
    toast("Bill on hold — F5 to bring it back"); setB(newBill(me?.id || "", shop, b.bill_type)); setBox(1);
  }
  async function doVoice(audio?: Blob, text?: string) {
    setAiBusy(true);
    try {
      const r = await voiceBill({ audio, text });
      let added = 0;
      for (const l of r.lines || []) {
        const cand = products.filter(p =>
          (!l.style || p.style.replace(/\s/g, "") === l.style.toUpperCase().replace(/\s/g, "")) &&
          (!l.item || p.item.toUpperCase().includes(l.item.toUpperCase()) || !!l.style) &&
          (!l.color || !p.color || p.color.toUpperCase().includes(l.color.toUpperCase().split(" ")[0])));
        const p = cand[0];
        if (!p) { toast(`Couldn't match: ${[l.item, l.style, l.color].filter(Boolean).join(" ")}`, true); continue; }
        addProduct(p, l.packets || (l.pieces ? 0 : 1), l.packets ? 0 : l.pieces || 0, l.rate || 0); added++;
      }
      if (r.customer?.name && !b?.party_name) set({ party_name: r.customer.name, party_phone: r.customer.phone || "" });
      if (r.remarks) set({ remarks: [b?.remarks, r.remarks].filter(Boolean).join(" · ") });
      toast(`${added} line${added === 1 ? "" : "s"} added${r.heard ? " — heard: " + r.heard : ""}`);
    } catch (e: any) { toast(e.message, true); } finally { setAiBusy(false); }
  }

  /* function keys */
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      const k = e.key;
      if (!/^F\d+$/.test(k)) return;
      e.preventDefault();
      if (k === "F2") { setB(newBill(me?.id || "", shop, b?.bill_type || "estimate")); setBox(1); }
      if (k === "F3") setCustOpen(true);
      if (k === "F4") doHold();
      if (k === "F5") setHeld(true);
      if (k === "F6") setBox(x => x + 1);
      if (k === "F7") scanRef.current?.focus();
      if (k === "F8") doSave(false);
      if (k === "F9") doSave(true);
      if (k === "F10") doSave(false, true);
      if (k === "F12") set({ bill_type: b?.bill_type === "gst" ? "estimate" : "gst" });
    };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  });

  if (!b || !t) return <div className="card pad">Loading…</div>;
  const boxes = [...new Set([...t.items.map(l => l.box_no), box])].sort((a, z) => a - z);
  const balance = due(t);

  return (
    <div className="pos">
      <div className="pos-top card">
        <div className="seg" role="group" aria-label="Bill type">
          <button aria-pressed={b.bill_type === "estimate"} onClick={() => set({ bill_type: "estimate" })}>Estimate</button>
          <button aria-pressed={b.bill_type === "gst"} onClick={() => set({ bill_type: "gst" })}>GST Invoice</button>
        </div>
        <div className="pos-no"><span className="xs mut">{b.no ? "Bill no" : "Next no"}</span><b className="mono">{b.no || nextNo}</b></div>
        <button className="pos-cust" onClick={() => setCustOpen(true)}>
          <span className="xs mut">Customer · F3</span>
          <b>{b.party_name || "Walk-in / cash"}</b>
          <span className="xs">{b.party_phone}{due0 > 0 ? <span className="pill bad" style={{ marginLeft: 6 }}>Due {rupees(due0)}</span> : null}</span>
        </button>
        <label className="f" style={{ minWidth: 130 }}>Salesman
          <select className="in" value={b.salesman} onChange={e => set({ salesman: e.target.value })}>
            <option value="">—</option>{staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></label>
        <div className="pos-box"><span className="xs mut">Box · F6</span>
          <div className="row" style={{ gap: 4 }}>{boxes.map(x => <button key={x} className="chip" aria-pressed={x === box} onClick={() => setBox(x)}>{x}</button>)}
            <button className="chip" onClick={() => setBox(Math.max(...boxes) + 1)}>+</button></div></div>
      </div>

      <div className="pos-main">
        <div className="stack" style={{ minWidth: 0 }}>
          <div className="card pad stack" style={{ gap: 8 }}>
            <div className="row scanrow">
              <div className="wedge grow" style={{ position: "relative" }}>
                <span aria-hidden>▥</span>
                <input ref={scanRef} autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Scan label, or type style / item (F7)"
                  onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); suggestions.length === 1 && q.length < 20 ? (addProduct(suggestions[0]), setQ("")) : onCode(q); } }} />
                {suggestions.length > 0 && q.length < 25 && (
                  <div className="sugg">{suggestions.map(p => (
                    <button key={p.id} onClick={() => { addProduct(p); setQ(""); scanRef.current?.focus(); }}>
                      <Thumb photo_id={p.photo_id} url={p.photo_url} text={p.item} size={34} />
                      <span className="grow"><b>{p.style || p.code}</b> <span className="mut">{p.item} · {p.color}</span></span>
                      <span className="mono">{p.rate ? rupees(p.rate) : ""}{p.pack ? " ×" + p.pack : ""}</span></button>))}</div>)}
              </div>
              <button className={"btn " + (cam ? "dk" : "")} onClick={() => setCam(!cam)} title="Camera scan">📷</button>
              <MicButton onAudio={a => doVoice(a)} busy={aiBusy} label="🎙 Speak order" />
            </div>
            {cam && <div style={{ maxWidth: 420 }}><CameraScanner onCode={c => onCode(c)} /></div>}
          </div>

          <div className="card tw">
            <table className="pos-t">
              <thead><tr><th>#</th><th>Box</th><th>Item · Style · Colour</th><th className="r">Pkt</th><th className="r">Pcs</th><th className="r">Rate ₹</th><th className="r">Disc</th><th className="r">Amount</th><th /></tr></thead>
              <tbody>
                {t.items.map((l, i) => (
                  <tr key={l.id} className="ln">
                    <td className="mut" data-l="#">{i + 1}</td>
                    <td data-l="Box"><input className="cell" style={{ width: 38 }} inputMode="numeric" value={l.box_no} onChange={e => setLine(l.id, { box_no: parseInt(e.target.value) || 1 })} /></td>
                    <td data-l=""><b>{l.item || "—"}</b> <span className="mono">{l.style}</span> <span className="mut">{l.color}</span></td>
                    <td className="r" data-l="Packets">{l.pack > 1 ? <span className="row" style={{ gap: 2, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <input className="cell r" style={{ width: 44 }} inputMode="numeric" value={l.pkts || ""} onChange={e => setLine(l.id, { pkts: parseInt(e.target.value) || 0 })} /><span className="xs mut">×{l.pack}</span></span> : <span className="mut">—</span>}</td>
                    <td className="r" data-l="Pieces"><input className="cell r" style={{ width: 56 }} inputMode="numeric" value={l.qty || ""} disabled={l.pack > 1 && l.pkts > 0}
                      onChange={e => setLine(l.id, { qty: parseInt(e.target.value) || 0, pkts: 0 })} /></td>
                    <td className="r" data-l="Rate ₹"><input className="cell r" style={{ width: 70 }} inputMode="decimal" value={l.rate ? l.rate / 100 : ""} onChange={e => setLine(l.id, { rate: toPaise(e.target.value) })} /></td>
                    <td className="r" data-l="Disc"><input className="cell r" style={{ width: 54 }} placeholder="—" value={l.disc} onChange={e => setLine(l.id, { disc: e.target.value })} /></td>
                    <td className="r mono b" data-l="Amount">{(l.amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td data-l=""><button className="x" aria-label="Remove line" onClick={() => dropLine(l.id)}>✕</button></td>
                  </tr>))}
                {!t.items.length && <tr><td colSpan={9} className="mut" style={{ padding: 28, textAlign: "center" }}>Scan a label, type a style, or tap 🎙 and say the order.<br /><span className="xs">e.g. “do packet K5208 white, ek darjan jhumki gold”</span></td></tr>}
              </tbody>
            </table>
          </div>
          <div className="card pad grid g2">
            <label className="f">Remarks<input className="in" value={b.remarks} onChange={e => set({ remarks: e.target.value })} placeholder="Transport, marka, instructions…" /></label>
            <div className="f"><span>Photo of packed goods</span><PhotoButton value={b.photo_id} onChange={v => set({ photo_id: v })} label="Parcel photo" /></div>
          </div>
        </div>

        <aside className="pos-sum card">
          <div className="sumrow"><span>Pieces · Boxes</span><b className="mono">{t.total_qty} · {t.box_count}</b></div>
          <div className="sumrow"><span>Gross</span><b className="mono">{rupees(t.gross)}</b></div>
          <div className="sumrow"><span>Discount</span>
            <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
              <input className="cell r" style={{ width: 48 }} placeholder="%" value={b.discount_pct || ""} onChange={e => set({ discount_pct: parseFloat(e.target.value) || 0 })} />
              <input className="cell r" style={{ width: 72 }} placeholder="₹" disabled={!!b.discount_pct} value={b.discount_pct ? (t.discount / 100).toFixed(0) : b.discount ? b.discount / 100 : ""} onChange={e => set({ discount: toPaise(e.target.value) })} /></span></div>
          <div className="sumrow"><span>Packing</span><input className="cell r" style={{ width: 80 }} value={b.packing ? b.packing / 100 : ""} onChange={e => set({ packing: toPaise(e.target.value) })} /></div>
          {b.bill_type === "gst" && <div className="sumrow"><span>GST {b.gst_rate}% <button className="linkbtn" onClick={() => set({ gst_mode: b.gst_mode === "exclusive" ? "inclusive" : "exclusive" })}>{b.gst_mode === "exclusive" ? "added" : "included"}</button></span><b className="mono">{rupees(t.gst)}</b></div>}
          {t.igst ? <div className="xs mut" style={{ textAlign: "right" }}>IGST (other state)</div> : t.gst ? <div className="xs mut" style={{ textAlign: "right" }}>CGST {rupees(t.cgst)} + SGST {rupees(t.sgst)}</div> : null}
          {t.adjust ? <div className="sumrow"><span>Round off</span><span className="mono">{rupees(t.adjust)}</span></div> : null}
          <div className="net"><span>NET</span><b>{rupees(t.net)}</b></div>
          <div className="sumrow"><span>Advance</span><input className="cell r" style={{ width: 80 }} value={b.advance ? b.advance / 100 : ""} onChange={e => set({ advance: toPaise(e.target.value) })} /></div>
          <Payments pays={b.payments} left={t.net - b.advance} onChange={payments => set({ payments })} />
          <div className={"sumrow " + (balance > 0 ? "due" : "")}><span>{balance > 0 ? "Balance (credit)" : balance < 0 ? "Return to customer" : "Balance"}</span><b className="mono">{rupees(Math.abs(balance))}</b></div>
          <div className="row" style={{ gap: 6 }}>
            <select className="in" style={{ flex: 1, minHeight: 36, padding: "4px 8px" }} value={fmt} onChange={e => { setFmt(e.target.value as PrintFormat); setSetting("print_fmt", e.target.value); }}>
              <option value="a5">A5 invoice</option><option value="a4">A4 invoice</option><option value="80mm">80 mm thermal</option><option value="packing">Packing slip (no rates)</option></select>
          </div>
          <div className="grid g2" style={{ gap: 6 }}>
            <button className="btn" onClick={doHold}>Hold · F4</button>
            <button className="btn" onClick={() => setHeld(true)}>Held · F5</button>
            <button className="btn p" onClick={() => doSave(false)}>Save · F8</button>
            <button className="btn dk" onClick={() => doSave(true)}>Print · F9</button>
          </div>
          <button className="btn g w" onClick={() => doSave(false, true)}>Save & WhatsApp · F10</button>
        </aside>
      </div>

      <div className="fkeys">{KEYS.map(([k, v]) => <span key={k}><kbd>{k}</kbd>{v}</span>)}</div>
      <div className="pos-mbar"><div><span className="xs">{t.total_qty} pcs · {t.items.length} lines</span><b>{rupees(t.net)}</b></div>
        <button className="btn g" onClick={() => doSave(false, true)}>Save & Send</button><button className="btn p" onClick={() => doSave(false)}>Save</button></div>

      {custOpen && <CustomerPicker bill={b} onPick={p => { set(p); setCustOpen(false); scanRef.current?.focus(); }} onClose={() => setCustOpen(false)} />}
      {held && <HeldBills onPick={x => { setB(x); setHeld(false); }} onClose={() => setHeld(false)} />}
      {printing && <PrintBill b={printing.bill} shop={shop} format={printing.fmt} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function Payments({ pays, left, onChange }: { pays: Payment[]; left: number; onChange: (p: Payment[]) => void }) {
  const paid = pays.reduce((a, p) => a + (p.mode === "credit" ? 0 : p.amount), 0);
  const rest = Math.max(0, left - paid);
  const add = (mode: Payment["mode"]) => onChange([...pays, { mode, amount: rest }]);
  return (
    <div className="stack" style={{ gap: 4 }}>
      {pays.map((p, i) => (
        <div key={i} className="sumrow"><span className="pill">{p.mode.toUpperCase()}</span>
          <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            <input className="cell r" style={{ width: 90 }} value={p.amount / 100} onChange={e => onChange(pays.map((x, j) => j === i ? { ...x, amount: toPaise(e.target.value) } : x))} />
            <button className="x" onClick={() => onChange(pays.filter((_, j) => j !== i))}>✕</button></span></div>))}
      <div className="chips">{(["cash", "upi", "card", "bank"] as const).map(m => <button key={m} className="chip" onClick={() => add(m)} disabled={!rest}>+ {m.toUpperCase()}</button>)}</div>
    </div>
  );
}

function CustomerPicker({ bill, onPick, onClose }: { bill: Bill; onPick: (p: Partial<Bill>) => void; onClose: () => void }) {
  const [q, setQ] = useState(bill.party_phone || bill.party_name || "");
  const [photo, setPhoto] = useState<string | undefined>();
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted).toArray(), [], []);
  const list = useMemo(() => { const x = q.trim().toLowerCase(); return x ? parties.filter(p => (p.name + " " + p.phone + " " + p.city).toLowerCase().includes(x)).slice(0, 12) : parties.slice(0, 12); }, [q, parties]);
  const pick = (p: Party) => onPick({ party_id: p.id, party_name: p.name, party_phone: p.phone, party_gstin: p.gstin, party_state: p.state });
  const create = async () => {
    const isPhone = /^\+?\d[\d\s]{7,}$/.test(q.trim());
    const name = isPhone ? prompt("Customer name") || "" : q.trim();
    const phone = isPhone ? q.replace(/\D/g, "") : prompt("Mobile number (for WhatsApp)")?.replace(/\D/g, "") || "";
    if (!name) return;
    const p = { ...newParty(name.toUpperCase(), phone), photo_id: photo };
    await put("parties", p); pick(p);
  };
  return (
    <Modal title="Customer" onClose={onClose}>
      <div className="stack">
        <input className="in" autoFocus placeholder="Name, mobile or city" value={q} onChange={e => setQ(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") list[0] ? pick(list[0]) : create(); }} />
        <div className="stack" style={{ gap: 6, maxHeight: 320, overflow: "auto" }}>
          {list.map(p => <button key={p.id} className="item" onClick={() => pick(p)}><Thumb photo_id={p.photo_id} url={p.photo_url} text={p.name} size={36} />
            <span className="grow"><b>{p.name}</b><div className="xs mut">{p.phone} {p.city}</div></span><span className="pill">{p.tier}</span></button>)}
          {!list.length && <div className="mut sm">No match.</div>}
        </div>
        <PhotoButton value={photo} onChange={setPhoto} label="Customer photo" />
        <div className="row"><button className="btn p" onClick={create}>+ New customer “{q || "…"}”</button>
          <button className="btn" onClick={() => onPick({ party_id: undefined, party_name: "", party_phone: "", party_gstin: "", party_state: "" })}>Walk-in / cash</button>
          <button className="btn" onClick={() => go("customers")}>Manage customers</button></div>
      </div>
    </Modal>
  );
}

function HeldBills({ onPick, onClose }: { onPick: (b: Bill) => void; onClose: () => void }) {
  const list = useLiveQuery(() => db.bills.where("status").equals("hold").filter(b => !b.deleted && !b.no).reverse().sortBy("at"), [], []);
  return (
    <Modal title="Bills on hold" onClose={onClose}>
      <div className="stack" style={{ gap: 6 }}>
        {list.map(b => (
          <div key={b.id} className="item">
            <span className="grow"><b>{b.party_name || "Walk-in"}</b><div className="xs mut">{b.items.length} lines · {b.total_qty} pcs · {new Date(b.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div></span>
            <b className="mono">{rupees(b.net)}</b>
            <button className="btn sm p" onClick={() => onPick(b)}>Resume</button>
            <button className="btn sm bad" onClick={async () => { if (confirm("Discard this held bill?")) await put("bills", { ...b, deleted: 1 }); }}>Discard</button>
          </div>))}
        {!list.length && <div className="mut sm">Nothing on hold.</div>}
      </div>
    </Modal>
  );
}
