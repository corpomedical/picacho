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
export async function MarketingHeader() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(data.user);
  const { t } = await getServerMessages();
  // No pricing entry point inside the native app (Apple 3.1.1 / Google Play);
  // the install button and everything else stay put for both platforms.
  const native = await isNativeApp();

  return (
    <header className="border-b border-neutral-200/70">
      {/* Phone-width layout, 2026-08-19: px-8 + gap-6 + the badge used to
          overflow a 375px viewport, and the flexbox "resolved" that by
          painting the logo, badge, and nav links on top of each other —
          the first thing every mobile visitor saw was a pile of glyphs.
          Below sm: tighter padding and gaps, the (decorative) badge is
          dropped, and every text link is nowrap so "Log in" can't split
          into two lines. flex-shrink-0 on the logo keeps the wordmark
          from being compressed into the badge. */}
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-4 sm:px-8 sm:py-5">
        <Link href="/" className="flex flex-shrink-0 items-center gap-1">
          <Logo className="h-6" />
          <EarlyAccessBadge className="hidden sm:inline" />
        </Link>
        <nav className="flex items-center gap-3 text-sm text-neutral-500 sm:gap-6">
          {!native && (
            <Link
              href="/pricing"
              className="whitespace-nowrap transition-colors hover:text-neutral-900"
            >
              {t.marketing.nav.pricing}
            </Link>
          )}
          {/* One quiet install entry point on every marketing page — it
              costs no vertical space, which the hero placement did. */}
          <GetAppButton />
          {isLoggedIn ? (
            <Link href="/app" className="flex-shrink-0">
              <Button size="sm">{t.marketing.nav.goToApp}</Button>
            </Link>
          ) : (
            <>
              <Link
                href="/login"
                className="whitespace-nowrap transition-colors hover:text-neutral-900"
              >
                {t.marketing.nav.login}
              </Link>
              <Link href="/signup" className="flex-shrink-0">
                <Button size="sm" className="whitespace-nowrap">
                  {t.marketing.nav.signup}
                </Button>
              </Link>
            </>
          )}
          <LanguageSwitcher compact />
        </nav>
      </div>
    </header>
  );
}
