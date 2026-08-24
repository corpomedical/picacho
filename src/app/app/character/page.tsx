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
    supabase.from("projects").select("id, name").eq("user_id", userData.user.id),
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
        ? thumbUrl(mediaUrl("character-references", firstPath), 320)
        : null,
    };
  });

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-atelier-ink">{c.listTitle}</h1>
        <Link href="/app/character/new">
          <button className="inline-flex items-center justify-center gap-2 rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity duration-150 hover:opacity-90">{c.newCharacter}</button>
        </Link>
      </div>

      {error ? (
        <div className="mt-6 rounded-control border border-atelier-rule bg-atelier-surface p-8 text-center">
          <p className="text-sm text-red-600 dark:text-red-400">{c.couldntLoad}</p>
        </div>
      ) : withThumbnails.length === 0 ? (
        <div className="mt-6 rounded-control border border-atelier-rule bg-atelier-surface p-8 text-center">
          <p className="text-sm text-atelier-muted">
            {c.noneYet}
          </p>
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {withThumbnails.map((profile) => (
            <Link
              key={profile.id}
              href={`/app/character/${profile.id}`}
              className="flex items-center gap-4 rounded-control border border-atelier-rule bg-atelier-surface p-5 transition-colors hover:border-atelier-muted/70"
            >
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-media bg-atelier-ink/5">
                {profile.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-atelier-ink">{profile.name}</p>
                <p className="truncate text-xs text-atelier-muted">
                  {profile.voice_tone_tags?.length
                    ? profile.voice_tone_tags.join(", ")
                    : c.noTagsYet}
                </p>
                <p className="mt-0.5 truncate text-xs text-atelier-muted/80">
                  {profile.project_id
                    ? (projectNameById.get(profile.project_id) ?? c.unknownProject)
                    : c.noProject}
                </p>
              </div>
              {/* Deletion used to live only behind the sidebar rail's
                  hover-revealed trash and the edit page's bottom link —
                  invisible or buried on a phone (2026-08-24, bmazloum:
                  "can't delete characters"). The list page is where people
                  look for it, so it lives here too. Confirm-guarded, and the
                  button stops the card's own navigation. */}
              <DeleteCharacterButton
                id={profile.id}
                name={profile.name}
                className="h-9 w-9 flex-shrink-0"
              />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
