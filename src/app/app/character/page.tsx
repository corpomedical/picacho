import Link from "next/link";
import { mediaUrl, thumbUrl } from "@/lib/media/url";
import { createClient } from "@/lib/supabase/server";
import { getServerMessages } from "@/lib/i18n/server";
import { DeleteCharacterButton } from "@/components/delete-character-button";

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
              /* The cast wall (2026-08-27 redesign, case 1): photo-first
                 portrait cards — the page's first job is "these are your
                 stars", not "here is a database row". The whole card opens
                 the profile via a stretched link; Generate and Delete sit
                 above it as siblings (never nested anchors). Tags/project
                 render only when they exist — the old "No tags yet · No
                 project" placeholder noise is gone. */
              <div
                key={profile.id}
                className="group relative aspect-[3/4] overflow-hidden rounded-[16px] border border-atelier-rule bg-atelier-ink"
              >
                {profile.thumbnailUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-atelier-ink to-[#3a3f4c] font-display text-5xl font-semibold text-atelier-paper/60">
                    {profile.name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                )}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"
                />
                <Link
                  href={`/app/character/${profile.id}`}
                  aria-label={profile.name}
                  className="absolute inset-0 z-[1]"
                />
                <div className="pointer-events-none absolute inset-x-3 bottom-2.5 z-[2]">
                  <p className="truncate text-sm font-semibold text-white">
                    {profile.name}
                  </p>
                  <span aria-hidden className="mt-1.5 flex items-center gap-1">
                    {[0, 1, 2, 3, 4].map((i) => (
                      <span
                        key={i}
                        className={
                          i < photoCount
                            ? "h-1 w-4 rounded-full bg-atelier-accent"
                            : "h-1 w-4 rounded-full bg-white/25"
                        }
                      />
                    ))}
                  </span>
                  {(profile.voice_tone_tags?.length || projectName) && (
                    <p className="mt-1 truncate text-[10.5px] text-white/70">
                      {[profile.voice_tone_tags?.join(", "), projectName]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <Link
                  href={`/app/generate?character=${encodeURIComponent(profile.id)}`}
                  className="absolute right-2 top-2 z-[2] rounded-full bg-black/50 px-3 py-1.5 text-[11px] font-medium text-white backdrop-blur transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                >
                  {t.nav.generate}
                </Link>
                <DeleteCharacterButton
                  id={profile.id}
                  name={profile.name}
                  className="absolute left-2 top-2 z-[2] h-8 w-8 rounded-full bg-black/40 text-white backdrop-blur"
                />
              </div>
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
