"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

// All of these are invoked directly from the Notes page's Client Component
// (typing in a textarea, clicking "New note"), not native <form> actions —
// same reasoning as the character/project actions: they return a result
// instead of calling redirect().

type NoteResult = { error: string | null; id?: string };

async function requireUser() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return { supabase, userId: null };
  return { supabase, userId: data.user.id };
}

export async function createNote(): Promise<NoteResult> {
  const { supabase, userId } = await requireUser();
  if (!userId) return { error: "Your session expired — please log in again." };

  const { data, error } = await supabase
    .from("notes")
    .insert({ user_id: userId, title: "Untitled note", body: "" })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "Couldn't create this note." };

  revalidatePath("/app/notes");
  return { error: null, id: data.id };
}

export async function saveNote(formData: FormData): Promise<NoteResult> {
  const { supabase, userId } = await requireUser();
  if (!userId) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;
  const title = ((formData.get("title") as string) || "Untitled note").trim() || "Untitled note";
  const body = (formData.get("body") as string) ?? "";

  const { error } = await supabase
    .from("notes")
    .update({ title, body, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("user_id", userId);

  if (error) return { error: error.message };

  revalidatePath("/app/notes");
  return { error: null };
}

export async function deleteNote(formData: FormData): Promise<NoteResult> {
  const { supabase, userId } = await requireUser();
  if (!userId) return { error: "Your session expired — please log in again." };

  const id = formData.get("id") as string;

  const { error } = await supabase.from("notes").delete().eq("id", id).eq("user_id", userId);
  if (error) return { error: error.message };

  revalidatePath("/app/notes");
  return { error: null };
}
