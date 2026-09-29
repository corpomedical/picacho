import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { editorAllowed, isEditorEnabled } from "@/lib/editor/enabled";
import { libraryVideos, listEffects, takeAsLibraryVideo } from "@/lib/editor/effects-actions";
import { EffectsDoor } from "@/components/effects/effects-door";

// Effects (operator, 2026-09-29: "sometimes people only want visual… make it
// its own door"): a finished film in; opening titles, a badge, credits, a
// vertical version, a cover and sound effects out, finished by Opus 5.5 on
// Director's Cut's engine (lib/editor/effects.ts). Its own place in Tools, the
// phone's lamp and a History take's Keep going shelf (?take=<id>). Admins
// only, behind the same `video_editor` switch; to anyone else this page does
// not exist.
//
// The first tick runs inside this page's own function right after "Finish
// it" (submitEffects → after()), and it probes the film with ffmpeg —
// next.config.ts traces the binary here.
export const maxDuration = 300;

export default async function EffectsPage({ searchParams }: { searchParams: Promise<{ take?: string | string[] }> }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", userData.user.id).maybeSingle();
  if (!editorAllowed(profile)) notFound();
  if (!(await isEditorEnabled(supabase))) notFound();

  const { take } = await searchParams;
  const takeId = typeof take === "string" ? take : null;
  const [{ jobs }, { videos }, pick] = await Promise.all([listEffects(), libraryVideos(), takeId ? takeAsLibraryVideo(takeId) : Promise.resolve(null)]);
  return <EffectsDoor initialJobs={jobs} library={videos} initialPick={pick} />;
}
