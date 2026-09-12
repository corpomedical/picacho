// The decision refusal-attribution.ts makes, pure and alias-free so the
// suite can load it (no node:async_hooks, no database, no model call).

/** What a caller knows about the prompt it is about to send. */
export type ModelWrittenPrompt = {
  /** The same prompt with the person's own words taken out. */
  modelOnlyPrompt: string;
  /** The tag a refusal of the model's words is logged under (never counted). */
  provider: string;
};

/**
 * null — the refusal is the person's, and counts toward their session.
 * A provider tag — the refusal is the model's words, and does not.
 *
 *   no model-written part known   → the person's (every caller but a Set shot)
 *   nothing of theirs in it        → the model's, with no second judgement
 *   the model's part refused alone → the model's
 *   the model's part passes alone  → the person's: their words made the difference
 *   the second judgement fails     → the person's, as it was before this existed
 */
export async function decideRefusalProvider(
  written: ModelWrittenPrompt | null,
  prompt: string,
  refusedAlone: (text: string) => Promise<boolean>,
): Promise<string | null> {
  if (!written) return null;
  if (written.modelOnlyPrompt.trim() === prompt.trim()) return written.provider;
  try {
    return (await refusedAlone(written.modelOnlyPrompt)) ? written.provider : null;
  } catch {
    return null;
  }
}
