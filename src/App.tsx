import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { AppProvider, useApp, useRoute, Toasts, go } from "./lib/app";
import { startSync, onSync, type SyncState } from "./lib/sync";
import { warmScanner } from "./components/Scanner";
import { SearchPalette } from "./components/Search";
import { Icon } from "./components/Icon";
import { can } from "./lib/roles";
import Home from "./pages/Home";
import { WhoAreYou } from "./pages/Settings";

/* Pages load on first visit (fast start); the service worker keeps every piece for offline use. */
const Billing = lazy(() => import("./pages/Billing"));
const Bills = lazy(() => import("./pages/Bills"));
const Customers = lazy(() => import("./pages/Customers"));
const Ask = lazy(() => import("./pages/Ask"));
const Scan = lazy(() => import("./pages/Scan"));
const Labels = lazy(() => import("./pages/Labels"));
const Racks = lazy(() => import("./pages/Racks"));
const Move = lazy(() => import("./pages/Move"));
const Products = lazy(() => import("./pages/Products"));
const Activity = lazy(() => import("./pages/Activity"));
const StockIn = lazy(() => import("./pages/StockIn"));
const Import = lazy(() => import("./pages/Import"));
const Settings = lazy(() => import("./pages/Settings"));

/* Five places. Everything else is a tab inside one of them. */
type Sec = { key: string; label: string; icon: string; tabs?: [string, string][] };
const SECTIONS: Sec[] = [
  { key: "home", label: "Home", icon: "home" },
  { key: "sell", label: "Sell", icon: "sell", tabs: [["bill", "New bill"], ["bills", "Bills"], ["customers", "Customers"]] },
  { key: "stock", label: "Stock", icon: "stock", tabs: [["products", "Products"], ["stockin", "Stock in"], ["scan", "Scan & record"], ["labels", "Labels"], ["racks", "Racks"], ["move", "Move"], ["activity", "Activity"], ["import", "Import"]] },
  { key: "ask", label: "Ask", icon: "ask" },
  { key: "settings", label: "Settings", icon: "settings" },
];
const sectionOf = (r: string) => (["bill", "bills", "customers"].includes(r) ? "sell" : ["products", "product", "stockin", "scan", "labels", "racks", "move", "activity", "import"].includes(r) ? "stock" : r === "ask" || r === "settings" ? r : "home");
const lastTab: Record<string, string> = { sell: "bill", stock: "products" };

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
  const { me, setMe, ready } = useApp();
  const [route, args] = useRoute();
  const [pal, setPal] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const sec = sectionOf(route);
  useEffect(() => { startSync(); warmScanner(); }, []);
  useEffect(() => { if (sec === "sell" || sec === "stock") lastTab[sec] = route === "product" ? "products" : route; window.scrollTo({ top: 0 }); }, [route]);
  useEffect(() => { const f = () => setScrolled(scrollY > 4); addEventListener("scroll", f, { passive: true }); return () => removeEventListener("scroll", f); }, []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPal(true); }
      if (e.key === "F2" && route !== "bill") { e.preventDefault(); go("bill"); }
    };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  }, [route]);
  if (!ready) return null;
  if (!me) return <WhoAreYou />;

  const visible = SECTIONS.filter(s => (s.key !== "sell" || can(me, "bill")) && (s.key !== "ask" || can(me, "ai")));
  const cur = SECTIONS.find(s => s.key === sec)!;
  const hrefOf = (s: Sec) => "#/" + (s.tabs ? lastTab[s.key] || s.tabs[0][0] : s.key);
  const tabs = cur.tabs?.filter(([k]) => (k !== "bill" || can(me, "bill")) && (k !== "import" || can(me, "settings")));
  const tabOn = (k: string) => route === k || (k === "products" && route === "product");

  let page: ReactNode;
  switch (route) {
    case "bill": page = can(me, "bill") ? <Billing args={args} /> : <NoAccess />; break;
    case "bills": page = can(me, "bill") ? <Bills args={args} /> : <NoAccess />; break;
    case "customers": page = can(me, "bill") ? <Customers args={args} /> : <NoAccess />; break;
    case "ask": page = can(me, "ai") ? <Ask /> : <NoAccess />; break;
    case "scan": page = <Scan />; break;
    case "labels": page = <Labels args={args} />; break;
    case "racks": page = <Racks args={args} />; break;
    case "move": page = <Move args={args} />; break;
    case "products": page = <Products args={[]} />; break;
    case "product": page = <Products args={args} />; break;
    case "activity": page = <Activity />; break;
    case "stockin": page = <StockIn args={args} />; break;
    case "import": page = can(me, "settings") ? <Import /> : <NoAccess />; break;
    case "settings": page = <Settings />; break;
    default: page = <Home />;
  }

  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand"><span className="mark">R</span><div><b>Rungnna</b><span>Jewellery &amp; Co</span></div></div>
        {can(me, "bill") && <a href="#/bill" className="newbill"><Icon n="plus" size={18} />New bill<kbd style={{ background: "rgba(255,255,255,.15)", color: "#fff" }}>F2</kbd></a>}
        <button className="railsearch" onClick={() => setPal(true)}><Icon n="search" size={17} /><span className="grow">Search</span><kbd>Ctrl K</kbd></button>
        {visible.map(s => <a key={s.key} href={hrefOf(s)} className={"nav" + (sec === s.key ? " on" : "")}><Icon n={s.icon} /><span className="grow">{s.label}</span></a>)}
        <div className="railfoot">
          <Status />
          <button className="me" onClick={() => setMe(null)} title="Switch person">
            <span className="av">{me.name.slice(0, 1).toUpperCase()}</span>
            <span className="grow"><b className="sm">{me.name}</b><small>{me.role} · tap to switch</small></span><Icon n="lock" size={16} />
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="top">
          <span className="brandm"><span className="mark">R</span>{cur.label === "Home" ? "Rungnna" : cur.label}</span>
          <span className="grow" />
          <button className="iconbtn" aria-label="Search" onClick={() => setPal(true)}><Icon n="search" size={18} /></button>
          <button className="avatar" onClick={() => go("settings")} aria-label="Me">{me.name.slice(0, 1).toUpperCase()}</button>
        </div>
        {tabs && tabs.length > 1 && (
          <div className={"subnav" + (scrolled ? " scrolled" : "")}>
            <nav className="tabs">{tabs.map(([k, t]) => <a key={k} href={"#/" + k} className={tabOn(k) ? "on" : ""}>{t}</a>)}</nav>
            <span className="grow" /><Status />
          </div>)}
        <main className={"page" + (route === "bill" ? " wide" : "")}>
          <Suspense fallback={<Loading />}><div key={route + (args[0] || "")} className="pagein">{page}</div></Suspense>
        </main>
      </div>
      <nav className="tabbar">
        {[visible.find(s => s.key === "home"), visible.find(s => s.key === "sell")].filter(Boolean).map(s => <a key={s!.key} href={hrefOf(s!)} className={sec === s!.key ? "on" : ""}><Icon n={s!.icon} size={22} />{s!.label}</a>)}
        <a href="#/stockin" className="fab"><span className="c"><Icon n="scan" size={24} sw={2} /></span></a>
        {[visible.find(s => s.key === "stock"), visible.find(s => s.key === "ask") || visible.find(s => s.key === "settings")].filter(Boolean).map(s => <a key={s!.key} href={hrefOf(s!)} className={sec === s!.key ? "on" : ""}><Icon n={s!.icon} size={22} />{s!.label}</a>)}
      </nav>
      {pal && <SearchPalette onClose={() => setPal(false)} />}
    </div>
  );
}

function NoAccess() {
  return <div className="card empty"><b>Not available for your role</b>Ask the owner to change your role in Settings → Staff.</div>;
}

export default function App() {
  return <AppProvider><Shell /><Toasts /></AppProvider>;
}
