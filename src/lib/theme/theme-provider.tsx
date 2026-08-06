"use client";

import { createContext, useContext, useEffect, useState } from "react";

export type ThemeMode = "default" | "light" | "dark";

const THEME_STORAGE_KEY = "picacho_theme";

const ThemeContext = createContext<{
  theme: ThemeMode;
  setTheme: (mode: ThemeMode) => void;
}>({
  theme: "default",
  setTheme: () => {},
});

function applyTheme(mode: ThemeMode) {
  const isDark =
    mode === "dark" || (mode === "default" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", isDark);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("default");

  useEffect(() => {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null;
    const initial = saved ?? "default";
    setThemeState(initial);
    applyTheme(initial);

    // "Default" tracks the OS setting live, not just at load.
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      const current = (window.localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null) ?? "default";
      if (current === "default") applyTheme("default");
    }
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  function setTheme(mode: ThemeMode) {
    window.localStorage.setItem(THEME_STORAGE_KEY, mode);
    setThemeState(mode);
    applyTheme(mode);
  }

  return <ThemeContext.Provider value={{ theme, setTheme }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}

// Inlined into a <script> tag in the root layout, before hydration, so the
// correct theme applies on first paint instead of flashing light-then-dark.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var mode = localStorage.getItem("${THEME_STORAGE_KEY}") || "default";
    var isDark = mode === "dark" || (mode === "default" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    if (isDark) document.documentElement.classList.add("dark");
  } catch (e) {}
})();
`;
