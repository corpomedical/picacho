import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { DeleteGenerationButton } from "@/components/delete-generation-button";
import { ContinueChatButton } from "@/components/continue-chat-button";

export default async function HistoryPage() {
  const { t } = await getServerMessages();
  const h = t.history;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  const [{ data: generations, error }, { data: profile }, usedThisMonth] = await Promise.all([
    supabase
      .from("generations")
      .select(
        "id, prompt_input, status, attempts, character_profile_id, content_type, created_at, angle_group_id, angle",
      )
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("profiles").select("plan").eq("id", userData.user.id).single(),
    getMonthlyUsage(userData.user.id),
  ]);

  if (error) console.error("Failed to load generations:", error);

  const characterIds = Array.from(
    new Set((generations ?? []).map((g) => g.character_profile_id).filter(Boolean)),
  );
  const { data: characters } = characterIds.length
    ? await supabase.from("character_profiles").select("id, name").in("id", characterIds)
    : { data: [] as { id: string; name: string }[] };

  const nameById = new Map((characters ?? []).map((c) => [c.id, c.name]));

  const plan = (profile?.plan ?? "none") as PlanId;
  const limit = PLAN_LIMITS[plan];

  // Multi-angle requests insert one row per angle sharing angle_group_id —
  // collapse those into a single history card (linking to the front angle,
  // or whichever came first) with an "N angles" badge instead of listing
  // near-duplicate rows.
  type GenerationRow = NonNullable<typeof generations>[number];
  const groups = new Map<string, GenerationRow[]>();
  for (const g of generations ?? []) {
    const key = g.angle_group_id ?? g.id;
    const arr = groups.get(key) ?? [];
    arr.push(g);
    groups.set(key, arr);
  }

  const cards = Array.from(groups.values())
    .map((rows) => {
      const representative = rows.find((g) => g.angle === "front") ?? rows[0];
      const allSucceeded = rows.every((r) => r.status === "succeeded");
      const anyFailed = rows.some((r) => r.status === "failed");
      return {
        id: representative.id,
        prompt_input: representative.prompt_input,
        character_profile_id: representative.character_profile_id,
        content_type: representative.content_type,
        created_at: representative.created_at,
        attempts: representative.attempts,
        status: rows.length > 1 ? (allSucceeded ? "succeeded" : anyFailed ? "failed" : "drafted") : representative.status,
        angleCount: rows.length > 1 ? rows.length : undefined,
      };
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const statusLabel = (status: string) =>
    status === "succeeded" ? h.statusSucceeded : status === "failed" ? h.statusFailed : h.statusDrafted;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-lg font-semibold text-neutral-900">{h.title}</h1>

      <Card className="mt-6">
        <p className="text-sm text-neutral-500">{h.thisMonth}</p>
        <p className="mt-1 text-2xl font-semibold text-neutral-900">
          {usedThisMonth}
          {limit > 0 && <span className="text-base font-normal text-neutral-400"> / {limit}</span>}
        </p>
        <p className="mt-1 text-xs text-neutral-500">
          {plan === "none" ? h.noActivePlan : formatMsg(h.planSuffix, { plan: PLAN_LABELS[plan] })}
        </p>
      </Card>

      <div className="mt-6 space-y-3">
        {error ? (
          <Card className="text-center">
            <p className="text-sm text-red-600">{h.couldntLoad}</p>
          </Card>
        ) : cards.length === 0 ? (
          <Card className="text-center">
            <p className="text-sm text-neutral-500">
              {h.noGenerationsYet}{" "}
              <Link href="/app/generate" className="font-medium text-neutral-900 underline">
                {h.tryOne}
              </Link>
              .
            </p>
          </Card>
        ) : (
          cards.map((g) => (
            <Link key={g.id} href={`/app/history/${g.id}`} className="group block">
              <Card className="flex items-center justify-between gap-4 p-5 transition-shadow hover:shadow-[0_8px_20px_-10px_rgba(0,0,0,0.12)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-neutral-900">
                    {g.prompt_input}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-neutral-500">
                    {nameById.get(g.character_profile_id) ?? h.unknownCharacter} ·{" "}
                    {new Date(g.created_at).toLocaleDateString()} ·{" "}
                    {g.angleCount
                      ? formatMsg(h.angleCountOther, { n: g.angleCount })
                      : g.attempts === 1
                        ? h.attemptCountOne
                        : formatMsg(h.attemptCountOther, { n: g.attempts })}
                  </p>
                </div>
                <div className="flex flex-shrink-0 items-center gap-2">
                  <Badge tone="neutral">{g.content_type === "image" ? t.generate.image : t.generate.video}</Badge>
                  <Badge
                    tone={
                      g.status === "succeeded"
                        ? "success"
                        : g.status === "failed"
                          ? "danger"
                          : "neutral"
                    }
                  >
                    {statusLabel(g.status)}
                  </Badge>
                  {g.character_profile_id && (
                    <ContinueChatButton
                      characterId={g.character_profile_id}
                      contentType={g.content_type}
                      generationId={g.id}
                      className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                    />
                  )}
                  <DeleteGenerationButton
                    id={g.id}
                    className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100"
                  />
                </div>
              </Card>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
