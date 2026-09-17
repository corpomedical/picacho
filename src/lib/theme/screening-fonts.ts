import { Archivo, DM_Mono, Newsreader } from "next/font/google";

// The Screening Room's three faces (direction A, 2026-09-17). Loaded from the
// APP layout only, so next/font preloads them on /app routes and the site —
// the landing page above all — never downloads a byte of them. Self-hosted
// from our own domain at runtime like the marketing Archivo in the root
// layout; no request to Google.
//
// Published to CSS as --font-*-face custom properties on :root (see
// SCREENING_FONT_VARS), not as next/font `variable` classes on the shell:
// menus and dialogs portal to <body>, outside the shell, and must read the
// same faces.

/** Archivo on its width axis, for the wide page titles (the `marquee` utility). */
const marquee = Archivo({
  subsets: ["latin"],
  weight: "variable",
  axes: ["wdth"],
  display: "swap",
});

/** DM Mono, the slate voice for labels (the `slate` utility and the base rule). */
const slate = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
});

/** Newsreader, the serif for every numeral (--font-numeral inside the app). */
const numeral = Newsreader({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
});

export const SCREENING_FONT_VARS = `:root{--font-marquee-face:${marquee.style.fontFamily};--font-slate-face:${slate.style.fontFamily};--font-numeral-face:${numeral.style.fontFamily};}`;
