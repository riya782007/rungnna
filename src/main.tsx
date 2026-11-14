import { lazy, Suspense } from "react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/plus-jakarta-sans/latin-400.css";
import "@fontsource/plus-jakarta-sans/latin-500.css";
import "@fontsource/plus-jakarta-sans/latin-600.css";
import "@fontsource/plus-jakarta-sans/latin-700.css";
import "@fontsource/cormorant-garamond/latin-600.css";
import "@fontsource/cormorant-garamond/latin-700.css";
/* the narrow type on the shop's stickers: bundled, so labels look the same on every computer and offline */
import "@fontsource/roboto-condensed/latin-500.css";
import "@fontsource/roboto-condensed/latin-700.css";
import "./styles.css";
import { startUpdates } from "./lib/update";
import { finishEmailLink } from "./lib/sync";
import { getSetting } from "./lib/db";
import { setRollMax } from "./lib/printing";

startUpdates();
// how long a page this computer's roll printer takes (Settings › Bill printing)
getSetting("roll_max_page", 280).then(setRollMax).catch(() => {});
setTimeout(() => sessionStorage.removeItem("rj_reloaded"), 15000);
// keep the PIN code list on this computer for the customer forms, so it is there when the internet is not
setTimeout(() => { if (navigator.onLine) fetch("/pincodes.txt").catch(() => {}); }, 60_000);
const pr = document.createElement("div"); pr.id = "printroot"; document.body.appendChild(pr);
/* A customer opening a video-call link sees only the call — no shop login (owner's list R-51). */
const guestRoom = location.hash.match(/^#\/call\/([a-z0-9]{6,16})$/)?.[1];
const GuestCall = lazy(() => import("./pages/Call"));
const start = () => createRoot(document.getElementById("root")!).render(guestRoom
  ? <Suspense fallback={null}><GuestCall room={guestRoom} host={false} /></Suspense>
  : <StrictMode><App /></StrictMode>);
// an emailed sign-in link brings the login in the address: take it before the screens read the address
if (/access_token=|error_description=/.test(location.hash)) finishEmailLink().catch(() => {}).finally(start);
else start();
