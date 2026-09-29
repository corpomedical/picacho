import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getGenerateWorkspaceData } from "@/lib/generations/workspace-data";
import { spendableCredits } from "@/lib/plans";
import { firstName, lightView, type LightPrepared } from "@/lib/light/mode";
import { getLightTake } from "@/lib/light/actions";
import { isAlyChatEnabled } from "@/lib/aly-chat/enabled";
import { chatPageBase } from "@/lib/aly-chat/page-data";
import { getChat, listDocs, loadRows } from "@/lib/aly-chat/store";
import { toView } from "@/lib/aly-chat/view";
import { LightChat } from "@/components/light/light-chat";
import { LightAly } from "@/components/light/light-aly";

// The renders start from here (runGeneration is a server action of this
// page), so it gets the generate page's ceiling.
export const maxDuration = 300;

/**
 * PICACHO LIGHT's chat (operator, 2026-09-27: "make it look like gemini").
 * One box; the picture or video comes back in the conversation.
 *
 * Since 2026-09-29 ("Add Aly capabilities to Light version" → "Aly IS the
 * Light chat") the box is Aly's: she talks, searches, reads files and
 * remembers, and a picture or video is her card with its price (LightAly).
 * Light's own box stays for what the address asks of it (lightView): a take
 * to show, a send prepared elsewhere, direct=1 when her allowance is used
 * up, and everyone while her chat is closed. Its sends go through the same
 * runGeneration as the full studio, with the defaults and prices a new
 * account's composer opens on (getGenerateWorkspaceData).
 */
export default async function LightPage({
  searchParams,
}: {
  searchParams: Promise<{
    take?: string;
    type?: string;
    prompt?: string;
    character?: string;
    model?: string;
    seconds?: string;
    chat?: string;
    direct?: string;
    n?: string;
  }>;
}) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login");
  const params = await searchParams;
  const takeId = params.take;

  const pick = lightView(params, await isAlyChatEnabled(supabase));
  if (pick.view === "aly") {
    const base = await chatPageBase();
    // The session's own client: a person reads only their own chats. One
    // that's gone (deleted, someone else's) opens a new chat instead.
    const chat = pick.chatId ? await getChat(base.supabase, base.userId, pick.chatId) : null;
    const [rows, docs] = chat
      ? await Promise.all([loadRows(base.supabase, chat.id), listDocs(base.supabase, base.userId, chat.id)])
      : [[], []];
    const project = chat?.projectId ? base.projects.find((p) => p.id === chat.projectId) ?? null : null;
    return (
      <LightAly
        // "New chat" and a chat from the rail are always a fresh chat view.
        key={chat?.id ?? `new-${params.n ?? ""}`}
        chatId={chat?.id ?? null}
        title={chat?.title ?? null}
        initial={toView(rows)}
        docs={docs}
        name={base.name}
        firstName={base.firstName}
        brains={base.brains}
        limited={base.limited}
        project={project}
        projects={base.projects}
        defaults={base.defaults}
        topUpHref={base.topUpHref}
        liveVoice={base.liveVoice}
        creditsLeft={base.creditsLeft}
        letter={base.initial}
      />
    );
  }

  const [workspace, { data: profile }, take] = await Promise.all([
    getGenerateWorkspaceData(supabase, data.user.id),
    supabase.from("profiles").select("full_name, username").eq("id", data.user.id).maybeSingle(),
    takeId ? getLightTake(takeId) : Promise.resolve(null),
  ]);

  const model = workspace.videoModels.find((m) => m.id === workspace.defaultVideoModelId);
  const name = firstName(profile?.full_name as string | null);

  // A send Aly prepared (her card links here in Light, lib/light/mode.ts
  // lightHref): the box opens filled in with it, unsent. Only what checks
  // out is kept: the person's own character, a model the composer offers,
  // a length that model takes. Anything else falls back to Light's default.
  let prepared: LightPrepared | null = null;
  const preparedPrompt = (params.prompt ?? "").trim().slice(0, 5000);
  if (!takeId && preparedPrompt) {
    const kind = params.type === "image" ? "image" : "video";
    let character: { id: string; name: string } | null = null;
    if (params.character) {
      const { data: row } = await supabase
        .from("character_profiles")
        .select("id, name")
        .eq("id", params.character)
        .eq("user_id", data.user.id)
        .maybeSingle();
      if (row) character = { id: row.id as string, name: String(row.name ?? "") };
    }
    const videoModel = kind === "video" ? workspace.videoModels.find((m) => m.id === params.model) ?? null : null;
    const seconds = Number(params.seconds);
    const secondsOk = videoModel?.durations.some((d) => d.seconds === seconds) ?? false;
    prepared = {
      kind,
      prompt: preparedPrompt,
      characterId: character?.id ?? null,
      characterName: character?.name ?? null,
      videoModelId: videoModel?.id ?? null,
      videoModelName: videoModel?.name ?? null,
      seconds: videoModel ? (secondsOk ? seconds : videoModel.defaultDurationSeconds) : null,
    };
  }

  return (
    <LightChat
      // A new chat (or another Recent entry) starts from a clean conversation.
      key={takeId ?? (prepared ? `prepared-${prepared.kind}-${prepared.characterId ?? ""}-${prepared.prompt}` : "new")}
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
      prepared={prepared}
    />
  );
}
