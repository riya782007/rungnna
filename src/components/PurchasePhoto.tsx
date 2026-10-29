import { entryReference } from "../lib/entry-reference";
import { DeleteButton } from "./DeleteButton";
import { SelectAll } from "./SelectAll";
import { confirmDelete } from "../lib/confirm-delete";
import { lazy, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
const BillCamera = lazy(() => import("./CustomerCamera"));
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Plus, Trash2 } from "lucide-react";
import { db, put, uid, now, getSetting, setSetting, type Product, type Purchase } from "../lib/db";
import { api, blobToB64 } from "../lib/ai";
import { compress, savePhoto } from "../lib/image";
import { getRule, costCode, type PricingRule } from "../lib/pricing";
import {
  preparePhotoRows, savePhotoPurchase, validatePhotoRows, pricePhotoRows, applyVendorTerms, repricePhotoRows, suspiciousCosts, restoreBillCosts,
  autoArticle, autoArticleCount, draftLabelProducts, combineRepeatedRows, keepRepeatsApart, byBoxes, labelCountFor, lineSignature, isSamePage, nextPageNo, continueSr, readDiscount, readMultiplier, readExtra, applyCosting, spreadExtra, costingOf, type PhotoRow,
} from "../lib/purchase-photo";
import { applyPhotoQuantities, copyLineBelow, readCount, repeatPhotoCount, stickersPerPacket, type RepeatedCountField } from "../lib/purchase-quantities";
import { purchaseLabelJobs } from "../lib/purchase-labels";
import { DEFAULT_CFG, LabelView, validateLabelPrint, loadLabelCfg, readLabelCfg, useLabelPrint, tscCommands, expandJobs, type LabelCfg, type Job } from "../pages/Labels";
import { directPrintSupported } from "../lib/tsc";
import { currentStore } from "../lib/scope";
import { toast, useApp } from "../lib/app";
import { can } from "../lib/roles";
import { PhotoButton } from "./common";
import { RackPicker } from "./RackPicker";
import { StickerQuickBar } from "./StickerQuickBar";
import { OldCodesCard } from "./OldCodesCard";
import { SupplierNo } from "./SupplierNo";
import { checkBill, checkSummary, matchSupplier, fallbackBillNo, type LineFix } from "../lib/billCheck";
import { newParty } from "../lib/billing";
import { UNITS, UNIT_RE } from "../lib/products";
import { isPdf, expandPdfs, splitPage, joinParts, srSpan, repeatedCodes } from "../lib/pdf-pages";
import { CartonPrint } from "./CartonPrint";
import { QuickLineBox, type QuickAdd } from "./QuickLineBox";
import { queueForShop, doneAtShop, useShopQueue, isPhoneLike, type RemotePrint } from "../lib/print-queue";

const blank = (pack = "1"): PhotoRow => ({ review_id: uid(), item: "", style: "", color: "", unit: "PCS", hsn: "", qty: "", pack, packSource: "default", stickers: "", cost: "", rate: "" });
const captions: Record<string, string> = { costcode: "Cost code", sr: "Bill Sr.", collection: "Collection / style", material: "Material", item: "Item", style: "Style/article", color: "Colour", unit: "Unit", entry_code: "Reference Code", hsn: "HSN", qty: "Qty", pack: "Pcs in box (X)", stickers: "Stickers", cost: "Cost ₹", rate: "Rate ₹" };
/* pack = the "X1" / "X3" after the rate on his stickers: pieces in one packet (his old software's QTY box) */
/* Owner, 24 Oct (call): the order he tallies a bill in — the bill's own serial no., item, quantity, cost, our
   rate, pieces per packet (X), stickers, colour — and the things filled once (reference code, supplier) last. */
/* Owner, 29 Oct: "the reference code should be in front — I have to shift the whole page to see it" */
const FIELDS = ["sr", "item", "style", "entry_code", "qty", "cost", "rate", "pack", "stickers", "color", "unit"] as const;
type Field = (typeof FIELDS)[number] | "collection" | "material" | "costcode";
const defaultStickers = (r: PhotoRow) => {
  const qty = Number(r.qty), pack = Number(r.pack || "1");
  return Number.isSafeInteger(qty) && qty > 0 && Number.isSafeInteger(pack) && pack > 0 ? String(Math.ceil(qty / pack)) : "";
};

type Draft = { store: string; rows: PhotoRow[]; supplier: string; billNo: string; rack: string; photoId?: string; warnings: string; total: string;
  /* owner, 24 Oct: "the discount on the goods bill is not mentioned in the bill received" — the bill's discount %,
     read from the bill or typed; it comes off every line's cost when the purchase is saved and is written on it */
  discount?: string;
  mult?: string;   // "Multiply ×" — the supplier writes his rates ÷ this (owner, 24 Oct: KALPESH ×5)
  extra?: string;  // packing / freight ₹ on this bill, spread over the lines when saved
  /* what the bill's own arithmetic said: shown so the owner checks only what is in doubt */
  check?: { summary: string; ok: boolean; fixes: LineFix[]; doubts: { line: number; why: string }[]; factor?: number };
  supplierName?: string;   // as read from the bill, for one-tap "add this supplier"
  autoBillNo?: boolean };  // the bill printed no number; one was made from its date and total

/* "Take photo" from anywhere (the AI strip on every Stock tab) opens this reader's camera: directly when the reader
   is in a box of its own (`camera`), or by event when it is already on the page (Labels, Stock in). */
export const BILL_CAMERA = "rj-bill-camera";
export function askBillCamera() { (window as any).__rjBillCamera = true; window.dispatchEvent(new Event(BILL_CAMERA)); }

/* Owner, 22 Oct ("Still not printing" — the Approve button was grey because no supplier and no rack
   were chosen, and the AI had read the shop's own letterhead "RUGUNNA JEW - DELHI" as the supplier).
   Printing now needs as little as possible: a missing supplier, rack, bill number or selling rate is
   filled in by itself at Approve, and the shop's own name is never taken as the supplier. */
export const OWN_SHOP = /R[UA]+N?G+U?N+A/i;
export const NO_SUPPLIER = "SUPPLIER NOT NAMED";
const RACK_KEY = "purchase_rack";
async function receivingRack(chosen: string): Promise<string> {
  const usable = async (id?: string) => { const l = id ? await db.locations.get(id) : undefined; return l && !l.deleted && l.kind !== "bucket" ? l.id : ""; };
  const picked = await usable(chosen) || await usable(await getSetting<string>(RACK_KEY, ""));
  if (picked) return picked;
  const store = currentStore();
  const first = await db.locations.filter(l => !l.deleted && l.kind === "rack" && (l.store_id || store) === store).first();
  if (first) return first.id;
  const recv = { id: uid(), code: "G-RECEIVING", floor: "G", rack: "IN", box: "", name: "Receiving (new stock)", kind: "rack" as const, updated_at: now() };
  await put("locations", recv as any);
  return recv.id;
}

/** Blank articles and blank selling rates filled the way the bill reader does (shop pricing). */
/** The Sr. a new line gets: one after the highest number already on the bill. */
const nextSrOf = (rows: PhotoRow[]) => String(Math.max(0, ...rows.map((r, i) => (/^\d{1,4}$/.test((r.sr || "").trim()) ? Number(r.sr) : i + 1))) + 1);
export const fillGaps = (rows: PhotoRow[], rule: PricingRule | null | undefined) => rule ? pricePhotoRows(autoArticle(rows), rule) : autoArticle(rows);

