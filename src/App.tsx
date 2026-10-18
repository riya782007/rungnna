import { lazy, Suspense, useEffect, useState, Component, type ReactNode } from "react";
import { onUpdate, applyUpdate } from "./lib/update";
import { AppProvider, useApp, useRoute, Toasts, go, toast } from "./lib/app";
import { startSync, onSync, type SyncState } from "./lib/sync";
import { warmScanner } from "./components/Scanner";
import { SearchPalette } from "./components/Search";
import { Icon } from "./components/Icon";
import { can, roleName } from "./lib/roles";
import { t, initLang, onLang } from "./lib/i18n";
import Home from "./pages/Home";
import { WhoAreYou } from "./pages/Settings";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "./lib/db";
const StockAI = lazy(() => import("./components/StockAI"));
import { OwnerGate } from "./components/OwnerSecurity";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { getSetting, setSetting } from "./lib/db";

/* Pages load on first visit (fast start); the service worker keeps every piece for offline use. */
const Billing = lazy(() => import("./pages/Billing"));
const Bills = lazy(() => import("./pages/Bills"));
const Customers = lazy(() => import("./pages/Customers"));
const Ask = lazy(() => import("./pages/Ask"));
const Scan = lazy(() => import("./pages/Scan"));
const Recheck = lazy(() => import("./pages/Recheck"));
const RfidCount = lazy(() => import("./pages/RfidCount"));
const Labels = lazy(() => import("./pages/Labels"));
const Catalogue = lazy(() => import("./pages/Catalogue"));
const Racks = lazy(() => import("./pages/Racks"));
const Move = lazy(() => import("./pages/Move"));
const Products = lazy(() => import("./pages/Products"));
const Activity = lazy(() => import("./pages/Activity"));
const StockIn = lazy(() => import("./pages/StockIn"));
const Suppliers = lazy(() => import("./pages/Suppliers"));
const Vouchers = lazy(() => import("./pages/Vouchers"));
const Reports = lazy(() => import("./pages/Reports"));
const Bank = lazy(() => import("./pages/Bank"));
const Stores = lazy(() => import("./pages/Stores"));
const Import = lazy(() => import("./pages/Import"));
const Remote = lazy(() => import("./pages/Remote"));
const Settings = lazy(() => import("./pages/Settings"));
const Roles = lazy(() => import("./pages/Roles"));
const AddInventory = lazy(() => import("./pages/AddInventory"));
const Dealers = lazy(() => import("./pages/Dealers"));

/* Five places. Everything else is a tab inside one of them. */
type Sec = { key: string; label: string; icon: string; tabs?: [string, string][] };
const SECTIONS: Sec[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "sell", label: "Sell", icon: "sell", tabs: [["bill", "New bill"], ["bills", "Bills"], ["customers", "Customers"], ["suppliers", "Suppliers"], ["dealers", "Trade orders"], ["vouchers", "Vouchers"]] },
  { key: "stock", label: "Stock", icon: "stock", tabs: [["products", "Products"], ["add", "Add inventory"], ["stockin", "Stock in"], ["scan", "Scan & record"], ["recheck", "Recheck"], ["rfid", "RFID count"], ["labels", "Labels"], ["catalogue", "Catalogue"], ["racks", "Racks"], ["move", "Move"], ["activity", "Activity"], ["import", "Import"]] },
  { key: "reports", label: "Reports", icon: "sales" },
  { key: "ask", label: "Ask", icon: "ask" },
  { key: "settings", label: "Settings", icon: "settings" },
];
const sectionOf = (r: string) => (["bill", "bills", "customers", "suppliers", "dealers", "vouchers"].includes(r) ? "sell" : ["products", "product", "add", "stockin", "scan", "recheck", "rfid", "labels", "catalogue", "racks", "move", "activity", "import"].includes(r) ? "stock" : r === "ask" || r === "settings" || r === "reports" ? r : r === "roles" ? "settings" : "home");
const lastTab: Record<string, string> = { sell: "bill", stock: "products" };
/* What each screen needs (lib/roles). A tab you can't use is not shown. */
const ROUTE_PERM: Record<string, string> = {
  bill: "billing.sell", bills: "billing.sell", customers: "customers.manage", suppliers: "suppliers.manage", vouchers: "money.vouchers",
  reports: "reports.view", ask: "ai.use", scan: "stock.in", stockin: "stock.in", recheck: "stock.count", rfid: "stock.count",
  labels: "labels.print", catalogue: "catalogue.share", racks: "racks.manage", move: "stock.move", products: "stock.view", product: "stock.view",
  activity: "stock.view", add: "products.edit", dealers: "dealers.manage", import: "import.data", bank: "bank.reconcile", stores: "stores.transfer", roles: "staff.manage",
  settings: "settings.manage",
};

