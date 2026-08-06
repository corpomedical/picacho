"use server";

import { cookies } from "next/headers";
import { LOCALE_COOKIE, isLocale, type Locale } from "@/lib/i18n/locales";

// Invoked directly from the language switcher (a Client Component), not a
// native <form> action — just persists the choice, no redirect involved.
export async function setLocaleCookie(locale: Locale) {
  if (!isLocale(locale)) return;
  const store = await cookies();
  store.set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
    sameSite: "lax",
  });
}
