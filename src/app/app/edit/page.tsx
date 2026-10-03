import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getModelControls } from "@/lib/models/controls";
import { editorGate, isEditorEnabled, isEditorOpenToPlans } from "@/lib/editor/enabled";
import { getEdit, listEdits } from "@/lib/editor/actions";
import { DirectorsCut } from "@/components/directors-cut/directors-cut";
import { DirectorsCutNeedsPlan } from "@/components/directors-cut/needs-plan";

// Director's Cut (operator, 2026-09-24): raw footage in, a finished edit out —
// Opus 5.5 cuts it, HyperFrames renders it (lib/editor/). Its own page and
// its own word in the nav, and an entry inside Generate (his placement:
// "1 and 2"). Behind the `video_editor` switch; admins, and every paid plan
// once `video_editor_paid_plans` is on (2026-10-03, lib/editor/enabled.ts).
// Someone without a paid plan gets the page that says how to get one (his
// pick: "Page with upgrade prompt"); while the plans switch is off, to
// anyone but an admin this page does not exist.
//
// The first tick of an edit runs right after the customer presses "Cut it",
// inside the server action this page hosts (submitEdit → after()), and it
// may probe footage with ffmpeg — next.config.ts traces the binary here.
export const maxDuration = 300;

export default async function DirectorsCutPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  if (!(await isEditorEnabled(supabase))) notFound();
  const { data: profile } = await supabase.from("profiles").select("role, status, plan, plan_status").eq("id", userData.user.id).maybeSingle();
  const isAdmin = profile?.role === "admin";
  const gate = editorGate(profile, isAdmin || (await isEditorOpenToPlans(supabase)));
  if (gate.code === "suspended" || gate.code === "notOpen") notFound();
  if (gate.code === "needsPlan") return <DirectorsCutNeedsPlan />;

  const [{ edits }, modelControls] = await Promise.all([listEdits(), getModelControls()]);
  const first = edits[0] ? (await getEdit(edits[0].id)).edit : null;
  return <DirectorsCut initialEdits={edits} initialDetail={first} offMusic={modelControls.off.music ?? []} isAdmin={isAdmin} />;
}
