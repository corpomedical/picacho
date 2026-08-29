import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Archivo } from "next/font/google";
import "./globals.css";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme/theme-provider";
import { PageViewTracker } from "@/components/page-view-tracker";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { NativeChrome, SPLASH_HIDE_SCRIPT } from "@/components/native-chrome";
import { LocaleProvider } from "@/lib/i18n/provider";
import { getLocale } from "@/lib/i18n/server";
import { isNativeApp } from "@/lib/native/server";


// Marketing display face (see --font-display in globals.css). Downloaded at
// build time by next/font and self-hosted from our own domain — no runtime
// request to Google, no layout shift.
const archivo = Archivo({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-archivo",
  display: "swap",
});

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
// viewport-fit=cover is required for env(safe-area-inset-*) to report real
// values on iPhone — without it the notch and home-indicator padding in
// globals.css silently resolves to 0 and content slides under the hardware.
// maximumScale/userScalable stop the double-tap zoom that makes a webview
// feel like a webview; the app's own text controls remain unaffected.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

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
  // Installed-app behaviour (paired with app/manifest.ts). apple-touch-icon
  // is what iOS puts on the home screen; appleWebApp makes an installed
  // Picacho open full-screen instead of inside Safari chrome.
  icons: {
    icon: [{ url: "/icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: "/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Picacho",
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
  // Native-app detection (UA marker), used to gate the splash-dismiss
  // script below to the app shell so the website never ships it.
  const native = await isNativeApp();
  // Per-request CSP nonce, minted by middleware.ts. Our hand-written inline
  // script below must carry it or the browser refuses to run it under the
  // nonce-based script-src (Next stamps its OWN inline scripts with the
  // nonce automatically; this one is ours to stamp). Every page is already
  // dynamically rendered (getLocale reads cookies), so headers() adds no new
  // rendering constraint here. The JSON-LD block is inert data
  // (type="application/ld+json"), not executable script — CSP doesn't gate
  // it, so it needs no nonce.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html lang={locale} className={archivo.variable}>
      <head>
        {/* Runs before hydration so the right theme applies on first paint
            instead of flashing light and then switching to dark. */}
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* App shell only: dismisses the native splash on the first painted
            frame instead of after hydration — see SPLASH_HIDE_SCRIPT in
            native-chrome.tsx for the why. */}
        {native && <script nonce={nonce} dangerouslySetInnerHTML={{ __html: SPLASH_HIDE_SCRIPT }} />}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORGANIZATION_JSON_LD) }}
        />
      </head>
      <body className="antialiased">
        <ThemeProvider>
          <LocaleProvider initialLocale={locale}>
            <NativeChrome />
            <PageViewTracker />
            {children}
            <CookieConsentBanner />
          </LocaleProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
