import type { SupabaseClient } from "@supabase/supabase-js";
import { PLAN_LABELS, PLAN_LIMITS, type PlanId } from "@/lib/plans";
import { getMonthlyUsageWith } from "@/lib/generations/core";
import type { WatchItem } from "./watch";

// The app's note to the Producer, appended after every message the person
// sends (2026-09-24) — a mid-conversation system message, which keeps the
// conversation append-only where editing the system prompt would not.
//
// KEPT SMALL, because every note stays in the conversation and is re-read on
// every later turn. The cast and the brand rules are written in full only
// when they changed since the last note in this conversation (a fingerprint
// travels in that message's `display`); renders are written only when new.

export type StateFingerprint = { cast: string; rules: string; lastRenderAt: string | null };

function clean(value: unknown, max = 300): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

// A short stable hash (FNV-1a) — enough to notice "this changed", not a
// security boundary.
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// Only paths inside the app are named — the page is a hint, not an input.
function cleanPage(page: unknown): string | null {
  if (typeof page !== "string") return null;
  const p = page.split("?")[0].slice(0, 80);
  return /^\/app(\/[A-Za-z0-9/_-]*)?$/.test(p) ? p : null;
}

export async function buildStateNote(
  supabase: SupabaseClient,
  a: {
    userId: string;
    name: string;
    page: unknown;
    previous: StateFingerprint | null;
    watch: WatchItem[];
    watchBar: number;
    /** A render the person pointed at from the sheet ("Ask why"). */
    focus?: unknown;
    /** They spoke this message and/or hear the answer read aloud. */
    spoken?: boolean;
    /** Their earlier messages that never got an answer (history.ts unansweredBefore). */
    unanswered?: string[];
    /** The last answer they were shown, when it was cut off part-way (history.ts lastAnswerCut). */
    cutAnswer?: string | null;
    /** They cut in while it was being read aloud: the part of it they heard (the sheet reports it). */
    heard?: string | null;
  },
): Promise<{ text: string; fingerprint: StateFingerprint }> {
  const [profileResult, castResult, rulesResult, rendersResult] = await Promise.all([
    supabase
      .from("profiles")
      .select("plan, plan_status, role, bonus_credits, purchased_credits, current_period_start")
      .eq("id", a.userId)
      .single(),
    supabase
      .from("character_profiles")
      .select("id, name, traits, render_style, reference_image_urls")
      .eq("user_id", a.userId)
      .order("updated_at", { ascending: false })
      .limit(20),
    supabase
      .from("brand_rules")
      .select("kind, label, value, applies_to, severity")
      .eq("user_id", a.userId)
      .eq("active", true)
      .order("label", { ascending: true })
      .limit(30),
    supabase
      .from("generations")
      .select(
        "id, created_at, status, content_type, model_id, video_model_id, video_duration_seconds, match_score, credits_used, character_profile_id, prompt_input",
      )
      .eq("user_id", a.userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  for (const [label, r] of [
    ["profile", profileResult],
    ["cast", castResult],
    ["brand rules", rulesResult],
    ["renders", rendersResult],
  ] as const) {
    if (r.error) console.error(`producer-state: ${label} unavailable —`, r.error.message);
  }

  const profile = profileResult.data;
  const plan = ((profile?.plan as string | null) ?? "none") as PlanId;
  const isAdmin = profile?.role === "admin";

  let credits: string;
  if (isAdmin) {
    credits = "admin account: no credit limit";
  } else {
    const used = await getMonthlyUsageWith(supabase, a.userId, profile?.current_period_start as string | null);
    const allowance = (PLAN_LIMITS[plan] ?? 0) + Number(profile?.bonus_credits ?? 0);
    const bought = Number(profile?.purchased_credits ?? 0);
    credits = `${Math.max(0, allowance - used)} of ${allowance} plan credits left this period, plus ${bought} bought credits`;
  }

  const cast = castResult.data ?? [];
  const castNames = new Map(cast.map((c) => [c.id as string, clean(c.name, 60)]));
  const castText =
    cast
      .map((c) => {
        const t = (c.traits ?? {}) as Record<string, unknown>;
        const bits = [
          t.hair ? `hair ${clean(t.hair, 60)}` : null,
          t.distinguishing_features ? `features ${clean(t.distinguishing_features, 100)}` : null,
          c.render_style ? `style ${clean(c.render_style, 20)}` : null,
          `${(c.reference_image_urls as string[] | null)?.length ?? 0} photo(s)`,
        ].filter(Boolean);
        return `- ${clean(c.name, 60)} (id ${c.id}): ${bits.join(", ")}`;
      })
      .join("\n") || "- no characters yet";

  const rulesText =
    (rulesResult.data ?? [])
      .map(
        (r) =>
          `- ${r.kind === "forbid" ? "never" : "always"} ${clean(r.label, 60)}: ${clean(r.value, 200)} (${clean(
            r.applies_to,
            20,
          )}, ${clean(r.severity, 20)})`,
      )
      .join("\n") || "- none set";

  const renders = rendersResult.data ?? [];
  const newest = (renders[0]?.created_at as string | undefined) ?? null;
  const since = a.previous?.lastRenderAt ?? null;
  const fresh = since ? renders.filter((g) => String(g.created_at) > since) : renders;
  const renderText = fresh
    .map((g) => {
      const model = g.model_id ?? g.video_model_id ?? (g.content_type === "image" ? "image" : "?");
      const who = g.character_profile_id ? castNames.get(g.character_profile_id as string) ?? "a character" : "no character";
      const score = typeof g.match_score === "number" ? `score ${g.match_score}` : "unscored";
      const len = g.video_duration_seconds ? ` ${g.video_duration_seconds}s` : "";
      return `- ${String(g.created_at).slice(0, 16).replace("T", " ")} ${g.content_type}${len} on ${model}, ${who}: ${
        g.status
      }, ${score}, ${g.credits_used ?? 0} cr (id ${g.id}). Asked for: "${clean(g.prompt_input, 160)}"`;
    })
    .join("\n");

  const next: StateFingerprint = {
    cast: fingerprint(castText),
    rules: fingerprint(rulesText),
    lastRenderAt: newest ?? since,
  };

  const page = cleanPage(a.page);
  const focus = typeof a.focus === "string" && /^[0-9a-f-]{36}$/i.test(a.focus) ? a.focus : null;
  const lines = [
    `App note (written by Picacho, not by the person), ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC.`,
    `They call you: ${clean(a.name, 24)}.`,
    page ? `They are on: ${page}` : null,
    `Plan: ${PLAN_LABELS[plan] ?? plan}${isAdmin ? " (admin)" : ""}. Credits: ${credits}.`,
    a.previous?.cast === next.cast ? "Their cast: unchanged since the last note." : `Their cast:\n${castText}`,
    a.previous?.rules === next.rules
      ? "Active brand rules: unchanged since the last note."
      : `Active brand rules:\n${rulesText}`,
    renderText
      ? `${a.previous ? "Renders since the last note" : "Their latest renders"}, newest first:\n${renderText}`
      : a.previous
        ? "No new renders since the last note."
        : "They haven't rendered anything yet.",
    a.watch.length > 0
      ? `On the watch list (finished, scored under ${a.watchBar}, not yet opened by them):\n${a.watch
          .map((w) => `- ${w.id}: ${w.kind}, score ${w.score}${w.notes ? ` — ${clean(w.notes, 120)}` : ""}`)
          .join("\n")}`
      : null,
    focus ? `They pressed "Ask why" on render ${focus}: that is the one this message is about.` : null,
    // Several things at once (2026-09-25): nothing they said is dropped.
    a.unanswered && a.unanswered.length > 0
      ? `Before this message they also said the following, and your answer was cut off before you replied, so it is still unanswered:\n${a.unanswered
          .map((t) => `- "${clean(t, 300)}"`)
          .join("\n")}\nAnswer that and this message together, in order, as one reply. Don't mention the interruption unless it matters.`
      : null,
    a.heard !== undefined && a.heard !== null
      ? a.heard.trim()
        ? `They cut in while your last answer was being read aloud. They heard only this much of it: "${clean(a.heard, 600)}". They did not hear the rest; don't assume they did, and don't repeat it unless they ask.`
        : "They cut in before any of your last answer was read aloud: they heard none of it."
      : a.cutAnswer
        ? `Your last answer was cut off part-way, after: "${clean(a.cutAnswer, 400)}". Don't pick it up again unless they ask.`
        : null,
    a.spoken
      ? "They are talking to you out loud and hear your answer spoken (see WHEN YOU ARE TALKING OUT LOUD). Their words were transcribed from speech, so allow for a misheard word. Prepared cards still appear on their screen. If they asked more than one thing, answer each of them, in order, briefly. Sound like a person, not a narrator: open with a short first sentence (it is spoken while you are still saying the rest), use everyday words and contractions, and the small reactions a person would use (\"oh, nice\", \"right\", \"okay, so\") where they fit. No headings, bullets, markdown or emoji: everything you write is heard."
      : null,
  ].filter(Boolean);

  return { text: lines.join("\n\n"), fingerprint: next };
}
