import { companyKindNow, typeForCompany, estimatesOnly } from "../lib/scope";
import { askText } from "../components/AskHost";
import { parkBillingDraft, resumeBillingDraft } from "../lib/billing-drafts";
import { publicOrigin } from "../lib/platform";
import { DeleteButton } from "../components/DeleteButton";
import { confirmDelete } from "../lib/confirm-delete";
import { SelectAll } from "../components/SelectAll";
import { placeCode } from "../lib/states";
import { selectedBox, mergeBoxLine, mergeBillLines, type BillingDraft } from "../lib/billingBox";
import { inStore, storeStock, currentStore, MAIN_STORE } from "../lib/stores";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Calculator, Plus } from "lucide-react";
import { appendPosLine, repeatedPosLine, validatePosLines } from "../lib/pos";
import type { CalcTarget } from "../components/PosTools";
import { useLiveQuery } from "dexie-react-hooks";
import { db, put, getSetting, setSetting, type Bill, type BillLine, type Party, type Payment, type Product } from "../lib/db";
import { findByScan, fillFromItemCode, label, readItemMap, codeInfo } from "../lib/products";
import { noteMiss, clearMiss, learnFromPick } from "../lib/scan-learn";
import { ShopDetailsAsk, shopNeedsTaxDetails } from "../components/ShopDetailsAsk";
import { NameItemCodes, unnamedCodes } from "../components/NameItemCodes";
import { isRfidTag, normTag, soldBill, TagSet, Recent } from "../lib/rfid";
import { discError, newBill, lineFrom, priceFor, totals, gstLabel, fixLine, finalize, due, getShop, newParty, partyDue, shareBill, DEFAULT_SHOP, seriesOf, fy, counterCode, type Shop } from "../lib/billing";
import { voiceBill } from "../lib/ai";
import { useApp, toast, beep, go } from "../lib/app";
import { can } from "../lib/roles";
import { usePrivate, unlock, lockNow, getPrivate, isOpen, isEstimate } from "../lib/privacy";
import { Icon } from "../components/Icon";
import { billAmount, toPaise } from "../lib/format";
import { CameraScanner, useScanOnlyIn } from "../components/Scanner";
import { hostRemote } from "../lib/remote";
import { qrSvg } from "../lib/qr";
import { createPortal } from "react-dom";
import { MicButton } from "../components/Voice";
import { Modal, PhotoButton, Thumb, MoneyInput } from "../components/common";
import { PrintBill, type PrintFormat } from "../components/Invoice";
import { resolveBillingScan, withBillNames } from "../lib/billing-products";
import { parseLabel } from "../lib/parse";
import { BagLabels } from "../components/BagLabels";
import { BAG_PREFIX, parseBagPayload } from "../lib/bag-labels";
import { BillScanNotice, type BillScanFeedback } from "../components/BillScanNotice";
import { paymentNarration } from "../lib/payment-narration";

/* The counter screen. Built like the shop's current PACKING SLIP: scan → lines → totals → save/print,
   every action on a function key, works with no internet (numbers come from this counter's own series). */

const KEYS: [string, string][] = [["F2", "New"], ["F3", "Hold"], ["F4", "Held"], ["F5", "Calculator"], ["F6", "Save"], ["F7", "Scan"],
  ["F8", "Item"], ["F9", "Save+Print"], ["F10", "WhatsApp"], ["F11", "Box summary"], ["F12", "Advance"]];
const ManualItems = lazy(() => import("../components/PosTools").then(m => ({ default: m.ManualItems })));
const PosCalculator = lazy(() => import("../components/PosTools").then(m => ({ default: m.PosCalculator })));

