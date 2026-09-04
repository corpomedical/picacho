import Link from "next/link";
import type { ReactNode, SVGProps } from "react";
import { createClient } from "@/lib/supabase/server";
import { getMonthlyUsage } from "@/lib/generations/actions";
import { PLAN_LIMITS, PLAN_LABELS, type PlanId } from "@/lib/plans";
import { toMediaUrl, thumbUrl, isRenderableUrl } from "@/lib/media/url";
import { VIDEO_MODELS } from "@/lib/generations/providers/video-models";
import { getServerMessages } from "@/lib/i18n/server";
import { QuietVideo } from "@/components/quiet-video";
import { formatMsg } from "@/lib/i18n/format";
import { DeleteGenerationButton } from "@/components/delete-generation-button";
import { ContinueChatButton } from "@/components/continue-chat-button";
import { LocalDate } from "@/components/local-date";

// History as a CONTACT SHEET — direction A from the design canvas, operator
// pick 2026-09-04 ("Go With A").
//
// What it replaces and why, measured rather than felt. The previous layout
// was a 672px column of rows with 64px thumbnails: on a 1440px screen that
// left 53% of the width empty and showed every render at a size too small to
// judge, which is the one job a library has. On a 390px phone it was worse —
// the row's fixed cluster (score, status chip, two 28px buttons) plus the
// thumb took ~195px of a 328px column, leaving the prompt, which the old
// comment here called "the headline", about 5px. All three of its text lines
// truncated to nothing at once.
//
// So: the render IS the card. A 4:3 tile on the Darkroom stage, the identity
// score as an ochre pip ON the image (proof, in the accent's one sanctioned
// job), duration bottom-right, prompt two lines under it, caps microlabel
// last. Four across at lg, two on a phone — a grid degrades by reflowing
// instead of crushing, which is why it fixes both screens with one layout.
//
// Actions do NOT hide behind hover. A phone has no hover, and the Android
// shell loads this same page: the tools row is always present on coarse
// pointers and fades in on hover-capable ones, using the
// [@media(hover:hover)] pattern already established in app-sidebar.tsx and
// character-form.tsx. The old row hid Continue-chat and Delete behind
// group-hover, which on a phone left them invisible AND still hit-testable
// (opacity-0 does not stop pointer events) — an unlabelled live control at
// the right edge, where a scrolling thumb rests.
//
// Kept exactly as it was: the two filter-chip groups in the URL as search
// params (a pure server component, shareable and refresh-proof), the
// multi-angle collapse, the "generating outranks failed" group status, and
// the promise that this list is the COMPLETE record — failures and in-flight
// renders included, unlike the media sections.

function PlayIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M8 5v14l11-7Z" />
    </svg>
  );
}

function ImageGlyph(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="10" r="1.5" />
      <path d="m5 17 4.5-4.5 3.5 3.5 3-3 3 4" />
    </svg>
  );
}

