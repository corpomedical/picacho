import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider, THEME_INIT_SCRIPT } from "@/lib/theme/theme-provider";
import { PageViewTracker } from "@/components/page-view-tracker";
import { CookieConsentBanner } from "@/components/cookie-consent-banner";
import { LocaleProvider } from "@/lib/i18n/provider";
import { getLocale } from "@/lib/i18n/server";

export const metadata: Metadata = {
  title: "Picacho",
  description: "The reliability layer for AI-generated character content.",
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
