import type { SupabaseClient } from "@supabase/supabase-js";

// The assistant allowance with what the person has topped up (2026-09-28,
// lib/agent/topups.ts). Both assistants reserve through here: Aly
// (api/producer) and the composer's (api/agent/chat) share one ledger.
//
// reserve_agent_units is record_agent_units with the top-up in the ceiling;
// settle_assistant_topup takes what the month used above its allowance off
// the balance once a turn's real cost is written
// (supabase/pending/producer-aly.sql). Until that file has run, the old
// function answers and nobody holds a top-up.

export type Reservation =
  | { ok: true; /** The reservation row, or null when the limit is reached. */ id: string | null; /** Bought units left. */ topUp: number }
  | { ok: false; error: string };

type RpcError = { code?: string; message?: string } | null;

/** PostgREST's answer for a function (or table/column) the database doesn't have yet. */
export function isMissingInDatabase(error: RpcError): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "PGRST204" || error.code === "PGRST205") return true;
  if (error.code === "42883" || error.code === "42P01" || error.code === "42703") return true;
  return /could not find the (function|table)|does not exist/i.test(error.message ?? "");
}

export async function reserveAssistantUnits(
  admin: SupabaseClient,
  a: { userId: string; since: string; cap: number; units: number },
): Promise<Reservation> {
  const args = { p_user_id: a.userId, p_since: a.since, p_cap: a.cap, p_units: a.units };
  const { data, error } = await admin.rpc("reserve_agent_units", args);
  if (!error) {
    const d = data as { id?: unknown; topup?: unknown } | null;
    return {
      ok: true,
      id: typeof d?.id === "string" ? d.id : null,
      topUp: Math.max(0, Math.floor(Number(d?.topup) || 0)),
    };
  }
  if (!isMissingInDatabase(error)) return { ok: false, error: error.message };
  const old = await admin.rpc("record_agent_units", args);
  if (old.error) return { ok: false, error: old.error.message };
  return { ok: true, id: typeof old.data === "string" ? old.data : null, topUp: 0 };
}

/**
 * After a turn's real cost is on the ledger: whatever the month has used
 * above its allowance comes off the top-up. Only for someone holding one
 * (the reservation said so). Never throws; a miss is caught up by the next
 * turn's settle, which recounts the month.
 */
export async function settleAssistantTopUp(
  admin: SupabaseClient,
  a: { userId: string; since: string; cap: number },
): Promise<void> {
  try {
    const { error } = await admin.rpc("settle_assistant_topup", {
      p_user_id: a.userId,
      p_since: a.since,
      p_cap: a.cap,
    });
    if (error && !isMissingInDatabase(error)) console.error("assistant top-up: settle failed", error.message);
  } catch (err) {
    console.error("assistant top-up: settle failed", err);
  }
}

/**
 * For the meters (Aly's wheel, Settings, her account tool): bought units
 * left, and how many this month has already used. Zeros before the SQL has
 * run or on any error.
 */
export async function readAssistantTopUp(
  admin: SupabaseClient,
  userId: string,
  since: string,
): Promise<{ balance: number; spent: number }> {
  const [bal, sp] = await Promise.all([
    admin.from("profiles").select("assistant_topup_units").eq("id", userId).maybeSingle(),
    admin.from("assistant_topup_spend").select("spent").eq("user_id", userId).eq("since", since).maybeSingle(),
  ]);
  const balance = bal.error ? 0 : Number((bal.data as { assistant_topup_units?: unknown } | null)?.assistant_topup_units) || 0;
  const spent = sp.error ? 0 : Number((sp.data as { spent?: unknown } | null)?.spent) || 0;
  return { balance: Math.max(0, balance), spent: Math.max(0, spent) };
}
