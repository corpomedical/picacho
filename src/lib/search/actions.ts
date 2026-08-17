"use server";

import { createClient } from "@/lib/supabase/server";

export type SearchResults = {
  projects: { id: string; name: string }[];
  characters: { id: string; name: string }[];
  generations: { id: string; prompt_input: string; content_type: string | null }[];
};

const EMPTY: SearchResults = { projects: [], characters: [], generations: [] };

// RLS scopes every table here to the signed-in user already (same pattern
// used everywhere else in the app), so there's no need to filter by user_id
// explicitly — a query just can't see anyone else's rows.
export async function searchAll(query: string): Promise<SearchResults> {
  const trimmed = query.trim();
  if (!trimmed) return EMPTY;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return EMPTY;

  const like = `%${trimmed}%`;

  const [{ data: projects }, { data: characters }, { data: generations }] = await Promise.all([
    supabase.from("projects").select("id, name").ilike("name", like).limit(5),
    supabase.from("character_profiles").select("id, name").ilike("name", like).limit(5),
    supabase
      .from("generations")
      .select("id, prompt_input, content_type")
      .ilike("prompt_input", like)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  return {
    projects: projects ?? [],
    characters: characters ?? [],
    generations: generations ?? [],
  };
}