export default function Billing({ args }: { args: string[] }) {
  const { me } = useApp();
  // the custom-item row stays open on the counter PC; phones open it with "Add item"
  // the hand-entry row opens with "Add item" (F8); closed it leaves the screen to the bill's lines (owner, 25 Oct)
  const [editorOpen, setEditorOpen] = useState(() => !window.matchMedia("(max-width:860px)").matches);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moneyMore, setMoneyMore] = useState(false);
  useEffect(() => { void getSetting<boolean>("bill_more_open", false).then(setMoreOpen); }, []);
  const [entryFocus, setEntryFocus] = useState(0), [calculator, setCalculator] = useState(false), [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const switchingRef = useRef(false);
  const [switching, setSwitching] = useState(false);
  const [lastSaved, setLastSaved] = useState<Bill | null>(null);
  const [shop, setShop] = useState<Shop>(DEFAULT_SHOP);
  const [b, setB] = useState<Bill | null>(null);
  const billRef = useRef(b); billRef.current = b;
  const [bagBill, setBagBill] = useState<Bill | null>(null);
  const [selectedLines, setSelectedLines] = useState<Set<string>>(new Set());
  useEffect(() => { setSelectedLines(new Set()); }, [b?.id]);
  const [box, setBox] = useState(1);
  const boxRef = useRef(box); boxRef.current = box;
  const boxCountRef = useRef(0);
  useEffect(() => { boxCountRef.current = b?.box_count || 0; }, [b?.id]);
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>());
  const linesPane = useRef<HTMLDivElement>(null);
  const pendingScan = useRef<{ id: string; added: number; repeated: boolean } | null>(null);
  const scanSequence = useRef(0);
  const [scanFeedback, setScanFeedback] = useState<BillScanFeedback | null>(null);
  const dismissScanFeedback = useCallback(() => setScanFeedback(null), []);
  const [lastScanId, setLastScanId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  /* Save/Print stopped by lines with no quantity: those lines go red, a banner says which,
     and offers to remove them (counter request 21/10/2026 — the corner toast was missed). */
  const [qtyProblem, setQtyProblem] = useState<string[]>([]);
  const noQty = (l: BillLine) => !Number.isSafeInteger(l.qty) || l.qty <= 0;
  function stopForQty(lines: BillLine[]) {
    setQtyProblem(lines.map(l => l.id));
    beep(false);
    toast(lines.length === 1 ? `Not saved — quantity missing for ${lines[0].item || lines[0].style}` : `Not saved — quantity missing on ${lines.length} lines`, true);
    requestAnimationFrame(() => {
      const row = rowRefs.current.get(lines[0].id);
      if (!row) return;
      row.scrollIntoView({ block: "center" });
      const field = [row.cells[4], row.cells[3]].map(c => c?.querySelector<HTMLInputElement>("input:not([disabled])")).find(Boolean);
      field?.focus({ preventScroll: true }); field?.select();
    });
  }
  function flashRow(row: HTMLElement, id: string) {
    row.classList.remove("flash");
    void row.offsetWidth; // restart the highlight when the same item is scanned again
    row.classList.add("flash");
    setFlashId(id);
  }

  /* Keyboard-only navigation across the bill-lines grid, so the counter can be
     worked without a mouse:
       ↑ / ↓        jump to the SAME field one row up / down (next box line)
       ← / →        jump to the field left / right in the same row
       Space        tick / untick the current row (select many lines)
       Shift+↑/↓    extend the selection over a range of rows
       Enter        step down to the next row (fast data entry)
     The arrows always move between cells (they never just move the text caret
     inside a field), so moving from box to box is immediate. */
  const selectAnchor = useRef<string | null>(null);
  function focusCell(el: HTMLElement | null) {
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement && el.type !== "checkbox") el.select?.();
  }
  // All editable fields in a row, in left-to-right order, each tagged with the
  // index of the <td> column it sits in. Columns are mapped by <td> position
  // (stable across rows) so Up/Down always lands in the same column even though
  // some rows hide the Pkt input or disable Qty.
  function fieldsOf(row: HTMLTableRowElement): { el: HTMLElement; col: number }[] {
    const out: { el: HTMLElement; col: number }[] = [];
    Array.from(row.children).forEach((td, col) => {
      const f = td.querySelector<HTMLElement>('input:not([type="checkbox"]):not([disabled]), select:not([disabled])');
      if (f) out.push({ el: f, col });
    });
    return out;
  }
  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const key = e.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Enter"].includes(key)) return;
    const el = document.activeElement as HTMLElement | null;
    const td = el?.closest("td");
    const row = el?.closest<HTMLTableRowElement>("tr.ln");
    if (!row || !el) return;
    const ids = t ? displayOrder(t.items).map(l => l.id) : [];
    const rowId = [...rowRefs.current.entries()].find(([, r]) => r === row)?.[0];
    const idx = rowId ? ids.indexOf(rowId) : -1;
    if (idx < 0) return;
    const isText = el.tagName === "INPUT" || el.tagName === "SELECT";
    const input = el as HTMLInputElement;
    const curCol = td ? Array.from(row.children).indexOf(td) : 0;

    // land on the field in the nearest column >= the current one (or the last field)
    const focusSameCol = (targetRow: HTMLTableRowElement) => {
      const fields = fieldsOf(targetRow);
      if (!fields.length) return;
      const same = fields.find(f => f.col === curCol)
        || fields.filter(f => f.col >= curCol)[0]
        || fields[fields.length - 1];
      focusCell(same.el);
    };
    const moveRow = (nextIdx: number) => {
      const nextRow = rowRefs.current.get(ids[nextIdx]);
      if (!nextRow) return;
      focusSameCol(nextRow);
      showLine(ids[nextIdx]);
    };

    if (key === "ArrowDown" || (key === "Enter" && !e.shiftKey)) {
      e.preventDefault();
      if (idx < ids.length - 1) moveRow(idx + 1);
      if (e.shiftKey && key === "ArrowDown") toggleRange(ids, idx + 1);
    } else if (key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) moveRow(idx - 1);
      if (e.shiftKey) toggleRange(ids, idx - 1);
    } else if (key === "ArrowRight") {
      const fields = fieldsOf(row); const here = fields.findIndex(f => f.el === el);
      if (here > -1 && here < fields.length - 1) { e.preventDefault(); focusCell(fields[here + 1].el); }
    } else if (key === "ArrowLeft") {
      const fields = fieldsOf(row); const here = fields.findIndex(f => f.el === el);
      if (here > 0) { e.preventDefault(); focusCell(fields[here - 1].el); }
    } else if (key === " " && (!isText || input.type === "checkbox")) {
      e.preventDefault();
      setSelectedLines(old => { const next = new Set(old); next.has(ids[idx]) ? next.delete(ids[idx]) : next.add(ids[idx]); return next; });
      selectAnchor.current = ids[idx];
    }
  }
  function toggleRange(ids: string[], toIdx: number) {
    if (toIdx < 0 || toIdx >= ids.length) return;
    const anchor = selectAnchor.current ? ids.indexOf(selectAnchor.current) : toIdx;
    const [lo, hi] = [Math.min(anchor, toIdx), Math.max(anchor, toIdx)];
    setSelectedLines(() => new Set(ids.slice(lo, hi + 1)));
  }
  function showLine(id: string) {
    const row = rowRefs.current.get(id);
    if (!row) return;
    flashRow(row, id);
    // Scroll AFTER layout has actually happened. A single rAF can fire before the
    // browser lays out a just-inserted <tr>, so the new row still measures as 0 /
    // in-view and nothing scrolls. Two frames guarantees layout is done.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const target = rowRefs.current.get(id);
      if (!target) return;
      const pane = linesPane.current;
      // On big counter screens the bill-lines table is its own scroll box — scroll that.
      if (pane && pane.scrollHeight > pane.clientHeight + 1) {
        const headH = pane.querySelector("thead")?.getBoundingClientRect().height || 0;
        const r = target.getBoundingClientRect(), p = pane.getBoundingClientRect();
        if (r.bottom > p.bottom) pane.scrollTop += r.bottom - p.bottom + 8;
        else if (r.top < p.top + headH + 8) pane.scrollTop -= p.top + headH + 8 - r.top;
      }
      // The ledger can be below the viewport on laptops. Reveal the committed
      // row below the pinned controls as well as scrolling the ledger itself.
      const r = target.getBoundingClientRect();
      const dock = counterDockRef.current?.getBoundingClientRect();
      const top = dock ? Math.max(64, dock.bottom) + 12 : 76;
      const bottomBar = document.querySelector(".pos-mbar")?.getBoundingClientRect();
      const bottom = bottomBar && bottomBar.height > 0 ? Math.min(window.innerHeight, bottomBar.top) : window.innerHeight;
      if (r.top < top || r.bottom > bottom - 12) {
        target.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });
      }
    }));
  }
  /* Scan order: the line touched by the latest scan is shown first, right under the
     scan box, so it is visible without scrolling. Display only — the bill, its line
     numbers and the printed order stay as added. */
  /* Owner, 25 Oct (voice): "black screen = GST: when a GST invoice is being made it should look like dark mode on
     the phone; estimates white". With one company, the bill screen goes dark while a tax invoice is open. */
  useEffect(() => {
    const el = document.documentElement, mine = b?.bill_type === "gst" && companyKindNow() !== "estimate";
    if (mine) el.dataset.company = "gst"; else if (companyKindNow() !== "gst") delete el.dataset.company;
    return () => { if (companyKindNow() !== "gst") delete el.dataset.company; };
  }, [b?.bill_type]);
  const [touched, setTouched] = useState<string[]>([]);
  const [lastRead, setLastRead] = useState("");
  function displayOrder(items: BillLine[]): BillLine[] {
    const byId = new Map(items.map(l => [l.id, l]));
    const first = touched.map(id => byId.get(id)).filter((l): l is BillLine => !!l);
    const seen = new Set(first.map(l => l.id));
    return [...first, ...items.filter(l => !seen.has(l.id)).reverse()];
  }
  useEffect(() => {
    if (!pendingScan.current) return;
    const added = pendingScan.current; pendingScan.current = null;
    setTouched(old => [added.id, ...old.filter(id => id !== added.id)]);
    setLastScanId(added.id); showLine(added.id);
    const line = b?.items.find(l => l.id === added.id);
    if (line) setScanFeedback({ sequence: ++scanSequence.current, line: { ...line }, added: added.added, repeated: added.repeated });
    // keep the scan box ready for the next label, without moving the page
    const active = document.activeElement;
    if (!active || active === document.body) scanRef.current?.focus({ preventScroll: true });
  }, [b]);
  useEffect(() => { setTouched([]); setLastRead(""); }, [b?.id]);
  useEffect(() => {
    if (!flashId) return;
    const timer = setTimeout(() => { rowRefs.current.get(flashId)?.classList.remove("flash"); setFlashId(null); }, 1600);
    return () => clearTimeout(timer);
  }, [flashId, b]);
  useEffect(() => { setLastScanId(null); setFlashId(null); setScanFeedback(null); pendingScan.current = null; }, [b?.id]);
  const [q, setQ] = useState("");
  const [cam, setCam] = useState(false);
  const [held, setHeld] = useState(false);
  const [custOpen, setCustOpen] = useState(false);
  const [printing, setPrinting] = useState<{ bill: Bill; fmt: PrintFormat; bags?: boolean } | null>(null);
  const [bagWithBill, setBagWithBill] = useState(false);
  const [fmt, setFmt] = useState<PrintFormat>("a5");
  const [aiBusy, setAiBusy] = useState(false);
  const [nextNo, setNextNo] = useState("");
  const [due0, setDue0] = useState(0);
  const scanRef = useRef<HTMLInputElement>(null);
  const advanceRef = useRef<HTMLInputElement>(null);
  const remarksRef = useRef<HTMLTextAreaElement>(null);
  const boxSummaryRef = useRef<HTMLElement>(null);
  const counterDockRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const dock = counterDockRef.current;
    if (!dock) return;
    const measure = () => dock.parentElement?.style.setProperty("--counter-dock-height", `${dock.getBoundingClientRect().height}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => observer.disconnect();
  }, [b?.id]);
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
      setFmt(await getSetting<PrintFormat>("print_fmt", "80mm"));
      setBagWithBill(await getSetting<boolean>("bag_labels_with_bill", false));
      if (args[0]) { const x = await db.bills.get(args[0]); if (x && inStore(x) && (!isEstimate(x) || isOpen())) { setBox(selectedBox(x)); setB(x.status === "hold" ? { ...x, items: mergeBillLines(x.items) } : x); return; } }
      const d = await getSetting<BillingDraft | null>("draft_bill", null);
      // a draft from the other company (owner, 23 Oct: two companies) stays there, kept safe in Held
      const fits = (x: Bill) => inStore(x) && typeForCompany(x.bill_type) === x.bill_type;
      if (d && d.items.length && (!fits(d) || (d.bill_type === "estimate" && !isOpen()))) await parkBillingDraft(d, selectedBox(d), s).catch(() => {});
      const want = typeForCompany("gst") as Bill["bill_type"];
      const restored = d && fits(d) && d.status === "hold" && !d.no && (d.bill_type !== "estimate" || isOpen()) ? d : await resumeBillingDraft(want);
      setBox(restored ? selectedBox(restored) : 1);
      if (restored) delete (restored as BillingDraft).selected_box;   // draft-only field: never saved onto the bill
      setB(restored ? { ...restored, items: mergeBillLines(restored.items) } : newBill(me?.id || "", s, want));
    })();
  }, [args[0]]);
  useEffect(() => { if (b && !b.no) setSetting("draft_bill", { ...b, selected_box: box }); }, [b, box]);
  useEffect(() => { if (!b) return; (async () => {
    const cc = await counterCode(); const n = (await getSetting<number>(`seq_${seriesOf(b.bill_type)}_${fy()}_${cc}`, 0)) + 1;
    setNextNo(`${seriesOf(b.bill_type)}/${fy().slice(0, 2)}${cc}${String(n).padStart(4, "0")}`);
  })(); }, [b?.bill_type]);
  useEffect(() => { b?.party_id ? partyDue(b.party_id).then(setDue0) : setDue0(0); }, [b?.party_id, priv]);

  const t = useMemo(() => (b ? totals(withBillNames(b, products, readItemMap(itemNames?.value)), shop.state, shop.gstin) : null), [b, shop.state, products, itemNames]);
  const [askCode, setAskCode] = useState(false);
  useEffect(() => {
    if (priv || !b || b.bill_type !== "estimate") return;
    // Keep the locked estimate in Held, then return to the separate invoice draft.
    if (b.items.length) toast("Estimate kept safe — unlock, then press Estimate to continue it");
    void openDocument("gst");
  }, [priv]);
  async function openDocument(type: Bill["bill_type"], heldBill?: Bill) {
    if (savingRef.current || switchingRef.current || (type === "estimate" && !isOpen())) return;
    const current = billRef.current;
    if (!heldBill && current?.bill_type === type) return;
    switchingRef.current = true; setSwitching(true);
    try {
      const held = heldBill ? await db.bills.get(heldBill.id) : null;
      if (heldBill && (!held || held.deleted || held.no || held.status !== "hold" || !inStore(held))) throw new Error("This held bill is no longer available");
      if (current && current.id !== held?.id) await parkBillingDraft(current, boxRef.current, shop);
      const draft = held || await resumeBillingDraft(type);
      if ((type === "estimate" || (draft && isEstimate(draft))) && !isOpen()) throw new Error("Unlock estimates before resuming");
      if (billRef.current?.id !== current?.id) throw new Error("Bill changed — choose the document again");
      const next = draft || newBill(me?.id || "", shop, type);
      setBox(selectedBox(next));
      const clean = { ...next }; delete (clean as BillingDraft).selected_box;
      setB({ ...clean, items: mergeBillLines(clean.items) });
      if (draft) toast(`Resumed ${type === "estimate" ? "estimate" : type === "gst" ? "tax invoice" : "challan"} · ${draft.party_name || "Walk-in"}`);
    } catch (error: any) { toast(error.message || "Could not switch bill", true); }
    finally { switchingRef.current = false; setSwitching(false); }
  }
  const press = useRef<any>(0);
  /* owner, 23 Oct: "double-click for estimates is not needed when the companies are separate" — in the
     tax-invoice company estimates live in the other company, so the title does nothing there */
  const hintProps = companyKindNow() === "gst" ? {} : {
    onDoubleClick: () => !priv && setAskCode(true),
    onPointerDown: () => { press.current = setTimeout(() => !priv && setAskCode(true), 700); },
    onPointerUp: () => clearTimeout(press.current), onPointerLeave: () => clearTimeout(press.current),
  };
  const set = (patch: Partial<Bill>) => setB(x => (x ? { ...x, ...patch } : x));
  const setLine = (id: string, patch: Partial<BillLine>) => setB(x => x ? { ...x, items: x.items.map(l => (l.id === id ? fixLine({ ...l, ...patch }) : l)) } : x);
  const dropLines = async (ids: string[]) => {
    const current = billRef.current, wanted = new Set(ids);
    if (!current || savingRef.current) return;
    const removed = current.items.filter(line => wanted.has(line.id));
    if (!removed.length || !await confirmDelete("Remove " + removed.length + " bill line(s)?\n" + removed.slice(0, 4).map(l => [l.item, l.style].filter(Boolean).join(" ")).join("\n"))) return;
    setB(latest => {
      if (!latest || latest.id !== current.id || savingRef.current) return latest;
      const items = latest.items.filter(line => !wanted.has(line.id));
      const removedCodes = new Set(latest.items.filter(line => wanted.has(line.id) && !items.some(keep => keep.product_id === line.product_id)).flatMap(line => line.product_id ? pmap.get(line.product_id)?.barcodes || [] : []));
      const rfid_tags = (latest.rfid_tags || []).filter(tag => !removedCodes.has(tag));
      removedCodes.forEach(tag => tagsRef.current.delete(tag));
      return { ...latest, items, rfid_tags };
    });
    setSelectedLines(new Set());
  };

  /* RFID: one tag counts once per bill, however many times the reader sees it */
  const tagsRef = useRef(new TagSet());
  const unlinked = useRef(new Recent());
  useEffect(() => { tagsRef.current = new TagSet(b?.rfid_tags || []); }, [b?.id]);

  function addProduct(p: Product, pkts = 1, pieces = 0, rate = 0, destination = { billId: billRef.current?.id, box: boxRef.current }) {
    if (savingRef.current || switchingRef.current || destination.billId !== billRef.current?.id) return false;
    const repeated = billRef.current?.items.some(l => l.product_id === p.id && l.box_no === destination.box);
    beep(repeated ? "repeat" : true);
    setB(x => {
      if (!x || x.id !== destination.billId) return x;
      let line = lineFrom(p, destination.box, pkts, x.price_level || "wholesale");
      if (pieces) line = fixLine({ ...line, pkts: 0, qty: pieces });
      if (rate) line = fixLine({ ...line, rate: toPaise(rate) });
      // Keep remainder packets, discounts and pieces already dispatched on another document distinct.
      const addition = appendPosLine(x.items, line);
      pendingScan.current = { id: addition.line.id, added: addition.added, repeated: addition.repeated };
      return { ...x, items: addition.items };
    });
    return true;
  }

  /* The scanner gun works ONLY in the scan box (counter request 21/10/2026). A scan
     while the cursor is in a Box / Qty / Rate cell, a dropdown, a button or anywhere
     else is thrown away — the field is put back as it was — and the error sound
     plays, because the biller listens rather than watches the screen. The scan box
     then takes the cursor so the next scan of the same label goes in. */
  useScanOnlyIn(scanRef, () => {
    beep(false);
    toast("Not added — scan only in the scan box. Scan this label again.", true);
    if (!document.querySelector(".modal,dialog[open]")) scanRef.current?.focus({ preventScroll: true });
  });

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
    if (savingRef.current || switchingRef.current) return "Please wait for the bill";
    // Capture before lookup: a fast BB scan must not move this item to the next box.
    const destination = { billId: billRef.current?.id, box: boxRef.current };
    setScanFeedback(null);
    if (r.startsWith(BAG_PREFIX)) {
      setQ("");
      try { const bag = parseBagPayload(r)!; const saved = await db.bills.get(bag.billId);
        if (!saved || saved.deleted || !inStore(saved) || (isEstimate(saved) && !isOpen())) throw new Error("Bag bill is not available on this counter");
        const text = "Bag " + bag.number + " · " + saved.party_name + " · " + saved.no; toast(text); return text;
      } catch (error: any) { toast(error.message, true); return "Bag not found"; }
    }
    if (r.toLowerCase() === "bb") {
      const next = ++boxCountRef.current; boxRef.current = next; setBox(next); set({ box_count: next }); setQ("");
      beep(); toast("Box " + next); return "Box " + next;
    }
    if (r.startsWith("#") && r.length > 1 && companyKindNow() !== "gst") { // typed code in the scan box (not in the tax-invoice company)
      setQ("");
      if (await unlock(r.slice(1))) { await openDocument("estimate"); beep(); } else { beep(false); toast("Not found", true); }
      return "";
    }
    if (isRfidTag(r)) {
      const tag = normTag(r), scanTags = tagsRef.current; setQ("");
      if (!scanTags.add(tag)) { beep("repeat"); toast("Tag already on this bill — no extra quantity added"); return "Tag already on this bill"; }
      const tp = await findByScan(tag);
      if (!tp) {
        scanTags.delete(tag);
        if (unlinked.current.first(tag)) { beep(false); toast("RFID tag not linked to a product — link it in Products", true); }
        return "Not found";
      }
      const sold = soldBill(tp, tag);
      if (sold) toast(`This tag was already sold on ${sold} — check the piece`, true);
      const fp = await fillFromItemCode(tp);
      if (!addProduct(fp, 1, 0, 0, destination)) { scanTags.delete(tag); beep(false); toast("Bill changed or saving — scan this label again", true); return "Bill changed or saving — scan again"; }
      setB(x => x && x.id === destination.billId ? { ...x, rfid_tags: [...(x.rfid_tags || []), tag] } : x);
      return "Added · " + label(fp);
    }
    // Release the scanner input immediately; earlier lookups must never erase a later burst.
    setQ("");
    let p = await resolve(r);
    const parsed = parseLabel(r);
    // Typed text may pick the one product it matches. A scanned label never does: a
    // label we couldn't read must not be swapped for some product that merely shares
    // part of its text (that is how an earring became a bali).
    const scannedLabel = parsed.how !== "code" || r.length > 20 || /[~|`^]/.test(r);
    if (!p && !scannedLabel) {
      const hits = products.filter(x => (x.style + " " + x.code + " " + x.item).toUpperCase().includes(r.toUpperCase()));
      if (hits.length === 1) p = await fillFromItemCode(hits[0]);
    }
    if (!p && parsed.how === "rungnna" && parsed.code && !parsed.item) { beep(false); toast(`This sticker's item (${parsed.code}) isn't on this counter yet. Check the internet / cloud sync, then scan again.`, true); return "Not on this counter yet"; }
    if (!p) {
      beep(false);
      if (scannedLabel) void noteMiss(r, me?.name || "");
      toast(scannedLabel ? `This sticker didn't read. Type its style or name above and pick the item once — after that this sticker scans by itself. (Scanner sent: ${r.length > 40 ? r.slice(0, 40) + "…" : r})` : "Not found — scan the label or record it in Scan & record", true);
      return "Not found";
    }
    clearMiss();
    if (!addProduct(p, 1, 0, 0, destination)) { beep(false); toast("Bill changed or saving — scan this label again", true); return "Bill changed or saving — scan again"; }
    // The sticker's printed rate is the operator's check: say so when the bill differs.
    const printed = parsed.rate && ["shop label", "rungnna"].includes(parsed.how) ? toPaise(parsed.rate) : 0;
    const billed = priceFor(p, billRef.current?.price_level || "wholesale");
    if (printed && billed && printed !== billed) toast(`Check rate: sticker says ${billAmount(printed)}, bill uses ${billAmount(billed)} for ${label(p)}`, true);
    // show exactly what the QR carried, so a mislabelled sticker is visible at the counter
    if (["shop label", "rungnna"].includes(parsed.how)) {
      const means = parsed.icode ? codeInfo(parsed.icode, readItemMap(itemNames?.value))?.name : parsed.item?.toUpperCase();
      setLastRead(["QR: " + (parsed.icode ? `code ${parsed.icode}${means ? " = " + means : " (not named)"}` : means || "—"), parsed.rate && "₹" + parsed.rate, parsed.qty && "×" + parsed.qty, parsed.style, parsed.color].filter(Boolean).join(" · "));
    } else setLastRead("Barcode: " + r);
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

  async function doSave(print = false, share = false, bags = false) {
    if (!b || !t) return;
    if (b.bill_type !== "challan" && b.payments.some(p => p.mode !== "credit" && p.amount <= 0)) {
      toast("Enter the amount received, or remove the unused payment row. No payment is assumed.", true);
      document.querySelector<HTMLInputElement>('.payment-row input[aria-label$="amount"]')?.focus();
      return;
    }
    if (bags && !b.party_name.trim()) return toast("Enter the customer name before printing bag labels", true);
    if (savingRef.current || switchingRef.current) return;
    if (b.status === "final") {
      beep("repeat"); toast("This bill is already saved");
      const saved = await db.bills.get(b.id);
      if (saved && bags) setBagBill(saved);
      if (saved && print) setPrinting({ bill: saved, fmt, bags: bagWithBill && !!saved.party_name.trim() });
      if (saved && share) await shareBill(saved, shop);
      return;
    }
    savingRef.current = true; setSaving(true);
    try {
    if (!t.items.length) return toast("No items on the bill", true);
    const empty = t.items.filter(noQty);
    if (empty.length) return stopForQty(empty);
    setQtyProblem([]);
    validatePosLines(t.items);
    /* discount above the shop's limit needs an owner/manager PIN */
    const list = t.items.reduce((a, l) => a + l.qty * l.rate, 0);
    const offPct = list ? ((list - t.gross + t.discount) / list) * 100 : 0;
    if (offPct > (shop.max_disc ?? 10) + 0.01 && !can(me, "discount")) {
      const pin = await askText(`Discount is ${offPct.toFixed(1)}% — above the ${shop.max_disc ?? 10}% limit. Owner or manager PIN:`);
      const ok = pin && (await db.staff.filter(x => !!x.active && !x.deleted && x.login !== "role" && !!x.pin && x.pin === pin && can(x, "billing.discount_over")).count());
      if (!ok) return toast("Discount not approved", true);
    }
    // never stop a sale over a setting: warn, and save the bill
    if (b.bill_type === "gst" && !shop.gstin?.trim()) toast("Add the shop's GSTIN in Settings → Shop profile: tax invoices should carry it.", true);
    const missing = t.items.find(l => !l.item?.trim() || /^ITEM\s+\d+$/i.test(l.item.trim()));
    if (missing) return toast("Add the product name before saving: " + (missing.style || missing.code), true);
    const done = await finalize(t, shop.state, b.party_name);
    beep("saved");
    setLastSaved(done);
    toast(`Saved ${done.bill_type === "estimate" ? "estimate" : done.bill_type === "gst" ? "tax invoice" : "challan"} ${done.no} in Bills · ${billAmount(done.net)}`);
    if (done.oversold?.length) toast("Saved with negative stock: " + done.oversold.map(o => `${o.item} (${o.qty} more than recorded)`).join(", "), true);
    await setSetting("draft_bill", null);
    if (bags) setBagBill(done);
    if (print) setPrinting({ bill: done, fmt, bags: bagWithBill && !!done.party_name.trim() });
    if (share) await shareBill(done, shop);
    setB(newBill(me?.id || "", shop, b.bill_type)); setBox(1);
    setNextNo("");
    } catch (e: any) { toast(e.message || "Could not save bill", true); }
    finally { savingRef.current = false; setSaving(false); }
  }
  async function doHold() {
    if (savingRef.current || switchingRef.current) return;
    if (!b?.items.length) return toast("Nothing to hold", true);
    if (!b.remarks?.trim()) { toast("Write a remark before Hold — customer, reason or what is pending.", true); remarksRef.current?.focus(); return; }
    await parkBillingDraft(b, box, shop); await setSetting("draft_bill", null);
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
      if (calculator || savingRef.current || switchingRef.current || document.querySelector('.modal,dialog[open]')) return;
      if (k === "F2") { const snapshot = billRef.current; void (async () => { if (snapshot?.items.length && !await confirmDelete("Clear the current bill and start a new one? Use Hold to keep it.")) return; if (billRef.current?.id !== snapshot?.id) return; setB(newBill(me?.id || "", shop, priv ? snapshot?.bill_type || "gst" : "gst")); setBox(1); })(); }
      if (k === "F3") doHold();
      if (k === "F4") setHeld(true);
      if (k === "F5") setCalculator(true);
      if (k === "F6") doSave(false);
      if (k === "F7") scanRef.current?.focus();
      if (k === "F8") { setEditorOpen(true); setEntryFocus(n => n + 1); }
      if (k === "F9") doSave(true);
      if (k === "F10") doSave(false, true);
      if (k === "F11") boxSummaryRef.current?.focus({ preventScroll: true });
      if (k === "F12") { setMoneyMore(true); setTimeout(() => advanceRef.current?.focus(), 0); }
    };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  });

  if (!b || !t || switching || (!priv && isEstimate(b))) return <div className="card pad">Loading bill…</div>;
  const documentName = b.bill_type === "estimate" ? "estimate" : b.bill_type === "gst" ? "tax invoice" : "challan";
  const unnamed = unnamedCodes(t.items, id => (id ? pmap.get(id)?.item_code : undefined));
  const boxes = [...new Set([...t.items.map(l => l.box_no), box])].sort((a, z) => a - z);
  const balance = due(t);
  const lastScan = t.items.find(l => l.id === lastScanId);
  const itemEditor = <Suspense fallback={<div className="pos-entry-loading" role="status">Loading items…</div>}><ManualItems key={b.id} inline persistent focusRequest={entryFocus} products={products} box={box} level={b.price_level || "wholesale"} canRates={can(me, "billing.rates")} onClose={() => {}}
    onProduct={(p, count, pieces, rate) => {
      void learnFromPick(p).then(ok => ok && toast(`Learnt: this sticker now scans as ${label(p)}`));
      const line = fixLine({ ...lineFrom(p, box, pieces ? 0 : count, b.price_level || "wholesale"), ...(pieces ? { qty: count, pkts: 0 } : {}), rate });
      if (savingRef.current) throw new Error("Wait for the bill to finish saving");
      const repeated = repeatedPosLine(b.items, line);
      beep(repeated ? "repeat" : true);
      setB(x => {
        if (!x) return x;
        const addition = appendPosLine(x.items, line);
        pendingScan.current = { id: addition.line.id, added: addition.added, repeated: addition.repeated };
        return { ...x, items: addition.items };
      });
    }} onCustom={line => {
      if (savingRef.current) throw new Error("Wait for the bill to finish saving");
      const repeated = repeatedPosLine(b.items, line);
      beep(repeated ? "repeat" : true);
      setB(x => { if (!x) return x; const addition = appendPosLine(x.items, line); pendingScan.current = { id: addition.line.id, added: addition.added, repeated: addition.repeated }; return { ...x, items: addition.items }; });
    }} /></Suspense>;

  return (
    <div className="pos">
      {scanFeedback && createPortal(<BillScanNotice key={scanFeedback.sequence} feedback={scanFeedback} onClose={dismissScanFeedback} />, document.body)}
      <div className="pos-counter-dock" ref={counterDockRef}>
      {b.bill_type === "gst" && shopNeedsTaxDetails(shop) && <ShopDetailsAsk shop={shop} onSaved={setShop} />}
      <div className="pos-top card">
        {companyKindNow() === "estimate" || estimatesOnly() ? <div className="row" style={{ gap: 8 }}><div className="pos-title"><b>Estimate</b><span className="xs mut">{companyKindNow() === "estimate" ? "estimate company" : "estimates"}</span></div></div>
        : priv && companyKindNow() !== "gst" ? <div className="seg" role="group" aria-label="Bill type">
          <button aria-pressed={b.bill_type === "estimate"} onClick={() => void openDocument("estimate")}>Estimate</button>
          <button aria-pressed={b.bill_type === "gst"} onClick={() => void openDocument("gst")}>GST Invoice</button>
          <button aria-pressed={b.bill_type === "challan"} onClick={() => void openDocument("challan")}>Challan</button>
          {me?.role !== "owner" && <button onClick={() => lockNow()} title="Close estimates" aria-label="Close estimates">✓</button>}
        </div> : <div className="row" style={{ gap: 8, flexWrap: "nowrap" }}>
          {/* no lock sign anywhere (owner, 23 Oct): someone allowed to open estimates double-clicks or holds the title */}
          <div className="pos-title" {...hintProps}><b>{b.bill_type === "challan" ? "Delivery challan" : "Tax invoice"}</b><span className="xs mut">{b.bill_type === "challan" ? "goods out · no money" : b.gst_rate + "% GST"}</span></div>
          <div className="seg" role="group" aria-label="Document">
            <button aria-pressed={b.bill_type !== "challan"} onClick={() => void openDocument("gst")}>Invoice</button>
            <button aria-pressed={b.bill_type === "challan"} onClick={() => void openDocument("challan")} title="Send goods now, invoice later">Challan</button>
          </div></div>}
        <div className="pos-no"><span className="xs mut">{b.no ? "Bill no" : "Next no"}</span><b className="mono">{b.no || nextNo}</b>
          {b.bill_type === "estimate" && (moreOpen || !!b.inv_no) && <input className="in xs mono" style={{ marginTop: 4, maxWidth: 170 }} aria-label="Invoice no. for this estimate" placeholder="Invoice no. (optional)" value={b.inv_no || ""} onChange={e => set({ inv_no: e.target.value.toUpperCase().slice(0, 24) })} />}</div>
        <button className="pos-cust" onClick={() => setCustOpen(true)}>
          <span className="xs mut">Client name</span>
          <b>{b.party_name || "Walk-in / cash"}</b>
          <span className="xs">{b.party_phone}{due0 > 0 ? <span className="pill bad" style={{ marginLeft: 6 }}>Due {billAmount(due0)}</span> : null}</span>
        </button>
        {/* Karan, 26 Oct: names are typed on the spot, hand to hand — the people list only suggests */}
        <label className="f" style={{ minWidth: 130 }}>Salesman
          <input className="in" list="pos-names-salesman" autoComplete="off" placeholder="Type or pick" value={b.salesman || ""} onChange={e => set({ salesman: e.target.value.toUpperCase().slice(0, 60) })} />
          <datalist id="pos-names-salesman">{staff.map(s => <option key={s.id} value={s.name} />)}</datalist></label>
        {/* Owner, 25 Oct (voice): "after 3–4 scans the lines go below and I scroll up and down — at least 8–10 lines
            must be in front of me". The rarely-changed fields fold away under "More" so the lines get the screen. */}
        <button type="button" className="linkbtn sm" aria-expanded={moreOpen} onClick={() => { setMoreOpen(o => !o); void setSetting("bill_more_open", !moreOpen); }}>{moreOpen ? "Less ▴" : `More ▾${[b.helper, b.packed_by, b.checked_by].filter(Boolean).length ? " (" + [b.helper, b.packed_by, b.checked_by].filter(Boolean).length + ")" : ""}`}</button>
        {moreOpen && me?.role === "owner" && !companyKindNow() && <a className="linkbtn sm" href="#/stores">Separate Estimates / GST companies →</a>}
        {/* who worked the bill, in counter order: salesman → helper → packed by → rechecked by */}
        {moreOpen && ([["Helper", "helper", "helper"], ["Packing done by", "packed_by", "packer"], ["Rechecked by", "checked_by", ""]] as const).map(([title, key, prefer]) =>
          <label key={key} className="f" style={{ minWidth: 130 }}>{title}
            <input className="in" list={"pos-names-" + key} autoComplete="off" placeholder="Type or pick" value={b[key] || ""} onChange={e => set({ [key]: e.target.value.toUpperCase().slice(0, 60) } as Partial<Bill>)} />
            <datalist id={"pos-names-" + key}>
              {[...staff].sort((x, y) => Number(!!prefer && y.role === prefer) - Number(!!prefer && x.role === prefer)).map(s => <option key={s.id} value={s.name}>{prefer && s.role === prefer ? prefer : ""}</option>)}</datalist></label>)}
        {moreOpen && <div className="pos-box"><span className="xs mut">Box qty: {b.box_count} · Current box {box}</span>
          <div className="row" style={{ gap: 4 }}>{boxes.map(x => <button key={x} className="chip" aria-pressed={x === box} onClick={() => setBox(x)}>{x}</button>)}
            <button className="chip" onClick={() => setBox(Math.max(...boxes) + 1)}>+</button></div></div>}
      </div>
            <div className="pos-scanhead stack" style={{ gap: 8 }}>
            <div className="row scanrow">
              <div className="wedge grow" style={{ position: "relative" }}>
                <Icon n="scan" size={16} />
                <input ref={scanRef} autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Scan label, or type style / item (F7)"
                  onKeyDown={e => { if (e.key === "Tab" && isRfidTag(q)) { e.preventDefault(); onCode(q); return; } if (e.key === "Enter") { e.preventDefault(); onCode(q); } }} />
                {suggestions.length > 0 && q.length < 25 && (
                  <div className="sugg">{suggestions.map(p => (
                    <button key={p.id} onClick={() => { addProduct(p); setQ(""); scanRef.current?.focus(); void learnFromPick(p).then(ok => ok && toast(`Learnt: this sticker now scans as ${label(p)}`)); }}>
                      <Thumb photo_id={p.photo_id} url={p.photo_url} text={p.item} size={34} />
                      <span className="grow"><b>{p.style || p.code}</b> <span className="mut">{p.item} · {p.color}</span></span>
                      <span className="mono">{p.rate ? billAmount(p.rate) : ""}{p.pack ? " ×" + p.pack : ""}</span></button>))}</div>)}
              </div>
              <button className={"btn " + (cam || sheet ? "p" : "g")} onClick={() => (small ? setSheet(true) : setCam(!cam))} title="Scan with the camera"><Icon n="scan" size={20} />Scan</button>
              {!small && <button className={"btn " + (peers ? "p" : "")} onClick={() => setPairOpen(true)} title="Use a phone as the scanner"><Icon n="sell" size={18} />{peers ? "Phone linked" : "Phone as scanner"}</button>}
              <MicButton onAudio={a => doVoice(a)} busy={aiBusy} label="🎙 Speak order" />
              <button className="btn" aria-pressed={editorOpen} aria-expanded={editorOpen} aria-controls="pos-item-entry" disabled={saving} onClick={() => { setEditorOpen(x => small ? !x : true); setEntryFocus(n => n + 1); }}><Plus size={18} />Add item</button>
              <button className="btn" disabled={saving} title="POS calculator" aria-label="POS calculator" onClick={() => setCalculator(true)}><Calculator size={20} /></button>
            </div>
            <div className={"lastscan" + (lastScan ? " has-item" : "")} role="status" aria-live="polite" aria-atomic="true">
              <span>{lastScan ? <><b>Added: {lastScan.item || lastScan.style || lastScan.code}</b><span className="xs">{[lastScan.style, lastScan.color, `Box ${lastScan.box_no}`, `${lastScan.qty} ${lastScan.type || "PCS"} × ${billAmount(lastScan.rate)}`, billAmount(lastScan.amount)].filter(Boolean).join(" · ")}</span>{lastRead && <span className="xs mono qr-read">{lastRead}</span>}</> : <span className="mut">{t.items.length} bill lines · {t.total_qty} units</span>}</span>
              {lastScan && <button className="btn sm" onClick={() => showLine(lastScan.id)}>Show line</button>}
            </div>
            </div>
      </div>

          {(cam && !small || editorOpen) && <div className="pos-entry stack" style={{ gap: 8 }}>
            {cam && !small && <div className="pos-cam"><CameraScanner onCode={c => onCode(c)} /></div>}
            {editorOpen && itemEditor}
          </div>}

      <div className="pos-main">
        <div className="stack pos-workspace" style={{ minWidth: 0 }}>


          <NameItemCodes codes={unnamed} onNamed={(code, name, unit) => setB(x => x && { ...x, items: x.items.map(l =>
            (l.item === "ITEM " + code || (!l.item && l.product_id && pmap.get(l.product_id)?.item_code === code)) ? { ...l, item: name, type: unit } : l) })} />

          {(() => { const stuck = t.items.filter(l => qtyProblem.includes(l.id) && noQty(l)); return stuck.length ? (
            <div className="note bad pos-qty-problem" role="alert">
              <b>Not saved — quantity missing on {stuck.length === 1 ? "this line" : stuck.length + " lines"}:</b> {stuck.slice(0, 3).map(l => [l.item, l.style].filter(Boolean).join(" ")).join(", ")}{stuck.length > 3 ? "…" : ""}. Enter the quantity, or remove the line, then save / print again.
              <span className="row" style={{ gap: 6, marginTop: 6 }}>
                <button className="btn sm bad" disabled={saving} onClick={() => dropLines(stuck.map(l => l.id))}>Remove {stuck.length === 1 ? "this line" : "these lines"}</button>
                <button className="btn sm" onClick={() => setQtyProblem([])}>Close</button></span>
            </div>) : null; })()}
          <div className="tw pos-lines" ref={linesPane} role="region" aria-label="Bill items" tabIndex={0} onKeyDown={onGridKey}>
            <table className="pos-t" aria-label="Bill items">
              <thead><tr><th>#</th><th>Box</th><th>Item</th><th>Type</th><th>Style</th><th>Colour / Art no.</th><th className="r">Pkt</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Disc</th><th className="r">Amount</th><th>{!small && <SelectAll compact ids={t.items.map(l => l.id)} selected={selectedLines} onChange={setSelectedLines} label="Select all bill lines" />}</th></tr></thead>
              <tbody>
                {displayOrder(t.items).map(l => [l, t.items.indexOf(l)] as const).map(([l, i]) => (
                  <tr key={l.id} className={"ln" + (lastScanId === l.id ? " scanned" : "") + (flashId === l.id ? " flash" : "") + (noQty(l) ? (qtyProblem.includes(l.id) ? " noqty stop" : " noqty") : "")} aria-current={lastScanId === l.id ? "true" : undefined} ref={row => { if (row) rowRefs.current.set(l.id, row); else rowRefs.current.delete(l.id); }}>
                    <td className="mut" data-l="#"><span className="line-no">{i + 1}</span></td>
                    <td data-l="Box"><input className="cell" style={{ width: 38 }} inputMode="numeric" value={l.box_no} onChange={e => setLine(l.id, { box_no: Math.max(1, parseInt(e.target.value) || 1) })}
                      onBlur={() => setB(x => x ? { ...x, items: mergeBoxLine(x.items, l.id) } : x)} /></td>
                    <td data-l=""><input className="cell" style={{ width: "100%", fontWeight: 700 }} title={l.item} aria-label={`Product name for line ${i + 1}`} placeholder="Product name" value={/^ITEM\s+\d+$/i.test(l.item || "") ? "" : l.item || ""} onChange={e => setLine(l.id, { item: e.target.value })} />{!l.product_id && <span className="pill">Custom</span>}{l.product_id && pmap.get(l.product_id)?.tk?.trim() ? <span className="pill warn" style={{ marginLeft: 6 }}>dead stock</span> : null}</td>
                    <td data-l="Type">{l.type}</td><td data-l="Style" className="mono">{l.style || "—"}</td><td data-l="Colour / Art no.">{l.color || "—"}</td>
                    <td className="r" data-l="Packets">{l.pack > 1 ? <span className="row" style={{ gap: 2, justifyContent: "flex-end", flexWrap: "nowrap" }}>
                      <input className="cell r" style={{ width: 44 }} inputMode="numeric" value={l.pkts || ""} onChange={e => setLine(l.id, { pkts: parseInt(e.target.value) || 0 })} /><span className="xs mut">×{l.pack}</span></span> : <span className="mut">—</span>}</td>
                    <td className="r" data-l={l.type || "Quantity"}><input className="cell r" style={{ width: 56 }} inputMode="numeric" value={l.qty || ""} disabled={l.pack > 1 && l.pkts > 0}
                      onChange={e => setLine(l.id, { qty: parseInt(e.target.value) || 0, pkts: 0 })} /></td>
                    <td className="r" data-l="Rate"><MoneyInput className="cell r" style={{ width: 70 }} disabled={!can(me, "billing.rates") && !!(l.product_id && pmap.get(l.product_id)?.rate)} paise={l.rate} onPaise={v => setLine(l.id, { rate: v })} /></td>
                    <td className="r" data-l="Disc"><input className={"cell r" + (discError(l.disc) ? " bad" : "")} style={{ width: 54 }} placeholder="—" title={discError(l.disc) || "10% or amount"} value={l.disc} onChange={e => setLine(l.id, { disc: e.target.value })} /></td>
                    <td className="r mono b" data-l="Amount">{(l.amount / 100).toLocaleString("en-IN", { minimumFractionDigits: 2 })}</td>
                    <td data-l="Select" className="pos-line-actions"><input type="checkbox" aria-label={"Select bill line " + (i + 1)} checked={selectedLines.has(l.id)} onChange={event => setSelectedLines(old => { const next = new Set(old); event.target.checked ? next.add(l.id) : next.delete(l.id); return next; })} /><DeleteButton className="x" aria-label="Remove line" onDelete={() => dropLines([l.id])}>✕</DeleteButton></td>
                  </tr>))}
                {!t.items.length && <tr><td colSpan={12} className="mut" style={{ padding: 28, textAlign: "center" }}>No items yet</td></tr>}
              </tbody>
            </table>
          </div>

        </div>

        {/* Karan, 26 Oct: the box summary stands at the right, full height, so box 5, 6, 7… show without scrolling;
            Save / Print / WhatsApp moved down into the totals panel in its place. */}
        <section className="pos-box-summary counter-boxes" ref={boxSummaryRef} tabIndex={-1} aria-label="Box summary">
          <b>Boxes <span className="xs mut">· qty</span></b>
          <div className="pos-box-totals">{boxes.map(n => <button key={n} className="chip" aria-pressed={n === box} onClick={() => setBox(n)} aria-label={`Box ${n}, quantity ${t.items.filter(l => l.box_no === n).reduce((a, l) => a + l.qty, 0)}`}>
            Box {n} <b>{t.items.filter(l => l.box_no === n).reduce((a, l) => a + l.qty, 0)}</b>
          </button>)}</div>
          <button className="chip counter-box-new" title="Next scans go into a new box" onClick={() => setBox(Math.max(...boxes) + 1)}>+ New box</button>
        </section>
        <aside className="pos-sum card" aria-label="Bill totals and payment">
          <div className="counter-actions">          <div className="pos-actions" aria-label="Print and save">
            <select className="in" aria-label="Print size" title="Roll printer: choose 58 mm or 80 mm thermal to match your paper. Enable auto-cut in the printer's preferences." value={fmt} onChange={e => { setFmt(e.target.value as PrintFormat); setSetting("print_fmt", e.target.value); }}>
              <option value="a5">A5 invoice</option><option value="a4">A4 invoice</option><option value="80mm">80 mm thermal</option><option value="58mm">58 mm thermal</option><option value="packing">Packing slip (no rates)</option></select>
            <button className="btn" disabled={saving} onClick={doHold}>Hold · F3</button>
            <button className="btn" disabled={saving} onClick={() => setHeld(true)}>Held · F4</button>
            <button className="btn p" disabled={saving} title={"Saves to Bills → " + (b.bill_type === "estimate" ? "Estimates" : b.bill_type === "gst" ? "Tax invoices" : "Challans")} onClick={() => doSave(false)}>{saving ? "Saving…" : `Save ${documentName}`}</button>
            <button className="btn dk" disabled={saving} onClick={() => doSave(true)}>Print {documentName}</button>
            <button className="btn g" disabled={saving} onClick={() => doSave(false, true)}>WhatsApp · F10</button>
            <span className="pos-actions-bags">
              <label className="row sm" title="Also print customer bag stickers with the bill"><input type="checkbox" checked={bagWithBill} onChange={event => { setBagWithBill(event.target.checked); void setSetting("bag_labels_with_bill", event.target.checked); }} /> + bags</label>
              <button className="btn" disabled={saving || !t.items.length} onClick={() => doSave(false, false, true)}>Bag stickers</button>
            </span>
            {lastSaved && (priv || !isEstimate(lastSaved)) && <button className="linkbtn sm" onClick={() => go("bills/" + lastSaved.id)}>View saved {lastSaved.bill_type === "estimate" ? "estimate" : lastSaved.bill_type === "gst" ? "tax invoice" : "challan"} {lastSaved.no}</button>}
          </div></div>
          <div className="counter-box-tools stack">          <div className="pos-notes">
            <label className="f"><textarea ref={remarksRef} className="in" rows={2} aria-label="Remarks" value={b.remarks} onChange={e => set({ remarks: e.target.value })} placeholder="Remarks / narration — required before Hold" /></label>
            {paymentNarration(b.payments) && <div className="xs payment-narration" aria-label="Automatic payment narration">{paymentNarration(b.payments)}</div>}
          </div>

          {selectedLines.size > 0 && <div className="selection-bar"><span className="sm">{t.items.filter(l => selectedLines.has(l.id)).length} selected</span><DeleteButton className="btn sm bad" disabled={saving || !t.items.some(l => selectedLines.has(l.id))} onDelete={() => dropLines(t.items.filter(l => selectedLines.has(l.id)).map(l => l.id))}>Delete selected</DeleteButton><span className="xs mut keys-hint" style={{ marginLeft: "auto" }}>Keys: ↑↓ rows · ←→ fields · Space select · Shift+↑↓ range</span></div>}
{small && <SelectAll ids={t.items.map(l => l.id)} selected={selectedLines} onChange={setSelectedLines} label="Select all bill lines" />}
          <div className="sumrow"><span>Pieces · Boxes</span><b className="mono">{t.total_qty} · {t.box_count}</b></div>
          {b.rfid_tags?.length ? <div className="sumrow"><span>RFID tags</span><b className="mono">{b.rfid_tags.length}</b></div> : null}
          </div>
          <div className="counter-amounts stack">
          <div className="sumrow"><span>Total amount</span><b className="mono">{billAmount(t.gross)}</b></div>
          {/* Owner, 23 Oct: he typed 50 for a 50% discount (his old software's discount box is a percentage; half
              the sticker rate is the wholesale rate) and it took off ₹50 from the small "Amount" box. Percent is
              now the main box, first and labelled; a rupee amount is the smaller "or ₹" box. */}
          <div className="sumrow"><span>Discount %</span>
            <span className="row" style={{ gap: 4, flexWrap: "nowrap", alignItems: "center" }}>
              <MoneyInput className={"cell r disc-pct" + (b.discount_pct > 100 ? " bad" : "")} style={{ width: 64 }} placeholder="%" aria-label="Discount percent" paise={Math.round((b.discount_pct || 0) * 100)} onPaise={v => set({ discount_pct: v / 100, ...(v ? { discount: 0 } : {}) })} />
              <b className="sm">%</b>
              {b.discount_pct ? <span className="mono sm mut" title="Discount in rupees">= {billAmount(t.discount)}</span>
                : <MoneyInput className="cell r" style={{ width: 64 }} placeholder="or ₹" aria-label="Discount in rupees" paise={b.discount} onPaise={v => set({ discount: v })} />}</span></div>
          {/* Owner, 25 Oct: the extra 2–3% for good customers, cut on what is left after the discount */}
          <div className="sumrow"><span title="Cut after the discount, on what is left. Items set as 'no extra less' (Settings › Prices) are left out.">Less % <span className="xs mut">after discount</span></span>
            <span className="row" style={{ gap: 4, flexWrap: "nowrap", alignItems: "center" }}>
              <MoneyInput className="cell r" style={{ width: 64 }} placeholder="%" aria-label="Less percent after discount" paise={Math.round((b.less_pct || 0) * 100)} onPaise={v => set({ less_pct: v / 100 })} />
              <b className="sm">%</b></span></div>
          {(moneyMore || !!b.packing) && <div className="sumrow"><span>Packing</span><MoneyInput className="cell r" style={{ width: 80 }} paise={b.packing} onPaise={v => set({ packing: v })} /></div>}
          {b.bill_type === "gst" && <div className="sumrow"><span>GST{gstLabel(t)} <button className="linkbtn" onClick={() => set({ gst_mode: b.gst_mode === "exclusive" ? "inclusive" : "exclusive" })}>{b.gst_mode === "exclusive" ? "added" : "included"}</button></span><b className="mono">{billAmount(t.gst)}</b></div>}
          {b.bill_type === "gst" && b.party_state && !placeCode(b.party_gstin, b.party_state) && <div className="xs" style={{ textAlign: "right", color: "var(--bad)" }}>Check buyer state “{b.party_state}” — not recognised, GST type may be wrong</div>}
          {t.igst ? <div className="xs mut" style={{ textAlign: "right" }}>IGST (other state)</div> : t.gst ? <div className="xs mut" style={{ textAlign: "right" }}>CGST {billAmount(t.cgst)} + SGST {billAmount(t.sgst)}</div> : null}
          {t.adjust ? <div className="sumrow"><span>Round off</span><span className="mono">{billAmount(t.adjust)}</span></div> : null}
          <div className="net"><span>{b.bill_type === "challan" ? "VALUE" : "NET"}</span><b>{billAmount(t.net)}</b></div>
          </div><div className="counter-payments stack">
          {b.bill_type === "challan" ? <div className="note sm">A challan sends the goods out with no money taken. Convert it to an invoice from Bills when the customer is billed.</div> : <>
          {(moneyMore || !!b.advance) ? <div className="sumrow"><span>Advance</span><MoneyInput inputRef={advanceRef} className="cell r" style={{ width: 80 }} paise={b.advance} onPaise={v => set({ advance: v })} /></div>
            : <button type="button" className="linkbtn xs" style={{ alignSelf: "flex-end" }} onClick={() => setMoneyMore(true)}>+ Packing / advance</button>}
          <Payments pays={b.payments} left={t.net - b.advance} onChange={payments => set({ payments })} />
          <div className={"sumrow " + (balance > 0 ? "due" : "")}><span>{balance > 0 ? "Balance (credit)" : balance < 0 ? "Return to customer" : "Balance"}</span><b className="mono">{billAmount(Math.abs(balance))}</b></div></>}
          </div>
        </aside>
      </div>

      <div className="fkeys">{KEYS.map(([k, v]) => <span key={k}><kbd>{k}</kbd>{v}</span>)}</div>
      <div className="pos-mbar"><div><span className="xs">{t.total_qty} pcs · {t.items.length} lines</span><b>{billAmount(t.net)}</b></div>
        <button className="btn g" disabled={saving} onClick={() => doSave(false, true)}>Save & Send</button><button className="btn p" disabled={saving} onClick={() => doSave(false)}>{saving ? "Saving…" : `Save ${documentName}`}</button></div>
      <Suspense fallback={<div className="toast" role="status">Loading billing tool…</div>}>
        {calculator && <PosCalculator lines={t.items} onClose={() => setCalculator(false)} onApply={(value, target: CalcTarget, id) => {
          if (value < 0) throw new Error("Billing amounts cannot be negative");
          if (target === "rate") { const l = t.items.find(l => l.id === id); if (!l) throw new Error("Select an item"); if (!can(me, "billing.rates") && l.product_id && pmap.get(l.product_id)?.rate) throw new Error("Owner approval is required to change this price"); setLine(id, { rate: value }); }
          if (target === "packing") set({ packing: value });
          if (target === "discount") set({ discount: value, discount_pct: 0 });
        }} />}
      </Suspense>

      {custOpen && <CustomerPicker bill={b} onPick={p => { set(p); setCustOpen(false); scanRef.current?.focus(); }} onClose={() => setCustOpen(false)} />}
      {sheet && <ScanSheet onCode={onCode} onClose={() => setSheet(false)} lines={t.items.length} pcs={t.total_qty} net={t.net} last={t.items[t.items.length - 1]} />}
      {pairOpen && <PairPhone id={pairId} peers={peers} onNew={async () => { const id = Math.random().toString(36).slice(2, 10); await setSetting("remote_id", id); setPairId(id); }} onClose={() => setPairOpen(false)} />}
      {askCode && <CodePrompt onDone={ok => { setAskCode(false); if (ok) void openDocument("estimate"); }} />}
      {held && <HeldBills activeId={b.id} onPick={x => { setHeld(false); void openDocument(x.bill_type, x); }} onClose={() => setHeld(false)} />}
      {bagBill && <BagLabels bill={bagBill} onClose={() => setBagBill(null)} />}
      {printing && <PrintBill b={printing.bill} shop={shop} format={printing.fmt} onDone={() => { setPrinting(null); if (printing.bags) setBagBill(printing.bill); }} />}
    </div>
  );
}

