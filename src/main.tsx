import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { startUpdates } from "./lib/update";

startUpdates();
setTimeout(() => sessionStorage.removeItem("rj_reloaded"), 15000);
const pr = document.createElement("div"); pr.id = "printroot"; document.body.appendChild(pr);
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
