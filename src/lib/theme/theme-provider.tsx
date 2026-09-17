"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { isScreeningPath, readThemeChoice, resolveDark, THEME_STORAGE_KEY, type ThemeChoice } from "./screening";

export type ThemeMode = ThemeChoice;

const ThemeContext = createContext<{
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
}>({
  theme: "default",
  setTheme: () => {},
});

function readStoredTheme(): ThemeMode {
  // try/catch: with "Block all cookies" set, touching localStorage throws.
  try {
    return readThemeChoice(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "default";
  }
}

// Two classes on <html>: `screening` for app routes (the Screening Room —
// see lib/theme/screening.ts) and `dark`. Both are recomputed on every route
// change, because a soft navigation between the site and the app keeps the
// root layout (and this provider) mounted.
function applyTheme(mode: ThemeMode, pathname: string | null) {
  const root = document.documentElement;
  const screening = isScreeningPath(pathname);
  const osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  root.classList.toggle("screening", screening);
  root.classList.toggle("dark", resolveDark(mode, screening, osDark));
}

// Layout effect on the client, plain effect on the server (where neither
// runs) — keeps React from warning during the server render.
const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("default");
  const pathname = usePathname();
  // The latest route for listeners bound once (the OS-theme watcher, the
  // setter). Written in the layout effect below, never during render.
  const pathRef = useRef(pathname);

  useEffect(() => {
    const initial = readStoredTheme();
    setThemeState(initial);
    applyTheme(initial, pathRef.current);

    // "Default" tracks the OS setting live, not just at load (outside the
    // app — inside it, Default is the Screening Room either way).
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      applyTheme(readStoredTheme(), pathRef.current);
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  // Before paint, so walking from /pricing into /app (or back) never shows
  // one frame of the other side's theme.
  useIsomorphicLayoutEffect(() => {
    pathRef.current = pathname;
    applyTheme(readStoredTheme(), pathname);
  }, [pathname]);

  function setTheme(mode: ThemeMode) {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage blocked — the choice still applies for this visit.
    }
    setThemeState(mode);
    applyTheme(mode, pathRef.current);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

// The pre-hydration script lives beside the rules it mirrors.
export { THEME_INIT_SCRIPT } from "./screening";
