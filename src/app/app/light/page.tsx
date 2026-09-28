import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { spendableCredits } from "@/lib/plans";
import { firstName } from "@/lib/light/mode";
import { getLightTake } from "@/lib/light/actions";
import { LightChat } from "@/components/light/light-chat";

// The renders start from here (runGeneration is a server action of this
// page), so it gets the generate page's ceiling.
export const maxDuration = 300;

/**
 * PICACHO LIGHT's chat (operator, 2026-09-27: "make it look like gemini").
 * One box; the picture or video comes back in the conversation. Sends go
 * through the same runGeneration as the full studio, with the defaults and
 * prices a new account's composer opens on (getGenerateWorkspaceData).
 */
export default async function LightPage({ searchParams }: { searchParams: Promise<{ take?: string }> }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const { take: takeId } = await searchParams;

  const [workspace, { data: profile }, take] = await Promise.all([
    getGenerateWorkspaceData(supabase, data.user.id),
    supabase.from("profiles").select("full_name, username").eq("id", data.user.id).maybeSingle(),
    takeId ? getLightTake(takeId) : Promise.resolve(null),
  ]);

  const model = workspace.videoModels.find((m) => m.id === workspace.defaultVideoModelId);
  const name = firstName(profile?.full_name as string | null);

  return (
    <LightChat
      // A new chat (or another Recent entry) starts from a clean conversation.
      key={takeId ?? "new"}
      firstName={name}
      initial={((name ?? (profile?.username as string | null) ?? data.user.email ?? "?").trim()[0] ?? "?").toUpperCase()}
      creditsLeft={spendableCredits({
        monthlyLimit: workspace.creditsLimit,
        used: workspace.creditsUsed,
        bonus: workspace.bonusCredits,
        purchased: workspace.purchasedCredits,
      })}
      defaults={{
        videoModelId: workspace.defaultVideoModelId,
        videoDurationSeconds: workspace.defaultVideoDurationSeconds ?? model?.defaultDurationSeconds ?? 5,
        videoAspectRatio: workspace.defaultAspectRatio,
        imageModelId: workspace.defaultImageModelId,
      }}
      openedTake={take}
    />
  );
}
