// Alias-free and side-effect-free, so the test can load it.
//
// ERRORS SAY WHAT HAPPENED, NOT WHAT TO BUY (Press Tour cut 0, 2026-09-25).
// The public API and the MCP server answer machines, and through them people
// inside Claude and ChatGPT. ChatGPT's app rules forbid an app promoting
// upgrades or selling credits, and a model that reads "pick a plan or top up
// credits" passes the pitch straight on. The web composer's allowance texts
// (generations/core.ts) are written for Picacho's own pages, where the next
// step is a button on the same screen, and they end in exactly that pitch.
//
// So the API keeps the part of each text that says what happened ("You've
// used today's free generation — it comes back tomorrow.") and drops the part
// that sells. It works on clauses, not on a table of exact strings, because
// the allowance texts carry numbers and plan names. The words it looks for
// are Picacho's own sales phrasing in Picacho's own texts, never a person's
// request, and the test pins it against every such text core.ts produces.

/** Said when nothing of a refusal is left once the pitch is gone. */
export const PLAIN_NO_CREDITS = "This account doesn't have enough credits for that right now.";

/** The daily free generation, already taken today (was: "...Top up credits or pick a plan to keep going."). */
export const PLAIN_FREE_USED_TODAY = "You've used today's free generation. It comes back tomorrow.";

// A clause that asks the reader to buy, upgrade or contact sales.
const PITCH = /\b(pick a plan|choose a plan|top up|top-up|upgrade|buy (more )?credits|reach out|get in touch|contact us)\b/i;

/**
 * The text with every sales clause removed.
 *
 * Sentences are split on their closing punctuation and clauses on " — ", the
 * dash these texts join them with. From the first clause that pitches, the
 * rest of that sentence goes (a pitch's tail, "— your characters and history
 * stay exactly as they are", is part of the pitch). A sentence that starts
 * with one goes whole.
 */
export function withoutSalesPitch(message: string, fallback: string = PLAIN_NO_CREDITS): string {
  const sentences = message.trim().split(/(?<=[.!?])\s+/);
  const kept: string[] = [];
  for (const sentence of sentences) {
    const clauses = sentence.split(" — ");
    const firstPitch = clauses.findIndex((c) => PITCH.test(c));
    if (firstPitch === -1) {
      kept.push(sentence);
      continue;
    }
    if (firstPitch === 0) continue;
    const head = clauses.slice(0, firstPitch).join(" — ").replace(/[\s,;:—-]+$/, "");
    kept.push(/[.!?]$/.test(head) ? head : `${head}.`);
  }
  const text = kept.join(" ").trim();
  return text || fallback;
}
