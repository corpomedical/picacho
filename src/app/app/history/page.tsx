import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { Badge } from "@/components/ui/badge";
import { getServerMessages } from "@/lib/i18n/server";
import { formatMsg } from "@/lib/i18n/format";
import { DeleteGenerationButton } from "@/components/delete-generation-button";
import { ContinueChatButton } from "@/components/continue-chat-button";
import { LocalDate } from "@/components/local-date";

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
      .eq("user_id", userData.user.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
    supabase.from("profiles").select("plan, bonus_credits").eq("id", userData.user.id).single(),
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
  // Bonus credits (admin-granted) stack on top of the plan limit — same rule
  // as the actual enforcement in checkGenerationAllowance.
  const limit = PLAN_LIMITS[plan] + (profile?.bonus_credits ?? 0);

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
      <h1 className="text-lg font-semibold text-atelier-ink">{h.title}</h1>

      {/* Atelier sheet instead of ui/Card (which stays neutral/white until its
          own phase): warm surface, hairline rule, control radius. The usage
          count is a credits figure — serif tabular numerals in ochre, the
          accent's one sanctioned job. */}
      <div className="mt-6 rounded-control border border-atelier-rule bg-atelier-surface p-8 shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
        <p className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{h.thisMonth}</p>
        <p className="mt-1 font-numeral text-2xl font-semibold tabular-nums text-atelier-accent">
          {usedThisMonth}
          {limit > 0 && <span className="text-base font-normal text-atelier-muted"> / {limit}</span>}
        </p>
        <p className="mt-1 text-xs text-atelier-muted">
          {plan === "none" ? h.noActivePlan : formatMsg(h.planSuffix, { plan: PLAN_LABELS[plan] })}
        </p>
      </div>

      <div className="mt-6 space-y-3">
        {error ? (
          <div className="rounded-control border border-atelier-rule bg-atelier-surface p-8 text-center shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
            <p className="text-sm text-red-600 dark:text-red-400">{h.couldntLoad}</p>
          </div>
        ) : cards.length === 0 ? (
          <div className="rounded-control border border-atelier-rule bg-atelier-surface p-8 text-center shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
            <p className="text-sm text-atelier-muted">
              {h.noGenerationsYet}{" "}
              <Link href="/app/generate" className="font-medium text-atelier-ink underline decoration-atelier-accent/50 underline-offset-2">
                {h.tryOne}
              </Link>
              .
            </p>
          </div>
        ) : (
          cards.map((g) => (
            <Link key={g.id} href={`/app/history/${g.id}`} className="group block">
              <div className="flex items-center justify-between gap-4 rounded-control border border-atelier-rule bg-atelier-surface p-5 transition-[border-color,box-shadow] hover:border-atelier-muted/60 hover:shadow-[0_8px_20px_-12px_rgba(33,29,22,0.25)]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-atelier-ink">
                    {g.prompt_input}
                  </p>
                  <p className="mt-0.5 truncate text-xs text-atelier-muted">
                    {g.character_profile_id ? (nameById.get(g.character_profile_id) ?? h.unknownCharacter) : h.noCharacter} ·{" "}
                    <LocalDate date={g.created_at} /> ·{" "}
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
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
