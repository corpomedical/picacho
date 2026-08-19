import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { FirstRunTour } from "@/components/first-run-tour";
import { InstallAppHint } from "@/components/install-app-hint";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { mediaUrl, toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";
import { PLAN_LABELS, type PlanId } from "@/lib/plans";

export const maxDuration = 300;

// The app's home. This used to be the bare composer in hero mode; now it's
// a real front door — credits at a glance, your characters one tap from a
// chat, your latest work, and the composer itself one tap away. The
// composer's own page (/app/generate) is unchanged and still does the
// heavy lifting; this page is deliberately light so it opens fast, which
// matters double now that Picacho installs to the home screen and this is
// the screen the app icon opens.
export default async function AppHome() {
  const { t } = await getServerMessages();
  const d = t.dashboard;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();

  const [{ data: profile }, workspace, { data: characters }, { data: recent }] = await Promise.all([
    supabase
      .from("profiles")
      .select("username, plan, role, has_completed_onboarding")
      .eq("id", data.user?.id ?? "")
      .single(),
    getGenerateWorkspaceData(supabase, data.user?.id),
    supabase
      .from("character_profiles")
      .select("id, name, reference_image_urls")
      .eq("user_id", data.user?.id ?? "")
      .order("created_at", { ascending: false })
      .limit(12),
    supabase
      .from("generations")
      .select("id, result_url, content_type, prompt_input")
      .eq("user_id", data.user?.id ?? "")
      .eq("status", "succeeded")
      .eq("content_type", "image")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(6),
  ]);

  const name = profile?.username ?? (data.user?.email ?? "").split("@")[0];
  const plan = (profile?.plan ?? "none") as PlanId;
  const { hasCharacter, creditsUsed, creditsLimit, purchasedCredits } = workspace;

  if (!hasCharacter) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center text-center">
        {profile?.has_completed_onboarding !== true && <FirstRunTour />}
        <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-atelier-ink">
          {formatMsg(d.greeting, { name })}
        </h1>
        <p className="mt-2 max-w-sm text-sm text-atelier-muted">{d.setupCharacterBody}</p>
        <Link href="/app/character/new" className="mt-6" data-tour-id="tour-create-character">
          <button className="inline-flex items-center justify-center gap-2 rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-90">{d.setupCharacterCta}</button>
        </Link>
      </div>
    );
  }

  const recentTiles = (recent ?? [])
    // Small tiles — the full image is one tap away on the history page.
    .map((g) => ({ ...g, displayUrl: thumbUrl(toMediaUrl(g.result_url), 320) }))
    .filter((g) => isRenderableUrl(g.displayUrl));

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      {/* Greeting + credits, one glance. */}
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-atelier-ink">
            {formatMsg(d.greeting, { name })}
          </h1>
          <p className="mt-1 text-xs text-atelier-muted">
            <span className="mr-1.5 rounded-full border border-atelier-rule px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-widest text-atelier-muted">
              {PLAN_LABELS[plan]}
            </span>
            {d.creditsTitle}: <span className="font-numeral text-[13px] font-medium tabular-nums text-atelier-accent">{creditsUsed}</span>
            {creditsLimit > 0 && <span className="font-numeral text-[13px] tabular-nums"> / {creditsLimit}</span>}
            {purchasedCredits > 0 && (
              <span className="ml-1.5 font-numeral tabular-nums">{formatMsg(d.creditsPurchased, { n: purchasedCredits })}</span>
            )}
          </p>
        </div>
        <Link href="/app/generate">
          <button className="inline-flex items-center justify-center gap-2 rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-90">{d.continueCreating}</button>
        </Link>
      </div>

      {/* Quick actions. */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { href: "/app/generate?type=image", label: d.quickImage, icon: ImageIcon },
          { href: "/app/generate?type=video", label: d.quickVideo, icon: FilmIcon },
          { href: "/app/tutorial", label: d.quickTutorial, icon: BookIcon },
        ].map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col items-start gap-2.5 rounded-control border border-atelier-rule bg-atelier-surface p-4 transition-colors hover:border-atelier-muted/70"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-atelier-ink/5 text-atelier-ink">
              <Icon className="h-4 w-4" />
            </span>
            <span className="text-xs font-medium leading-snug text-atelier-ink">{label}</span>
          </Link>
        ))}
      </div>

      {/* Characters strip. */}
      <section className="border-t border-atelier-rule pt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{d.yourCharacters}</h2>
          <Link href="/app/character" className="text-xs text-atelier-muted hover:text-atelier-ink">
            {d.seeAll}
          </Link>
        </div>
        <div className="flex gap-3 overflow-x-auto pb-1">
          {(characters ?? []).map((c) => {
            const thumb = c.reference_image_urls?.[0]
              ? thumbUrl(mediaUrl("character-references", c.reference_image_urls[0]), 320)
              : null;
            return (
              <Link
                key={c.id}
                href={`/app/generate?character=${c.id}`}
                className="group w-16 flex-shrink-0 text-center"
              >
                <div className="h-16 w-16 overflow-hidden rounded-full border border-atelier-rule bg-atelier-ink/5 transition-transform group-hover:scale-105">
                  {thumb && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                  )}
                </div>
                <p className="mt-1.5 truncate text-[11px] text-atelier-muted">{c.name}</p>
              </Link>
            );
          })}
          <Link href="/app/character/new" className="w-16 flex-shrink-0 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full border border-dashed border-atelier-rule text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink">
              <PlusIcon className="h-5 w-5" />
            </div>
            <p className="mt-1.5 truncate text-[11px] text-atelier-muted">{d.newCharacter}</p>
          </Link>
        </div>
      </section>

      {/* Recent creations. */}
      <section className="border-t border-atelier-rule pt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{d.recentCreations}</h2>
          <Link href="/app/images" className="text-xs text-atelier-muted hover:text-atelier-ink">
            {d.seeAll}
          </Link>
        </div>
        {recentTiles.length === 0 ? (
          <p className="rounded-control border border-dashed border-atelier-rule p-6 text-center text-xs text-atelier-muted">
            {d.emptyRecent}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {recentTiles.map((g) => (
              <Link
                key={g.id}
                href={`/app/history/${g.id}`}
                className="group relative aspect-square overflow-hidden rounded-media border border-atelier-rule bg-atelier-ink/5"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={g.displayUrl!}
                  alt={g.prompt_input ?? ""}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-105"
                />
              </Link>
            ))}
          </div>
        )}
      </section>

      <InstallAppHint />
    </div>
  );
}

function ImageIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="9" cy="9" r="2" />
      <path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21" />
    </svg>
  );
}

function FilmIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="3" />
      <path d="m10 9 5 3-5 3Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

function BookIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  );
}

function PlusIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}
