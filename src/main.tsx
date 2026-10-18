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

startUpdates();
setTimeout(() => sessionStorage.removeItem("rj_reloaded"), 15000);
const pr = document.createElement("div"); pr.id = "printroot"; document.body.appendChild(pr);
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
