import React from "react";
import "./browserBridge";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./workspace.css";
import "./features/routes/routes.css";
import "./features/pages.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
