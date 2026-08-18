import Link from "next/link";
import { InstallBadges } from "@/components/install-badges";
import { getServerMessages } from "@/lib/i18n/server";
import { isNativeApp } from "@/lib/native/server";

export async function MarketingFooter() {
  const { t } = await getServerMessages();
  // Hide the Pricing footer link in the native app (Apple 3.1.1 / Google
  // Play) — even a footer link to pricing counts as a purchase entry point.
  const native = await isNativeApp();

  return (
    <footer className="border-t border-neutral-200/70">
      <div className="mx-auto flex max-w-5xl justify-center px-8 pt-8 sm:justify-start">
        <InstallBadges variant="footer" />
      </div>
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-8 py-8 text-sm text-neutral-500 sm:flex-row">
        <p>
          © {new Date().getFullYear()} Picacho — {t.marketing.footer.rights}
        </p>
        <div className="flex flex-wrap items-center justify-center gap-6">
          {!native && (
            <Link href="/pricing" className="hover:text-neutral-900">
              {t.marketing.nav.pricing}
            </Link>
          )}
          <Link href="/login" className="hover:text-neutral-900">
            {t.marketing.nav.login}
          </Link>
          <Link href="/signup" className="hover:text-neutral-900">
            {t.marketing.nav.signup}
          </Link>
          <Link href="/privacy" className="hover:text-neutral-900">
            {t.marketing.footer.privacy}
          </Link>
          <Link href="/terms" className="hover:text-neutral-900">
            {t.marketing.footer.terms}
          </Link>
          <Link href="/content-policy" className="hover:text-neutral-900">
            {t.marketing.footer.contentPolicy}
          </Link>
        </div>
      </div>
    </footer>
  );
}
