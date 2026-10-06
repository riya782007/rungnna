import { selectedBox, mergeBoxLine, type BillingDraft } from "../lib/billingBox";
import { inStore, storeStock, currentStore, MAIN_STORE } from "../lib/stores";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Plus } from "lucide-react";
import { repeatedPosLine, validatePosLines } from "../lib/pos";
import type { CalcTarget } from "../components/PosTools";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, getSetting, setSetting, type Bill, type BillLine, type Party, type Payment, type Product } from "../lib/db";
import { findByScan, fillFromItemCode, label, readItemMap } from "../lib/products";
import { NameItemCodes, unnamedCodes } from "../components/NameItemCodes";
import { isRfidTag, normTag, soldBill, TagSet, Recent } from "../lib/rfid";
import { newBill, lineFrom, totals, fixLine, finalize, holdBill, due, getShop, newParty, partyDue, shareBill, DEFAULT_SHOP, seriesOf, fy, counterCode, type Shop } from "../lib/billing";
import { voiceBill } from "../lib/ai";
import { useApp, toast, beep, go } from "../lib/app";
import { can } from "../lib/roles";
import { usePrivate, unlock, lockNow, getPrivate, isOpen, isEstimate } from "../lib/privacy";
import { Icon } from "../components/Icon";
import { rupees, toPaise } from "../lib/format";
import { CameraScanner, useScannerGun } from "../components/Scanner";
import { hostRemote } from "../lib/remote";
import { qrSvg } from "../lib/qr";
import { createPortal } from "react-dom";
import { MicButton } from "../components/Voice";
import { Modal, PhotoButton, Thumb } from "../components/common";
import { PrintBill, type PrintFormat } from "../components/Invoice";
import { resolveBillingScan, withBillNames } from "../lib/billing-products";

/* The counter screen. Built like the shop's current PACKING SLIP: scan → lines → totals → save/print,
   every action on a function key, works with no internet (numbers come from this counter's own series). */

const KEYS: [string, string][] = [["F2", "New"], ["F3", "Hold"], ["F4", "Held"], ["F5", "Calculator"], ["F6", "Save"], ["F7", "Scan"],
  ["F8", "Item"], ["F9", "Save+Print"], ["F10", "WhatsApp"], ["F11", "Box summary"], ["F12", "Advance"]];
const ManualItems = lazy(() => import("../components/PosTools").then(m => ({ default: m.ManualItems })));
const PosCalculator = lazy(() => import("../components/PosTools").then(m => ({ default: m.PosCalculator })));

