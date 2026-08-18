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
      <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-5">
        <Link href="/" className="flex items-center gap-1">
          <Logo className="h-6" />
          <EarlyAccessBadge />
        </Link>
        <nav className="flex items-center gap-6 text-sm text-neutral-500">
          {!native && (
            <Link href="/pricing" className="transition-colors hover:text-neutral-900">
              {t.marketing.nav.pricing}
            </Link>
          )}
          {/* One quiet install entry point on every marketing page — it
              costs no vertical space, which the hero placement did. */}
          <GetAppButton />
          {isLoggedIn ? (
            <Link href="/app">
              <Button size="sm">{t.marketing.nav.goToApp}</Button>
            </Link>
          ) : (
            <>
              <Link href="/login" className="transition-colors hover:text-neutral-900">
                {t.marketing.nav.login}
              </Link>
              <Link href="/signup">
                <Button size="sm">{t.marketing.nav.signup}</Button>
              </Link>
            </>
          )}
          <LanguageSwitcher compact />
        </nav>
      </div>
    </header>
  );
}
