import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { alertEditorOutOfCredit } from "@/lib/push/admin-alerts";
import { advanceEdit } from "./advance";

/**
 * The first step of a job right away, after the reply is sent; the minute
 * cron carries on from there. Shared by Director's Cut and Effects (both are
 * video_edits rows), outside their "use server" files so it stays a plain
 * function and never becomes a server action of its own.
 */
export function kickEdit(editId: string): void {
  after(async () => {
    try {
      await advanceEdit(editId, { admin: createAdminClient(), heavyStartBudgetMs: 5_000, tickBudgetMs: 20_000, onOutOfCredit: alertEditorOutOfCredit });
    } catch (err) {
      console.error(`[editor] first tick for ${editId} failed:`, err instanceof Error ? err.message : err);
    }
  });
}
