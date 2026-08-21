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
        <div className="flex flex-col items-center gap-3 sm:items-end">
          <div className="flex flex-wrap items-center justify-center gap-6 sm:justify-end">
            {!native && (
              <Link href="/pricing" className="hover:text-neutral-900">
                {t.marketing.nav.pricing}
              </Link>
            )}
            {/* Public showcase gallery — safe inside the native app too:
                it's proof-of-output, not a purchase entry point. */}
            <Link href="/gallery" className="hover:text-neutral-900">
              {t.marketing.footer.madeWith}
            </Link>
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
          {/* Comparison pages — hidden in the native app like the Pricing
              link above, because they are wall-to-wall prices (Apple 3.1.1 /
              Google Play). Link labels are brand names, kept literal. */}
          {!native && (
            <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-neutral-400 sm:justify-end">
              <Link href="/guides" className="hover:text-neutral-700">
                {t.marketing.footer.guides}
              </Link>
              <span>{t.marketing.footer.compare}:</span>
              <Link href="/compare/heygen" className="hover:text-neutral-700">
                Picacho vs HeyGen
              </Link>
              <Link href="/compare/hedra" className="hover:text-neutral-700">
                Picacho vs Hedra
              </Link>
              <Link href="/compare/renoise" className="hover:text-neutral-700">
                Picacho vs Renoise
              </Link>
              <Link href="/compare/imagineart" className="hover:text-neutral-700">
                Picacho vs ImagineArt
              </Link>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
