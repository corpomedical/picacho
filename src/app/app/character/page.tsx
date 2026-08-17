import Link from "next/link";
import { mediaUrl, thumbUrl } from "@/lib/media/url";
import { createClient } from "@/lib/supabase/server";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getServerMessages } from "@/lib/i18n/server";

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
        <h1 className="text-lg font-semibold text-neutral-900">{c.listTitle}</h1>
        <Link href="/app/character/new">
          <Button>{c.newCharacter}</Button>
        </Link>
      </div>

      {error ? (
        <Card className="mt-6 text-center">
          <p className="text-sm text-red-600">{c.couldntLoad}</p>
        </Card>
      ) : withThumbnails.length === 0 ? (
        <Card className="mt-6 text-center">
          <p className="text-sm text-neutral-500">
            {c.noneYet}
          </p>
        </Card>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          {withThumbnails.map((profile) => (
            <Link
              key={profile.id}
              href={`/app/character/${profile.id}`}
              className="flex items-center gap-4 rounded-[18px] border border-neutral-100 bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] transition-shadow hover:shadow-[0_8px_20px_-10px_rgba(0,0,0,0.12)]"
            >
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-[10px] bg-neutral-100">
                {profile.thumbnailUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profile.thumbnailUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-neutral-900">{profile.name}</p>
                <p className="truncate text-xs text-neutral-500">
                  {profile.voice_tone_tags?.length
                    ? profile.voice_tone_tags.join(", ")
                    : c.noTagsYet}
                </p>
                <p className="mt-0.5 truncate text-xs text-neutral-400">
                  {profile.project_id
                    ? (projectNameById.get(profile.project_id) ?? c.unknownProject)
                    : c.noProject}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
