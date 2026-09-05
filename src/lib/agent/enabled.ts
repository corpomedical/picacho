import type { SupabaseClient } from "@supabase/supabase-js";

// The chat agent's kill switch — three independent levels, every one of them
// defaulting to OFF (2026-08-30).
//
// Modelled on voice/enabled.ts, including the line that matters most there:
// a feature that spends money on every use should never switch itself on
// because a lookup failed. This one spends Anthropic tokens on every message,
// with a tool loop that can make several calls per turn, so the same rule
// applies with more force.
//
// The three levels exist because they fail in different directions:
//
//   1. AGENT_CHAT_DISABLED=1 in the environment. Checked FIRST, before any
//      database call, so it still works when the database is the thing that
//      is wrong. An instant off from the Vercel dashboard.
//   2. feature_flags.chat_agent. One toggle in Admin > Feature flags, no
//      deploy. Inserted disabled by applied/2026-08-30/agent-chat.sql.
//   3. A missing ANTHROPIC_API_KEY, same as draftWithClaude already treats it.
//
// DELIBERATELY NOT REUSING voice_mode. That flag gates a different,
// unfinished thing, and switching it on to enable this would silently revive
// the half-built conversational voice loop with it.
export async function isChatAgentEnabled(supabase: SupabaseClient): Promise<boolean> {
  if (process.env.AGENT_CHAT_DISABLED === "1") return false;
  if (!process.env.ANTHROPIC_API_KEY) return false;

  const { data } = await supabase
    .from("feature_flags")
    .select("enabled")
    .eq("key", "chat_agent")
    .maybeSingle<{ enabled: boolean }>();

  return data?.enabled === true;
}
