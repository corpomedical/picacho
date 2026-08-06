"use client";

import { createContext, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import type { Locale } from "@/lib/i18n/locales";
import { getMessages, type Messages } from "@/lib/i18n/messages";
import { setLocaleCookie } from "@/lib/i18n/actions";

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
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const router = useRouter();

  function setLocale(next: Locale) {
    setLocaleState(next);
    // Client Components using useLocale() update immediately; Server
    // Components (marketing/legal pages) need a refresh to re-read the
    // cookie on their next render.
    setLocaleCookie(next).then(() => router.refresh());
  }

  return (
    <LocaleContext.Provider value={{ locale, t: getMessages(locale), setLocale }}>
      {children}
    </LocaleContext.Provider>
  );
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error("useLocale must be used within a LocaleProvider");
  return ctx;
}