function Payments({ pays, left, onChange }: { pays: Payment[]; left: number; onChange: (p: Payment[]) => void }) {
  const paymentInputs = useRef<HTMLDivElement>(null);
  const focusNew = useRef(false);
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    const inputs = paymentInputs.current?.querySelectorAll<HTMLInputElement>('.payment-row input[aria-label$="amount"]');
    inputs?.[inputs.length - 1]?.focus();
  }, [pays.length]);
  const paid = pays.reduce((a, p) => a + (p.mode === "credit" ? 0 : p.amount), 0);
  const rest = Math.max(0, left - paid);
  const add = (mode: Payment["mode"]) => { focusNew.current = true; onChange([...pays, { mode, amount: 0, at: new Date().toISOString() }]); };
  return (
    <div ref={paymentInputs} className="stack" style={{ gap: 4 }}>
      {pays.map((p, i) => (
        <div key={i} className="payment-row"><div className="sumrow"><span className="pill">{p.mode.toUpperCase()}</span>
          <span className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
            <MoneyInput className="cell r" aria-label={`${p.mode.toUpperCase()} payment ${i + 1} amount`} style={{ width: 90 }} paise={p.amount} onPaise={v => onChange(pays.map((x, j) => j === i ? { ...x, amount: v } : x))} />
            <DeleteButton className="x" aria-label="Remove payment" onDelete={async () => { if (await confirmDelete("Remove this payment from the bill?")) onChange(pays.filter((_, j) => j !== i)); }}>✕</DeleteButton></span></div>
          {p.mode === "upi" && <input className="in payment-recipient" aria-label={`UPI payment ${i + 1} received by`} placeholder="Received by / UPI name" value={p.recipient || ""} onChange={e => onChange(pays.map((x, j) => j === i ? { ...x, recipient: e.target.value } : x))} />}
          {!p.amount && rest > 0 && <button type="button" className="linkbtn xs" onClick={() => onChange(pays.map((x, j) => j === i ? { ...x, amount: rest } : x))}>Use balance {billAmount(rest)}</button>}
        </div>))}
      <div className="chips">{(["cash", "upi", "card", "bank"] as const).map(m => <button key={m} className="chip" onClick={() => add(m)} disabled={!rest}>+ {m.toUpperCase()}</button>)}</div>
    </div>
  );
}

