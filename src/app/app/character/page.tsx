import Link from "next/link";
import { mediaUrl, thumbUrl } from "@/lib/media/url";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { CastCard } from "@/components/cast-card";

export default async function CharacterListPage() {
  const { t } = await getServerMessages();
  const c = t.character;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) {
    return null; // AppLayout already redirects unauthenticated users to /login
  }

  // Explicit user_id filter, not just RLS — admins have a SELECT policy on
  // this table that intentionally returns every user's characters (that's
  // what /admin/users/[id] relies on), so without this an admin's own
  // "My characters" page would show every user's characters, not just
  // theirs. This was the bug: the row was visible here, but the reference
  // photo's signed URL still correctly failed (storage RLS is per-user and
  // has no admin bypass), so the name showed with a broken/blank thumbnail.
  const [{ data: profiles, error }, { data: projects }] = await Promise.all([
    supabase
      .from("character_profiles")
      .select("*")
      .eq("user_id", userData.user.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", userData.user.id),
  ]);

  if (error) {
    // Shows up in the Terminal running `npm run dev`.
    console.error("Failed to load character profiles:", error);
  }

  const projectNameById = new Map((projects ?? []).map((p) => [p.id, p.name]));

  // Stable capability URLs (see lib/media/url.ts): no storage round-trip
  // per character, and the browser caches each thumbnail forever instead of
  // re-downloading a 2 MB PNG on every visit because the signed token — and
  // with it the URL — changed.
  const withThumbnails = (profiles ?? []).map((profile) => {
    const firstPath = profile.reference_image_urls?.[0];
    return {
      ...profile,
      thumbnailUrl: firstPath
        ? thumbUrl(mediaUrl("character-references", firstPath), 640)
        : null,
    };
  });

  return (
    <div>
      {/* The cast wall itself is unchanged — photo-first 3:4 cards, the ochre
          photo-count meter, Generate on hover with the touch-safe fallback,
          all from the 2026-08-27 redesign. What changed on 2026-09-04 is the
          masthead (eyebrow + serif title, as History, the render page and
          Projects now wear) and the width: this was max-w-4xl inside a
          max-w-5xl shell, so the wall was narrower than the page holding it. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {c.eyebrow}
          </p>
          <h1 className="mt-1 font-numeral text-3xl font-semibold tracking-tight text-atelier-ink">
            {c.listTitle}
          </h1>
        </div>
        <Link href="/app/character/new">
          <button className="inline-flex items-center justify-center gap-2 rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-90">
            {c.newCharacter}
          </button>
        </Link>
      </div>

      <div className="mt-5 h-px bg-atelier-rule" />

      {error ? (
        <div className="mt-5 rounded-control border border-atelier-rule bg-atelier-surface p-8 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">
            {c.couldntLoad}
          </p>
        </div>
      ) : withThumbnails.length === 0 ? (
        <div className="mt-5 rounded-control border border-atelier-rule bg-atelier-surface p-8 text-center">
          <p className="text-sm text-atelier-muted">{c.noneYet}</p>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          {withThumbnails.map((profile) => {
            const photoCount = profile.reference_image_urls?.length ?? 0;
            const projectName = profile.project_id
              ? (projectNameById.get(profile.project_id) ?? null)
              : null;
            return (
              <CastCard
                key={profile.id}
                id={profile.id}
                name={profile.name}
                thumbnailUrl={profile.thumbnailUrl ?? null}
                photoCount={photoCount}
                subtitle={
                  [profile.voice_tone_tags?.join(", "), projectName].filter(Boolean).join(" · ") ||
                  null
                }
                generateLabel={t.nav.generate}
              />
            );
          })}
          <Link
            href="/app/character/new"
            className="flex aspect-[3/4] flex-col items-center justify-center gap-1 rounded-[16px] border-2 border-dashed border-atelier-rule text-sm text-atelier-muted transition-colors hover:border-atelier-muted hover:text-atelier-ink"
          >
            + {c.newCharacter}
          </Link>
        </div>
      )}
    </div>
  );
}
