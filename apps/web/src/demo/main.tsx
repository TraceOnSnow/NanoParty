import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles.css";
import "./static.css";
import { StaticApp } from "./StaticApp.tsx";

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <StaticApp />
  </StrictMode>,
);
