import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/language-switcher";
import { Logo } from "@/components/logo";
import { EarlyAccessBadge } from "@/components/early-access-badge";
import { GetAppButton } from "@/components/install-badges";
import { isNativeApp } from "@/lib/native/server";

// Async Server Component — checks the session so someone who's already
// logged in sees a way back into the app instead of "Log in"/"Sign up",
// which looked (and invited them) to authenticate all over again.
// `dark` (2026-09-02, the C×A front page): the homepage went near-black
// with the reel playing behind the header, so the header must render as
// light-on-dark REGARDLESS of the site theme — hence explicit literals
// here, not theme tokens, and the forceDark logo.
export async function MarketingHeader({ dark = false }: { dark?: boolean } = {}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(data.user);
  const { t } = await getServerMessages();
  // No pricing entry point inside the native app (Apple 3.1.1 / Google Play);
  // the install button and everything else stay put for both platforms.
  const native = await isNativeApp();

  return (
    <header
      // The dark variant draws NO border — the board's nav floats on the
      // playing reel with nothing across it.
      className={dark ? "relative z-10" : "border-b border-neutral-200/70"}
    >
      {/* Phone-width layout, 2026-08-19: px-8 + gap-6 + the badge used to
          overflow a 375px viewport, and the flexbox "resolved" that by
          painting the logo, badge, and nav links on top of each other —
          the first thing every mobile visitor saw was a pile of glyphs.
          Below sm: tighter padding and gaps, the (decorative) badge is
          dropped, and every text link is nowrap so "Log in" can't split
          into two lines. flex-shrink-0 on the logo keeps the wordmark
          from being compressed into the badge. */}
      <div
        className={
          dark
            ? "mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-5"
            : "mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-5"
        }>
        <Link href="/" className="flex flex-shrink-0 items-center gap-1">
          <Logo className="h-6" forceDark={dark} />
          <EarlyAccessBadge className="hidden sm:inline" dark={dark} />
        </Link>
        <nav
          className={
            dark
              ? "flex items-center gap-3 text-sm text-[#f7f6f4]/65 sm:gap-6"
              : "flex items-center gap-3 text-sm text-neutral-500 sm:gap-6"
          }
        >
          {!native && (
            <Link
              href="/pricing"
              className={
                dark
                  ? "whitespace-nowrap transition-colors hover:text-[#f7f6f4]"
                  : "whitespace-nowrap transition-colors hover:text-neutral-900"
              }
            >
              {t.marketing.nav.pricing}
            </Link>
          )}
          {/* One quiet install entry point on every marketing page — it
              costs no vertical space, which the hero placement did. */}
          {dark ? <GetAppButton variant="darkText" /> : <GetAppButton />}
          {isLoggedIn ? (
            <Link href="/app" className="flex-shrink-0">
              {dark ? (
                <span className="inline-flex items-center rounded-[8px] bg-[#f7f6f4] px-4 py-2 text-[13.5px] font-medium text-[#1c1c1e] transition-opacity hover:opacity-90">
                  {t.marketing.nav.goToApp}
                </span>
              ) : (
                <Button size="sm">{t.marketing.nav.goToApp}</Button>
              )}
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className={
                  dark
                    ? "whitespace-nowrap transition-colors hover:text-[#f7f6f4]"
                    : "whitespace-nowrap transition-colors hover:text-neutral-900"
                }
              >
                {t.marketing.nav.login}
              </Link>
              <Link href="/signup" className="flex-shrink-0">
                {dark ? (
                  <span className="inline-flex items-center whitespace-nowrap rounded-[8px] bg-[#f7f6f4] px-4 py-2 text-[13.5px] font-medium text-[#1c1c1e] transition-opacity hover:opacity-90">
                    {t.marketing.nav.signup}
                  </span>
                ) : (
                  <Button size="sm" className="whitespace-nowrap">
                    {t.marketing.nav.signup}
                  </Button>
                )}
              </Link>
            </>
          )}
          <LanguageSwitcher
            compact
            triggerClassName={dark ? "text-[#f7f6f4]/65 hover:text-[#f7f6f4]" : undefined}
          />
        </nav>
      </div>
    </header>
  );
}
