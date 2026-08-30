import { headers } from "next/headers";
import type { Metadata } from "next";
import { LOCALES, DEFAULT_LOCALE, isLocale } from "@/lib/i18n/locales";
import { LOCALE_HEADER, localizedHref } from "@/lib/i18n/routing";

/**
 * Canonical + hreflang for a translated marketing page (2026-08-30).
 *
 * `basePath` is the ENGLISH path ("/pricing") — a literal in the calling page,
 * which is why no second header is needed to recover the pre-rewrite URL: the
 * page already knows its own path, and the locale comes from LOCALE_HEADER.
 *
 * THE CANONICAL IS DERIVED FROM THE URL, NEVER FROM getLocale(). That
 * distinction is the whole correctness of this: getLocale() also honours the
 * cookie, so a Spanish-cookied visitor on bare /pricing renders Spanish — but
 * that page must still declare canonical=/pricing. Pointing every locale's
 * canonical at the English page is the classic way to make Google drop all the
 * translations as duplicates; pointing the English page at a Spanish one
 * because of a cookie would be worse.
 *
 * The languages map is IDENTICAL on all four URLs. Reciprocal,
 * self-referencing hreflang is what Google requires: every variant must list
 * every variant, including itself.
 */
export async function localeAlternates(basePath: string): Promise<Metadata["alternates"]> {
  const raw = (await headers()).get(LOCALE_HEADER);
  const urlLocale = isLocale(raw) ? raw : DEFAULT_LOCALE;

  // x-default points at English on the bare path — the version served to
  // anyone whose language we don't publish.
  const languages: Record<string, string> = { "x-default": basePath };
  for (const { code } of LOCALES) languages[code] = localizedHref(basePath, code);

  return { canonical: localizedHref(basePath, urlLocale), languages };
}