export default function Billing({ args }: { args: string[] }) {
  const { me } = useApp();
  const [entryFocus, setEntryFocus] = useState(0), [calculator, setCalculator] = useState(false), [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [b, setB] = useState<Bill | null>(null);
  const [box, setBox] = useState(1);
  const boxRef = useRef(box); boxRef.current = box;
  const boxCountRef = useRef(0);
  useEffect(() => { boxCountRef.current = b?.box_count || 0; }, [b?.id]);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const linesPane = useRef<HTMLDivElement>(null);
  const pendingScan = useRef<string | null>(null);
  const [lastScanId, setLastScanId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  function showLine(id: string, revealPage = false) {
    const row = rowRefs.current.get(id);
    if (!row) return;
    const pane = linesPane.current;
    if (pane && pane.scrollHeight > pane.clientHeight) {
      const r = row.getBoundingClientRect(), p = pane.getBoundingClientRect();
      if (r.bottom > p.bottom) pane.scrollTop += r.bottom - p.bottom;
      else if (r.top < p.top + 40) pane.scrollTop -= p.top + 40 - r.top;
    } else if (revealPage) row.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "auto" });
    row.classList.remove("flash");
    void row.offsetWidth; // restart the highlight when the same item is scanned again
    row.classList.add("flash");
    setFlashId(id);
  }
  useEffect(() => {
    if (!pendingScan.current) return;
    const id = pendingScan.current; pendingScan.current = null;
    setLastScanId(id); showLine(id);
  }, [b]);
  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => { rowRefs.current.get(flashId)?.classList.remove("flash"); setFlashId(null); }, 1600);
    return () => clearTimeout(timer);
  }, [flashId, b]);
  useEffect(() => { setLastScanId(null); setFlashId(null); pendingScan.current = null; }, [b?.id]);
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
  const advanceRef = useRef<HTMLInputElement>(null);
  const [boxSummary, setBoxSummary] = useState(false);
  /* private estimates: hidden until the owner's code is entered */
  const priv = usePrivate();
  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], []);
  const pmap = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
  const itemNames = useLiveQuery(() => db.config.get("item_codes"), []);
  const staff = useLiveQuery(() => db.staff.filter(s => inStore(s) && !!s.active && !s.deleted).toArray(), [], []);

  /* load shop profile + a resumed bill (#/bill/<id>) or the unsaved draft on this device */
  useEffect(() => {
    (async () => {
      const s = await getShop(); setShop(s);
      setFmt(await getSetting<PrintFormat>("print_fmt", "a5"));
      if (args[0]) { const x = await db.bills.get(args[0]); if (x && inStore(x)) { setBox(selectedBox(x)); setB(x); return; } }
      const d = await getSetting<BillingDraft | null>("draft_bill", null);
      const restored = d && d.status === "hold" && !d.no && (d.bill_type !== "estimate" || isOpen()) ? d : null;
      setBox(restored ? selectedBox(restored) : 1);
      setB(restored || newBill(me?.id || "", s, "gst"));
    })();
  }, [args[0]]);
  useEffect(() => { if (b && !b.no) setSetting("draft_bill", { ...b, selected_box: box }); }, [b, box]);
  useEffect(() => { if (!b) return; (async () => {
    const cc = await counterCode(); const n = (await getSetting<number>(`seq_${seriesOf(b.bill_type)}_${fy()}_${cc}`, 0)) + 1;
    setNextNo(`${seriesOf(b.bill_type)}/${fy().slice(0, 2)}${cc}${String(n).padStart(4, "0")}`);
  })(); }, [b?.bill_type]);
  useEffect(() => { b?.party_id ? partyDue(b.party_id).then(setDue0) : setDue0(0); }, [b?.party_id, priv]);

  const t = useMemo(() => (b ? totals(withBillNames(b, products, readItemMap(itemNames?.value)), shop.state) : null), [b, shop.state, products, itemNames]);
  const [askCode, setAskCode] = useState(false);
  useEffect(() => {
    if (priv || !b || b.bill_type !== "estimate") return;
    // locked while an estimate was open: park it out of sight, continue with a GST invoice
    (async () => { if (b.items.length) await holdBill(totals(b, shop.state)); await setSetting("draft_bill", null); setB(newBill(me?.id || "", shop, "gst")); setBox(1); })();
  }, [priv]);
  const press = useRef<any>(0);
  const hintProps = {
    onDoubleClick: () => !priv && setAskCode(true),
    onPointerDown: () => { press.current = setTimeout(() => !priv && setAskCode(true), 700); },
    onPointerUp: () => clearTimeout(press.current), onPointerLeave: () => clearTimeout(press.current),
  };
  const set = (patch: Partial<Bill>) => setB(x => (x ? { ...x, ...patch } : x));
  const setLine = (id: string, patch: Partial<BillLine>) => setB(x => x ? { ...x, items: x.items.map(l => (l.id === id ? fixLine({ ...l, ...patch }) : l)) } : x);
  const dropLine = (id: string) => setB(x => {
    if (!x) return x;
    // tags read for a removed line must not be marked sold with this bill
    const gone = x.items.find(l => l.id === id), codes = new Set(gone?.product_id ? pmap.get(gone.product_id)?.barcodes || [] : []);
    const keep = x.items.some(l => l.id !== id && l.product_id === gone?.product_id);
    const rfid_tags = keep ? x.rfid_tags : (x.rfid_tags || []).filter(t => !codes.has(t));
    if (!keep) (x.rfid_tags || []).forEach(t => codes.has(t) && tagsRef.current.delete(t));
    return { ...x, items: x.items.filter(l => l.id !== id), rfid_tags };
  });

  /* RFID: one tag counts once per bill, however many times the reader sees it */
  const tagsRef = useRef(new TagSet());
  const unlinked = useRef(new Recent());
  useEffect(() => { tagsRef.current = new TagSet(b?.rfid_tags || []); }, [b?.id]);

  function addProduct(p: Product, pkts = 1, pieces = 0, rate = 0) {
    if (savingRef.current) return;
    const repeated = b?.items.some(l => l.product_id === p.id && l.box_no === boxRef.current);
    beep(repeated ? "repeat" : true);
    if (repeated) toast((!pieces && !rate ? "Repeated item: quantity increased · " : "Repeated item: added as a separate line · ") + label(p));
    setB(x => {
      if (!x) return x;
      const same = x.items.find(l => l.product_id === p.id && l.box_no === boxRef.current);
      if (same && !pieces && !rate) {
        pendingScan.current = same.id;
        const named = p.item ? { item: p.item, type: p.type } : {}; // a scan that just learned the name updates the line too
        return { ...x, items: x.items.map(l => l.id === same.id ? fixLine(l.pack > 1 && l.pkts > 0 ? { ...l, ...named, pkts: l.pkts + pkts } : { ...l, ...named, qty: l.qty + pkts * Math.max(1, l.pack) }) : l) };
      }
      let line = lineFrom(p, boxRef.current, pkts, x.price_level || "wholesale");
      if (pieces) line = fixLine({ ...line, pkts: 0, qty: pieces });
      if (rate) line = fixLine({ ...line, rate: toPaise(rate) });
      pendingScan.current = line.id;
      return { ...x, items: [...x.items, line] };
    });
  }

  /* Hardware scanner gun works anywhere on the bill screen — even if the focus
     isn't in the scan box (e.g. the operator tapped Remarks). The hook ignores
     keystrokes while a real field is focused, so it never double-reads what the
     scan box already handles. */
  useScannerGun((code) => onCode(code));

  /* a scan or Enter in the box: find the product; unknown shop labels create the product on the spot */
  /* the same new sticker read twice in a split second must not create two products */
  const creating = useRef(new Map<string, Promise<Product | undefined>>());
  async function resolve(r: string): Promise<Product | undefined> {
    if (creating.current.has(r)) return creating.current.get(r);
    const job = (async () => {
      return resolveBillingScan(r, me?.id || "");
    })();
    creating.current.set(r, job);
    try { return await job; } finally { setTimeout(() => creating.current.delete(r), 3000); }
  }

  async function onCode(raw: string): Promise<string> {
    const r = raw.trim(); if (!r) return "";
    if (savingRef.current) return "Saving bill";
    if (r.toLowerCase() === "bb") {
      const next = ++boxCountRef.current; boxRef.current = next; setBox(next); set({ box_count: next }); setQ("");
      beep(); toast("Box " + next); return "Box " + next;
    }
    if (r.startsWith("#") && r.length > 1) { // typed code in the scan box
      setQ("");
      if (await unlock(r.slice(1))) { set({ bill_type: "estimate" }); beep(); } else { beep(false); toast("Not found", true); }
      return "";
    }
    if (isRfidTag(r)) {
      const tag = normTag(r); setQ("");
      if (!tagsRef.current.add(tag)) return "Tag already on this bill";
      const tp = await findByScan(tag);
      if (!tp) {
        tagsRef.current.delete(tag);
        if (unlinked.current.first(tag)) { beep(false); toast("RFID tag not linked to a product — link it in Products", true); }
        return "Not found";
      }
      const sold = soldBill(tp, tag);
      if (sold) toast(`This tag was already sold on ${sold} — check the piece`, true);
      const fp = await fillFromItemCode(tp);
      addProduct(fp);
      setB(x => x && { ...x, rfid_tags: [...(x.rfid_tags || []), tag] });
      return "Added · " + label(fp);
    }
    let p = await resolve(r);
    if (!p) {
      const hits = products.filter(x => (x.style + " " + x.code + " " + x.item).toUpperCase().includes(r.toUpperCase()));
      if (hits.length === 1) p = await fillFromItemCode(hits[0]);
    }
    if (!p) { beep(false); toast("Not found — scan the label or record it in Scan & record", true); return "Not found"; }
    addProduct(p); setQ("");
    return "Added · " + label(p);
  }
  const onCodeRef = useRef(onCode); onCodeRef.current = onCode;

  /* phone-as-scanner: codes from a paired phone land on this bill */
  const [pairId, setPairId] = useState("");
  const [pairOpen, setPairOpen] = useState(false);
  const [peers, setPeers] = useState(0);
  useEffect(() => { getSetting("remote_id", "").then(setPairId); }, []);
  useEffect(() => {
    if (!pairId) return;
    let off = () => {}, dead = false;
    hostRemote(pairId, t => onCodeRef.current(t), setPeers).then(f => { if (dead) f(); else off = f; });
    return () => { dead = true; off(); };
  }, [pairId]);
  const [sheet, setSheet] = useState(false);
  const [small, setSmall] = useState(() => typeof matchMedia !== "undefined" && matchMedia("(max-width: 860px)").matches);
  useEffect(() => {
    const media = matchMedia("(max-width: 860px)"), change = () => setSmall(media.matches);
    change(); media.addEventListener("change", change);
    return () => media.removeEventListener("change", change);
  }, []);

  const suggestions = useMemo(() => {
    const w = q.trim().toUpperCase().split(/\s+/).filter(Boolean);
    if (!w.length) return [];
    return products.filter(p => w.every(x => (p.style + " " + p.item + " " + p.color + " " + p.code).toUpperCase().includes(x))).slice(0, 8);
  }, [q, products]);

  async function doSave(print = false, share = false) {
    if (!b || !t) return;
    if (savingRef.current) return;
    if (b.status === "final") {
      beep("repeat"); toast("This bill is already saved");
      const saved = await db.bills.get(b.id);
      if (saved && print) setPrinting({ bill: saved, fmt });
      if (saved && share) await shareBill(saved, shop);
      return;
    }
    savingRef.current = true; setSaving(true);
    try {
    if (!t.items.length) return toast("No items on the bill", true);
    validatePosLines(t.items);
    /* discount above the shop's limit needs an owner/manager PIN */
    const list = t.items.reduce((a, l) => a + l.qty * l.rate, 0);
    const offPct = list ? ((list - t.gross + t.discount) / list) * 100 : 0;
    if (offPct > (shop.max_disc ?? 10) + 0.01 && !can(me, "discount")) {
      const pin = prompt(`Discount is ${offPct.toFixed(1)}% — above the ${shop.max_disc ?? 10}% limit. Owner or manager PIN:`);
      const ok = pin && (await db.staff.filter(x => (x.role === "owner" || x.role === "manager") && !!x.pin && x.pin === pin).count());
      if (!ok) return toast("Discount not approved", true);
    }
    if (b.bill_type === "gst" && !shop.gstin) toast("Tip: add the shop GSTIN in Settings → Shop profile", true);
    const missing = t.items.find(l => !l.item?.trim() || /^ITEM\s+\d+$/i.test(l.item.trim()));
    if (missing) return toast("Add the product name before saving: " + (missing.style || missing.code), true);
    const done = await finalize(t, shop.state, b.party_name);
    beep("saved");
    toast(`Saved ${done.no} · ${rupees(done.net)}`);
    await setSetting("draft_bill", null);
    if (print) setPrinting({ bill: done, fmt });
    if (share) await shareBill(done, shop);
    setB(newBill(me?.id || "", shop, b.bill_type)); setBox(1);
    setNextNo("");
    } catch (e: any) { toast(e.message || "Could not save bill", true); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function doHold() {
    if (savingRef.current) return;
    if (!b?.items.length) return toast("Nothing to hold", true);
    await holdBill(totals(b, shop.state)); await setSetting("draft_bill", null);
    toast("Bill on hold — F4 to bring it back"); setB(newBill(me?.id || "", shop, b.bill_type)); setBox(1);
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
      if (calculator || savingRef.current || document.querySelector('.modal')) return;
      if (k === "F2") { setB(newBill(me?.id || "", shop, priv ? b?.bill_type || "gst" : "gst")); setBox(1); }
      if (k === "F3") doHold();
      if (k === "F4") setHeld(true);
      if (k === "F5") setCalculator(true);
      if (k === "F6") doSave(false);
      if (k === "F7") scanRef.current?.focus();
      if (k === "F8") setEntryFocus(n => n + 1);
      if (k === "F9") doSave(true);
      if (k === "F10") doSave(false, true);
      if (k === "F11") setBoxSummary(x => !x);
      if (k === "F12") advanceRef.current?.focus();
    };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  });

  if (!b || !t) return <div className="card pad">Loading…</div>;
  const unnamed = unnamedCodes(t.items, id => (id ? pmap.get(id)?.item_code : undefined));
  const boxes = [...new Set([...t.items.map(l => l.box_no), box])].sort((a, z) => a - z);
  const balance = due(t);
  const lastScan = t.items.find(l => l.id === lastScanId);
  const itemEditor = <Suspense fallback={<div className="pos-entry-loading" role="status">Loading items…</div>}><ManualItems key={b.id} inline persistent focusRequest={entryFocus} products={products} box={box} level={b.price_level || "wholesale"} canRates={can(me, "rates")} onClose={() => {}}
    onProduct={(p, count, pieces, rate) => {
      const line = fixLine({ ...lineFrom(p, box, pieces ? 0 : count, b.price_level || "wholesale"), ...(pieces ? { qty: count, pkts: 0 } : {}), rate });
      if (savingRef.current) throw new Error("Wait for the bill to finish saving");
      const repeated = repeatedPosLine(b.items, line);
      beep(repeated ? "repeat" : true);
      if (repeated) {
        const merged = !mergeBoxLine([...b.items, line], line.id).some(l => l.id === line.id);
        toast((merged ? "Repeated item: quantity increased · " : "Repeated item: added as a separate line · ") + line.item);
      }
      setB(x => {
        if (!x) return x;
        const items = mergeBoxLine([...x.items, line], line.id);
        pendingScan.current = items.some(l => l.id === line.id) ? line.id
          : items.find(l => l.qty !== x.items.find(old => old.id === l.id)?.qty)?.id || line.id;
        return { ...x, items };
      });
    }} onCustom={line => {
      if (savingRef.current) throw new Error("Wait for the bill to finish saving");
      const repeated = repeatedPosLine(b.items, line);
      beep(repeated ? "repeat" : true);
      if (repeated) toast("Repeated custom item: added as a separate line · " + line.item);
      pendingScan.current = line.id; setB(x => x && { ...x, items: [...x.items, line] });
    }} /></Suspense>;

  return (
    <div className="pos">
      <div className="pos-top card">
        {priv ? <div className="seg" role="group" aria-label="Bill type">
          <button aria-pressed={b.bill_type === "estimate"} onClick={() => set({ bill_type: "estimate" })}>Estimate</button>
          <button aria-pressed={b.bill_type === "gst"} onClick={() => set({ bill_type: "gst" })}>GST Invoice</button>
          <button aria-pressed={b.bill_type === "challan"} onClick={() => set({ bill_type: "challan" })}>Challan</button>
          <button onClick={() => lockNow()} title="Lock estimates" aria-label="Lock estimates"><Icon n="lock" size={15} /></button>
        </div> : <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          <div className="pos-title" {...hintProps}><b>{b.bill_type === "challan" ? "Delivery challan" : "Tax invoice"}</b><span className="xs mut">{b.bill_type === "challan" ? "goods out · no money" : b.gst_rate + "% GST"}</span></div>
          <div className="seg" role="group" aria-label="Document">
            {me?.role === "owner" && <button title="Unlock private estimates" aria-label="Unlock private estimates" onClick={() => setAskCode(true)}><Icon n="lock" size={15} /></button>}
            <button aria-pressed={b.bill_type !== "challan"} onClick={() => set({ bill_type: "gst" })}>Invoice</button>
            <button aria-pressed={b.bill_type === "challan"} onClick={() => set({ bill_type: "challan" })} title="Send goods now, invoice later">Challan</button>
          </div></div>}
        <div className="pos-no"><span className="xs mut">{b.no ? "Bill no" : "Next no"}</span><b className="mono">{b.no || nextNo}</b></div>
        <button className="pos-cust" onClick={() => setCustOpen(true)}>
          <span className="xs mut">Client name</span>
          <b>{b.party_name || "Walk-in / cash"}</b>
          <span className="xs">{b.party_phone}{due0 > 0 ? <span className="pill bad" style={{ marginLeft: 6 }}>Due {rupees(due0)}</span> : null}</span>
        </button>
        <label className="f" style={{ minWidth: 130 }}>Salesman
          <select className="in" value={b.salesman} onChange={e => set({ salesman: e.target.value })}>
            <option value="">—</option>{staff.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}</select></label>
        <div className="pos-box"><span className="xs mut">Box qty: {b.box_count} · Current box {box}</span>
          <div className="row" style={{ gap: 4 }}>{boxes.map(x => <button key={x} className="chip" aria-pressed={x === box} onClick={() => setBox(x)}>{x}</button>)}
            <button className="chip" onClick={() => setBox(Math.max(...boxes) + 1)}>+</button></div></div>
      </div>

      <div className="pos-main">
        <div className="stack pos-workspace" style={{ minWidth: 0 }}>
          <div className="pos-entry stack" style={{ gap: 8 }}>
            <div className="row scanrow">
              <div className="wedge grow" style={{ position: "relative" }}>
                <Icon n="scan" size={20} />
                <input ref={scanRef} autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Scan label, or type style / item (F7)"
                  onKeyDown={e => { if (e.key === "Tab" && isRfidTag(q)) { e.preventDefault(); onCode(q); return; } if (e.key === "Enter") { e.preventDefault(); onCode(q); } }} />
                {suggestions.length > 0 && q.length < 25 && (
                  <div className="sugg">{suggestions.map(p => (
                    <button key={p.id} onClick={() => { addProduct(p); setQ(""); scanRef.current?.focus(); }}>
                      <Thumb photo_id={p.photo_id} url={p.photo_url} text={p.item} size={34} />
                      <span className="grow"><b>{p.style || p.code}</b> <span className="mut">{p.item} · {p.color}</span></span>
                      <span className="mono">{p.rate ? rupees(p.rate) : ""}{p.pack ? " ×" + p.pack : ""}</span></button>))}</div>)}
              </div>
              <button className={"btn " + (cam || sheet ? "p" : "g")} onClick={() => (small ? setSheet(true) : setCam(!cam))} title="Scan with the camera"><Icon n="scan" size={20} />Scan</button>
              {!small && <button className={"btn " + (peers ? "p" : "")} onClick={() => setPairOpen(true)} title="Use a phone as the scanner"><Icon n="sell" size={18} />{peers ? "Phone linked" : "Phone as scanner"}</button>}
              <MicButton onAudio={a => doVoice(a)} busy={aiBusy} label="🎙 Speak order" />
              <button className="btn" aria-pressed="true" aria-expanded="true" aria-controls="pos-item-entry" disabled={saving} onClick={() => setEntryFocus(n => n + 1)}><Plus size={18} />Add item</button>
              <button className="btn" disabled={saving} title="POS calculator" aria-label="POS calculator" onClick={() => setCalculator(true)}><Calculator size={20} /></button>
            </div>
            <div className={"lastscan" + (lastScan ? " has-item" : "")} role="status" aria-live="polite" aria-atomic="true">
              <span>{lastScan ? <><b>Added: {lastScan.item || lastScan.style || lastScan.code}</b><span className="xs">{[lastScan.style, lastScan.color, `Box ${lastScan.box_no}`, `${lastScan.qty} ${lastScan.type || "PCS"} × ${rupees(lastScan.rate)}`, rupees(lastScan.amount)].filter(Boolean).join(" · ")}</span></> : <span className="mut">{t.items.length} bill lines · {t.total_qty} units</span>}</span>
              {lastScan && <button className="btn sm" onClick={() => showLine(lastScan.id, true)}>Show line</button>}
            </div>
            {cam && !small && <div style={{ maxWidth: 560 }}><CameraScanner onCode={c => { onCode(c); }} /></div>}
            {itemEditor}
          </div>

          <NameItemCodes codes={unnamed} onNamed={(code, name, unit) => setB(x => x && { ...x, items: x.items.map(l =>
            (l.item === "ITEM " + code || (!l.item && l.product_id && pmap.get(l.product_id)?.item_code === code)) ? { ...l, item: name, type: unit } : l) })} />
          <div className="tw pos-lines" ref={linesPane} role="region" aria-label="Bill items" tabIndex={0}>
            <table className="pos-t" aria-label="Bill items">
              <thead><tr><th>#</th><th>Box</th><th>Item · Style · Colour</th><th className="r">Pkt</th><th className="r">Qty</th><th className="r">Rate ₹</th><th className="r">Disc</th><th className="r">Amount</th><th /></tr></thead>
              <tbody>
                {t.items.map((l, i) => (
                  <tr key={l.id} className="ln" ref={row => { if (row) rowRefs.current.set(l.id, row); else rowRefs.current.delete(l.id); }}>
                    <td className="mut" data-l="#">{i + 1}</td>
                    <td data-l="Box"><input className="cell" style={{ width: 38 }} inputMode="numeric" value={l.box_no} onChange={e => setLine(l.id, { box_no: Math.max(1, parseInt(e.target.value) || 1) })}
                      onBlur={() => setB(x => x ? { ...x, items: mergeBoxLine(x.items, l.id) } : x)} /></td>
                    <td data-l=""><input className="cell" style={{ width: "100%", fontWeight: 700 }} title={l.item} aria-label={`Product name for line ${i + 1}`} placeholder="Product name" value={/^ITEM\s+\d+$/i.test(l.item || "") ? "" : l.item || ""} onChange={e => setLine(l.id, { item: e.target.value })} /> <span className="mono">{l.style}</span> <span className="mut">{l.color} · {l.type}</span>{!l.product_id && <span className="pill">Custom</span>}{l.product_id && pmap.get(l.product_id)?.tk?.trim() ? <span className="pill warn" style={{ marginLeft: 6 }}>dead stock</span> : null}</td>
                    <td className="r" data-l="Packets">{l.pack > 1 ? <span className="row" style={{ gap: 2, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <input className="cell r" style={{ width: 44 }} inputMode="numeric" value={l.pkts || ""} onChange={e => setLine(l.id, { pkts: parseInt(e.target.value) || 0 })} /><span className="xs mut">×{l.pack}</span></span> : <span className="mut">—</span>}</td>
                    <td className="r" data-l={l.type || "Quantity"}><input className="cell r" style={{ width: 56 }} inputMode="numeric" value={l.qty || ""} disabled={l.pack > 1 && l.pkts > 0}
                      onChange={e => setLine(l.id, { qty: parseInt(e.target.value) || 0, pkts: 0 })} /></td>
                    <td className="r" data-l="Rate ₹"><input className="cell r" style={{ width: 70 }} inputMode="decimal" disabled={!can(me, "rates") && !!(l.product_id && pmap.get(l.product_id)?.rate)} value={l.rate ? l.rate / 100 : ""} onChange={e => setLine(l.id, { rate: toPaise(e.target.value) })} /></td>
                    <td className="r" data-l="Disc"><input className="cell r" style={{ width: 54 }} placeholder="—" value={l.disc} onChange={e => setLine(l.id, { disc: e.target.value })} /></td>
                    <td className="r mono b" data-l="Amount">{(l.amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td data-l=""><button className="x" aria-label="Remove line" onClick={() => dropLine(l.id)}>✕</button></td>
                  </tr>))}
                {!t.items.length && <tr><td colSpan={9} className="mut" style={{ padding: 28, textAlign: "center" }}>No items yet</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="pos-notes grid g2">
            <label className="f">Remarks<input className="in" value={b.remarks} onChange={e => set({ remarks: e.target.value })} placeholder="Transport, marka, instructions…" /></label>
            <div className="f"><span>Photo of packed goods</span><PhotoButton value={b.photo_id} onChange={v => set({ photo_id: v })} label="Parcel photo" /></div>
          </div>
        </div>

        <aside className="pos-sum card">
          <button className="btn" aria-expanded={boxSummary} onClick={() => setBoxSummary(x => !x)}>Box summary</button>
          {boxSummary && <table className="pos-t"><thead><tr><th>Box</th><th>Qty</th></tr></thead><tbody>{boxes.map(n => <tr key={n}><td>{n}</td><td>{t.items.filter(l => l.box_no === n).reduce((a, l) => a + l.qty, 0)}</td></tr>)}</tbody></table>}
          <div className="sumrow"><span>Pieces · Boxes</span><b className="mono">{t.total_qty} · {t.box_count}</b></div>
          {b.rfid_tags?.length ? <div className="sumrow"><span>RFID tags</span><b className="mono">{b.rfid_tags.length}</b></div> : null}
          <div className="sumrow"><span>Gross</span><b className="mono">{rupees(t.gross)}</b></div>
          <div className="sumrow"><span>Discount</span>
            <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
              <input className="cell r" style={{ width: 48 }} placeholder="%" value={b.discount_pct || ""} onChange={e => set({ discount_pct: parseFloat(e.target.value) || 0 })} />
              <input className="cell r" style={{ width: 72 }} placeholder="₹" disabled={!!b.discount_pct} value={b.discount_pct ? (t.discount / 100).toFixed(0) : b.discount ? b.discount / 100 : ""} onChange={e => set({ discount: toPaise(e.target.value) })} /></span></div>
          <div className="sumrow"><span>Packing</span><input className="cell r" style={{ width: 80 }} value={b.packing ? b.packing / 100 : ""} onChange={e => set({ packing: toPaise(e.target.value) })} /></div>
          {b.bill_type === "gst" && <div className="sumrow"><span>GST {b.gst_rate}% <button className="linkbtn" onClick={() => set({ gst_mode: b.gst_mode === "exclusive" ? "inclusive" : "exclusive" })}>{b.gst_mode === "exclusive" ? "added" : "included"}</button></span><b className="mono">{rupees(t.gst)}</b></div>}
          {t.igst ? <div className="xs mut" style={{ textAlign: "right" }}>IGST (other state)</div> : t.gst ? <div className="xs mut" style={{ textAlign: "right" }}>CGST {rupees(t.cgst)} + SGST {rupees(t.sgst)}</div> : null}
          {t.adjust ? <div className="sumrow"><span>Round off</span><span className="mono">{rupees(t.adjust)}</span></div> : null}
          <div className="net"><span>{b.bill_type === "challan" ? "VALUE" : "NET"}</span><b>{rupees(t.net)}</b></div>
          {b.bill_type === "challan" ? <div className="note sm">A challan sends the goods out with no money taken. Convert it to an invoice from Bills when the customer is billed.</div> : <>
          <div className="sumrow"><span>Advance</span><input ref={advanceRef} className="cell r" style={{ width: 80 }} value={b.advance ? b.advance / 100 : ""} onChange={e => set({ advance: toPaise(e.target.value) })} /></div>
          <Payments pays={b.payments} left={t.net - b.advance} onChange={payments => set({ payments })} />
          <div className={"sumrow " + (balance > 0 ? "due" : "")}><span>{balance > 0 ? "Balance (credit)" : balance < 0 ? "Return to customer" : "Balance"}</span><b className="mono">{rupees(Math.abs(balance))}</b></div></>}
          <div className="row" style={{ gap: 6 }}>
            <select className="in" style={{ flex: 1, minHeight: 36, padding: "4px 8px" }} value={fmt} onChange={e => { setFmt(e.target.value as PrintFormat); setSetting("print_fmt", e.target.value); }}>
              <option value="a5">A5 invoice</option><option value="a4">A4 invoice</option><option value="80mm">80 mm thermal</option><option value="58mm">58 mm thermal</option><option value="packing">Packing slip (no rates)</option></select>
          </div>
          <div className="grid g2" style={{ gap: 6 }}>
            <button className="btn" disabled={saving} onClick={doHold}>Hold · F3</button>
            <button className="btn" disabled={saving} onClick={() => setHeld(true)}>Held · F4</button>
            <button className="btn p" disabled={saving} onClick={() => doSave(false)}>{saving ? "Saving…" : "Save · F6"}</button>
            <button className="btn dk" disabled={saving} onClick={() => doSave(true)}>Print · F9</button>
          </div>
          <button className="btn g w" disabled={saving} onClick={() => doSave(false, true)}>Save & WhatsApp · F10</button>
        </aside>
      </div>

      <div className="fkeys">{KEYS.map(([k, v]) => <span key={k}><kbd>{k}</kbd>{v}</span>)}</div>
      <div className="pos-mbar"><div><span className="xs">{t.total_qty} pcs · {t.items.length} lines</span><b>{rupees(t.net)}</b></div>
        <button className="btn g" disabled={saving} onClick={() => doSave(false, true)}>Save & Send</button><button className="btn p" disabled={saving} onClick={() => doSave(false)}>{saving ? "Saving…" : "Save"}</button></div>
      <Suspense fallback={<div className="toast" role="status">Loading billing tool…</div>}>
        {calculator && <PosCalculator lines={t.items} onClose={() => setCalculator(false)} onApply={(value, target: CalcTarget, id) => {
          if (value < 0) throw new Error("Billing amounts cannot be negative");
          if (target === "rate") { const l = t.items.find(l => l.id === id); if (!l) throw new Error("Select an item"); if (!can(me, "rates") && l.product_id && pmap.get(l.product_id)?.rate) throw new Error("Owner approval is required to change this price"); setLine(id, { rate: value }); }
          if (target === "packing") set({ packing: value });
          if (target === "discount") set({ discount: value, discount_pct: 0 });
        }} />}
      </Suspense>

      {custOpen && <CustomerPicker bill={b} onPick={p => { set(p); setCustOpen(false); scanRef.current?.focus(); }} onClose={() => setCustOpen(false)} />}
      {sheet && <ScanSheet onCode={onCode} onClose={() => setSheet(false)} lines={t.items.length} pcs={t.total_qty} net={t.net} last={t.items[t.items.length - 1]} />}
      {pairOpen && <PairPhone id={pairId} peers={peers} onNew={async () => { const id = Math.random().toString(36).slice(2, 10); await setSetting("remote_id", id); setPairId(id); }} onClose={() => setPairOpen(false)} />}
      {askCode && <CodePrompt onDone={ok => { setAskCode(false); if (ok) set({ bill_type: "estimate" }); }} />}
      {held && <HeldBills onPick={x => { setBox(selectedBox(x)); setB(x); setHeld(false); }} onClose={() => setHeld(false)} />}
      {printing && <PrintBill b={printing.bill} shop={shop} format={printing.fmt} onDone={() => setPrinting(null)} />}
    </div>
  );
}

function Payments({ pays, left, onChange }: { pays: Payment[]; left: number; onChange: (p: Payment[]) => void }) {
  const paid = pays.reduce((a, p) => a + (p.mode === "credit" ? 0 : p.amount), 0);
  const rest = Math.max(0, left - paid);
  const add = (mode: Payment["mode"]) => onChange([...pays, { mode, amount: rest, at: new Date().toISOString() }]);
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
  const pick = (p: Party) => onPick({ party_id: p.id, party_name: p.name, party_phone: p.phone, party_gstin: p.gstin, party_state: p.state, price_level: p.tier });
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
            <span className="grow"><b>{p.name}</b><div className="xs mut">{p.city}</div></span><span className="pill">{p.tier}</span></button>)}
          {!list.length && <div className="mut sm">No match.</div>}
        </div>
        <PhotoButton webcam value={photo} onChange={setPhoto} label="Customer photo" />
        <div className="row"><button className="btn p" onClick={create}>+ New customer “{q || "…"}”</button>
          <button className="btn" onClick={() => onPick({ party_id: undefined, party_name: "", party_phone: "", party_gstin: "", party_state: "" })}>Walk-in / cash</button>
          <button className="btn" onClick={() => go("customers")}>Manage customers</button></div>
      </div>
    </Modal>
  );
}

function HeldBills({ onPick, onClose }: { onPick: (b: Bill) => void; onClose: () => void }) {
  const open = usePrivate();
  const list = useLiveQuery(() => db.bills.where("status").equals("hold").filter(b => inStore(b) && !b.deleted && !b.no && (open || !isEstimate(b))).reverse().sortBy("at"), [open], []);
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

/* The discreet door to estimates: the owner's hint, then the code. Nothing on screen says "estimate". */
function CodePrompt({ onDone }: { onDone: (ok: boolean) => void }) {
  const [hint, setHint] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  useEffect(() => { getPrivate().then(c => setHint(c ? c.hint || "" : null)); }, []);
  return (
    <Modal title="Enter code" onClose={() => onDone(false)}>
      <form className="stack" onSubmit={async e => { e.preventDefault(); if (await unlock(code)) onDone(true); else { setBad(true); setCode(""); } }}>
        {hint === null ? <div className="sm mut">No code has been set on this system yet. The owner sets it in Settings.</div>
          : <>{hint && <div className="sm mut">Hint: {hint}</div>}
            <input className={"in mono" + (bad ? " bad" : "")} type="password" inputMode="numeric" autoFocus autoComplete="off" value={code} onChange={e => { setCode(e.target.value); setBad(false); }} />
            <button className="btn p">Open</button></>}
      </form>
    </Modal>
  );
}

/* Phones: the whole screen becomes the scanner; the bill keeps count underneath. */
function ScanSheet({ onCode, onClose, lines, pcs, net }: { onCode: (t: string) => Promise<string>; onClose: () => void; lines: number; pcs: number; net: number; last?: BillLine }) {
  const [msg, setMsg] = useState("");
  const bad = /not found/i.test(msg);
  return createPortal(
    <div className="scansheet">
      <div className="row between"><b style={{ fontSize: 17 }}>Scan to bill</b><button className="btn sm" onClick={onClose}>Done</button></div>
      <CameraScanner tall gap={1500} onCode={async c => setMsg(await onCode(c))} />
      <div className="card pad stack" style={{ gap: 6 }}>
        {msg && <div className="sm b" style={{ color: bad ? "var(--bad)" : "var(--ok)" }}>{msg}</div>}
        {!msg && <div className="xs mut">Point at one sticker at a time. The same sticker counts again after it leaves the picture.</div>}
        <div className="row between"><span className="sm">{lines} lines · {pcs} pcs</span><b style={{ fontSize: 24 }}>{rupees(net)}</b></div>
        <button className="btn p big" onClick={onClose}>Done — go to bill</button>
      </div>
    </div>, document.body);
}

/* Laptop / counter PC: pair a phone as the camera. */
function PairPhone({ id, peers, onNew, onClose }: { id: string; peers: number; onNew: () => void; onClose: () => void }) {
  useEffect(() => { if (!id) onNew(); }, [id]);
  const url = id ? `${location.origin}/#/remote/${id}` : "";
  return (
    <Modal title="Use a phone as the scanner" onClose={onClose}>
      <div className="stack" style={{ alignItems: "center", textAlign: "center" }}>
        {url && <div style={{ width: 220, height: 220 }} dangerouslySetInnerHTML={{ __html: qrSvg(url).svg }} />}
        <div className="sm">On the phone (signed in to the shop app), scan this code with the phone camera — or open <b className="mono">{url.replace(/^https?:\/\//, "")}</b></div>
        <div className={"pill " + (peers ? "ok" : "warn")}>{peers ? `${peers} phone${peers > 1 ? "s" : ""} connected` : "Waiting for a phone…"}</div>
        <div className="xs mut">Every sticker the phone reads is added to the bill on this screen instantly. Needs internet on both. The link stays the same, so the phone can keep it open all day.</div>
        <button className="btn sm" onClick={onNew}>Make a new link</button>
      </div>
    </Modal>
  );
}
