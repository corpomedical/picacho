import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { LanguageSwitcher } from "@/components/language-switcher";

// Async Server Component — checks the session so someone who's already
// logged in sees a way back into the app instead of "Log in"/"Sign up",
// which looked (and invited them) to authenticate all over again.
export async function MarketingHeader() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const isLoggedIn = Boolean(data.user);
  const { t } = await getServerMessages();

  return (
    <header className="border-b border-neutral-200/70">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-8 py-5">
        <Link href="/" className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900 text-[11px] font-semibold text-white">
            P
          </span>
          <span className="text-sm font-semibold text-neutral-900">Picacho</span>
        </Link>
        <nav className="flex items-center gap-6 text-sm text-neutral-500">
          <Link href="/pricing" className="transition-colors hover:text-neutral-900">
            {t.marketing.nav.pricing}
          </Link>
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
