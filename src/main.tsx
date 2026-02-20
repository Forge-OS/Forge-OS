import React from "react";
import ReactDOM from "react-dom/client";
import ForgeOS from "../forgeos-ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ForgeOS />
    </ErrorBoundary>
  </React.StrictMode>
);
