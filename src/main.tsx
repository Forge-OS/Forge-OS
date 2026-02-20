import React from "react";
import ReactDOM from "react-dom/client";
import ForgeOS from "../forgeos-ui";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles/global.css";

declare global {
  interface Window {
    __FORGEOS_BOOTED__?: boolean;
    __FORGEOS_RENDERED__?: boolean;
  }
}

window.__FORGEOS_BOOTED__ = true;
document.documentElement.setAttribute("data-forgeos-booted", "1");

if(!window.__FORGEOS_RENDERED__) {
  window.__FORGEOS_RENDERED__ = true;
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ForgeOS />
      </ErrorBoundary>
    </React.StrictMode>
  );
}