export default function PurchasePhoto({ by, camera = false, typed = false }: { by: string; camera?: boolean; typed?: boolean }) {
  /* Owner, 22 Oct: "the staff who load the stock need not see the bill's money" — whoever may not see costs
     (permission "See cost & set selling rates") gets no cost/rate columns, totals or pricing buttons here.
     "More details" adds collection/style, material and a photo per line, on this same screen. */
  const { me } = useApp();
  const money = can(me, "rates");
  const [more, setMore] = useState(false);
  /* Owner, 24 Oct (voice): "today I thought of giving the rates to a boy — he needn't see what everything costs;
     it should reach him coded". Ticked for "Set selling rates — cost shown only as code": he sets the rates and
     sees each line's cost only as the shop's cost code. */
  const coded = !money && can(me, "rates.coded");
  const lineFields: Field[] = [...FIELDS.flatMap((f): Field[] => money ? [f] : f === "rate" ? (coded ? ["costcode", "rate"] : []) : f === "cost" ? [] : [f]), ...(more ? ["collection", "material"] as Field[] : [])];
  const [d, setD] = useState<Draft>({ store: currentStore(), rows: [], supplier: "", billNo: "", rack: "", warnings: "", total: "" });
  const [photoUploads, setPhotoUploads] = useState<Set<string>>(new Set());
  /* Owner, 29 Oct: "carton by carton". When ticked, approving saves the bill (stock in once) and the stickers are
     then printed one carton at a time from the saved purchase. Remembered on this computer. */
  const [cartonMode, setCartonMode] = useState(false);
  const [showCarton, setShowCarton] = useState(false);
  useEffect(() => { void getSetting<boolean>("carton_mode", false).then(v => { setCartonMode(!!v); setShowCarton(!!v); }); }, []);
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const countFocus = useRef<HTMLInputElement | null>(null);
  // a line just added by Enter: the cursor goes to the same column on it
  const cellFocus = useRef<{ line: number; col: number } | null>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const next = countFocus.current; countFocus.current = null;
    if (next?.isConnected) { next.focus(); next.select(); }
    const cell = cellFocus.current; cellFocus.current = null;
    const tr = cell && linesRef.current?.querySelectorAll<HTMLTableRowElement>("tbody > tr")[cell.line];
    if (cell && tr) {
      const fields = gridFields(tr);
      const target = fields.find(f => f.col === cell.col) || fields.filter(f => f.col >= cell.col)[0] || fields[0];
      if (target) { focusGridCell(target.el); tr.scrollIntoView({ block: "nearest" }); }
    }
  }, [d.rows]);
  const draftRef = useRef(d); draftRef.current = d;
  const removeRows = async (ids: string[]) => {
    if (busy || lock.current) return;
    const wanted = new Set(ids), rows = draftRef.current.rows.filter(r => wanted.has(r.review_id || ""));
    if (!rows.length || !await confirmDelete("Remove " + rows.length + " purchase line(s) from this draft?")) return;
    setReviewed(false); setD(latest => ({ ...latest, rows: latest.rows.filter(r => !wanted.has(r.review_id || "")), check: undefined })); setSelection(new Set());
  };

  /* Keyboard-only movement across the bill-photo grid, so you can check an
     uploaded bill without the mouse:
       ↑ / ↓        move to the same field one line up / down
       ← / →        move to the field left / right in the same line
       Space        tick / untick the current line (select many)
       Shift+↑/↓    extend the selection over a range of lines
     ↑/↓ always move between lines (they never just move the text caret), so
     going box to box is immediate. Enter keeps its existing "copy down" job on
     the count fields. */
  const selectAnchor = useRef<string | null>(null);
  function focusGridCell(el: HTMLElement | null | undefined) {
    if (!el) return;
    el.focus();
    if (el instanceof HTMLInputElement && el.type !== "checkbox") el.select?.();
  }
  function gridFields(row: HTMLTableRowElement): { el: HTMLElement; col: number }[] {
    const out: { el: HTMLElement; col: number }[] = [];
    Array.from(row.children).forEach((td, col) => {
      const f = td.querySelector<HTMLElement>('input:not([type="checkbox"]):not([disabled]), select:not([disabled])');
      if (f) out.push({ el: f, col });
    });
    return out;
  }
  function onPurchaseGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    const key = e.key;
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " ", "Enter"].includes(key)) return;
    if (key === "Enter" && (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey || e.nativeEvent.isComposing)) return;
    const el = document.activeElement as HTMLElement | null;
    const td = el?.closest("td");
    const row = el?.closest<HTMLTableRowElement>("tr");
    const body = row?.closest("tbody");
    if (!row || !body || !el) return;
    const rows = Array.from(body.querySelectorAll<HTMLTableRowElement>(":scope > tr"));
    const idx = rows.indexOf(row);
    if (idx < 0) return;
    const ids = draftRef.current.rows.map(r => r.review_id || "");
    const isText = el.tagName === "INPUT" || el.tagName === "SELECT";
    const input = el as HTMLInputElement;
    const curCol = td ? Array.from(row.children).indexOf(td) : 0;

    const moveRow = (nextIdx: number) => {
      const next = rows[nextIdx]; if (!next) return;
      const fields = gridFields(next); if (!fields.length) return;
      const target = fields.find(f => f.col === curCol) || fields.filter(f => f.col >= curCol)[0] || fields[fields.length - 1];
      focusGridCell(target.el);
    };

    if (key === "Enter") {
      // Enter in a typed cell: down one line; on the last line, a new line copied from this one (owner, 27 Oct)
      if (el.tagName !== "INPUT" || input.type === "checkbox" || input.type === "file") return;
      e.preventDefault();
      if (e.repeat || busy || lock.current) return;
      if (idx < rows.length - 1) { moveRow(idx + 1); return; }
      cellFocus.current = { line: idx + 1, col: curCol };
      set({ rows: copyLineBelow(draftRef.current.rows, idx, uid()) });
      return;
    }
    if (key === "ArrowDown") {
      e.preventDefault();
      if (idx < rows.length - 1) moveRow(idx + 1);
      if (e.shiftKey) toggleSelRange(ids, idx + 1);
    } else if (key === "ArrowUp") {
      e.preventDefault();
      if (idx > 0) moveRow(idx - 1);
      if (e.shiftKey) toggleSelRange(ids, idx - 1);
    } else if (key === "ArrowRight") {
      const fields = gridFields(row); const here = fields.findIndex(f => f.el === el);
      if (here > -1 && here < fields.length - 1) { e.preventDefault(); focusGridCell(fields[here + 1].el); }
    } else if (key === "ArrowLeft") {
      const fields = gridFields(row); const here = fields.findIndex(f => f.el === el);
      if (here > 0) { e.preventDefault(); focusGridCell(fields[here - 1].el); }
    } else if (key === " " && (!isText || input.type === "checkbox")) {
      e.preventDefault();
      const id = ids[idx];
      setSelection(old => { const next = new Set(old); next.has(id) ? next.delete(id) : next.add(id); return next; });
      selectAnchor.current = id;
    }
  }
  function toggleSelRange(ids: string[], toIdx: number) {
    if (toIdx < 0 || toIdx >= ids.length) return;
    const anchor = selectAnchor.current ? ids.indexOf(selectAnchor.current) : toIdx;
    const [lo, hi] = [Math.min(anchor, toIdx), Math.max(anchor, toIdx)];
    setSelection(new Set(ids.slice(lo, hi + 1)));
  }
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [reviewed, setReviewed] = useState(false), [error, setError] = useState("");
  const [connection, setConnection] = useState(""), [checking, setChecking] = useState(false);
  const [probe, setProbe] = useState<{ provider: string; model: string; ok: boolean; plain: string }[] | null>(null), [probing, setProbing] = useState(false);
  /* Each AI on its own, on a tiny picture of a number: tells the owner exactly which account works */
  const testEach = async () => {
    setProbing(true); setProbe(null);
    try { setProbe((await api<{ results: any[] }>("purchase-photo", { probe: true })).results); }
    catch (e: any) { setConnection(e.message); }
    finally { setProbing(false); }
  };
  const [perPacket, setPerPacket] = useState("1");
  const [packetDefault, setPacketDefault] = useState("1"), [bulkPack, setBulkPack] = useState("1"), [bulkQty, setBulkQty] = useState(""), [bulkRef, setBulkRef] = useState("");
  const [rememberPack, setRememberPack] = useState(true), [quantityNote, setQuantityNote] = useState("");
  const [pricing, setPricing] = useState<PricingRule | null>(null);
  const [atShop, setAtShop] = useState(isPhoneLike());
  const [toolsOpen, setToolsOpen] = useState(false);
  const [already, setAlready] = useState<{ p: Purchase; labels: number; lines: number } | null>(null);
  const shopQueue = useShopQueue();
  useEffect(() => { if (!pricing) void getRule().then(setPricing).catch(() => {}); }, []);
  const onCosting = (patch: { mult?: string; discount?: string; extra?: string }) => {
    const next = { ...d, ...patch };
    if (("mult" in patch && patch.mult !== d.mult) || ("discount" in patch && patch.discount !== d.discount)) {
      const rows = applyCosting(d.rows, { mult: next.mult, less: next.discount });
      set({ ...patch, rows }); void price(rows, "Costing changed · ");
    } else set(patch);
  };
  const codeFor = (r: PhotoRow) => { const c = Math.round(Number(r.cost) * 100); return pricing && c > 0 ? costCode(c, pricing, Number(r.pack) || 1, r.unit || "PCS") : "—"; };
  const [cfg, setCfg] = useState<LabelCfg>(DEFAULT_CFG);
  const [jobs, setJobs] = useState<Job[]>([]);          // labels for the purchase just saved
  const printer = useLabelPrint(cfg, setCfg);
  const [saved, setSaved] = useState<Purchase | null>(null);
  const lock = useRef(false), file = useRef<HTMLInputElement>(null);
  /* every line the AI has read for this bill so far, pages in order, so a later page's ditto marks and the
     bill's Net are checked against the whole bill */
  const readSoFar = useRef<any[]>([]);
  const [cam, setCam] = useState(camera);
  useEffect(() => {
    const open = () => { (window as any).__rjBillCamera = false; setCam(true); };
    if ((window as any).__rjBillCamera) open();          // asked for before this reader had loaded
    window.addEventListener(BILL_CAMERA, open);
    return () => window.removeEventListener(BILL_CAMERA, open);
  }, []);
  const maker = useLiveQuery(() => db.staff.get(by), [by]);
  useEffect(() => {
    if (!ready || !maker || maker.login === "role") return;
    const code = entryReference(maker.name);
    if (!code) return;
    setD(current => current.rows.some(r => r.entry_code === undefined)
      ? { ...current, rows: current.rows.map(r => r.entry_code === undefined ? { ...r, entry_code: code } : r) }
      : current);
  }, [ready, maker, d.rows]);
  const suppliers = useLiveQuery(() => db.parties.filter(p => p.kind === "supplier" && !p.deleted).toArray(), [], []);

  useEffect(() => { void Promise.all([getSetting<Draft | null>("purchase_photo_draft", null), getSetting<string>("purchase_label_pack", "1"), getRule()]).then(async ([old, pack, rule]) => {
    const value = /^\d+$/.test(String(pack)) && Number(pack) > 0 && Number(pack) <= 10000 ? String(pack) : "1";
    setPacketDefault(value); setBulkPack(value); setPricing(rule);
    if (old?.store === currentStore()) setD({ ...old, rows: await preparePhotoRows(old.rows, old.supplier, value) });
    setReady(true);
  }).catch(e => { setError(e.message || "Could not restore the purchase draft"); setReady(true); }); }, []);
  useEffect(() => { if (ready) setSetting("purchase_photo_draft", d); }, [d, ready]);
  // Labels › "Type a bill by hand": open straight on line 1, ready to type (owner, 27 Oct)
  useEffect(() => {
    if (!typed || !ready) return;
    // a bill already being typed (or read) is kept: the cursor just goes to its last line
    if (!draftRef.current.rows.length) set({ rows: [blank(packetDefault)] });
    // the cursor goes to the one-line box: type a bill line, Enter, the next (owner, 29 Oct)
    setTimeout(() => { quickRef.current?.focus(); quickRef.current?.scrollIntoView({ block: "center" }); }, 80);
  }, [typed, ready]);
  const quickRef = useRef<HTMLInputElement>(null);
  /* A line typed in the quick box goes under the others with the next Sr.; an empty first line is replaced. */
  const addQuick = (q: QuickAdd) => {
    const rows = draftRef.current.rows;
    const emptyOnly = rows.length === 1 && !rows[0].item.trim() && !rows[0].style.trim() && !String(rows[0].qty).trim();
    const base = emptyOnly ? [] : rows;
    let row: PhotoRow = { ...blank(q.pack || packetDefault), item: q.item, style: q.style, qty: q.qty, cost: q.cost, billCost: q.cost || undefined,
      stickers: q.stickers || "", sr: nextSrOf(base), ...(q.pack ? { packSource: "manual" as const } : {}) };
    if (pricing && row.cost) row = pricePhotoRows([row], pricing)[0];
    set({ rows: [...base, row] });
    setTimeout(() => linesRef.current?.querySelector("tbody > tr:last-child")?.scrollIntoView({ block: "nearest" }), 30);
  };
  /* The purchase just approved stays here — with its labels ready to print — when you go to
     QR labels or another screen and come back, so the bill never has to be read again. */
  const LAST = "purchase_photo_last";
  const restoreSaved = async (id: string) => {
    const p = await db.purchases.get(id);
    if (!p || p.deleted || (p.store_id || currentStore()) !== currentStore()) return false;
    setSaved(p); setJobs(await jobsFor(p)); return true;
  };
  useEffect(() => { void getSetting<{ id: string } | null>(LAST, null).then(async last => { if (last?.id && !await restoreSaved(last.id)) await setSetting(LAST, null); }).catch(() => {}); }, []);
  const recent = useLiveQuery(() => db.purchases.orderBy("at").reverse().filter(p => !p.deleted && p.status === "final" && (p.store_id || currentStore()) === currentStore()).limit(6).toArray(), [saved?.id], []);
  // the same printer settings the Labels page uses, so a sticker printed here is that sticker
  useEffect(() => { void loadLabelCfg().catch(() => {}); }, []);   // saves an upgraded copy once, outside the live query
  const deviceCfg = useLiveQuery(() => readLabelCfg(), []);
  useEffect(() => { if (deviceCfg) setCfg(deviceCfg); }, [deviceCfg]);

  /* the two "apply" buttons confirm in green that they did something (owner, 18 Oct) */
  const [done, setDone] = useState<{ pricing?: string; pricingSig?: string; terms?: string }>({});
  const set = (patch: Partial<Draft>) => { setReviewed(false); if (patch.rows) setError(""); setD(x => ({ ...x, ...patch, ...(patch.rows && !("check" in patch) ? { check: undefined } : {}) })); };
  const row = (i: number, key: Field, value: string) =>
    set({ rows: d.rows.map((r, k) => k === i ? { ...r, [key]: value, ...(key === "style" ? { autoStyle: false } : {}), ...(key === "pack" ? { packSource: "manual" as const } : {}), ...(["item", "unit"].includes(key) ? { item_code: undefined } : {}) } : r) });

  useEffect(() => { void check(); }, []);
  const check = async () => {
    setChecking(true);
    try {
      const r = await api<{ configured: boolean; provider: string; model: string; keys: Record<string, boolean> }>("purchase-photo");
      setConnection(r.configured
        ? `Ready · tries ${r.provider}${r.model ? " (" + r.model + ")" : ""}`
        : "No AI key can read a bill yet. Add OPENAI_API_KEY or GEMINI_API_KEY in Vercel → Environment Variables, then redeploy.");
    }
    catch (e: any) { setConnection(e.message); } finally { setChecking(false); }
  };

  /* Owner, 22 Oct (voice note): "I scanned a bill with AI, it had more lines but it took only 15 —
     when all the pictures were scanned, only 15 items came." "Photo of another page" READ the new page
     in place of the first one, so page 1's lines disappeared. Now a page read while a bill is open is
     ADDED below its lines, and more than three photos are read three at a time. The bill's own serial
     numbers carry on from page to page; lines without one are numbered on after the last line. */
  const read = async (picked: File[]) => {
    if (!picked.length || lock.current) return;
    let files = picked;
    if (picked.some(isPdf)) {
      try { toast("Opening the PDF…"); files = await expandPdfs(picked); }
      catch (e: any) { return setError("Could not open this PDF: " + (e?.message || "it may be damaged or password-protected") + ". Take a photo of the page instead."); }
    }
    if (files.length > 12) return setError("Choose up to twelve pages of one bill");
    if (!(await getSetting<boolean>("bill_ai_ok", false))) {
      if (!confirm("Bill photos are sent to the AI (OpenAI, then Gemini, then Groq) to be read. Nothing is saved until you approve.\n\nAllow this from now on, on this device?")) return;
      await setSetting("bill_ai_ok", true);
    }
    const adding = d.rows.length > 0;
    lock.current = true; setBusy(true); setError(""); setJobs([]); setSaved(null);
    if (!adding) { setBulkQty(""); setBulkRef(""); setQuantityNote(""); readSoFar.current = []; }
    try {
      let current = adding ? d : { ...d, rows: [] as PhotoRow[], warnings: "", total: "" };
      /* One page per reading, sharper photos, and a page read short is read again (owner, 23 Oct: "a bill of
         30 lines reads only 15 or 20; Google Lens reads every line"). */
      for (let at = 0; at < files.length; at += 1) {
        const part = files.slice(at, at + 1);
        const images = [];
        for (const f of part) { const { blob } = await compress(f, 2800, 1050000); images.push({ data: await blobToB64(blob), mime: blob.type }); }
        if (files.length > 1) toast(`Reading page ${at + 1} of ${files.length}…`);
        let out = await api<any>("purchase-photo", { images });
        const rowsOf = (x: any): any[] => (Array.isArray(x?.rows) ? x.rows : []);
        let seen = Math.max(Number(out?.lines_on_bill) || 0, srSpan(rowsOf(out)));
        const first = rowsOf(out).length;
        if (seen > first) {
          toast(`The AI read ${first} of about ${seen} lines — reading the page again…`);
          const second = await api<any>("purchase-photo", { images, retry: { counted: seen, got: first } }).catch(() => null);
          if (second && rowsOf(second).length > first) out = second;
          seen = Math.max(seen, Number(second?.lines_on_bill) || 0, srSpan(rowsOf(second)));
          /* still short (owner, 24 Oct: "the bill was 25 lines, it read 18"): cut the page into strips of about 8
             lines each, read them all at once, and put the lines together by their bill Sr. numbers */
          const got = rowsOf(out).length;
          if (got < seen && part.length === 1) {
            const n = Math.min(5, Math.max(2, Math.ceil(seen / 8)));
            toast(`Still ${got} of ${seen} lines — reading the page in ${n} parts…`);
            const strips = await splitPage(part[0], n).catch(() => null);
            if (strips) {
              const whole = await compress(part[0], 1600, 420000);
              const page = { data: await blobToB64(whole.blob), mime: whole.blob.type };
              const reads = await Promise.all(strips.map(async (h, k) => { const { blob } = await compress(h, 2400, 800000); return api<any>("purchase-photo", { images: [page, { data: await blobToB64(blob), mime: blob.type }], part: { k: k + 1, n: strips.length } }).catch(() => null); }));
              const joined = joinParts([rowsOf(out), ...reads.map(rowsOf)]);
              if (joined.length > got) out = { ...out, rows: joined, invoice_total: out.invoice_total || reads.map(x => x?.invoice_total).filter(Boolean).pop(), lines_on_bill: String(seen) };
            }
          }
        }
        const rule = await getRule(); setPricing(rule);
        const text = (v: unknown) => (typeof v === "string" || typeof v === "number" ? String(v) : "");
        const raw = out.rows.map((r: any) => ({
          item: text(r.item), style: text(r.style), color: text(r.color), unit: text(r.unit) || "PCS",
          hsn: text(r.hsn), qty: readCount(r.qty), pack: text(r.pack),
          cost: text(r.cost), rate: text(r.rate), amount: text(r.amount), box: text(r.box),
          sr: text(r.sr).trim().replace(/\s+/g, "").slice(0, 9).replace(/[^0-9A-Za-z+\-/]/g, ""),
        }));
        const before = readSoFar.current.length;
        readSoFar.current = [...readSoFar.current, ...raw];
        const total = text(out.invoice_total) || current.total || "";
        // the bill checked against itself (all pages so far): ditto marks written out, each line's amount, the Net
        const checked = checkBill(readSoFar.current, total);
        // keep the bill's own cost on each line; a "selling rate" equal to the cost is just the supplier's price
        // read twice (owner's bill, 18 Oct: rate 170 = cost 170), so it is left for shop pricing to fill
        const read: PhotoRow[] = checked.rows.slice(before).map(({ amount: _a, box, ...r }) => ({ ...r, ...byBoxes(box, r.qty, r.pack), billCost: r.cost, rate: r.rate && Number(r.rate) === Number(r.cost) ? "" : r.rate }));
        // bills that print no article get one built from item + rate, so the lines neither collide nor merge
        const readName = OWN_SHOP.test(text(out.supplier)) ? "" : text(out.supplier).trim();
        const supplier = current.supplier || matchSupplier(readName, suppliers)?.id || "";
        // this bill's costing (multiply / less %): read from the bill, kept for its next pages
        const costing = {
          mult: current.mult || (checked.factor ? String(checked.factor) : readMultiplier(out)),
          discount: current.discount || readDiscount(out, readSoFar.current.map(r => ({ qty: String(r.qty), cost: String(r.cost) }))),
          extra: current.extra || readExtra(out),
        };
        const rows = await preparePhotoRows(pricePhotoRows(autoArticle(applyCosting(read, { mult: costing.mult, less: costing.discount })), rule), supplier, packetDefault);
        const readBy = out.read_by ? String(out.read_by) : "";
        const fellBack = Array.isArray(out.attempts) && out.attempts.some((a: any) => a && a.ok === false && !a.skipped);
        const supplierName = current.supplierName || readName;
        const printedNo = text(out.bill_no).trim();
        const counted = Number(text(out.lines_on_bill)) || 0;
        const keepNo = !!current.billNo && !current.autoBillNo;
        current = {
          ...current,
          rows: [...current.rows, ...rows], supplier, supplierName, total,
          ...costing,
          billNo: keepNo ? current.billNo : printedNo || fallbackBillNo(text(out.bill_date), checked.net),
          autoBillNo: keepNo ? false : !printedNo,
          check: { summary: checkSummary(checked), ok: checked.addsUp === true && !checked.doubts.length, fixes: checked.fixes, doubts: checked.doubts, ...(checked.factor ? { factor: checked.factor } : {}) },
          warnings: [
            current.warnings,
            // owner, 29 Oct: "remove unnecessary text". Only what he must act on: the supplier/buyer chatter and the
            // box-column note are dropped; a missing Sr. is named above the lines, where it can be added with one tap
            ...(Array.isArray(out.warnings) ? out.warnings.map(String).filter((w: string) => w.trim() && !/supplier|buyer|letterhead|box\/packet|packet count/i.test(w)) : []),
            counted > raw.length && !srSpan(raw) ? `Read ${raw.length} of ${counted} lines — add the missing ones with + Line.` : "",
            fellBack && readBy ? `Read by the backup AI (${readBy}) — ${whyFellBack(out.attempts)}. Check the codes and quantities.` : "",
          ].filter(Boolean).join("\n"),
          photoId: current.photoId || await savePhoto(files[0]),
        };
        set(current);
        if (adding || at > 0) toast(`Page added: ${rows.length} more line${rows.length === 1 ? "" : "s"} — this bill now has ${current.rows.length}`);
      }
      if (!adding) setDone({});   // a new bill: nothing has been applied to it yet
    } catch (e: any) { setError(e.message); } finally { lock.current = false; setBusy(false); }
  };

  /* the two "apply" buttons say plainly, in green, that they did something (owner, 18 Oct) */
  const costSig = (rows: PhotoRow[]) => rows.map(r => r.cost + "|" + r.unit).join(";");
  const price = async (rowsIn = d.rows, note = "") => {
    try {
      const rule = await getRule(); setPricing(rule);
      // fill any still-blank article the same way the bill reader does, so a hand-typed line
      // behaves exactly like a read one
      const { rows, priced } = repricePhotoRows(autoArticle(rowsIn), rule);
      set({ rows });
      const how = rule.margin.mode === "percent" ? `+${rule.margin.percent}%` : `${rule.margin.mode === "divide" ? "÷" : "×"}${rule.margin.factor}`;
      setDone(x => ({ ...x, pricing: `${note}Shop pricing applied: ${priced} line${priced === 1 ? "" : "s"} priced (${how}, even rates)`, pricingSig: costSig(rows) }));
    } catch (e: any) { setError(e.message); }
  };
  const applyTerms = (v: NonNullable<typeof vendor>) => {
    const todo = d.rows.filter(r => !r.termsDone).length;
    const terms = [(v.rate_divisor || 1) !== 1 ? `cost ÷ ${v.rate_divisor}` : "", v.less_pct ? `${v.less_pct}% less` : ""].filter(Boolean).join(", ");
    setDone(x => ({ ...x, terms: `Vendor terms applied: ${terms} on ${todo} line${todo === 1 ? "" : "s"}` }));
    // the rates were worked out from the old cost: work them out again from the new one
    void price(applyVendorTerms(d.rows, v), `${terms} done · `);
  };

  /* Build the labels for a purchase exactly as the Labels page would. */
  const jobsFor = async (p: Purchase) => {
    const products = await db.products.bulkGet(p.items.map(l => l.product_id));
    return purchaseLabelJobs(p, products.filter((x): x is Product => !!x));
  };

  const sendToPrinter = async (queue: Job[], prompt: boolean) => {
    if (!queue.length) return "none";
    // Printer settings can change while this embedded reader remains mounted.
    // Always snapshot the latest device setup at the actual print click.
    const current = await loadLabelCfg();
    setCfg(current);
    validateLabelPrint(current, queue);
    const direct = current.output === "tspl" && directPrintSupported() && current.mode === "roll" && current.cols === 1;
    const list = expandJobs(queue);
    if (direct) tscCommands(current, list.slice(0, 1));
    let result = printer.start(list, direct, prompt, current);
    // direct/QZ printer not ready (no printer chosen, not connected): print through the normal
    // print window instead, so the stickers still come out today
    if (!result.started && !result.cancelled && (direct || current.output === "qz")) {
      const viaBrowser = { ...current, output: "browser" as const };
      result = printer.start(list, false, prompt, viaBrowser);
      if (result.started) { toast("Direct printer not ready — opening the print window instead", true); return "browser"; }
    }
    if (!result.started) throw new Error(result.message);
    return current.output === "qz" ? "qz" : direct ? "tsc" : "browser";
  };

  /* THE one approval: drafts the products, records the purchase, and sends the labels — one press. */
  const approve = async () => {
    if (photoUploads.size) return;
    if (lock.current) return;
    lock.current = true; setBusy(true); setError("");
    let savedPurchase: Purchase | null = null;
    try {
      // fill in what was left blank, so the stickers print
      const rule0 = await getRule();
      let supplierId = d.supplier;
      if (!supplierId) {
        const name = (d.supplierName || "").trim().toUpperCase();
        const want = name && !OWN_SHOP.test(name) ? name : NO_SUPPLIER;
        const found = matchSupplier(want, suppliers) || suppliers.find(x => x.name.trim().toUpperCase() === want);
        if (found) supplierId = found.id;
        else { const sup = { ...newParty(want), kind: "supplier" as const }; await put("parties", sup); supplierId = sup.id; }
      }
      const rackId = await receivingRack(d.rack);
      await setSetting(RACK_KEY, rackId);
      // date AND time, so two un-numbered bills on one day never look like the same bill
      const billNoIn = d.billNo.trim() || `EST ${new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", "")}`;
      const filled = continueSr(fillGaps(d.rows, rule0));
      set({ supplier: supplierId, rack: rackId, billNo: billNoIn, rows: filled });
      const D = { ...d, supplier: supplierId, rack: rackId, billNo: billNoIn };
      // a bill listing the same article twice: add identical lines together instead of refusing
      let merged = combineRepeatedRows(filled);
      if (merged.conflict) {
        const apart = keepRepeatsApart(filled);
        if (!confirm(`${merged.conflict.replace(/ One code is probably misread.*$/, "")}\n\nOK — they really are different: keep both (${apart.renamed.map(x => `Sr. ${x.sr} prints as ${x.to}`).join(", ")}).\nCancel — let me correct the code first.`)) throw new Error(merged.conflict);
        set({ rows: apart.rows });
        merged = combineRepeatedRows(apart.rows);
      }
      if (merged.combined) { set({ rows: merged.rows }); toast(`${merged.combined} repeated line${merged.combined === 1 ? "" : "s"} added together`); }
      const cst = costingOf({ mult: d.mult, less: d.discount, extra: d.extra }), pct = cst.less;
      const rows = await preparePhotoRows(cst.extra ? spreadExtra(merged.rows, cst.extra) : merged.rows, D.supplier, packetDefault);
      const rule = await getRule(), current = await loadLabelCfg();
      const checked = validatePhotoRows(rows), products = draftLabelProducts(rows, by, rule, rows.length);
      const preflight = checked.flatMap((r, i) => {
        const copies = r.print_qty ?? Math.ceil(r.qty / r.pack);
        return copies ? [{ p: products[i], qtyOnLabel: r.pack, copies, line: r.sr?.trim() || i + 1 }] : [];
      });
      if (preflight.length) validateLabelPrint(current, preflight);
      // the same supplier bill was saved before: don't save it twice, print its labels again
      const billNo = D.billNo.trim().toUpperCase();
      const pages = await db.purchases.filter(x => !x.deleted && x.status === "final" && x.supplier_id === D.supplier && (x.supplier_bill.trim().toUpperCase() === billNo || x.supplier_bill.trim().toUpperCase().startsWith(billNo + " P"))).toArray();
      /* Owner, 25 Oct: "it goes to print by itself". Lines of this bill already saved (on any page) are never
         saved or printed again: only the new lines become the next page. When every line is already saved, nothing
         prints by itself — he chooses to print that bill's stickers again, or to clear the screen. */
      const savedKey = (l: { style: string; color?: string; qty: number }) => [l.style.trim().toUpperCase(), (l.color || "").trim().toUpperCase(), l.qty].join("|");
      const have = new Set(pages.flatMap(x => x.items).map(savedKey));
      const freshIdx = checked.map((r, i) => (have.has(savedKey(r)) ? -1 : i)).filter(i => i >= 0);
      const before = pages.length && !freshIdx.length ? pages[pages.length - 1] : undefined;
      if (before) {
        const queue = await jobsFor(before);
        setAlready({ p: before, labels: expandJobs(queue).length, lines: checked.length });
        toast(`All ${checked.length} lines of bill ${D.billNo} are already saved (${before.no}) — nothing printed`);
        return;
      }
      let saveRows = rows;
      if (pages.length) {
        const skipped = checked.length - freshIdx.length;
        saveRows = freshIdx.map(i => rows[i]);
        D.billNo = nextPageNo(D.billNo, pages.map(x => x.supplier_bill)); set({ billNo: D.billNo });
        toast(skipped ? `${skipped} line${skipped === 1 ? " was" : "s were"} already saved on ${pages.map(x => x.no).join(", ")} — saving the other ${freshIdx.length} as ${D.billNo}` : `Next page of bill ${billNo} — saved as ${D.billNo}`);
      }
      // the same lines saved recently under another bill no. or supplier: print those stickers again rather
      // than adding the stock and the supplier's amount a second time
      const sig = lineSignature(checked.map(r => ({ style: r.style, color: r.color, qty: r.qty, cost: r.cost })));
      const since = new Date(Date.now() - 30 * 86400000).toISOString();
      const twin = pages.length ? undefined : await db.purchases.filter(x => !x.deleted && x.status === "final" && (x.store_id || currentStore()) === currentStore() && x.at >= since
        && x.items.length === checked.length && lineSignature(x.items.map(l => ({ style: l.style, color: l.color, qty: l.qty, cost: l.cost }))) === sig).last();
      if (twin && confirm(`This looks like ${twin.no}, saved ${new Date(twin.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}${twin.supplier_name ? " · " + twin.supplier_name : ""} · bill ${twin.supplier_bill}: the same ${checked.length} line${checked.length === 1 ? "" : "s"} and pieces.\n\nOK — print its stickers again (stock is NOT added again).\nCancel — it is a different bill: save it as a new purchase.`)) {
        const queue = await jobsFor(twin);
        setSaved(twin); setJobs(queue); await setSetting(LAST, { id: twin.id });
        if (!queue.length) { toast(`${twin.no} has no stickers`); return; }
        const how = await sendToPrinter(queue, true);
        toast(`${twin.no} · ${how === "browser" ? "opening its labels to print" : "printing its labels again"} · stock not added again`);
        return;
      }
      const p = await savePhotoPurchase(saveRows, { by, rack: D.rack, supplierId: D.supplier, billNo: D.billNo, photoId: d.photoId, invoiceTotal: d.total, note: [cst.mult !== 1 || pct || cst.extra ? `Bill costing: printed rate${cst.mult !== 1 ? ` × ${cst.mult}` : ""}${pct ? ` − ${pct}% less` : ""}${cst.extra ? ` + ₹${cst.extra} packing/freight spread over the lines` : ""}` : "", d.warnings, d.total ? "Supplier invoice total (as printed): " + d.total : ""].filter(Boolean).join("\n") });
      savedPurchase = p;
      setSaved(p); setBulkQty(""); setBulkRef(""); setQuantityNote("");
      await setSetting(LAST, { id: p.id });
      // Financial saving succeeded. Any subsequent print failure is recovered
      // by printing this saved purchase, never by approving it a second time.
      set({ rows: [], supplier: D.supplier, billNo: "", total: "", discount: "", mult: "", extra: "", warnings: "", photoId: undefined });
      setReviewed(false);
      const queue = await jobsFor(p);
      setJobs(queue);
      if (atShop) {
        await queueForShop(p, me?.name || "", expandJobs(queue).length);
        toast(`Purchase ${p.no} saved · ${expandJobs(queue).length} stickers will print at the shop computer`);
        return;
      }
      if (cartonMode) { setShowCarton(true); toast(`Purchase ${p.no} saved · type the Sr. of the first carton's lines and press Enter`); return; }
      const how = await sendToPrinter(queue, true);
      toast(how === "none" ? `Purchase ${p.no} saved · no stickers requested` : how === "browser" ? `Purchase ${p.no} saved · opening the label print window` : `Purchase ${p.no} saved · starting label printing`);
    } catch (e: any) {
      // the purchase may already be saved; say so rather than inviting a second save
      setError(savedPurchase ? `${e.message}\nPurchase ${savedPurchase.no} is saved. Use “Print all stickers” after fixing the printer setting; do not approve the bill again.` : e.message);
    } finally { lock.current = false; setBusy(false); }
  };

  const printRemote = async (q: RemotePrint) => {
    setError("");
    try {
      const p = await db.purchases.get(q.id);
      if (!p || p.deleted) { await doneAtShop(q.id); return toast(`${q.no} is not on this computer (deleted, or not synced yet)`, true); }
      const queue = await jobsFor(p);
      if (!queue.length) { await doneAtShop(q.id); return toast(`${q.no} has no stickers`, true); }
      setSaved(p); setJobs(queue);
      await sendToPrinter(queue, true);
      await doneAtShop(q.id);
    } catch (e: any) { setError(e.message || "Printing did not start. Check the printer settings."); }
  };
  // a computer with a direct label printer prints phone-sent stickers by itself (nothing to click)
  const autoDone = useRef(new Set<string>());
  useEffect(() => {
    if (isPhoneLike() || printer.busy || !shopQueue.length || !(cfg.output === "tspl" || cfg.output === "qz")) return;
    const q = shopQueue.find(x => !autoDone.current.has(x.id)); if (!q) return;
    autoDone.current.add(q.id); void printRemote(q);
  }, [shopQueue.length, printer.busy, cfg.output]);
  const reprint = async () => {
    if (!jobs.length) return;
    setError("");
    try { await sendToPrinter(jobs, true); }
    catch (e: any) { setError(e.message || "Printing did not start. Check the printer settings."); }
  };


  const applyQuantities = async () => {
    try {
      const rows = applyPhotoQuantities(d.rows, bulkQty, bulkPack);
      if (rememberPack && bulkPack.trim()) {
        const value = rows[0].pack!;
        await setSetting("purchase_label_pack", value); setPacketDefault(value);
      }
      set({ rows }); setError("");
      setQuantityNote(rows.length + " lines updated" + (bulkQty.trim() ? " · total quantity " + rows[0].qty + " each" : " · bill quantities kept") + (bulkPack.trim() ? " · X" + rows[0].pack + " per packet" : "") + (rememberPack && bulkPack.trim() ? " · packet default saved" : ""));
    } catch (e: any) { setError(e.message); }
  };
  const legacyGroups = [...new Map(d.rows.filter(r => r.item.trim()).map(r => [r.item.trim().toUpperCase() + "|" + r.unit.trim().toUpperCase(), r])).values()];
  const legacyMissing = cfg.format === "shop" && d.rows.some(r => r.stickers?.trim() !== "0" && !r.item_code?.trim());

  const vendor = suppliers.find(s => s.id === d.supplier);
  const lowCost = suspiciousCosts(d.rows);
  /* Owner, 29 Oct: "it keeps saying lines 8 and 10 are the same article". A code on two lines is shown the moment
     the bill is read, on the lines themselves, by the Sr. he sees — so it is corrected before approving, not after. */
  const repeats = useMemo(() => repeatedCodes(d.rows), [d.rows]);
  const repeatedRow = (r: PhotoRow) => { const s = (r.style || "").trim().toUpperCase(); return !!s && repeats.some(x => x.style === s); };
  /* Owner, 29 Oct: "pieces came out 1-1 although the bill says everything". When the packet size was not read and
     almost every line's quantity is a whole number of 12s (or 6s, 24s…), one tap sets the boxes for all of them. */
  const boxGuess = useMemo(() => {
    const open = d.rows.filter(r => Number(r.qty) > 0 && (!r.pack || r.pack === "1") && r.packSource !== "manual" && r.packSource !== "bill");
    if (open.length < 3 || open.length < d.rows.length * 0.6) return 0;
    for (const c of [12, 24, 6, 10, 36]) if (open.filter(r => Number(r.qty) % c === 0).length >= open.length * 0.8) return c;
    return 0;
  }, [d.rows]);
  const missingSr = useMemo(() => {
    const ns = d.rows.map(r => /^\d{1,4}$/.test((r.sr || "").trim()) ? Number(r.sr) : NaN).filter(Number.isFinite);
    if (ns.length < 3 || ns.length < d.rows.length * 0.8) return [] as number[];
    const have = new Set(ns), lo = Math.min(...ns), hi = Math.max(...ns), gone: number[] = [];
    for (let n = lo; n <= hi && gone.length <= 12; n++) if (!have.has(n)) gone.push(n);
    return gone.length <= 12 ? gone : [];
  }, [d.rows]);
  const invented = autoArticleCount(d.rows);
  let total = "—", labelCount = 0, validation = "";
  try {
    const rows = validatePhotoRows(fillGaps(d.rows, pricing));
    total = (rows.reduce((n, r) => n + r.qty * r.cost, 0) / 100).toFixed(2);
    labelCount = labelCountFor(rows);
    if (labelCount > 5000) validation = "More than 5000 labels: reduce stickers or split this purchase into smaller batches.";
  } catch (e: any) { validation = e.message; }

  const preview = useMemo(
    // the preview shows what Approve will print, blank rates already worked out by shop pricing
    () => (pricing && d.rows.length ? draftLabelProducts(fillGaps(d.rows, pricing), by, pricing) : []),
    [d.rows, pricing, by]);

  const ready4 = !busy && !validation;
  const legacyCount = cfg.format === "shop" ? d.rows.filter(r => r.stickers?.trim() !== "0" && !r.item_code?.trim()).length : 0;
  /* a grey button with no reason sends the owner hunting: say exactly what is still missing */
  const missing = [validation && validation.replace(/\.$/, "").replace(/^./, c => c.toLowerCase())].filter(Boolean) as string[];
  /* what Approve will fill in by itself, said plainly so nothing is a surprise */
  const autoFill = [
    !d.supplier && `supplier: ${d.supplierName && !OWN_SHOP.test(d.supplierName) ? d.supplierName.trim().toUpperCase() : NO_SUPPLIER}`,
    !d.rack && "rack: the last one used (or Receiving)",
    !d.billNo.trim() && "bill no.: today's date",
    d.rows.some(r => !r.rate.trim()) && "selling rates: shop pricing",
  ].filter(Boolean) as string[];

  const notReady = !!connection && !connection.startsWith("Ready");
  return <section className="purchase-photo stack" aria-busy={!ready || busy} onKeyDown={e => {
    // Ctrl+Enter anywhere on the bill: approve and print every line's stickers in one go (owner, 27 Oct)
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey) || e.repeat || !d.rows.length) return;
    e.preventDefault();
    if (ready4 && !photoUploads.size) void approve(); else if (missing.length) toast("To approve: " + missing.join(" · "), true);
  }}>
    {!d.rows.length && <div className="bill-drop stack">
      <button className="btn p bill-drop-btn" disabled={busy} onClick={() => setCam(true)}>
        <Camera size={22} />{busy ? "Reading the bill…" : "Take photo of the bill"}</button>
      <button className="linkbtn" disabled={busy} onClick={() => file.current?.click()}>or upload a photo or PDF of the bill</button>
      <div className="xs mut">Up to 3 pages of one bill. Then check what is highlighted, and approve: the products are drafted and the labels print.</div>
      <div className="row xs" style={{ justifyContent: "center", gap: 14 }}>
        <span className={notReady ? "bad-text" : "mut"}>{checking ? "Checking the AI…" : connection || ""}</span>
        <button className="linkbtn" disabled={busy || probing} onClick={testEach}>{probing ? "Testing…" : "Test each AI"}</button>
        <button className="linkbtn" disabled={busy} onClick={() => { set({ rows: [blank(packetDefault)] }); setTimeout(() => quickRef.current?.focus(), 80); }}>Type the lines instead</button>
      </div>
      {probe && <div className="note sm ai-probe" role="status" style={{ textAlign: "left" }}>
        {probe.map(r => <div key={r.provider}><b className={r.ok ? "ok-text" : "bad-text"}>{r.ok ? "✓" : "✗"}</b> {r.plain} <span className="xs mut mono">{r.model}</span></div>)}
        <div className="xs mut">{probe.some(r => r.ok) ? "Bills are read by the first working AI, in this order." : "No AI can read a bill right now: fix one of the accounts above."}</div>
      </div>}
    </div>}
    {!!d.rows.length && <div className="row"><b className="grow">{(d.supplierName && !OWN_SHOP.test(d.supplierName) && d.supplierName) || "Purchase bill"}{d.billNo ? <span className="xs mut"> · {d.billNo}</span> : null}</b>
      <button className="btn sm" disabled={busy} onClick={() => setCam(true)}><Camera size={15} />Add next page</button>
      <button className="btn sm" disabled={busy} title="Adds a blank line at the top" onClick={() => {
        set({ rows: [blank(packetDefault), ...d.rows] });
        setTimeout(() => (document.querySelector('input[aria-label="item line 1"]') as HTMLInputElement | null)?.focus(), 50);
      }}><Plus size={15} />Line</button>
      <button type="button" className="linkbtn" disabled={busy} onClick={async () => {
        if (busy || lock.current || !await confirmDelete("Clear this bill and start again? Nothing has been saved.")) return;
        set({ rows: [], supplier: "", billNo: "", total: "", discount: "", mult: "", extra: "", warnings: "", check: undefined, supplierName: "", photoId: undefined, autoBillNo: undefined });
        readSoFar.current = [];
        setDone({}); setSelection(new Set()); setError("");
        setBulkQty(""); setBulkPack(packetDefault); setBulkRef(""); setQuantityNote("");
      }}>Start over</button></div>}
    <input ref={file} type="file" hidden accept="image/jpeg,image/png,image/webp,application/pdf,.pdf" multiple onChange={e => { void read(Array.from(e.target.files || [])); e.target.value = ""; }} />
    {busy && !!d.rows.length && <div role="status">Working…</div>}
    {cam && <Suspense fallback={<div role="status">Opening camera…</div>}>
      <BillCamera title="Photo of the purchase bill" facing="environment" settingKey="bill_camera" onClose={() => setCam(false)}
        onBlob={b => void read([new File([b], `bill-${Date.now()}.jpg`, { type: "image/jpeg" })])} />
    </Suspense>}

    {!isPhoneLike() && !!shopQueue.length && <div className="note stack remote-prints" role="status" style={{ gap: 6 }}>
      <b>Stickers sent from a phone</b>
      {shopQueue.map(q => <div key={q.id} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <span className="grow">{q.no}{q.supplier ? " · " + q.supplier : ""} · {q.labels} sticker{q.labels === 1 ? "" : "s"} · from {q.by || "phone"}, {new Date(q.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>
        <button className="btn p sm" disabled={printer.busy} onClick={() => void printRemote(q)}>Print now</button>
        <button className="linkbtn" onClick={() => void doneAtShop(q.id)}>Remove</button>
      </div>)}
    </div>}
    {saved && !d.rows.length && <div className="note stack saved-purchase" role="status" style={{ gap: 8 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <b className="grow">Purchase {saved.no} saved{saved.supplier_name ? " · " + saved.supplier_name : ""} · {expandJobs(jobs).length} label{expandJobs(jobs).length === 1 ? "" : "s"} ready</b>
        {!!jobs.length && <button className={"btn" + (showCarton ? "" : " p")} disabled={printer.busy} onClick={reprint}>Print all {expandJobs(jobs).length} stickers</button>}
        {!!jobs.length && <button className={"btn" + (showCarton ? " p" : "")} onClick={() => setShowCarton(v => !v)}>{showCarton ? "Hide cartons" : "Carton by carton"}</button>}
        <a className="btn" href={"#/labels/purchase/" + saved.id}>Open in QR labels</a>
        <button type="button" className="linkbtn" onClick={() => { setSaved(null); setJobs([]); void setSetting(LAST, null); }}>Close</button>
      </div>
      <StickerQuickBar cfg={cfg} onChange={setCfg} />
      {showCarton && !!jobs.length
        ? <CartonPrint purchase={saved} jobs={jobs} busy={printer.busy} print={async q => { setError(""); await sendToPrinter(q, true); }} />
        : <>
          <div className="xs mut">Stays here until you close it. Printing again never adds stock again.</div>
          <div className="tw"><table className="pos-t"><thead><tr><th>Item</th><th>Style</th><th>Colour</th><th className="r">Qty</th><th className="r">Rate</th></tr></thead><tbody>
            {saved.items.map((l, i) => <tr key={i}><td>{l.item}</td><td className="mono">{l.style}</td><td>{l.color}</td><td className="r">{l.pack > 1 ? l.pkts * l.pack : l.qty}</td><td className="r">{l.rate ? (l.rate / 100).toFixed(2) : "—"}</td></tr>)}
          </tbody></table></div>
        </>}
    </div>}
    {!d.rows.length && !saved && <details className="note" open>
      <summary><b>Sticker settings</b> <span className="xs mut">— what prints on each sticker, its position and text size. Saved on this computer.</span></summary>
      <StickerQuickBar cfg={cfg} onChange={setCfg} />
    </details>}
    {!d.rows.length && recent.filter(p => p.id !== saved?.id).length > 0 && <details className="note">
      <summary><b>Recent purchases</b> <span className="xs mut">— print their labels again without re-reading the bill</span></summary>
      <div className="stack" style={{ gap: 6, marginTop: 6 }}>{recent.filter(p => p.id !== saved?.id).map(p => <div key={p.id} className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <span className="grow sm"><b>{p.no}</b> · {p.supplier_name || "Supplier"} · {p.total_qty} pcs · {new Date(p.at).toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}</span>
        <button className="btn sm" onClick={async () => { if (await restoreSaved(p.id)) await setSetting(LAST, { id: p.id }); }}>Show &amp; print labels</button>
        <a className="btn sm" href={"#/labels/purchase/" + p.id}>Open in QR labels</a>
      </div>)}</div>
    </details>}

    {!!d.rows.length && <>
      {/* Sticker settings and the sticker preview sit at the TOP of the bill (owner, 22 Oct): under a long
          bill they were below every line, so he scrolled past 20+ lines and thought they had been removed. */}
      <div className="stack sticker-top">
        <StickerQuickBar cfg={cfg} onChange={setCfg} />
        {cfg.format !== "rungnna" && <OldCodesCard names={d.rows.map(r => r.item)} open={false} />}
        {!!preview.length && <>
          <div className="row"><b>{labelCount} labels</b><span className="xs mut">{cfg.w}×{cfg.h}mm · {cfg.output === "tspl" && directPrintSupported() ? "straight to the TSC printer" : "browser print sheet"}</span></div>
          <div className="label-preview">{preview.map((p, i) => <LabelView key={i} cfg={cfg} p={p} qtyOnLabel={p.pack || 1} line={d.rows[i]?.sr?.trim() || i + 1} />)}
            {d.rows.length > preview.length && <span className="xs mut">+{d.rows.length - preview.length} more designs</span>}</div>
        </>}
      </div>
      {d.check && <div className={"note " + (d.check.ok ? "ok" : "warn")} role="status">
        <b>{d.check.ok ? "✓ " : ""}{d.check.summary}</b>
        {d.check.fixes.map(f => <div key={"f" + f.line} className="sm">Line {f.line}: {f.field === "qty" ? "quantity" : "cost"} read as {f.from}, set to <b>{f.to}</b>, because {f.why}.</div>)}
        {d.check.doubts.map(x => <div key={"d" + x.line} className="sm">Line {x.line}: {x.why}. Check it against the bill.</div>)}
      </div>}
      <div className="grid g3">
        <div className="f"><SupplierNo suppliers={suppliers} id={d.supplier} onPick={s => set({ supplier: s?.id || "" })} />
          {!d.supplier && !!d.supplierName && !OWN_SHOP.test(d.supplierName) && <button type="button" className="linkbtn xs" style={{ textAlign: "left" }} onClick={async () => {
            const name = d.supplierName!.trim().toUpperCase();
            const sup = { ...newParty(name), kind: "supplier" as const };
            await put("parties", sup); set({ supplier: sup.id }); toast(`${name} added as a supplier`);
          }}>+ Add “{d.supplierName.trim().toUpperCase()}” as a new supplier</button>}</div>
        <label className="f">Supplier bill no.<input className={"in" + (d.autoBillNo ? " auto-filled" : "")} value={d.billNo}
          title={d.autoBillNo ? "The bill printed no number, so its date and total stand in for one. That still stops the same bill being saved twice." : undefined}
          onChange={e => set({ billNo: e.target.value, autoBillNo: false })} /></label>
        <RackPicker value={d.rack} onChange={rack => set({ rack })} /></div>

      <label className="row sm" style={{ gap: 6 }}><input type="checkbox" checked={more} onChange={e => setMore(e.target.checked)} /> More details: collection / style and material</label>
      <QuickLineBox ref={quickRef} prevItem={[...d.rows].reverse().find(r => r.item.trim())?.item || ""} prevPack={Number([...d.rows].reverse().find(r => r.item.trim())?.packSource === "manual" ? [...d.rows].reverse().find(r => r.item.trim())?.pack : 1) || 1} expectCode={d.rows.filter(r => r.style.trim() && !r.autoStyle).length >= 2}
        money={money} nextSr={nextSrOf(d.rows.length === 1 && !d.rows[0].item.trim() && !d.rows[0].style.trim() ? [] : d.rows)} disabled={busy} onAdd={addQuick} />
      {(!!missingSr.length || !!repeats.length || !!boxGuess) && <div className="note bad bill-gaps" role="alert">
        <b>Check with the bill:</b>
        {!!boxGuess && <button type="button" className="btn sm p" disabled={busy} title={`Pieces per box is 1 on these lines, but their quantities are all in ${boxGuess}s`} onClick={() => {
          set({ rows: d.rows.map(r => Number(r.qty) > 0 && Number(r.qty) % boxGuess === 0 && (!r.pack || r.pack === "1") && r.packSource !== "manual" && r.packSource !== "bill"
            ? { ...r, pack: String(boxGuess), packSource: "manual" as const, stickers: "" } : r) });
          toast(`Boxes of ${boxGuess}: one sticker per box`);
        }}>Boxes of {boxGuess}? Set X{boxGuess} on all lines</button>}
        {missingSr.map(n => <button key={"m" + n} type="button" className="btn sm" disabled={busy} title={`The bill's Sr. ${n} was not read. Adds an empty line ${n} in its place.`} onClick={() => {
          const at = d.rows.findIndex(r => /^\d+$/.test((r.sr || "").trim()) && Number(r.sr) > n);
          const rows = [...d.rows]; rows.splice(at < 0 ? rows.length : at, 0, { ...blank(packetDefault), sr: String(n) });
          set({ rows });
          setTimeout(() => (document.querySelector(`input[aria-label="style line ${(at < 0 ? rows.length : at + 1)}"]`) as HTMLInputElement | null)?.focus(), 50);
        }}>+ Sr. {n} missing</button>)}
        {repeats.map(x => <button key={"r" + x.style} type="button" className="btn sm" title="One of these is probably misread. Jumps to the second one." onClick={() => {
          const i = d.rows.findIndex((r, k) => k > d.rows.findIndex(q => (q.style || "").trim().toUpperCase() === x.style) && (r.style || "").trim().toUpperCase() === x.style);
          (document.querySelector(`input[aria-label="style line ${i + 1}"]`) as HTMLInputElement | null)?.focus();
        }}>{x.style} on Sr. {x.lines.join(" & ")}</button>)}
      </div>}
      <div className="selection-bar"><SelectAll ids={d.rows.map(r => r.review_id!)} selected={selection} onChange={setSelection} label="Select all purchase lines" /><span className="sm">{d.rows.filter(r => selection.has(r.review_id!)).length} selected</span><DeleteButton className="btn sm bad" disabled={busy || !d.rows.some(r => selection.has(r.review_id!))} onDelete={() => removeRows(d.rows.filter(r => selection.has(r.review_id!)).map(r => r.review_id!))}>Delete selected</DeleteButton><span className="xs mut keys-hint" style={{ marginLeft: "auto" }} title="↑↓ lines · ←→ fields · Enter on the last line: next line, copied · Space select · Shift+↑↓ range">Ctrl+Enter: approve &amp; print</span></div>
      <div ref={linesRef} className="tw purchase-lines" onKeyDown={onPurchaseGridKey}><table className="pos-t"><thead><tr>{["No.", ...lineFields.map(f => captions[f]), "Jewellery photo", "Supplier S.No.", ""].map((x, i) => <th key={i}>{x}</th>)}</tr></thead><tbody>
        {d.rows.map((r, i) => <tr key={r.review_id || i}>
          <td className="line-no" data-l="Line" title="Line number: the same small boxed number printed on this line's stickers"><input type="checkbox" aria-label={"Select purchase line " + (i + 1)} checked={selection.has(r.review_id!)} onChange={event => setSelection(old => { const next = new Set(old); event.target.checked ? next.add(r.review_id!) : next.delete(r.review_id!); return next; })} />{r.sr?.trim() ? <span title={"Serial on the supplier's bill (line " + (i + 1) + " here)"}>{r.sr}</span> : i + 1}</td>
          {lineFields.map(k => k === "costcode" ? <td key={k} data-l={captions[k]} className="mono b" title="The cost as the shop's code (only people allowed to see costs see the rupees)">{codeFor(r)}</td> : <td key={k} data-l={captions[k]}>
            <input className={"in" + ((k === "style" && r.autoStyle) || d.check?.fixes.some(f => f.line === i + 1 && f.field === k) ? " auto-filled" : "") + (k === "cost" && lowCost.includes(i + 1) ? " cost-low" : "") + (k === "style" && repeatedRow(r) ? " cost-low" : "")} aria-label={`${k} line ${i + 1}`}
              title={k === "entry_code" ? "Editable maker initial + entry date (DDMMYY). This assumed code does not encode price." : ["qty", "pack", "stickers"].includes(k) ? `Enter copies this ${captions[k].toLowerCase()} to the next line. Type a new number to change it.${k === "stickers" ? " Blank means one per packet; 0 prints none." : ""}` : k === "style" && r.autoStyle ? "The bill printed no article number — this was built from the item and its rate. Edit it if you have the supplier's own code." : undefined}
              inputMode={k === "cost" || k === "rate" ? "decimal" : ["qty", "pack", "stickers"].includes(k) ? "numeric" : undefined}
              maxLength={k === "entry_code" ? 24 : undefined}
              placeholder={k === "entry_code" ? "e.g. K201026" : k === "stickers" ? defaultStickers(r) : undefined}
              value={r[k] ?? ""} onChange={e => row(i, k, e.target.value)}
              onKeyDown={["qty", "pack", "stickers"].includes(k) ? e => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing || e.ctrlKey || e.metaKey) return;
                if (i === d.rows.length - 1) return;   // last line: the grid adds the next line, copied from this one
                e.preventDefault(); e.stopPropagation();
                if (e.repeat || busy || lock.current) return;
                try {
                  const rows = repeatPhotoCount(d.rows, i, k as RepeatedCountField, e.currentTarget.value);
                  countFocus.current = e.currentTarget.closest("tbody")?.querySelector<HTMLInputElement>(`input[aria-label="${k} line ${i + 2}"]`) ?? null;
                  set({ rows });
                  setError("");
                } catch (error: any) { setError(error.message); }
              } : undefined}
              style={{ minWidth: k === "item" ? 130 : ["style", "entry_code", "collection", "material"].includes(k) ? 110 : 56 }} /></td>)}
          <td data-l="Jewellery photo"><PhotoButton value={r.photo_id} disabled={busy} onBusyChange={uploading => setPhotoUploads(old => { const next = new Set(old); uploading ? next.add(r.review_id!) : next.delete(r.review_id!); return next; })} onChange={v => set({ rows: draftRef.current.rows.map(x => x.review_id === r.review_id ? { ...x, photo_id: v } : x) })} label="Photo" /></td>
          <td data-l="Supplier S.No." className="supplier-number mono" title="Saved supplier roll number">{vendor?.vendor_code || "—"}</td>
          <td><DeleteButton className="iconbtn" aria-label="Remove line" disabled={busy} onDelete={() => removeRows([r.review_id!])}><Trash2 size={16} /></DeleteButton></td>
        </tr>)}</tbody></table></div>
      {/* Owner, 25 Oct (voice): "remove this part from here and bring it down — or give a small box to tick". The
          tools that change many lines at once sit under the lines, folded, so the bill's lines come first. */}
      <details className="note purchase-tools" open={toolsOpen} onToggle={e => setToolsOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary><b>Change many lines at once</b> <span className="xs mut">— reference code, item, packet size, stickers per packet, old-software codes</span></summary>
      <BulkEdit rows={d.rows} selection={selection} disabled={busy} onApply={(ids, patch) => {
        const all = !ids;
        set({ rows: d.rows.map(r => (all || ids!.has(r.review_id!)) ? { ...r, ...patch, ...(patch.item || patch.unit ? { item_code: undefined } : {}) } : r) });
        setReviewed(false); setError("");
      }} />
      <fieldset className="purchase-quantity-tools" disabled={busy}>
        <legend>Set quantities for all {d.rows.length} lines</legend>
        <div className="row">
          <label className="f">Total quantity per line (optional)<input className="in mono" inputMode="numeric" value={bulkQty} onChange={e => setBulkQty(e.target.value)} placeholder="Blank keeps each bill quantity" /></label>
          <label className="f">Pieces per packet for all lines<input className="in mono" inputMode="numeric" value={bulkPack} onChange={e => setBulkPack(e.target.value)} /></label>
          <button className="btn" type="button" onClick={() => void applyQuantities()}>Apply to all {d.rows.length} lines</button>
        </div>
        <label className="row sm"><input type="checkbox" checked={rememberPack} onChange={e => setRememberPack(e.target.checked)} /> Remember this packet size for future bills</label>
        <div className="xs mut">Bill quantities are kept unless you enter a replacement total above. A new bill uses its printed packet size first, then a matching saved article, then the saved default X{packetDefault}. Sticker counts calculate automatically; individual lines stay editable.</div>
        <div className="row">
          <label className="f">Stickers on each packet<select className="in" value={perPacket} onChange={e => setPerPacket(e.target.value)}>
            {["1", "2", "3", "4", "5"].map(n => <option key={n} value={n}>{n === "1" ? "1 (normal)" : n}</option>)}</select></label>
          <button className="btn" type="button" onClick={() => {
            try {
              const only = selection.size ? selection : undefined, n = Number(perPacket);
              set({ rows: stickersPerPacket(d.rows, n, only) }); setError("");
              setQuantityNote(`${only ? only.size + " ticked" : "All " + d.rows.length} line${(only ? only.size : d.rows.length) === 1 ? "" : "s"}: ${n === 1 ? "one sticker per packet" : n + " stickers on each packet"}`);
            } catch (e: any) { setError(e.message); }
          }}>{selection.size ? `Apply to ${selection.size} ticked line${selection.size === 1 ? "" : "s"}` : `Apply to all ${d.rows.length} lines`}</button>
        </div>
        <div className="xs mut">For goods that need more than one sticker (one on the piece, one on its box…). Tick lines in the list to change only those. The Stickers box on any line can still be typed by hand.</div>
        {quantityNote && <div className="sm ok-text" role="status">✓ {quantityNote}</div>}
      </fieldset>

      {cfg.format === "shop" && <details className="note" open={legacyMissing}>
        <summary>Old-software QR item codes{legacyMissing ? ` — ${legacyCount} line${legacyCount === 1 ? "" : "s"} will print with the Rungnna QR` : ""}</summary>
        {legacyMissing && <div className="sm">Lines without an old item code still print. Their QR is the Rungnna one: this app scans it with the name, but the old software can't. Enter the old code below if those stickers must scan in the old software too.</div>}
        <div className="xs mut">Use that application's real numeric item code. Set it once per item category here; all matching lines use it. Saved articles retain their original reference. Unknown codes are never invented.</div>
        <button type="button" className="btn sm" disabled={busy} onClick={async () => { try { set({ rows: await preparePhotoRows(d.rows, d.supplier, packetDefault) }); } catch (e: any) { setError(e.message); } }}>Use saved old item codes</button>
        <div className="row">
          <label className="f grow">Old-system reference for these labels (optional)<input className="in mono" value={bulkRef} onChange={event => setBulkRef(event.target.value)} placeholder="Copy the reference from the old system" /></label>
          <button type="button" className="btn sm" disabled={busy || !bulkRef.trim()} onClick={() => {
            if (/[~\u0000-\u001f\u007f]/.test(bulkRef)) return setError("Reference cannot contain ~ or control characters");
            set({ rows: d.rows.map(r => ({ ...r, ref: bulkRef.trim() })) }); setError("");
          }}>Apply reference to all lines</button>
        </div>
        <div className="grid g3">{legacyGroups.map(group => <label className="f" key={group.item + "|" + group.unit}>{group.item} ({group.unit})
          <input className="in mono" inputMode="numeric" aria-label={"Old software code for " + group.item + " (" + group.unit + ")"} value={group.item_code || ""} onChange={event => {
            const value = event.target.value.replace(/\D/g, "");
            set({ rows: d.rows.map(r => r.item.trim().toUpperCase() === group.item.trim().toUpperCase() && r.unit.trim().toUpperCase() === group.unit.trim().toUpperCase() ? { ...r, item_code: value || undefined } : r) });
          }} />
        </label>)}</div>
      </details>}

      </details>

      {!!invented && <div className="note sm">{invented} line{invented === 1 ? " has" : "s have"} no code on the bill — made from item + rate (e.g. SET-360). Type the bill's code if it has one.</div>}

      {money && <>
      <div className="row">
        {vendor && (!!vendor.less_pct || (vendor.rate_divisor || 1) !== 1) && (d.rows.length && d.rows.every(r => r.termsDone)
          ? <span className="pill ok applied" role="status">✓ Vendor terms applied{(vendor.rate_divisor || 1) !== 1 ? ` (÷${vendor.rate_divisor})` : ""}{vendor.less_pct ? ` (${vendor.less_pct}% less)` : ""}{d.rows.some(r => r.billCost) && <button className="linkbtn" style={{ marginLeft: 8 }} onClick={() => { set({ rows: restoreBillCosts(d.rows) }); setDone({}); }}>Undo</button>}</span>
          : <button className="btn" disabled={busy} title="Printed cost ÷ rate divisor, then less %. Each line only once." onClick={() => applyTerms(vendor)}>
              Apply vendor terms{vendor.less_pct ? ` (${vendor.less_pct}% less)` : ""}{(vendor.rate_divisor || 1) !== 1 ? ` (÷${vendor.rate_divisor})` : ""}{d.rows.some(r => r.termsDone) ? ` to ${d.rows.filter(r => !r.termsDone).length} new lines` : ""}</button>)}
        <button className="btn" disabled={busy} onClick={() => void price()}>{done.pricing && done.pricingSig === costSig(d.rows) ? "Apply shop pricing again" : "Apply shop pricing"}</button>
        <span>Goods cost ₹{total}</span>
        <label className="f">Supplier payable ₹<input className="in" inputMode="decimal" value={d.total} onChange={e => set({ total: e.target.value })} /></label></div>
      <BillCosting d={d} busy={busy} onChange={onCosting} />

      {!!lowCost.length && <div className="note bad sm" role="alert">
        <b>Check the cost on line{lowCost.length === 1 ? "" : "s"} {lowCost.join(", ")}:</b> it is less than a tenth of the selling rate. A cost like ₹1.03 against a rate of ₹170 usually means the vendor terms (÷) were applied again and again, or the cost was misread.
        {d.rows.some(r => r.billCost && r.billCost !== r.cost) && <> <button className="linkbtn" onClick={() => { set({ rows: restoreBillCosts(d.rows) }); setDone({}); }}>Put the bill's costs back</button></>}
      </div>}
      {done.pricing && done.pricingSig === costSig(d.rows) && <div className="note ok applied-note sm" role="status">✓ {done.pricing}</div>}
      {pricing && <div className="row sm"><span>Pricing: {pricing.margin.mode === "percent" ? `+${pricing.margin.percent}%` : `${pricing.margin.mode === "divide" ? "÷" : "×"}${pricing.margin.factor}`} · round ₹{pricing.margin.round_to} {pricing.margin.round_dir}</span><a href="#/settings/prices">Pricing settings</a></div>}
      </>}


      {coded && <BillCosting d={d} busy={busy} onChange={onCosting} hideRupees />}
      {already && <div className="note warn stack" role="alert" style={{ gap: 6 }}>
        <b>All {already.lines} lines of this bill are already saved as {already.p.no}{already.p.supplier_bill ? ` (bill ${already.p.supplier_bill})` : ""}.</b>
        <span className="sm">Nothing was saved or printed again. If this photo has lines that are missing, add them with + Line and approve again.</span>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <button className="btn" disabled={printer.busy} onClick={async () => { const q = await jobsFor(already.p); setSaved(already.p); setJobs(q); setAlready(null); try { await sendToPrinter(q, true); } catch (e: any) { setError(e.message); } }}>Print its {already.labels} stickers again</button>
          <button className="btn p" onClick={() => { set({ rows: [], billNo: "", total: "", discount: "", mult: "", extra: "", warnings: "", check: undefined, photoId: undefined }); setAlready(null); }}>Clear — take the next bill</button>
        </div>
      </div>}
      {validation && <div className="note warn" role="status">{validation}</div>}
      {d.warnings && <div className="note warn" style={{ whiteSpace: "pre-wrap" }}>{d.warnings}</div>}

      {/* stays in view at the bottom of the full-window review, so approving needs no scrolling */}
      <div className="approve-bar stack">
      {!!autoFill.length && <div className="xs mut">Approve fills in by itself — {autoFill.join(" · ")}. Change any of them above if you like.</div>}
      <label className="row"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} />
        {d.check?.ok ? "The lines add up to the bill. I checked the highlighted cells and the selling rates." : "I checked quantities, units, costs, selling rates and tax/freight differences."} <span className="xs mut">(optional)</span></label>
      <label className="row"><input type="checkbox" checked={cartonMode} disabled={atShop} onChange={e => { setCartonMode(e.target.checked); setShowCarton(e.target.checked); void setSetting("carton_mode", e.target.checked); }} /> <b>Carton by carton</b> — save the bill, then print each carton's stickers as you open it</label>
      <label className="row"><input type="checkbox" checked={atShop} onChange={e => setAtShop(e.target.checked)} /> Print the stickers at the shop computer (not here)</label>
      <button className="btn p" disabled={!ready4 || !!photoUploads.size} onClick={approve}>
        {busy ? "Working…" : `Approve: draft ${d.rows.length} product${d.rows.length === 1 ? "" : "s"}${labelCount ? ` & print ${labelCount} label${labelCount === 1 ? "" : "s"}` : " & save purchase"}`}
      </button>
      {!busy && !!missing.length && <div className="sm bad-text" role="status">To approve: {missing.join(" · ")}</div>}
      </div>
    </>}

    {error && <div className="note warn" role="alert" style={{ whiteSpace: "pre-line" }}>{error}</div>}
    {printer.panel}
  </section>;
}

/* Change one field on every line, or only on the ticked lines, in one go (owner, 21/10):
   Reference Code, Item name, Colour, Unit. Nobody has to edit line after line. */
type BulkField = "entry_code" | "item" | "color" | "unit" | "collection" | "material";
const BULK_FIELDS: [BulkField, string][] = [["entry_code", "Reference Code"], ["item", "Item name"], ["color", "Colour"], ["unit", "Unit"], ["collection", "Collection / style"], ["material", "Material"]];
function BulkEdit({ rows, selection, disabled, onApply }: { rows: PhotoRow[]; selection: Set<string>; disabled: boolean; onApply: (ids: Set<string> | null, patch: Partial<PhotoRow>) => void }) {
  const [field, setField] = useState<BulkField>("entry_code"), [value, setValue] = useState("");
  const picked = rows.filter(r => selection.has(r.review_id!)).length;
  const clean = () => {
    const v = value.trim().toUpperCase();
    if (!v && !["color", "entry_code", "collection", "material"].includes(field)) { toast("Type the new " + (field === "item" ? "item name" : field), true); return null; }
    if (field === "entry_code" && (v.length > 24 || !/^[A-Z0-9./-]*$/.test(v))) { toast("Reference code: up to 24 letters, numbers, / . or -", true); return null; }
    if (field === "unit" && !UNIT_RE.test(v)) { toast("Unit must be PCS, PAIR, SET, DOZEN, BOX, CARD or PACKET", true); return null; }
    return { [field]: v } as Partial<PhotoRow>;
  };
  const go = (ids: Set<string> | null, n: number) => { const patch = clean(); if (!patch) return; onApply(ids, patch); toast(`${BULK_FIELDS.find(f => f[0] === field)![1]} changed on ${n} line${n === 1 ? "" : "s"}`); };
  return <fieldset className="purchase-quantity-tools" disabled={disabled}>
    <legend>Change many lines at once</legend>
    <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
      <label className="f">Field<select className="in" value={field} onChange={e => { setField(e.target.value as BulkField); setValue(""); }}>{BULK_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
      {field === "unit"
        ? <label className="f">New value<select className="in" value={value} onChange={e => setValue(e.target.value)}><option value="">—</option>{UNITS.map(u => <option key={u}>{u}</option>)}</select></label>
        : <label className="f grow">New value<input className={"in" + (field === "entry_code" ? " mono" : "")} value={value} maxLength={field === "entry_code" ? 24 : 80} onChange={e => setValue(e.target.value.toUpperCase())} placeholder={field === "entry_code" ? "e.g. K211026" : field === "item" ? "e.g. N SET" : field === "color" ? "e.g. MIX (blank clears)" : ""} /></label>}
      <button type="button" className="btn" disabled={!picked} onClick={() => go(new Set(rows.filter(r => selection.has(r.review_id!)).map(r => r.review_id!)), picked)}>Apply to {picked || "ticked"} selected</button>
      <button type="button" className="btn p" disabled={!rows.length} onClick={() => go(null, rows.length)}>Apply to all {rows.length} lines</button>
    </div>
    <div className="xs mut">Tick lines in the first column (or Select all, Space / Shift+↑↓) to change only those. Changing the item name or unit clears that line's old-software code so the right one is used.</div>
  </fieldset>;
}

/* One box per bill for the supplier's own way of pricing (owner, 24 Oct). Changes apply when the box is left. */
function BillCosting({ d, busy, onChange, hideRupees = false }: { d: { mult?: string; discount?: string; extra?: string; rows: PhotoRow[] }; busy: boolean; onChange: (p: { mult?: string; discount?: string; extra?: string }) => void; hideRupees?: boolean }) {
  const [v, setV] = useState({ mult: d.mult || "", discount: d.discount || "", extra: d.extra || "" });
  useEffect(() => { setV({ mult: d.mult || "", discount: d.discount || "", extra: d.extra || "" }); }, [d.mult, d.discount, d.extra]);
  const clean = (x: string) => x.replace(/[^0-9.]/g, "").slice(0, 9);
  const commit = (k: "mult" | "discount" | "extra") => { if ((v[k] || "") !== (d[k] || "")) onChange({ [k]: v[k] }); };
  const c = costingOf({ mult: d.mult, less: d.discount, extra: d.extra });
  const sample = d.rows.find(r => Number(r.billCost ?? r.cost) > 0);
  const field = (k: "mult" | "discount" | "extra", label: string, ph: string, w = 90) =>
    <label className="f">{label}<input className="in" inputMode="decimal" style={{ maxWidth: w }} disabled={busy} value={v[k]} placeholder={ph}
      onChange={e => setV({ ...v, [k]: clean(e.target.value) })} onBlur={() => commit(k)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); commit(k); } }} /></label>;
  return <fieldset className="purchase-quantity-tools bill-costing">
    <legend>Bill costing <span className="xs mut">— this supplier's way of writing rates</span></legend>
    <div className="row" style={{ flexWrap: "wrap", alignItems: "flex-end", gap: 8 }}>
      {field("mult", "Multiply ×", "1")}{field("discount", "Less / discount %", "0")}{!hideRupees && field("extra", "Packing / freight ₹", "0", 120)}
      {!hideRupees && sample && (c.mult !== 1 || c.less) ? <span className="sm">e.g. printed ₹{sample.billCost ?? sample.cost}{c.mult !== 1 ? ` × ${c.mult}` : ""}{c.less ? ` − ${c.less}%` : ""} = <b>₹{sample.cost}</b> cost</span> : null}
    </div>
  </fieldset>;
}

/** Why the stronger readers were not used, in plain words (shown on the bill and kept in the purchase note). */
function whyFellBack(attempts: unknown): string {
  const list = Array.isArray(attempts) ? attempts.filter((a: any) => a && a.ok === false) : [];
  const say = (a: any) => {
    const n = a.provider === "openai" ? "OpenAI" : a.provider === "gemini" ? "Gemini" : "Groq", m = String(a.message || "");
    if (a.skipped) return `${n} not set up`;
    if (a.kind === "quota") return `${n} out of credit/quota`;
    if (a.kind === "timeout") return `${n} too slow`;
    if (a.kind === "rate_limit") return `${n} busy`;
    if (/model/i.test(m) && /not.?found|does not exist|deprecat|no longer|unsupported/i.test(m)) return `${n} model not available (${m.slice(0, 80)})`;
    return `${n}: ${m.slice(0, 90) || "error"}`;
  };
  return list.length ? list.map(say).join("; ") : "an earlier provider was unavailable";
}
