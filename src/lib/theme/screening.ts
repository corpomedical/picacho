// SCREENING ROOM (2026-09-17, operator-chosen direction A on the theme
// canvas: "Lets try A, but keep my actual landing page").
//
// The logged-in app wears the Screening Room: one warm-black ground, renders
// shown like a screening, wide Archivo titles, mono slate lines and serif
// numerals. The marketing site does not. That split cannot live in the
// tokens alone, because the landing page renders components the app shares
// (header, footer, pricing card) that read the same atelier-* and neutral
// tokens — retuning `.dark` would have repainted the landing page for every
// visitor whose OS is dark. So the new palette hangs off a second class on
// <html>, `screening`, which only app routes carry.
//
// Its own alias-free module so the rules are unit-testable and so the
// pre-hydration script and the provider can never disagree: both are built
// from the functions below.

/** The routes that wear the Screening Room: the logged-in app. */
export function isScreeningPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  return pathname === "/app" || pathname.startsWith("/app/");
}

export type ThemeChoice = "default" | "light" | "dark";

/**
 * Whether the page renders dark.
 *
 * Inside the app the Screening Room IS the default: "Default" means dark
 * there, whatever the OS says, and only an explicit "Light" brings the Frost
 * look back. Everywhere else "Default" still follows the OS, exactly as
 * before, so marketing pages behave the way they always have.
 */
export function resolveDark(mode: ThemeChoice, screening: boolean, osDark: boolean): boolean {
  if (mode === "dark") return true;
  if (mode === "light") return false;
  return screening || osDark;
}

/** Anything stored that is not one of the three choices reads as "default". */
export function readThemeChoice(raw: string | null | undefined): ThemeChoice {
  return raw === "light" || raw === "dark" ? raw : "default";
}

/** localStorage key for the Default / Light / Dark choice. */
export const THEME_STORAGE_KEY = "picacho_theme";

// Inlined into a <script> tag in the root layout, before hydration, so the
// correct theme applies on first paint instead of flashing light-then-dark.
// A string, so it cannot call the functions above: it mirrors them line for
// line, and screening.test.ts runs it against every combination and holds it
// to their answers.
export const THEME_INIT_SCRIPT = `
(function () {
  try {
    var path = window.location.pathname || "";
    var screening = path === "/app" || path.indexOf("/app/") === 0;
    var stored = null;
    try { stored = window.localStorage.getItem("${THEME_STORAGE_KEY}"); } catch (e) {}
    var mode = stored === "light" || stored === "dark" ? stored : "default";
    var osDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var isDark = mode === "dark" || (mode === "default" && (screening || osDark));
    var root = window.document.documentElement;
    if (screening) root.classList.add("screening");
    if (isDark) root.classList.add("dark");
  } catch (e) {}
})();
`;
