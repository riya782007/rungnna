import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Camera, Sparkles } from "lucide-react";
import { db, type Product } from "../lib/db";
import { Modal } from "./common";
import { api } from "../lib/ai";
import { useApp, toast } from "../lib/app";
import { can, roleName } from "../lib/roles";
import {
  writePages, pickForListing, planPublish, publishAll, describePlan,
  type BulkProgress, type BulkResult, type BulkTarget,
} from "../lib/bulkListing";

const PurchasePhoto = lazy(() => import("./PurchasePhoto"));

/* The two pages that already carry the bill reader in full. Opening a second copy
   there would give two editors the same saved draft, so the strip points at the one
   that is already on screen instead. */
const HAS_READER = ["labels", "stockin"];

/* ===========================================================================
   The AI commands, on every Stock screen.

   The owner's complaint was fair: writing pages one product at a time is the
   only way the app offered, and the AI lived on a single screen. This bar rides
   above every Stock tab so the two bulk jobs — write the pages, put the ready
   ones live — are one press from wherever he is standing.

   It is deliberately a strip, not a panel: it must not push the day's work
   (scan, stock in, labels) below the fold.
=========================================================================== */

export default function StockAI({ route = "" }: { route?: string }) {
  const { me, setMe } = useApp();
  const [bill, setBill] = useState<false | "upload" | "camera">(false);
  /* the reader already on this page (Labels, Stock in): open its box and its camera there, not a second copy */
  const cameraHere = () => {
    const box = document.querySelector<HTMLDetailsElement>("details.purchase-import");
    if (box) { box.open = true; box.scrollIntoView({ behavior: "smooth", block: "start" }); }
    void import("./PurchasePhoto").then(m => m.askBillCamera());
  };
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState<BulkTarget>("missing");
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<BulkProgress | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [chain, setChain] = useState("");
  const stop = useRef(false);

  const products = useLiveQuery(() => db.products.filter(p => !p.deleted).toArray(), [], [] as Product[]);
  const plan = describePlan(products.filter(p => !!(p.item?.trim() || p.style?.trim())));
  const toWrite = products.filter(p => (p.item?.trim() || p.style?.trim()) && (target === "all" || !p.content?.title?.trim())).length;
  const ready = planPublish(products).ready.filter(p => p.catalogue !== 1).length;

  const mayWrite = can(me, "products.edit") && can(me, "ai.use");
  const mayPublish = can(me, "catalogue.share");
  const mayBill = can(me, "purchases.photo") && can(me, "ai.use");

  // every hook runs on every render: this must stay ABOVE the permission return below
  useEffect(() => {
    if (!open || chain) return;
    api<{ provider: string; configured: boolean }>("purchase-photo")
      .then(r => setChain(r.configured ? r.provider : "no AI key yet"))
      .catch(e => setChain(/sign in|login/i.test(e.message) ? "needs the shop login — Settings › Cloud backup" : e.message));
  }, [open]);


  async function run() {
    const list = await pickForListing(target);
    if (!list.length) return toast("Every product already has a page", true);
    if (!confirm(`Write an online page for ${list.length} product${list.length === 1 ? "" : "s"}?\n\nEach one is a paid AI call. Pages are saved as they are written, and you can stop at any time.`)) return;
    stop.current = false; setBusy(true); setResult(null);
    try {
      const r = await writePages(list, { onProgress: setProg, cancelled: () => stop.current });
      setResult(r);
      toast(r.stopped === "provider"
        ? `Stopped after ${r.failures.length} failures in a row — check the AI account. ${r.ok} page${r.ok === 1 ? "" : "s"} written and saved.`
        : r.stopped === "cancelled"
          ? `Stopped. ${r.ok} page${r.ok === 1 ? "" : "s"} written and saved.`
          : `${r.ok} page${r.ok === 1 ? "" : "s"} written${r.failures.length ? ` · ${r.failures.length} could not be done` : ""}`,
        r.stopped === "provider");
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); setProg(null); }
  }

  async function goLive() {
    const { ready: list, blocked } = planPublish(products);
    const fresh = list.filter(p => p.catalogue !== 1);
    if (!fresh.length) return toast(blocked.length ? `Nothing is ready yet — ${blocked.length} still need a page or a photo` : "Everything ready is already live", true);
    if (!confirm(`Put ${fresh.length} design${fresh.length === 1 ? "" : "s"} live on the shop, trade portal and catalogues?${blocked.length ? `\n\n${blocked.length} are not ready and will be left alone.` : ""}`)) return;
    setBusy(true);
    try {
      const r = await publishAll(products);
      toast(`${r.published} live${r.blocked ? ` · ${r.blocked} still need a page or photo` : ""}`);
    } catch (e: any) { toast(e.message, true); }
    finally { setBusy(false); }
  }

  const pct = prog && prog.total ? Math.round((prog.done / prog.total) * 100) : 0;

  const Locked = () => <span className="row" style={{ gap: 8 }}>
    <span className="xs mut">Not allowed for {roleName(me) || "this person"}</span>
    <button className="btn sm" onClick={() => setMe(null)}>Switch person</button>
  </span>;

  return (
    <div className="stock-ai">
      <button className="stock-ai-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <Sparkles size={16} />
        <b className="grow">AI for the catalogue</b>
        <span className="xs mut">{plan.withPage}/{plan.total} pages · {ready} ready to go live</span>
        <span className="xs mut">{open ? "▴" : "▾"}</span>
      </button>

      {open && <div className="pad stack">
        {busy && prog && <div className="stack" style={{ gap: 6 }}>
          <div className="row"><span className="sm grow">{prog.current || "Finishing…"}</span>
            <span className="xs mut">{prog.done}/{prog.total} · {prog.ok} written{prog.failed ? ` · ${prog.failed} failed` : ""}</span></div>
          <div className="bar-track"><div className="bar-fill" style={{ width: pct + "%" }} /></div>
          <button className="btn sm" onClick={() => { stop.current = true; toast("Stopping after this one — everything written so far is saved"); }}>Stop</button>
        </div>}

        {!busy && <>
          <div className="row">
            <span className="sm grow">Read a purchase bill from its photo: labels print and product pages are drafted</span>
            {!mayBill ? <Locked />
              : HAS_READER.includes(route)
                ? <button className="btn p" onClick={cameraHere}><Camera size={15} />Take photo of bill</button>
                : <><button className="btn p" onClick={() => setBill("camera")}><Camera size={15} />Take photo of bill</button>
                  <button className="btn" onClick={() => setBill("upload")}>Upload photo</button></>}
          </div>

          {!mayWrite && <div className="row"><span className="sm grow">Write product pages with AI</span><Locked /></div>}
          {mayWrite && <div className="row">
            <label className="f" style={{ margin: 0 }}>Write pages for
              <select className="in" value={target} onChange={e => setTarget(e.target.value as BulkTarget)}>
                <option value="missing">products with no page yet</option>
                <option value="all">every product (rewrites existing pages)</option>
              </select></label>
            <button className="btn p" disabled={!toWrite} onClick={run}>
              {toWrite ? `Write ${toWrite} page${toWrite === 1 ? "" : "s"}` : "Nothing to write"}
            </button>
          </div>}

          {mayPublish && <div className="row">
            <span className="sm grow">{ready ? `${ready} design${ready === 1 ? " has" : "s have"} a page and a photo` : "Nothing new is ready — a design needs a page and a photo"}</span>
            <button className="btn" disabled={!ready} onClick={goLive}>Put {ready || ""} live</button>
          </div>}

          <div className="xs mut">
            {chain ? `AI: ${chain.replace(/\.+$/, "")}. ` : ""}
            Pages are saved one by one, so stopping never loses work. {plan.total - plan.withPhoto > 0 ? `${plan.total - plan.withPhoto} design${plan.total - plan.withPhoto === 1 ? " still needs a photo before it can" : "s still need a photo before they can"} go live.` : ""}
          </div>
        </>}

        {result && !!result.failures.length && <details className="note warn">
          <summary>{result.failures.length} could not be written</summary>
          <ul style={{ margin: "6px 0 0 16px", padding: 0 }}>
            {result.failures.slice(0, 12).map(f => <li key={f.id} className="xs">{f.item} ({f.code}) — {f.why}</li>)}
            {result.failures.length > 12 && <li className="xs mut">+{result.failures.length - 12} more</li>}
          </ul>
        </details>}
      </div>}

      {bill && <Modal title="Read a purchase bill" onClose={() => setBill(false)}>
        <Suspense fallback={<div role="status">Loading bill reader…</div>}>
          <PurchasePhoto by={me?.id || ""} camera={bill === "camera"} />
        </Suspense>
      </Modal>}
    </div>
  );
}
