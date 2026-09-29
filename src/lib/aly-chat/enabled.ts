import type { SupabaseClient } from "@supabase/supabase-js";

// Aly's chat page switch (2026-09-29): the `aly_chat` flag (aly-chat.sql
// adds it switched on), and Claude's key, since Claude is the default brain.
// A missing row reads as off: until the SQL has run the page says chat isn't
// open and the sidebar row stays hidden.
export async function isAlyChatEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.ALY_CHAT_DISABLED === "1") return false;
  if (!process.env.ANTHROPIC_API_KEY) return false;
  const { data } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "aly_chat")
    .maybeSingle<{ enabled: boolean }>();
  return data?.enabled === true;
}

/** Which brains this server can reach (the picker greys out the others). */
export function availableBrains(): { claude: boolean; gpt: boolean; gemini: boolean } {
  return {
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    gpt: Boolean(process.env.OPENAI_API_KEY),
    gemini: Boolean(process.env.GEMINI_API_KEY),
  };
}