// One pill of a chip group — the pricing page's billing toggle, spoken in
// Atelier: ink-filled when active, muted text otherwise.
function FilterPill({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={
        active
          ? "rounded-full bg-atelier-ink px-3 py-1 text-xs font-medium text-atelier-paper"
          : "rounded-full px-3 py-1 text-xs text-atelier-muted transition-colors hover:text-atelier-ink"
      }
    >
      {children}
    </Link>
  );
}

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; outcome?: string }>;
}) {
  const { t } = await getServerMessages();
  const h = t.history;
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return null;

  // URL params, not client state (the pricing billing-toggle pattern): the
  // server renders exactly the filtered list, nothing hydrates, and the
  // choice survives refresh and sharing. Unknown values fall back to "all".
  const raw = await searchParams;
  const type = raw.type === "video" || raw.type === "image" ? raw.type : undefined;
  const outcome = raw.outcome === "passed" || raw.outcome === "failed" ? raw.outcome : undefined;
  const filtered = Boolean(type || outcome);

  const filterHref = (next: { type?: "video" | "image"; outcome?: "passed" | "failed" }) => {
    const params = new URLSearchParams();
    if (next.type) params.set("type", next.type);
    if (next.outcome) params.set("outcome", next.outcome);
    const qs = params.toString();
    return qs ? `/app/history?${qs}` : "/app/history";
  };

  // Filtering happens in SQL so each view digs through the user's FULL
  // history (the 50 most recent MATCHING rows), not just whatever matches
  // within the newest 50. Deliberate consequence for multi-angle groups: a
  // mixed group (some angles passed, some failed) genuinely belongs to both
  // outcome views — it appears under "Passed" via its passing angles and
  // under "Failed" via its failing ones; the unfiltered list shows the
  // collapsed truth. Counts on the chips are deliberately omitted: rows
  // collapse into angle groups, so an honest DB count wouldn't match the
  // number of cards on screen.
  let query = supabase
    .from("generations")
    .select(
      "id, prompt_input, status, attempts, character_profile_id, content_type, created_at, angle_group_id, angle, result_url, match_score, video_model_id, video_duration_seconds",
    )
    .eq("user_id", userData.user.id)
    .is("deleted_at", null);
  if (type) query = query.eq("content_type", type);
  if (outcome) query = query.eq("status", outcome === "passed" ? "succeeded" : "failed");

  const [{ data: generations, error }, { data: profile }, usedThisMonth] = await Promise.all([
    query.order("created_at", { ascending: false }).limit(50),
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
      // Collapsed group status. "Generating" outranks "failed" on purpose: a
      // group with one dud angle but others still rendering isn't done
      // failing yet — it settles to failed only once nothing is in flight.
      const allSucceeded = rows.every((r) => r.status === "succeeded");
      const anyGenerating = rows.some((r) => r.status === "generating");
      const anyFailed = rows.some((r) => r.status === "failed");
      const groupStatus = allSucceeded
        ? "succeeded"
        : anyGenerating
          ? "generating"
          : anyFailed
            ? "failed"
            : "drafted";
      // Thumbnail source: the representative's render, or — when the front
      // angle has nothing to show — the first angle in the group that does.
      const media =
        [representative, ...rows]
          .map((r) => toMediaUrl(r.result_url))
          .find((u) => isRenderableUrl(u)) ?? null;
      const modelName =
        representative.content_type === "video" && representative.video_model_id
          ? (VIDEO_MODELS.find((m) => m.id === representative.video_model_id)?.name ?? null)
          : null;
      return {
        id: representative.id,
        prompt_input: representative.prompt_input,
        character_profile_id: representative.character_profile_id,
        content_type: representative.content_type,
        created_at: representative.created_at,
        attempts: representative.attempts,
        status: rows.length > 1 ? groupStatus : representative.status,
        angleCount: rows.length > 1 ? rows.length : undefined,
        // Images go through the resizing thumb route. 640w, not the 320w
        // the old 64px row used: a contact-sheet tile is ~340px wide at lg,
        // so 320 would arrive visibly soft on any 2x screen.
        thumb: representative.content_type === "image" ? thumbUrl(media, 640) : media,
        matchScore:
          typeof representative.match_score === "number" ? representative.match_score : null,
        modelName,
        durationSeconds: representative.video_duration_seconds ?? null,
      };
    })
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const statusLabel = (status: string) =>
    status === "succeeded"
      ? h.statusSucceeded
      : status === "failed"
        ? h.statusFailed
        : status === "generating"
          ? h.statusGenerating
          : h.statusDrafted;

  // Calm chips: success is the norm here, so it stays a quiet paper chip
  // (the ochre identity score next to it is the positive signal); failure
  // is the calm semantic red the Badge tones use; a render in flight gets
  // the live accent pulse — StillRendering's convention that the one moving
  // thing is the lit one.
  const chipClass = (status: string) =>
    status === "failed"
      ? "border-transparent bg-red-50 text-red-700 dark:bg-red-500/15 dark:text-red-400"
      : status === "generating"
        ? "border-atelier-rule bg-atelier-paper text-atelier-ink"
        : "border-atelier-rule bg-atelier-paper text-atelier-muted";

  return (
    <div>
      {/* Masthead in the Ledger's voice — eyebrow, serif title, and the
          month's credits as a figure on the same line rather than a p-8 sheet
          of its own. The admin redesign's commit promised "one design system
          front and back of house"; the library never got it, and a page whose
          largest type was 18px sans was the most visible place that showed. */}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {h.eyebrow}
          </p>
          <h1 className="mt-1 font-numeral text-3xl font-semibold tracking-tight text-atelier-ink">
            {h.title}
          </h1>
        </div>
        <div className="text-right">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
            {h.thisMonth}
          </p>
          <p className="mt-1 font-numeral text-[22px] font-semibold leading-none tabular-nums text-atelier-accent">
            {usedThisMonth}
            {limit > 0 && <span className="text-base font-normal text-atelier-muted"> / {limit}</span>}
          </p>
          <p className="mt-1.5 text-xs text-atelier-muted">
            {plan === "none" ? h.noActivePlan : formatMsg(h.planSuffix, { plan: PLAN_LABELS[plan] })}
          </p>
        </div>
      </div>

      <div className="mt-5 h-px bg-atelier-rule" />

      {/* Filter chips — two independent axes, each a link group so the whole
          thing works without a byte of client JS. */}
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <nav
          aria-label={h.filterByType}
          className="inline-flex items-center gap-0.5 rounded-full border border-atelier-rule bg-atelier-surface p-1"
        >
          <FilterPill href={filterHref({ outcome })} active={!type}>
            {h.filterAllTypes}
          </FilterPill>
          <FilterPill href={filterHref({ type: "video", outcome })} active={type === "video"}>
            {t.gallery.videosTitle}
          </FilterPill>
          <FilterPill href={filterHref({ type: "image", outcome })} active={type === "image"}>
            {t.gallery.imagesTitle}
          </FilterPill>
        </nav>
        <nav
          aria-label={h.filterByOutcome}
          className="inline-flex items-center gap-0.5 rounded-full border border-atelier-rule bg-atelier-surface p-1"
        >
          <FilterPill href={filterHref({ type })} active={!outcome}>
            {h.filterAllOutcomes}
          </FilterPill>
          <FilterPill href={filterHref({ type, outcome: "passed" })} active={outcome === "passed"}>
            {h.filterPassed}
          </FilterPill>
          <FilterPill href={filterHref({ type, outcome: "failed" })} active={outcome === "failed"}>
            {h.filterFailed}
          </FilterPill>
        </nav>
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {error ? (
          <div className="col-span-full rounded-control border border-atelier-rule bg-atelier-surface p-8 text-center shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
            <p className="text-sm text-red-600 dark:text-red-400">{h.couldntLoad}</p>
          </div>
        ) : cards.length === 0 ? (
          <div className="col-span-full rounded-control border border-atelier-rule bg-atelier-surface p-8 text-center shadow-[0_1px_2px_rgba(33,29,22,0.04)]">
            {filtered ? (
              // Empty because of the active filters, not an empty account —
              // say so, and hand back the unfiltered view in one click.
              <p className="text-sm text-atelier-muted">
                {h.emptyFiltered}{" "}
                <Link
                  href="/app/history"
                  className="font-medium text-atelier-ink underline decoration-atelier-accent/50 underline-offset-2"
                >
                  {h.showAll}
                </Link>
              </p>
            ) : (
              <p className="text-sm text-atelier-muted">
                {h.noGenerationsYet}{" "}
                <Link
                  href="/app/generate"
                  className="font-medium text-atelier-ink underline decoration-atelier-accent/50 underline-offset-2"
                >
                  {h.tryOne}
                </Link>
                .
              </p>
            )}
          </div>
        ) : (
          cards.map((g) => (
            <Link key={g.id} href={`/app/history/${g.id}`} className="group block">
              <div className="flex h-full flex-col rounded-[18px] border border-atelier-rule bg-atelier-surface p-2.5 shadow-[0_1px_2px_rgba(33,29,22,0.04)] transition-[border-color,box-shadow] hover:border-atelier-muted/60 hover:shadow-[0_8px_20px_-12px_rgba(33,29,22,0.25)]">
                {/* The render on its Darkroom stage. 4:3 rather than square:
                    every engine renders landscape or portrait video, and a
                    square crop cuts the thing being judged. */}
                <div className="relative aspect-[4/3] w-full overflow-hidden rounded-media bg-atelier-stage">
                  {g.thumb ? (
                    g.content_type === "image" ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.thumb} alt="" className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <>
                        <QuietVideo
                          // The #t media fragment makes Chromium actually
                          // paint that frame as the standing image. Desktop
                          // Chrome paints frame 0 from bare metadata anyway;
                          // Android's WebView does NOT — it showed the grey
                          // system play tile instead (operator-reported,
                          // 2026-08-21). Same fix on every video thumb site.
                          src={`${g.thumb}#t=0.1`}
                          muted
                          playsInline
                          preload="metadata"
                          className="h-full w-full object-cover"
                        />
                        <span className="absolute inset-0 m-auto flex h-9 w-9 items-center justify-center rounded-full bg-[#faf8f3]/95 text-[#211d16] shadow-sm">
                          <PlayIcon className="h-3.5 w-3.5" />
                        </span>
                      </>
                    )
                  ) : g.status === "generating" ? (
                    <span className="absolute inset-0 m-auto h-5 w-5 animate-spin rounded-full border-2 border-[#3b3323] border-t-[#e0a468]" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-[#a39a88]">
                      {g.content_type === "image" ? <ImageGlyph className="h-6 w-6" /> : <PlayIcon className="h-6 w-6" />}
                    </span>
                  )}

                  {/* Identity score — proof, so it rides ON the render in the
                      accent, where the eye already is. Only ever the real one. */}
                  {typeof g.matchScore === "number" && (
                    <span
                      title={formatMsg(t.generate.identityMatch, { n: g.matchScore })}
                      className="absolute left-2 top-2 inline-flex items-center gap-1.5 rounded-full bg-[#1b1c20]/72 px-2 py-1 backdrop-blur-sm"
                    >
                      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#e0a468]" />
                      <span className="font-numeral text-[11px] font-semibold tabular-nums text-[#f4ede4]">
                        {g.matchScore}
                      </span>
                    </span>
                  )}

                  {/* Failed and in-flight still need naming; a succeeded tile
                      says so by having a picture, so it gets no chip at all. */}
                  {g.status !== "succeeded" && (
                    <span
                      className={`absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-wider ${chipClass(g.status)}`}
                    >
                      {g.status === "generating" && (
                        <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-atelier-accent" />
                      )}
                      {statusLabel(g.status)}
                    </span>
                  )}

                  {(g.durationSeconds || g.angleCount) && (
                    <span className="absolute bottom-2 right-2 rounded-full bg-[#1b1c20]/72 px-2 py-0.5 font-numeral text-[10.5px] tabular-nums text-[#f4ede4] backdrop-blur-sm">
                      {g.angleCount
                        ? formatMsg(h.angleCountOther, { n: g.angleCount })
                        : `${g.durationSeconds}s`}
                    </span>
                  )}

                  {/* Tools. ALWAYS present on a coarse pointer — a phone has
                      no hover, and opacity-0 does not stop pointer events, so
                      the old hidden pair were invisible and still tappable.
                      The bracket variant is the house pattern (app-sidebar,
                      character-form); it just never reached this page. */}
                  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 opacity-100 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100">
                    {g.character_profile_id && (
                      <ContinueChatButton
                        characterId={g.character_profile_id}
                        contentType={g.content_type}
                        generationId={g.id}
                        className="h-9 w-9 rounded-full bg-[#faf8f3]/92 text-[#211d16] shadow-sm"
                      />
                    )}
                    <DeleteGenerationButton
                      id={g.id}
                      className="h-9 w-9 rounded-full bg-[#faf8f3]/92 text-[#211d16] shadow-sm"
                    />
                  </div>
                </div>

                <p
                  title={g.prompt_input}
                  className="mt-2.5 line-clamp-2 px-0.5 text-[13px] font-medium leading-snug text-atelier-ink [text-wrap:pretty]"
                >
                  {g.prompt_input}
                </p>
                <p className="mt-1.5 truncate px-0.5 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-atelier-muted">
                  {[
                    g.character_profile_id
                      ? (nameById.get(g.character_profile_id) ?? h.unknownCharacter)
                      : h.noCharacter,
                    g.modelName ?? (g.content_type === "image" ? t.generate.image : t.generate.video),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
                <p className="mt-0.5 truncate px-0.5 text-[11px] text-atelier-muted">
                  <LocalDate date={g.created_at} />
                </p>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