function CustomerPicker({ bill, onPick, onClose }: { bill: Bill; onPick: (p: Partial<Bill>) => void; onClose: () => void }) {
  const [q, setQ] = useState(bill.party_phone || bill.party_name || "");
  const [photo, setPhoto] = useState<string | undefined>();
  const parties = useLiveQuery(() => db.parties.filter(p => !p.deleted && p.kind !== "supplier").toArray(), [], []);
  const list = useMemo(() => { const x = q.trim().toLowerCase(); return x ? parties.filter(p => (p.name + " " + p.phone + " " + p.city).toLowerCase().includes(x)).slice(0, 12) : parties.slice(0, 12); }, [q, parties]);
  const pick = (p: Party) => onPick({ party_id: p.id, party_name: p.name, party_phone: p.phone, party_gstin: p.gstin, party_state: p.state, party_address: [p.address, p.city, p.pin].filter(Boolean).join(", "), price_level: p.tier });
  const create = async () => {
    const isPhone = /^\+?\d[\d\s]{7,}$/.test(q.trim());
    const name = isPhone ? await askText("Customer name") || "" : q.trim();
    const phone = isPhone ? q.replace(/\D/g, "") : (await askText("Mobile number (for WhatsApp)", "", { numeric: true }))?.replace(/\D/g, "") || "";
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
          <button className="btn" onClick={() => onPick({ party_id: undefined, party_name: "", party_phone: "", party_gstin: "", party_state: "", party_address: "" })}>Walk-in / cash</button>
          <button className="btn" onClick={() => go("customers")}>Manage customers</button></div>
      </div>
    </Modal>
  );
}

