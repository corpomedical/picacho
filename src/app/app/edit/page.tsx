import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { editorAllowed, isEditorEnabled } from "@/lib/editor/enabled";
import { getEdit, listEdits } from "@/lib/editor/actions";
import { DirectorsCut } from "@/components/directors-cut/directors-cut";

// Director's Cut (operator, 2026-09-24): raw footage in, a finished edit out —
// Opus 5.5 cuts it, HyperFrames renders it (lib/editor/). Its own page and
// its own word in the nav, and an entry inside Generate (his placement:
// "1 and 2"). Admins only, behind the `video_editor` switch; to anyone else
// this page does not exist.
//
// The first tick of an edit runs right after the customer presses "Cut it",
// inside the server action this page hosts (submitEdit → after()), and it
// may probe footage with ffmpeg — next.config.ts traces the binary here.
export const maxDuration = 300;

export default async function DirectorsCutPage() {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) redirect("/login");

  const { data: profile } = await supabase.from("profiles").select("role, status").eq("id", userData.user.id).maybeSingle();
  if (!editorAllowed(profile)) notFound();
  if (!(await isEditorEnabled(supabase))) notFound();

  const { edits } = await listEdits();
  const first = edits[0] ? (await getEdit(edits[0].id)).edit : null;
  return <DirectorsCut initialEdits={edits} initialDetail={first} />;
}
