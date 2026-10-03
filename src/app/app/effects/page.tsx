import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getModelControls } from "@/lib/models/controls";
import { effectsAllowed, isEditorEnabled } from "@/lib/editor/enabled";
import { libraryVideos, listEffects, takeAsLibraryVideo } from "@/lib/editor/effects-actions";
import { EffectsDoor } from "@/components/effects/effects-door";

// Effects (operator, 2026-09-29: "make it its own door", then all four:
// "VFX in the shot, one-tap effect library, effects inside Generate, effects
// tracks in the editor"): effects put into a video (lib/effects/, Opus 5.5 +
// FLUX 3 edit), one-tap effects on a photo, and titles and credits for a
// finished film (lib/editor/effects.ts). ?tab=video|photo|titles opens a tab. Its own place in Tools, the
// phone's lamp and a History take's Keep going shelf (?take=<id>). Admins
// only, behind the same `video_editor` switch; to anyone else this page does
// not exist.
//
// The first tick runs inside this page's own function right after "Finish
// it" (submitEffects → after()), and it probes the film with ffmpeg —
// next.config.ts traces the binary here.
export const maxDuration = 300;

export default async function EffectsPage({ searchParams }: { searchParams: Promise<{ take?: string | string[]; tab?: string | string[] }> }) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", userData.user.id).maybeSingle();
  if (!effectsAllowed(profile)) notFound();
  if (!(await isEditorEnabled(supabase))) notFound();

  const { take, tab } = await searchParams;
  const takeId = typeof take === "string" ? take : null;
  const initialTab = tab === "video" || tab === "photo" || tab === "titles" ? tab : undefined;
  const [{ jobs }, { videos }, { videos: pictures }, pick, modelControls] = await Promise.all([
    listEffects(),
    libraryVideos("video"),
    libraryVideos("image"),
    takeId ? takeAsLibraryVideo(takeId) : Promise.resolve(null),
    getModelControls(),
  ]);
  return (
    <EffectsDoor
      initialJobs={jobs}
      library={videos}
      pictures={pictures}
      initialPick={pick}
      initialTab={initialTab}
      offEngines={modelControls.off.effects ?? []}
    />
  );
}
