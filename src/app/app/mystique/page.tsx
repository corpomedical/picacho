import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getRecastHome, sweepRecastOrphans } from "@/lib/recast/data";
import { isRecastEnabled, isRecastLockOn } from "@/lib/recast/enabled";
import { MystiqueDoor } from "@/components/mystique/mystique-door";

// The Mystique door (working title, "Lets go with Mystique for now",
// 2026-09-17): a saved character performs an uploaded clip — the answer to
// Higgsfield's Genjutsu. Its own page and its own word in the nav (the
// operator's siting decision). The lane underneath is "recast"
// (lib/recast/) and never carries the door's name, so the name can change
// by moving this folder and four dictionary words.
//
// Admins only while it is proved, behind the `recast` switch; to anyone
// else this page does not exist.
//
// The take's start runs inside the server action this page hosts
// (startRecastTake: the file is read, then the clip's frame meets the
// picture check's 10–100 s), so the route declares the budget that needs.
export const maxDuration = 300;

export default async function MystiquePage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", userData.user.id).maybeSingle();
  if (profile?.role !== "admin") notFound();
  if (!(await isRecastEnabled(supabase))) notFound();

  // Opens inside the app too (2026-09-21): Recast is one of the app bar's two
  // Generate choices ("Generate Video | All Models, Recast"), and the page
  // was a dead end there. Still admins only, behind the recast flag, so the
  // audience is unchanged; the door carries no purchase path (reader mode).

  // Clips that never became a take are cleared on the way in (best-effort).
  const [home, lockOn] = await Promise.all([
    getRecastHome(supabase, userData.user.id),
    isRecastLockOn(supabase),
    sweepRecastOrphans(supabase, userData.user.id),
  ]);

  return (
    <MystiqueDoor characters={home.characters} motions={home.motions} initialTakes={home.takes} lockOn={lockOn} notify={home.notify} />
  );
}
