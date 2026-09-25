import { useEffect, useState } from "react";
import { AppProvider, useApp, useRoute, Toasts, go } from "./lib/app";
import { startSync, onSync, type SyncState } from "./lib/sync";
import { warmScanner } from "./components/Scanner";
import { SearchPalette } from "./components/Search";
import Home from "./pages/Home";
import Scan from "./pages/Scan";
import Labels from "./pages/Labels";
import Racks from "./pages/Racks";
import Move from "./pages/Move";
import Products from "./pages/Products";
import Activity from "./pages/Activity";
import Billing from "./pages/Billing";
import Bills from "./pages/Bills";
import Customers from "./pages/Customers";
import Ask from "./pages/Ask";
import Settings, { WhoAreYou } from "./pages/Settings";

/* Sidebar grouped the way a jewellery counter thinks: sell → stock → know → set up. */
const NAV: { g: string; items: [string, string, string, string?][] }[] = [
  { g: "Sell", items: [["bill", "New bill", "₹", "F2"], ["bills", "Bills", "▤"], ["customers", "Customers", "☺"]] },
  { g: "Stock", items: [["scan", "Scan & record", "▥"], ["products", "Products", "✦"], ["labels", "QR labels", "▣"], ["racks", "Floors & racks", "▦"], ["move", "Move & transfer", "⇄"]] },
  { g: "Know", items: [["home", "Dashboard", "◈"], ["ask", "Ask the shop", "✨"], ["activity", "Activity log", "❑"]] },
  { g: "Setup", items: [["settings", "Settings", "⚙"]] },
];
const TABS: [string, string, string][] = [["home", "Home", "◈"], ["products", "Stock", "✦"], ["bill", "Bill", "₹"], ["scan", "Scan", "▥"], ["more", "More", "☰"]];

function SyncChip() {
  const [s, setS] = useState<SyncState>();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => onSync(setS) as any, []);
  useEffect(() => { const a = () => setOnline(true), b = () => setOnline(false); addEventListener("online", a); addEventListener("offline", b); return () => { removeEventListener("online", a); removeEventListener("offline", b); }; }, []);
  const txt = !online ? "Offline · saving here" : s?.status === "syncing" ? "Syncing…" : s?.status === "error" ? "Sync problem" : s?.user ? "Backed up" : "Not connected";
  const cls = !online || s?.status === "error" || !s?.user ? "warn" : "ok";
  return <a href="#/settings" className={"pill " + cls} style={{ textDecoration: "none" }}><i className={"dot " + cls} />{txt}{s?.pending ? ` · ${s.pending}` : ""}</a>;
}

function Shell() {
  const { me, ready } = useApp();
  const [route, args] = useRoute();
  const [pal, setPal] = useState(false);
  const [more, setMore] = useState(false);
  useEffect(() => { startSync(); warmScanner(); }, []);
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPal(true); }
      if (e.key === "F2" && route !== "bill") { e.preventDefault(); go("bill"); }
    };
    addEventListener("keydown", f); return () => removeEventListener("keydown", f);
  }, [route]);
  useEffect(() => setMore(false), [route]);
  if (!ready) return null;
  if (!me) return <WhoAreYou />;
  const page = (() => {
    switch (route) {
      case "bill": return <Billing args={args} />;
      case "bills": return <Bills args={args} />;
      case "customers": return <Customers args={args} />;
      case "ask": return <Ask />;
      case "scan": return <Scan />;
      case "labels": return <Labels args={args} />;
      case "racks": return <Racks args={args} />;
      case "move": return <Move args={args} />;
      case "products": return <Products args={[]} />;
      case "product": return <Products args={args} />;
      case "activity": return <Activity />;
      case "settings": return <Settings />;
      default: return <Home />;
    }
  })();
  const on = (k: string) => route === k || (k === "products" && route === "product");
  const wide = route === "bill";
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand"><span className="mark">R</span><div><b>Rungnna</b><span>Jewellery &amp; Co</span></div></div>
        <button className="railsearch" onClick={() => setPal(true)}>⌕ Search <kbd>Ctrl K</kbd></button>
        {NAV.map(g => (
          <div key={g.g} className="navg"><div className="navh">{g.g}</div>
            {g.items.map(([k, t, i, key]) => <a key={k} href={"#/" + k} className={"nav" + (on(k) ? " on" : "") + (k === "bill" ? " cta" : "")}><i>{i}</i><span className="grow">{t}</span>{key && <kbd>{key}</kbd>}</a>)}</div>))}
        <div className="railfoot"><span>Signed in: <b>{me.name}</b> · {me.role}</span></div>
      </aside>
      <div className="main">
        <div className="top">
          <b className="disp topbrand">Rungnna</b>
          <button className="topsearch" onClick={() => setPal(true)}>⌕ <span>Search products, customers, bills…</span><kbd>Ctrl K</kbd></button>
          <span className="grow" />
          <SyncChip />
          <a href="#/settings" className="avatar" title={me.name}>{me.name.slice(0, 1).toUpperCase()}</a>
        </div>
        <main className={"page" + (wide ? " wide" : "")}>{page}</main>
      </div>
      <nav className="tabbar">{TABS.map(([k, t, i]) => k === "more"
        ? <button key={k} className={more ? "on" : ""} onClick={() => setMore(!more)}><i>{i}</i>{t}</button>
        : <a key={k} href={"#/" + k} className={(on(k) ? "on " : "") + (k === "bill" ? "scan" : "")}><i>{i}</i>{t}</a>)}</nav>
      {more && <div className="moresheet" onClick={() => setMore(false)}>
        <div className="card pad" onClick={e => e.stopPropagation()}>
          {NAV.map(g => <div key={g.g} className="stack" style={{ gap: 4, marginBottom: 10 }}><div className="navh dark">{g.g}</div>
            <div className="grid g3" style={{ gap: 6 }}>{g.items.map(([k, t, i]) => <a key={k} href={"#/" + k} className="moreitem"><i>{i}</i>{t}</a>)}</div></div>)}
          <button className="btn w" onClick={() => { setMore(false); setPal(true); }}>⌕ Search everything</button>
        </div></div>}
      {pal && <SearchPalette onClose={() => setPal(false)} />}
    </div>
  );
}

export default function App() {
  return <AppProvider><Shell /><Toasts /></AppProvider>;
}
