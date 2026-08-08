"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// Both actions here are only ever wired to native <form action={...}> elements
// (no client-side pre-processing like file uploads is needed), so redirect()
// works reliably — unlike the character actions, which are invoked directly
// from a Client Component and have to return a result instead.

export async function saveProject(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const id = (formData.get("id") as string) || null;
  const name = (formData.get("name") as string)?.trim();
  const description = (formData.get("description") as string)?.trim() || null;

  if (!name) {
    redirect(
      `${id ? `/app/projects/${id}` : "/app/projects/new"}?error=${encodeURIComponent("Give this project a name.")}`,
    );
  }

  if (id) {
    const { error } = await supabase
      .from("projects")
      .update({ name, description, updated_at: new Date().toISOString() })
      .eq("id", id)
      .eq("user_id", data.user.id);

    if (error) {
      console.error("saveProject update failed:", error.message);
      redirect(`/app/projects/${id}?error=${encodeURIComponent("Couldn't save this project — try again.")}`);
    }

    revalidatePath("/app/projects");
    revalidatePath(`/app/projects/${id}`);
    redirect(`/app/projects/${id}`);
  }

  const { data: inserted, error } = await supabase
    .from("projects")
    .insert({ user_id: data.user.id, name, description })
    .select("id")
    .single();

  if (error || !inserted) {
    if (error) console.error("saveProject insert failed:", error.message);
    redirect(`/app/projects/new?error=${encodeURIComponent("Couldn't create this project — try again.")}`);
  }

  revalidatePath("/app/projects");
  redirect(`/app/projects/${inserted.id}`);
}

// Lets one or more existing characters be moved into this project without
// going through each character's own edit page — the project detail page
// only ever showed characters already pointing at it via project_id, with
// no way to point existing ones here. The form posts a checkbox per
// character, all sharing the "character_id" name, so getAll picks up
// however many were checked in a single submit.
export async function assignCharacterToProject(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const projectId = formData.get("project_id") as string;
  const characterIds = formData.getAll("character_id").filter(Boolean) as string[];

  if (characterIds.length === 0) {
    redirect(`/app/projects/${projectId}?error=${encodeURIComponent("Pick at least one character to assign.")}`);
  }

  const { error } = await supabase
    .from("character_profiles")
    .update({ project_id: projectId })
    .in("id", characterIds)
    .eq("user_id", data.user.id);

  if (error) {
    console.error("assignCharacterToProject failed:", error.message);
    redirect(`/app/projects/${projectId}?error=${encodeURIComponent("Couldn't assign those characters — try again.")}`);
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath("/app/character");
  redirect(`/app/projects/${projectId}`);
}

export async function removeCharacterFromProject(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const projectId = formData.get("project_id") as string;
  const characterId = formData.get("character_id") as string;

  const { error } = await supabase
    .from("character_profiles")
    .update({ project_id: null })
    .eq("id", characterId)
    .eq("user_id", data.user.id);

  if (error) {
    console.error("removeCharacterFromProject failed:", error.message);
    redirect(`/app/projects/${projectId}?error=${encodeURIComponent("Couldn't remove that character — try again.")}`);
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${projectId}`);
  revalidatePath("/app/character");
  redirect(`/app/projects/${projectId}`);
}

export async function deleteProject(formData: FormData) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");

  const id = formData.get("id") as string;

  // Characters in this project aren't deleted — project_id just goes back
  // to null (see the ON DELETE SET NULL foreign key), so nothing a user
  // built gets wiped out by deleting the folder around it.
  const { error } = await supabase.from("projects").delete().eq("id", id).eq("user_id", data.user.id);

  if (error) {
    console.error("deleteProject failed:", error.message);
    redirect(`/app/projects/${id}?error=${encodeURIComponent("Couldn't delete this project — try again.")}`);
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/projects");
  redirect("/app/projects");
}

// Everything below is invoked directly from Client Components (the sidebar's
// quick-list and the project cards' "..." menu), not native <form> actions —
// so, same as the character actions, these return a result instead of
// calling redirect(), which doesn't reliably navigate when called that way.

type ActionResult = { error: string | null };

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { supabase, userId: null };
  return { supabase, userId: data.user.id };
}

export async function renameProject(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  if (!userId) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  const name = (formData.get("name") as string)?.trim();

  if (!name) return { error: "Give this project a name." };

  const { error } = await supabase
    .from("projects")
    .update({ name, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Project action failed:", error.message);
    return { error: "Couldn't save that change — try again." };
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/projects");
  revalidatePath(`/app/projects/${id}`);
  return { error: null };
}

export async function toggleProjectStar(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  if (!userId) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  const starred = formData.get("starred") === "true";

  const { error } = await supabase
    .from("projects")
    .update({ is_starred: !starred, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Project action failed:", error.message);
    return { error: "Couldn't save that change — try again." };
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/projects");
  return { error: null };
}

export async function toggleProjectPin(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  if (!userId) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  const pinned = formData.get("pinned") === "true";

  const { error } = await supabase
    .from("projects")
    .update({ is_pinned: !pinned, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Project action failed:", error.message);
    return { error: "Couldn't save that change — try again." };
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/projects");
  return { error: null };
}

export async function toggleProjectArchive(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  if (!userId) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  const archived = formData.get("archived") === "true";

  const { error } = await supabase
    .from("projects")
    .update({ is_archived: !archived, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) {
    console.error("Project action failed:", error.message);
    return { error: "Couldn't save that change — try again." };
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/projects");
  return { error: null };
}

export async function removeProject(formData: FormData): Promise<ActionResult> {
  const { supabase, userId } = await requireUser();
  if (!userId) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;

  const { error } = await supabase.from("projects").delete().eq("id", id).eq("user_id", userId);
  if (error) {
    console.error("Project action failed:", error.message);
    return { error: "Couldn't save that change — try again." };
  }

  revalidatePath("/app", "layout");
  revalidatePath("/app/projects");
  return { error: null };
}
