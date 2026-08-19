import { createAdminClient } from "@/lib/supabase/server";

// The homepage hero grid: one real character (Eva) across six real scenes.
// Everything here is genuine Picacho output — her uploaded identity photo
// plus images the product actually generated — which is the entire point of
// the hero: the proof IS the product.
//
// This module is the single source of truth for WHICH rows back the grid.
// It is imported by BOTH consumers so they can never drift apart:
//   • /api/showcase/[index] (route.ts) — streams the image bytes
//   • app/page.tsx — reads the same rows' match_score / prompt_input for
//     the hero score chips and the "Try it" proof widget
//
// Two sources, because the good scenes live in two places:
//   • "reference"  — a slot in her character gallery (character-references)
//   • "generation" — a finished generation's stored result (generated-images)
//
// To swap a tile, change one line below — no redeploy of anything else, no
// files to copy. Storage paths come from generations.result_url (strip the
// query string) or character_profiles.reference_image_urls.
export type ShowcaseItem =
  | { kind: "reference"; index: number }
  | { kind: "generation"; path: string };

// Which real character/account backs the hero grid. Env-var first so the
// ids of a live production account aren't baked into the public repo's
// source as the only copy (they also used to be pasted into the public API
// docs as "examples" — now scrubbed there; see docs/api/page.tsx). The
// fallbacks keep the current deployment working with nothing set.
// OPERATOR: set SHOWCASE_CHARACTER_ID / SHOWCASE_OWNER_ID in production if
// the hero account ever changes — one env edit, no redeploy of code.
export const SHOWCASE_CHARACTER_ID =
  process.env.SHOWCASE_CHARACTER_ID || "15486a3c-4203-43e9-b80d-ab476f842404"; // Eva
export const SHOWCASE_OWNER_ID =
  process.env.SHOWCASE_OWNER_ID || "a3102bc1-2355-444a-8ade-caafd7980218";

export const SHOWCASE: ShowcaseItem[] = [
  // 0 — identity photo, the one the hero badges as such.
  { kind: "reference", index: 0 },
  // 1 — snow / white winter coat (match 95%).
  { kind: "generation", path: `${SHOWCASE_OWNER_ID}/775251a7-d43f-47f7-97fc-3e900feb1c4e.png` },
  // 2 — festival, hand raised, laughing (match 91%).
  { kind: "generation", path: `${SHOWCASE_OWNER_ID}/36c68d55-fd40-4b31-93ca-4c975509d9e6.png` },
  // 3 — cooking show, chef whites (match 92%). Rendered chest-up on the
  //     homepage via object-position, so the face carries at tile size.
  { kind: "generation", path: `${SHOWCASE_OWNER_ID}/97e292c7-0f39-4786-9c6d-4dc98de691e0.png` },
  // 4, 5 — remaining scenes from her gallery.
  { kind: "reference", index: 4 },
  { kind: "reference", index: 5 },
];

type AdminClient = ReturnType<typeof createAdminClient>;

// Resolves a showcase item to the storage bucket + object path the image
// route downloads from. Extracted verbatim from the route so the homepage's
// data fetch below is guaranteed to describe the same files the route
// serves — the route's behavior is unchanged.
export async function resolveShowcaseItem(
  admin: AdminClient,
  item: ShowcaseItem,
): Promise<{ bucket: string; path: string | null }> {
  if (item.kind === "generation") {
    return { bucket: "generated-images", path: item.path };
  }
  const { data: character } = await admin
    .from("character_profiles")
    .select("reference_image_urls")
    .eq("id", SHOWCASE_CHARACTER_ID)
    .single();
  return {
    bucket: "character-references",
    path: character?.reference_image_urls?.[item.index] ?? null,
  };
}

// One qualifying entry for the homepage's "Try it" widget — a showcase tile
// whose backing generations row really has a prompt and a vision score.
export type ShowcaseTryItEntry = {
  /** Hero-grid index — the image is `/api/showcase/${index}`. */
  index: number;
  /** The row's real prompt_input, whitespace-trimmed. */
  prompt: string;
  /** The row's real match_score (0-100), rounded for display. */
  score: number;
  /** Pipeline attempts (attempts column, else pipeline_log length); null when underivable. */
  attempts: number | null;
};

export type ShowcaseProof = {
  /**
   * Real match_score per hero tile, aligned with SHOWCASE by index. null =
   * no score exists (reference tiles have no generations row at all —
   * gallery images are copies under new random filenames, so there is no
   * provenance to score them by — and a generation tile whose row lacks a
   * numeric match_score gets null too). The hero renders NO chip for null:
   * a score is either real or absent, never invented.
   */
  scores: (number | null)[];
  /** Entries qualifying for the "Try it" widget (image + prompt + score). */
  tryIt: ShowcaseTryItEntry[];
};

const EMPTY_PROOF: ShowcaseProof = { scores: SHOWCASE.map(() => null), tryIt: [] };

// Fetches, via the service client (the rows belong to the showcase owner,
// not the visitor — exactly how the image route itself reads her files),
// the generations rows behind the generation-kind tiles above. A row is
// found by its stored result file: result_url embeds
// "generated-images/<owner>/<uuid>.png" in BOTH formats a row can hold
// (the current /api/media capability URL and the legacy signed URL — see
// extractStoragePath in lib/generations/actions.ts), so a LIKE on the
// path matches either. Best-effort by design: the homepage must render
// with or without this data, so any failure returns the empty shape and
// the chips/widget simply don't appear — never a made-up number.
export async function getShowcaseProof(): Promise<ShowcaseProof> {
  try {
    const admin = createAdminClient();
    const rows = await Promise.all(
      SHOWCASE.map(async (item) => {
        if (item.kind !== "generation") return null;
        const { data } = await admin
          .from("generations")
          .select("prompt_input, match_score, attempts, pipeline_log, status")
          .eq("user_id", SHOWCASE_OWNER_ID)
          .like("result_url", `%generated-images/${item.path}%`)
          .limit(1)
          .maybeSingle();
        return data ?? null;
      }),
    );

    const scores: (number | null)[] = rows.map((row) => {
      const raw = row?.match_score;
      return typeof raw === "number" && Number.isFinite(raw) ? Math.round(raw) : null;
    });

    const tryIt: ShowcaseTryItEntry[] = [];
    rows.forEach((row, index) => {
      if (!row) return;
      const score = scores[index];
      if (score === null) return;
      const prompt = typeof row.prompt_input === "string" ? row.prompt_input.trim() : "";
      if (!prompt) return;
      // The widget captions this as "Passed on attempt N" (retries stop on
      // success, so the passing attempt IS the last one) — a claim that is
      // only true for a row that actually succeeded. Anything else: null,
      // and the caption is simply omitted.
      const logLength = Array.isArray(row.pipeline_log) ? row.pipeline_log.length : 0;
      const attempts =
        row.status !== "succeeded"
          ? null
          : typeof row.attempts === "number" && row.attempts > 0
            ? row.attempts
            : logLength > 0
              ? logLength
              : null;
      tryIt.push({ index, prompt, score, attempts });
    });

    return { scores, tryIt: tryIt.slice(0, 4) };
  } catch {
    return EMPTY_PROOF;
  }
}
