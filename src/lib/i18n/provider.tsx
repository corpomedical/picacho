"use client";

import { createContext, useContext, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/locales";
import type { Messages } from "@/lib/i18n/messages";
import { setLocaleCookie } from "@/lib/i18n/actions";
import { matchLocalePrefix, localizedHref } from "@/lib/i18n/routing";

type LocaleContextValue = {
  locale: Locale;
  t: Messages;
  setLocale: (next: Locale) => void;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

// Seeded with the locale the server already resolved from the cookie (see
// getLocale() in server.ts), so there's no hydration mismatch and no
// flash — unlike ThemeProvider, which deliberately defers its first read
// because it depends on matchMedia, locale is already known at request time.
//
// ONE dictionary, passed from the server (2026-09-05 audit): this provider
// used to import getMessages, whose index statically pulls all FOUR locale
// catalogs into the client bundle — 114KB gzipped, ~38% of the homepage's
// JS, three quarters of it in languages the visitor isn't reading. The
// server resolves the locale anyway; it now serializes exactly one dict.
// A locale switch still round-trips (cookie + refresh/push, unchanged
// below), so the new dictionary arrives with the re-render — the switcher's
// highlight flips instantly via the optimistic locale; the copy follows a
// beat later, which is the moment the page repaints anyway.
export function LocaleProvider({
  initialLocale,
  messages,
  children,
}: {
  initialLocale: Locale;
  messages: Messages;
  children: React.ReactNode;
}) {
  const [optimisticLocale, setOptimisticLocale] = useState<Locale | null>(null);
  // Server truth wins the moment it catches up; until then the optimistic
  // value keeps the switcher's highlight honest about what was chosen.
  const locale = optimisticLocale ?? initialLocale;
  const router = useRouter();
  const pathname = usePathname();

  function setLocale(next: Locale) {
    setOptimisticLocale(next);
    // On a locale-prefixed URL (/es/pricing), the URL beats the cookie by
    // design — so a cookie-and-refresh here could not change the language,
    // and worse, the middleware re-stamped the URL's locale over the choice
    // on the way back (2026-08-31 inspection: picking English on /es/pricing
    // produced a mixed-language page and then erased the choice entirely).
    // The switch has to MOVE: to the same page's URL in the chosen language.
    // Everywhere else the cookie-and-refresh behaviour is unchanged.
    const prefixed = matchLocalePrefix(pathname ?? "");
    setLocaleCookie(next).then(() => {
      if (prefixed) {
        router.push(localizedHref(prefixed.basePath, next));
      } else {
        router.refresh();
      }
    });
  }

  return (
    <LocaleContext.Provider value={{ locale, t: messages, setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return ctx;
}
