// First-paint read guard (2026-09-02).
//
// Born from a crash report: a brand-new user's first visit to /app/generate
// died server-side (React #419, recovered client-side) two seconds after
// they created their first character — and the report couldn't say why,
// because every Supabase read in the workspace path destructured `data` and
// DISCARDED `error`. That pattern has two failure modes, both worse than a
// crash:
//
//   1. Silent wrong states. supabase-js does not throw on query errors; it
//      returns { data: null, error }. Dropped on the floor, a transient DB
//      blip renders a confidently wrong page — a subscriber shown the
//      "create your first character" card, plan "none", zero credits. For a
//      first-session user that IS the product breaking, invisibly.
//   2. Undiagnosable crashes. Whatever DOES throw inside the stream reaches
//      the admin queue as a minified mystery with no cause attached.
//
// guardedRead fixes both: it checks the error, absorbs transients with one
// short retry (the query factory builds a FRESH builder per attempt —
// PostgREST builders are single-shot), and if the retry also fails it
// throws a labeled error, so the Vercel function log names the exact read
// and the real Supabase message instead of a digest hash alone.
//
// PGRST116 ("zero rows" from .single()) is data, not weather: it means the
// row genuinely isn't there, so it returns null immediately — preserving
// each caller's existing missing-row semantics — rather than retrying or
// throwing.

const RETRY_DELAY_MS = 150;
const NO_ROWS = "PGRST116";

// Generic over the whole response (not just the row type): supabase-js
// types a response as the union { data: T; error: null } | { data: null;
// error: PostgrestError }, and inferring a bare T from that union collapses
// to never. R["data"] gives back exactly T | null.
export async function guardedRead<
  R extends { data: unknown; error: { message: string; code?: string } | null },
>(label: string, query: () => PromiseLike<R>): Promise<R["data"] | null> {
  const first = await query();
  if (!first.error) return first.data;
  if (first.error.code === NO_ROWS) return null;

  await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  const second = await query();
  if (!second.error) return second.data;
  if (second.error.code === NO_ROWS) return null;

  throw new Error(`[first-paint] ${label} read failed twice: ${second.error.message}`);
}
