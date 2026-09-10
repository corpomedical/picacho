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
