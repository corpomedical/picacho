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

/**
 * Social-share (Open Graph + Twitter) block for a marketing page (2026-09-05
 * flaw hunt). Next does NOT deep-merge these with the root layout's: a page
 * that set nothing inherited the HOMEPAGE card wholesale — homepage title,
 * homepage description, and an og:url pointing back at "/" — so sharing
 * /pricing or a guide produced a homepage preview linking to the homepage.
 * And a page that set any single og field would silently drop the layout's
 * siteName and image. So pages pass their own title/description/path here
 * and get the complete block, siteName and image restated.
 *
 * `basePath` is the ENGLISH path — marketing metadata is English-only (same
 * convention as each caller's title/description), so the share URL is the
 * English canonical, the same URL hreflang x-default names. The root
 * layout's title.template ("%s | Picacho") applies only to the <title> tag,
 * never to og/twitter titles, so the suffix is appended here to match.
 */
export function marketingSocial(
  basePath: string,
  title: string,
  description: string,
): Pick<Metadata, "openGraph" | "twitter"> {
  const full = `${title} | Picacho`;
  return {
    openGraph: {
      type: "website",
      url: basePath,
      siteName: "Picacho",
      title: full,
      description,
      images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Picacho" }],
    },
    twitter: {
      card: "summary_large_image",
      title: full,
      description,
      images: ["/og-image.png"],
    },
  };
}
