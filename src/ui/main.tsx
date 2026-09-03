import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles.css";

interface DesktopBindings {
  fitDesktopWindow(screen: {
    availWidth: number;
    availHeight: number;
    availLeft: number;
    availTop: number;
    devicePixelRatio: number;
  }): Promise<unknown>;
}

const desktopBindings = (globalThis as unknown as { bindings?: DesktopBindings }).bindings;

async function mountApp() {
  if (desktopBindings?.fitDesktopWindow) {
    const desktopScreen = screen as Screen & { availLeft?: number; availTop?: number };
    await desktopBindings.fitDesktopWindow({
      availWidth: desktopScreen.availWidth,
      availHeight: desktopScreen.availHeight,
      availLeft: desktopScreen.availLeft ?? 0,
      availTop: desktopScreen.availTop ?? 0,
      devicePixelRatio: globalThis.devicePixelRatio,
    }).catch(() => undefined);
  }

  createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void mountApp();
