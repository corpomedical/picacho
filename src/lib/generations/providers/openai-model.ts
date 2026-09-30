// The model behind every OpenAI "utility" reader (2026-09-10): the identity
// scorer, both content gates' primary readers, image descriptions, the
// brand-rule classifier. They all read OPENAI_MODEL, and all of them depend on
// a model that takes temperature 0 and a seed — the gates' repeatable
// readings are built on it, and the identity scorer stamps every score with
// the model that produced it.
//
// GPT-6 Astra takes neither parameter. Setting OPENAI_MODEL to the Astra model
// "to try Astra" would quietly break six readers at once — both gates would
// lose their OpenAI reader and the score dataset would split — so a gpt-6
// value is refused here, loudly, and the default stands. Astra has its own
// client (providers/astra.ts); this setting is not the way to reach it.
//
// Alias-free on purpose: the scorer-version test imports it.

export const DEFAULT_UTILITY_MODEL = "gpt-5.4-mini";

let warned = false;

export function utilityModel(): string {
  const configured = (process.env.OPENAI_MODEL ?? "").trim();
  if (!configured) return DEFAULT_UTILITY_MODEL;
  if (/^gpt-6/i.test(configured)) {
    if (!warned) {
      warned = true;
      console.error(
        `[openai-model] OPENAI_MODEL=${configured} refused for the utility readers (no temperature/seed); using ${DEFAULT_UTILITY_MODEL}. Astra has its own client.`,
      );
    }
    return DEFAULT_UTILITY_MODEL;
  }
  return configured;
}

// THE IDENTITY SCORER'S OWN MODEL (scorer p3, 2026-09-30). The one reader
// that no longer rides OPENAI_MODEL. On the day's test set (identity-prompt.ts)
// gpt-5.4-mini swung by as much as 70 points between two readings of one
// lookalike under the first new wording, and under the final one put a
// lookalike (86) above one of Eva's own photos (72). gpt-5.5 varies too, by
// up to 14 points, but its readings of Eva's photos stayed above every
// lookalike's in 3 of 5 runs and the overlap in the other two was 2-4
// points. The scorer takes neither temperature nor seed, so a larger model
// costs it nothing but money: ≈ $0.041 a reading with three
// references (5,858 tokens in at $5/1M, 396 out at $30/1M, read at
// developers.openai.com/api/docs/models/gpt-5.5 that day). IDENTITY_SCORER_MODEL
// overrides it; a gpt-6 value is refused for the same reason as above.
export const DEFAULT_IDENTITY_MODEL = "gpt-5.5";

let identityWarned = false;

export function identityModel(): string {
  const configured = (process.env.IDENTITY_SCORER_MODEL ?? "").trim();
  if (!configured) return DEFAULT_IDENTITY_MODEL;
  if (/^gpt-6/i.test(configured)) {
    if (!identityWarned) {
      identityWarned = true;
      console.error(`[openai-model] IDENTITY_SCORER_MODEL=${configured} refused; using ${DEFAULT_IDENTITY_MODEL}.`);
    }
    return DEFAULT_IDENTITY_MODEL;
  }
  return configured;
}
