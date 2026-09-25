import { useEffect, useState } from "react";
import { AppProvider, useApp, useRoute, Toasts } from "./lib/app";
import { startSync, onSync, type SyncState } from "./lib/sync";
import { warmScanner } from "./components/Scanner";
import Home from "./pages/Home";
import Scan from "./pages/Scan";
import Labels from "./pages/Labels";
import Racks from "./pages/Racks";
import Move from "./pages/Move";
import Products from "./pages/Products";
import Activity from "./pages/Activity";
import Settings, { WhoAreYou } from "./pages/Settings";

const NAV: [string, string, string][] = [
  ["home", "Dashboard", "▦"], ["scan", "Scan & record", "▥"], ["products", "Products", "✦"], ["labels", "QR labels", "▣"],
  ["racks", "Floors & racks", "▤"], ["move", "Move & transfer", "⇄"], ["activity", "Activity log", "❑"], ["settings", "Settings", "⚙"],
];
const TABS: [string, string, string][] = [["home", "Home", "▦"], ["products", "Stock", "✦"], ["scan", "Scan", "▥"], ["move", "Move", "⇄"], ["labels", "Labels", "▣"]];

function SyncChip() {
  const [s, setS] = useState<SyncState>();
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => onSync(setS) as any, []);
  useEffect(() => { const a = () => setOnline(true), b = () => setOnline(false); addEventListener("online", a); addEventListener("offline", b); return () => { removeEventListener("online", a); removeEventListener("offline", b); }; }, []);
  const txt = !online ? "Offline · saving on this device" : s?.status === "syncing" ? "Syncing…" : s?.status === "error" ? "Sync problem" : s?.user ? "Backed up" : "Not connected";
  const cls = !online || s?.status === "error" || !s?.user ? "warn" : "ok";
  return <a href="#/settings" className={"pill " + cls} style={{ textDecoration: "none" }}>{txt}{s?.pending ? ` · ${s.pending} to upload` : ""}</a>;
}

function Shell() {
  const { me, ready } = useApp();
  const [route, args] = useRoute();
  useEffect(() => { startSync(); warmScanner(); }, []);
  if (!ready) return null;
  if (!me) return <WhoAreYou />;
  const page = (() => {
    switch (route) {
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
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand"><span className="mark">R</span><div><b>Rungnna</b><span>Jewellery &amp; Co</span></div></div>
        {NAV.map(([k, t, i]) => <a key={k} href={"#/" + k} className={"nav" + (on(k) ? " on" : "")}><i>{i}</i>{t}</a>)}
        <div className="railfoot"><span>Signed in: <b>{me.name}</b></span><span className="xs">Billing (POS) — coming next</span></div>
      </aside>
      <div className="main">
        <div className="top"><b className="disp" style={{ fontSize: 18 }}>Rungnna</b><span className="grow" /><SyncChip /><a href="#/settings" className="pill" style={{ textDecoration: "none" }}>{me.name}</a></div>
        <main className="page">{page}</main>
      </div>
      <nav className="tabbar">{TABS.map(([k, t, i]) => <a key={k} href={"#/" + k} className={(on(k) ? "on " : "") + (k === "scan" ? "scan" : "")}><i>{i}</i>{t}</a>)}</nav>
    </div>
  );
}

export default function App() {
  return <AppProvider><Shell /><Toasts /></AppProvider>;
}
