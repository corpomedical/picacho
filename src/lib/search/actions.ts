"use server";

import { createClient } from "@/lib/supabase/server";

export type SearchResults = {
  projects: { id: string; name: string }[];
  characters: { id: string; name: string }[];
  generations: { id: string; prompt_input: string; content_type: string | null }[];
};

const EMPTY: SearchResults = { projects: [], characters: [], generations: [] };

// Explicit user_id filters, NOT just RLS. The old comment claimed "a query
// just can't see anyone else's rows" — false for an admin account, whose
// admin-read policies span every user's projects, characters and
// generations, so the workspace search box quietly returned other people's
// content to it (2026-08-31 inspection). RLS is the floor; the scope is
// stated here.
export async function searchAll(query: string): Promise<SearchResults> {
  const trimmed = query.trim();
  if (!trimmed) return EMPTY;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return EMPTY;

  // Escape LIKE metacharacters (and the escape character itself) so a query
  // is matched literally: an unescaped "%" or "_" is a wildcard inside the
  // ilike pattern, which made searching for "100%" match everything and let
  // a crafted query probe rows one wildcard at a time. Backslash first, or
  // it would re-escape the escapes.
  const escaped = trimmed.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
  const like = `%${escaped}%`;

  const [{ data: projects }, { data: characters }, { data: generations }] = await Promise.all([
    supabase
      .from("projects")
      .select("id, name")
      .eq("user_id", userData.user.id)
      .ilike("name", like)
      .limit(5),
    supabase
      .from("character_profiles")
      .select("id, name")
      .eq("user_id", userData.user.id)
      .ilike("name", like)
      .limit(5),
    supabase
      .from("generations")
      .select("id, prompt_input, content_type")
      .eq("user_id", userData.user.id)
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
