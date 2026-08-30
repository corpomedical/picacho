import { cookies, headers } from "next/headers";
import { LOCALE_HEADER } from "@/lib/i18n/routing";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";
import { getMessages } from "@/lib/i18n/messages";

// For Server Components — reads the saved locale cookie directly (no
// context needed on the server). Falls back to English if it's missing or
// invalid.
export async function getLocale(): Promise<Locale> {
  // URL beats cookie (2026-08-30). On a locale-prefixed URL the language is a
  // fact about the DOCUMENT, not a preference of the visitor — /es/pricing is
  // Spanish even for someone whose cookie says English, because that URL is
  // what Google indexed and what a share link points at.
  //
  // Set only by middleware, which deletes it on every non-matching request,
  // so it cannot be spoofed by a client sending its own header.
  const fromUrl = (await headers()).get(LOCALE_HEADER);
  if (isLocale(fromUrl)) return fromUrl;

  const store = await cookies();
  const raw = store.get(LOCALE_COOKIE)?.value;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

export async function getServerMessages() {
  const locale = await getLocale();
  return { locale, t: getMessages(locale) };
}
