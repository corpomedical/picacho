import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme/theme-provider";
import { PageViewTracker } from "@/components/page-view-tracker";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { LocaleProvider } from "@/lib/i18n/provider";
import { getLocale } from "@/lib/i18n/server";

const SITE_URL = "https://picacho.ai";
const DESCRIPTION = "The reliability layer for AI-generated character content.";
const TITLE = "Picacho — Consistent AI Character Content, On the First Try";

// picacho.io and picacho.ai both serve this same app (see LAUNCH_CHECKLIST.md
// — deliberately no redirect between them). Without a canonical, Google sees
// two complete duplicate sites and splits ranking signals across both.
// metadataBase + alternates.canonical below tell it picacho.ai is the real
// one; picacho.io stays reachable but stops competing with itself.
//
// title.default used to just be "Picacho" — a real name, but not a single
// word a stranger would ever type into Google, and not what shows up in the
// blue search-result link (the OG/Twitter titles below were already the
// descriptive version; the actual <title> tag, the one Google weighs most,
// was the plain one). title.template means every page under this layout
// that sets its own `title` (pricing, privacy, terms, content-policy) gets
// "<page> | Picacho" automatically instead of repeating "| Picacho" by hand
// on each one.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: TITLE, template: "%s | Picacho" },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  // Set GOOGLE_SITE_VERIFICATION in the production environment once Wigly
  // has the code from Google Search Console — see LAUNCH_CHECKLIST.md for
  // the exact steps. Left out entirely (rather than an empty string) when
  // unset, so there's no broken empty verification tag in the meantime.
  verification: process.env.GOOGLE_SITE_VERIFICATION
    ? { google: process.env.GOOGLE_SITE_VERIFICATION }
    : undefined,
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Picacho",
    title: TITLE,
    description: DESCRIPTION,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Picacho" }],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
};

// Organization structured data — site-wide (every page, via the root
// layout) rather than just the homepage, since this is identity
// information ("what/who is Picacho") that search engines use to build a
// knowledge panel and to attribute the logo to search results, not a
// per-page claim. Deliberately minimal: name, url, logo and a same-as back
// to the canonical domain — no aggregateRating, review, or offer fields,
// since those need to reflect something actually shown on the page and
// fabricating them risks a manual action from Google, not just no benefit.
const ORGANIZATION_JSON_LD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Picacho",
  url: SITE_URL,
  logo: `${SITE_URL}/logo.png`,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();

  return (
    <html lang={locale}>
      <head>
        {/* Runs before hydration so the right theme applies on first paint
            instead of flashing light and then switching to dark. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <LocaleProvider initialLocale={locale}>
            <PageViewTracker />
            {children}
            <CookieConsentBanner />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
