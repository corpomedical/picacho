import Link from "next/link";
import { InstallBadges } from "@/components/install-badges";
import { getServerMessages } from "@/lib/i18n/server";
import { isNativeApp } from "@/lib/native/server";
import { LEGAL_ENTITY } from "@/lib/legal-entity";
import { createAdminClient } from "@/lib/supabase/server";

// Whether the public gallery has anything to show — the sitewide "Made with
// Picacho" link landing on an EMPTY page was the audit's cheapest
// trust-killer: a proof link that proves nothing. Same filters as the
// gallery page's own query, as a head-count. Best-effort: on any failure
// the link renders (the page itself has an honest empty state), so this can
// only ever hide a dead end, never break the footer. Featuring a render in
// Admin makes the link reappear on the next request.
async function galleryHasItems(): Promise<boolean> {
  try {
    const admin = createAdminClient();
    const { count, error } = await admin
      .from("generations")
      .select("id, profiles!inner(role)", { count: "exact", head: true })
      .eq("status", "succeeded")
      .not("featured_at", "is", null)
      .is("deleted_at", null)
      .eq("profiles.role", "admin");
    if (error) return true;
    return (count ?? 0) > 0;
  } catch {
    return true;
  }
}

// `dark` (2026-09-02): the homepage went full dark — the footer follows
// with pinned literals there (the .dark theme remap must not touch it),
// while every other marketing page keeps the light footer.
export async function MarketingFooter({ dark = false }: { dark?: boolean } = {}) {
  const { t } = await getServerMessages();
  // Hide the Pricing footer link in the native app (Apple 3.1.1 / Google
  // Play) — even a footer link to pricing counts as a purchase entry point.
  const native = await isNativeApp();
  const showGallery = await galleryHasItems();
  const link = dark ? "transition-colors hover:text-[#f7f6f4]" : "hover:text-neutral-900";
  const subLink = dark ? "transition-colors hover:text-[#f7f6f4]/70" : "hover:text-neutral-700";

  return (
    <footer className={dark ? "border-t border-[#f7f6f4]/[0.08] bg-[#101014]" : "border-t border-neutral-200/70"}>
      <div className="mx-auto flex max-w-5xl justify-center px-8 pt-8 sm:justify-start">
        <InstallBadges variant="footer" dark={dark} />
      </div>
      <div
        className={
          dark
            ? "mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-8 py-8 text-sm text-[#f7f6f4]/50 sm:flex-row"
            : "mx-auto flex max-w-5xl flex-col items-center justify-between gap-4 px-8 py-8 text-sm text-neutral-500 sm:flex-row"
        }
      >
        <p>
          © {new Date().getFullYear()} Picacho — {t.marketing.footer.rights} ·{" "}
          {LEGAL_ENTITY.name} · NIF {LEGAL_ENTITY.nif} · Madrid
        </p>
        <div className="flex flex-col items-center gap-3 sm:items-end">
          <div className="flex flex-wrap items-center justify-center gap-6 sm:justify-end">
            {!native && (
              <Link href="/pricing" className={link}>
                {t.marketing.nav.pricing}
              </Link>
            )}
            {/* Public showcase gallery — safe inside the native app too:
                it's proof-of-output, not a purchase entry point. Hidden
                while the gallery is empty (see galleryHasItems above). */}
            {showGallery && (
              <Link href="/gallery" className={link}>
                {t.marketing.footer.madeWith}
              </Link>
            )}
            <Link href="/login" className={link}>
              {t.marketing.nav.login}
            </Link>
            <Link href="/signup" className={link}>
              {t.marketing.nav.signup}
            </Link>
            <Link href="/privacy" className={link}>
              {t.marketing.footer.privacy}
            </Link>
            <Link href="/terms" className={link}>
              {t.marketing.footer.terms}
            </Link>
            <Link href="/content-policy" className={link}>
              {t.marketing.footer.contentPolicy}
            </Link>
          </div>
          {/* Comparison pages — hidden in the native app like the Pricing
              link above, because they are wall-to-wall prices (Apple 3.1.1 /
              Google Play). Link labels are brand names, kept literal. */}
          {!native && (
            <div
              className={
                dark
                  ? "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-[#f7f6f4]/35 sm:justify-end"
                  : "flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-xs text-neutral-400 sm:justify-end"
              }
            >
              <Link href="/guides" className={subLink}>
                {t.marketing.footer.guides}
              </Link>
              <span>{t.marketing.footer.compare}:</span>
              <Link href="/compare/heygen" className={subLink}>
                Picacho vs HeyGen
              </Link>
              <Link href="/compare/hedra" className={subLink}>
                Picacho vs Hedra
              </Link>
              <Link href="/compare/renoise" className={subLink}>
                Picacho vs Renoise
              </Link>
              <Link href="/compare/imagineart" className={subLink}>
                Picacho vs ImagineArt
              </Link>
              <Link href="/compare/higgsfield" className={subLink}>
                Picacho vs Higgsfield
              </Link>
            </div>
          )}
        </div>
      </div>
    </footer>
  );
}
