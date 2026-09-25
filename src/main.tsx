import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { registerSW } from "virtual:pwa-register";

registerSW({ immediate: true });
const pr = document.createElement("div"); pr.id = "printroot"; document.body.appendChild(pr);
createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);
