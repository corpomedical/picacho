import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/messages";

// For Server Components — reads the saved locale cookie directly (no
// context needed on the server). Falls back to English if it's missing or
// invalid.
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export async function getServerMessages() {
  const locale = await getLocale();
  return { locale, t: getMessages(locale) };
}
