import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/dm-sans/400.css";
import "@fontsource/dm-sans/500.css";
import "@fontsource/dm-sans/600.css";
import "@fontsource/dm-sans/700.css";
import "@fontsource/space-grotesk/500.css";
import "@fontsource/space-grotesk/600.css";
import "./styles.css";
import "./light-theme.css";
import App from "./App";
try {
  const saved = localStorage.getItem("romdock-theme");
  document.documentElement.dataset.theme = saved === "light" ? "light" : "dark";
  document.documentElement.style.colorScheme =
    saved === "light" ? "light" : "dark";
} catch {
  document.documentElement.dataset.theme = "dark";
}
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
