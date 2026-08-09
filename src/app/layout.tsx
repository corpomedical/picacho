import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme/theme-provider";
import { PageViewTracker } from "@/components/page-view-tracker";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { LocaleProvider } from "@/lib/i18n/provider";
import { getLocale } from "@/lib/i18n/server";

const SITE_URL = "https://picacho.ai";
const DESCRIPTION = "The reliability layer for AI-generated character content.";

// picacho.io and picacho.ai both serve this same app (see LAUNCH_CHECKLIST.md
// — deliberately no redirect between them). Without a canonical, Google sees
// two complete duplicate sites and splits ranking signals across both.
// metadataBase + alternates.canonical below tell it picacho.ai is the real
// one; picacho.io stays reachable but stops competing with itself.
export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "Picacho",
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "Picacho",
    title: "Picacho — consistent AI character content, on the first try",
    description: DESCRIPTION,
    images: [{ url: "/og-image.png", width: 1200, height: 630, alt: "Picacho" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Picacho — consistent AI character content, on the first try",
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
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
