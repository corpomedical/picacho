// Hand-rolled i18n (no next-intl / react-intl) — the sandbox this app is
// developed in has no npm registry access, so a new dependency can't be
// installed. This is a small, dependency-free system: a cookie remembers
// the choice, a Server Component helper reads it for server-rendered pages,
// and a Context provider makes it available to Client Components.
//
// Arabic is intentionally not listed yet — it needs right-to-left layout
// support (mirrored UI, not just translated strings), which is a separate,
// larger piece of work planned as a follow-up.

export const LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "pt", label: "Português" },
  { code: "it", label: "Italiano" },
] as const;

export type Locale = (typeof LOCALES)[number]["code"];

export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_COOKIE = "picacho_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return LOCALES.some((l) => l.code === value);
}

export function localeLabel(locale: Locale): string {
  return LOCALES.find((l) => l.code === locale)?.label ?? locale;
}
