// The one module that names character_profiles.expression_set
// (supabase/applied/2026-09-19/character-expression-set.sql, run in
// production 2026-09-19). Everything else goes
// through here, the Mystique lesson: a statement that names a column the
// database does not have fails WHOLE, so the column is read in a query of
// its own, and until the SQL runs every reader sees an empty set and every
// writer says the database needs updating — nothing else on the character
// page or in a render moves.
//
// Relative imports only: the tests load it as it is.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseExpressionSet, type ExpressionSet, type ExpressionSlot, type ExpressionSlotEntry } from "./expression-set";

const COLUMN = "expression_set";

/** The set off a row a caller already loaded with select("*") — no query, nothing named in one. */
export function expressionSetOfRow(row: unknown, ownerId: string): ExpressionSet {
  if (!row || typeof row !== "object") return {};
  return normaliseExpressionSet((row as Record<string, unknown>)[COLUMN], ownerId);
}

/** The character's set, in a query of its own. A missing column, or any failure, reads as no set. */
export async function readExpressionSet(supabase: SupabaseClient, characterId: string, ownerId: string): Promise<ExpressionSet> {
  const { data, error } = await supabase
    .from("character_profiles")
    .select(COLUMN)
    .eq("id", characterId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error || !data) return {};
  return expressionSetOfRow(data, ownerId);
}

/**
 * Whether the set can be written at all, asked BEFORE anything is spent: an
 * allowance must never pay for a close-up the database cannot keep. Unlike
 * readExpressionSet, "no set yet" and "no column" come back different.
 */
export async function probeExpressionSet(
  supabase: SupabaseClient,
  characterId: string,
  ownerId: string,
): Promise<{ available: true; set: ExpressionSet } | { available: false; reason: "missing" | "failed" }> {
  const { data, error } = await supabase
    .from("character_profiles")
    .select(COLUMN)
    .eq("id", characterId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) return { available: false, reason: /column|expression_set|schema cache/i.test(error.message) ? "missing" : "failed" };
  if (!data) return { available: false, reason: "failed" };
  return { available: true, set: expressionSetOfRow(data, ownerId) };
}

export type SetWrite = { error: null; set: ExpressionSet; replaced: string | null } | { error: "missing" | "failed" };

/**
 * Puts one close-up in its slot (or takes it out, entry null) and says which
 * earlier file it replaced, for the caller to remove from storage. Read and
 * written in two statements: the page makes a set one close-up at a time, so
 * two writes to one character do not race in practice, and the worst a race
 * could do is drop the other slot's pointer — never another person's data.
 */
export async function writeExpressionSlot(
  supabase: SupabaseClient,
  characterId: string,
  ownerId: string,
  slot: ExpressionSlot,
  entry: ExpressionSlotEntry | null,
): Promise<SetWrite> {
  const { data, error } = await supabase
    .from("character_profiles")
    .select(COLUMN)
    .eq("id", characterId)
    .eq("user_id", ownerId)
    .maybeSingle();
  if (error) return { error: /column|expression_set|schema cache/i.test(error.message) ? "missing" : "failed" };
  if (!data) return { error: "failed" };
  const current = expressionSetOfRow(data, ownerId);
  const replaced = current[slot]?.path ?? null;
  const next: ExpressionSet = { ...current };
  if (entry) next[slot] = entry;
  else delete next[slot];
  // Through the normaliser on the way in too: nothing outside the owner's
  // folder is ever written, whatever the caller handed over.
  const clean = normaliseExpressionSet(next, ownerId);
  const { error: writeError } = await supabase
    .from("character_profiles")
    .update({ [COLUMN]: clean, updated_at: new Date().toISOString() })
    .eq("id", characterId)
    .eq("user_id", ownerId);
  if (writeError) return { error: /column|expression_set|schema cache/i.test(writeError.message) ? "missing" : "failed" };
  return { error: null, set: clean, replaced: replaced && replaced !== entry?.path ? replaced : null };
}