function useSync() {
  const [s, setS] = useState<SyncState>();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => onSync(setS) as any, []);
  useEffect(() => { const a = () => setOnline(true), b = () => setOnline(false); addEventListener("online", a); addEventListener("offline", b); return () => { removeEventListener("online", a); removeEventListener("offline", b); }; }, []);
  const txt = !online ? "Offline — saving on this device" : s?.status === "syncing" ? "Syncing…" : s?.status === "error" ? "Sync problem" : s?.user ? "All saved" : "Not connected";
  const cls = !online || !s?.user ? "warn" : s?.status === "error" ? "bad" : "";
  return { txt, cls, pending: s?.pending || 0 };
}
function Status() {
  const s = useSync();
  return <a href="#/settings" className="status"><i className={"dot " + s.cls} />{s.txt}{s.pending ? ` · ${s.pending}` : ""}</a>;
}

function Loading() { return <div className="stack"><div className="skel" style={{ height: 40, width: 220 }} /><div className="skel" style={{ height: 180 }} /><div className="skel" style={{ height: 120 }} /></div>; }

function Shell() {
  const { me, setMe, ready, store, switchStore } = useApp();
  const stores = useLiveQuery(() => db.stores.filter(s => !s.deleted && !!s.active).toArray(), [], []);
  const [route, args] = useRoute();
  const [pal, setPal] = useState(false);
  const [compact, setCompact] = useState(true);
  useEffect(() => { getSetting("compact_menu", true).then(setCompact); }, []);
  const [, setLangTick] = useState("");
  const [scrolled, setScrolled] = useState(false);
  const sec = sectionOf(route);
  useEffect(() => { startSync(); warmScanner(); }, []);
  useEffect(() => { initLang().then(setLangTick); return onLang(setLangTick) as any; }, []);
  useEffect(() => {
    const f = (e: PromiseRejectionEvent) => { const m = String(e.reason?.message || e.reason || ""); if (m && !/abort/i.test(m)) toast(m.slice(0, 120), true); };
    addEventListener("unhandledrejection", f); return () => removeEventListener("unhandledrejection", f);
  }, []);
  useEffect(() => { if (sec === "sell" || sec === "stock") lastTab[sec] = route === "product" ? "products" : route; window.scrollTo({ top: 0 }); }, [route]);
  useEffect(() => { const f = () => setScrolled(scrollY > 4); addEventListener("scroll", f, { passive: true }); return () => removeEventListener("scroll", f); }, []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPal(true); }
      if (e.key === "F2" && route !== "bill") { e.preventDefault(); go("bill"); }
    };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  }, [route]);
  /* A dealer's order used to wait until somebody happened to open Sell › Trade orders.
     Count the orders and sign-ups that need a person, and badge the section.
     Must stay ABOVE the early returns below — every hook runs on every render. */
  const waiting = useLiveQuery(async () => {
    if (!me || !can(me, "dealers.manage")) return 0;
    const [orders, signups] = await Promise.all([
      db.trade_orders.filter(o => !o.deleted && o.status === "new").count(),
      db.dealers.filter(d => !d.deleted && d.status === "pending").count(),
    ]);
    return orders + signups;
  }, [me?.id, me?.role, me?.role_id], 0);

  if (!ready) return null;
  if (!me) return <WhoAreYou />;

  const ok = (r: string) => !ROUTE_PERM[r] || can(me, ROUTE_PERM[r]);
  const visible = SECTIONS.filter(s => s.tabs ? s.tabs.some(([k]) => ok(k)) : ok(s.key));
  const cur = SECTIONS.find(s => s.key === sec)!;
  const hrefOf = (s: Sec) => "#/" + (s.tabs ? (ok(lastTab[s.key]) && lastTab[s.key]) || s.tabs.find(([k]) => ok(k))?.[0] || s.tabs[0][0] : s.key);
  const tabs = cur.tabs?.filter(([k]) => ok(k));
  // what this person's role is hiding in this section, so a missing screen reads as
  // "ask for the permission" instead of "the feature is gone"
  const hidden = (cur.tabs || []).filter(([k]) => !ok(k)).map(([, label]) => label);
  const tabOn = (k: string) => route === k || (k === "products" && route === "product");

  let page: ReactNode;
  switch (route) {
    case "bill": page = <Billing args={args} />; break;
    case "bills": page = <Bills args={args} />; break;
    case "customers": page = <Customers args={args} />; break;
    case "suppliers": page = <Suppliers args={args} />; break;
    case "vouchers": page = <Vouchers />; break;
    case "reports": page = <Reports />; break;
    case "ask": page = <Ask />; break;
    case "scan": page = <Scan />; break;
    case "recheck": page = <Recheck args={args} />; break;
    case "rfid": page = <RfidCount />; break;
    case "labels": page = <Labels args={args} />; break;
    case "catalogue": page = <Catalogue />; break;
    case "racks": page = <Racks args={args} />; break;
    case "move": page = <Move args={args} />; break;
    case "products": page = <Products args={[]} />; break;
    case "product": page = <Products args={args} />; break;
    case "activity": page = <Activity />; break;
    case "stockin": page = <StockIn args={args} />; break;
    case "remote": page = <Remote id={args[0] || ""} />; break;
    case "import": page = <Import />; break;
    case "bank": page = <Bank />; break;
    case "stores": page = <Stores />; break;
    case "settings": page = <Settings />; break;
    case "roles": page = <Roles />; break;
    case "add": page = <AddInventory />; break;
    case "dealers": page = <Dealers />; break;
    default: page = <Home />;
  }
  if (!ok(route)) page = <NoAccess />;

  return (
    <div className={"shell" + (compact ? " compact-menu" : "") + (route === "bill" ? " billing-shell" : "")}>
      <aside className="rail">
        {/* the R mark is what people tap first, so it opens and closes the menu: on a desktop the
            collapsed rail had no other way back, the toggle lives in the phone-only top bar */}
        <div className="brand"><button type="button" className="mark markbtn" onClick={() => { setCompact(!compact); setSetting("compact_menu", !compact); }}
          title={compact ? "Show menu" : "Hide menu"} aria-label={compact ? "Show menu" : "Hide menu"} aria-expanded={!compact}>R</button><div><b>Rungnna</b><span>Jewellery &amp; Co</span></div></div>
        {can(me, "bill") && <a href="#/bill" className="newbill"><Icon n="plus" size={18} /><span className="t">{t("New bill")}</span><kbd style={{ background: "rgba(255,255,255,.15)", color: "#fff" }}>F2</kbd></a>}
        <button className="railsearch" onClick={() => setPal(true)}><Icon n="search" size={17} /><span className="grow">Search</span><kbd>Ctrl K</kbd></button>
        {visible.map(s => <a key={s.key} href={hrefOf(s)} title={t(s.label)} aria-label={t(s.label) + (s.key === "sell" && waiting ? ` · ${waiting} waiting` : "")} className={"nav" + (sec === s.key ? " on" : "")}><Icon n={s.icon} /><span className="grow">{t(s.label)}</span>{s.key === "sell" && waiting > 0 && <span className="navbadge" title={`${waiting} trade order${waiting > 1 ? "s" : ""} / dealer sign-up${waiting > 1 ? "s" : ""} waiting`}>{waiting > 9 ? "9+" : waiting}</span>}</a>)}
        {me.role === "owner" && <label className="f store-switch">Store<select className="in" value={store} onChange={e => switchStore(e.target.value)}>{stores.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        {can(me, "stores.transfer") && <a className="nav" href="#/stores" title="Transfers and stores" aria-label="Transfers and stores"><Icon n="stock" /><span>Transfers{me.role === "owner" ? " & stores" : ""}</span></a>}
        {can(me, "bank.reconcile") && <a className="nav" href="#/bank" title="Bank reconciliation" aria-label="Bank reconciliation"><Icon n="sales" /><span>Bank reconciliation</span></a>}
        <div className="railfoot">
          <Status />
          <button className="me" onClick={() => setMe(null)} title="Switch person">
            <span className="av">{me.name.slice(0, 1).toUpperCase()}</span>
            <span className="grow"><b className="sm">{me.name}</b><small>{roleName(me)} · tap to switch</small></span><Icon n="lock" size={16} />
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="top">
          <button className="iconbtn menu-toggle" title={compact ? "Show menu" : "Hide menu"} aria-label={compact ? "Show menu" : "Hide menu"} onClick={() => { setCompact(!compact); setSetting("compact_menu", !compact); }}>{compact ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
          <span className="brandm"><span className="mark">R</span>{cur.label === "Home" ? "Rungnna" : t(cur.label)}</span>
          <span className="grow" />
          {me.role === "owner" && <select aria-label="Store" className="in mobile-store" value={store} onChange={e => switchStore(e.target.value)}>{stores.map(s => <option key={s.id} value={s.id}>{s.code}</option>)}</select>}
          <button className="iconbtn" aria-label="Search" onClick={() => setPal(true)}><Icon n="search" size={18} /></button>
          <button className="avatar" onClick={() => go("settings")} aria-label="Me">{me.name.slice(0, 1).toUpperCase()}</button>
        </div>
        {tabs && tabs.length > 1 && (
          <div className={"subnav" + (scrolled ? " scrolled" : "")}>
            <nav className="tabs">{tabs.map(([k, label]) => <a key={k} href={"#/" + k} className={tabOn(k) ? "on" : ""} ref={el => { if (el && tabOn(k)) el.scrollIntoView({ block: "nearest", inline: "center" }); }}>{t(label)}</a>)}</nav>
            {!!hidden.length && <span className="xs mut tabs-hidden" title={hidden.join(", ")}>
              {hidden.length} more {hidden.length === 1 ? "screen needs" : "screens need"} another role — <button type="button" className="linkbtn" onClick={() => setMe(null)}>switch person</button>
            </span>}
            <span className="grow" /><Status />
          </div>)}
        <main className={"page" + (route === "bill" ? " wide" : "")}>
          <Guard key={store + route + (args[0] || "")}>
            {sec === "stock" && <Suspense fallback={null}><StockAI route={route} /></Suspense>}
            <Suspense fallback={<Loading />}><div className="pagein">{page}</div></Suspense>
          </Guard>
        </main>
      </div>
      <nav className="tabbar">
        {[visible.find(s => s.key === "home"), visible.find(s => s.key === "sell")].filter(Boolean).map(s => <a key={s!.key} href={hrefOf(s!)} className={sec === s!.key ? "on" : ""}><Icon n={s!.icon} size={22} />{t(s!.label)}</a>)}
        <a href={ok("stockin") ? "#/stockin" : "#/"} className="fab"><span className="c"><Icon n="scan" size={24} sw={2} /></span></a>
        {[visible.find(s => s.key === "stock"), visible.find(s => s.key === "reports") || visible.find(s => s.key === "ask") || visible.find(s => s.key === "settings")].filter(Boolean).map(s => <a key={s!.key} href={hrefOf(s!)} className={sec === s!.key ? "on" : ""}><Icon n={s!.icon} size={22} />{t(s!.label)}</a>)}
      </nav>
      {pal && <SearchPalette onClose={() => setPal(false)} />}
      <UpdateBar />
    </div>
  );
}

/* One broken screen must never take the shop down: show a calm card, keep the rest working.
   After an update the old screen files are gone — reload once to pick up the new ones. */
class Guard extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) {
    const chunk = /dynamically imported module|Failed to fetch|Importing a module script failed|error loading/i.test(err.message);
    if (chunk && !sessionStorage.getItem("rj_reloaded")) { sessionStorage.setItem("rj_reloaded", "1"); location.reload(); }
    console.error(err);
  }
  render() {
    if (!this.state.err) return this.props.children;
    return <div className="card empty"><b>This screen hit a problem</b><div className="sm" style={{ margin: "6px 0 14px" }}>Your data is safe on this device. Try again, or go Home.</div>
      <div className="row" style={{ justifyContent: "center" }}><button className="btn p" onClick={() => location.reload()}>Try again</button><a className="btn" href="#/home" onClick={() => this.setState({ err: null })}>Home</a></div>
      <div className="xs mut" style={{ marginTop: 10 }}>{String(this.state.err.message).slice(0, 140)}</div></div>;
  }
}

function UpdateBar() {
  const [ready, setReady] = useState(false);
  useEffect(() => onUpdate(setReady), []);
  if (!ready) return null;
  return <div className="updatebar">New version ready<button className="btn sm" onClick={() => { setReady(false); void applyUpdate(); }}>Update</button></div>;
}

function NoAccess() {
  return <div className="card empty"><b>Not available for your role</b>Ask the owner to change your role in Settings → Staff.</div>;
}

export default function App() {
  return <AppProvider><OwnerGate><Shell /></OwnerGate><Toasts /></AppProvider>;
}
