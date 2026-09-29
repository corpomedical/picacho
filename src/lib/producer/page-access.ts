import type { SupabaseClient } from "@supabase/supabase-js";
import { isAlyChatEnabled } from "@/lib/aly-chat/enabled";
import type { PageAccess } from "@/lib/agent/site-map";
import { readToolGates } from "@/lib/nav/gates";

/**
 * Which pages this person can open, for open_page: the same gates the
 * sidebar, the tab bar and the lamp read (lib/nav/gates.ts), their role,
 * Picacho Light, and whether Aly's chat page is open. Read once per turn,
 * and only when she opens a page.
 */
export function pageAccessReader(supabase: SupabaseClient, userId: string): () => Promise<PageAccess> {
  let once: Promise<PageAccess> | null = null;
  return () =>
    (once ??= (async () => {
      const { data: profile } = await supabase.from("profiles").select("role, plan, status").eq("id", userId).maybeSingle();
      // app_mode on its own read, like the state note: before picacho-light.sql
      // the column is missing and the account is simply not in Light.
      const [gates, modeRead, chatOpen] = await Promise.all([
        readToolGates(supabase, profile),
        supabase.from("profiles").select("app_mode").eq("id", userId).maybeSingle(),
        isAlyChatEnabled(supabase),
      ]);
      return {
        isAdmin: profile?.role === "admin",
        inLight: (modeRead.data as { app_mode?: unknown } | null)?.app_mode === "light",
        chatOpen,
        gates,
      };
    })());
}