function HeldBills({ activeId, onPick, onClose }: { activeId: string; onPick: (b: Bill) => void; onClose: () => void }) {
  const open = usePrivate();
  const list = useLiveQuery(() => db.bills.where("status").equals("hold").filter(b => b.id !== activeId && inStore(b) && !b.deleted && !b.no && (open || !isEstimate(b))).reverse().sortBy("at"), [open, activeId], []);
  return (
    <Modal title="Bills on hold" onClose={onClose}>
      <div className="stack" style={{ gap: 6 }}>
        {list.map(b => (
          <div key={b.id} className="item">
            <span className="grow"><span className="pill">{b.bill_type === "estimate" ? "Estimate" : b.bill_type === "gst" ? "Tax invoice" : "Challan"}</span> <b>{b.party_name || "Walk-in"}</b><div className="xs mut">{b.items.length} lines · {b.total_qty} pcs · {new Date(b.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</div>{b.remarks && <div className="sm" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{b.remarks}</div>}</span>
            <b className="mono">{billAmount(b.net)}</b>
            <button className="btn sm p" onClick={() => onPick(b)}>Resume</button>
            <DeleteButton className="btn sm bad" onDelete={async () => { if (await confirmDelete("Discard this held bill?")) await put("bills", { ...b, deleted: 1 }); }}>Discard</DeleteButton>
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
        <div className="row between"><span className="sm">{lines} lines · {pcs} pcs</span><b style={{ fontSize: 24 }}>{billAmount(net)}</b></div>
        <button className="btn p big" onClick={onClose}>Done — go to bill</button>
      </div>
    </div>, document.body);
}

/* Laptop / counter PC: pair a phone as the camera. */
function PairPhone({ id, peers, onNew, onClose }: { id: string; peers: number; onNew: () => void; onClose: () => void }) {
  useEffect(() => { if (!id) onNew(); }, [id]);
  const url = id ? `${publicOrigin()}/#/remote/${id}` : "";
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
