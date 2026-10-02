// Reads what "Who comes back" needs (model.ts computes it). Service client
// only — callers have passed requireAdmin / requireAdminFromRequest, or are
// the cron.
//
// Every source but profiles fails soft: a table that isn't there yet (the
// SQL in supabase/applied/2026-10-03/who-comes-back.sql not run) or a query that errors
// leaves that source empty, and a tool whose "made something" couldn't be
// read shows a dash instead of a misleading 0.
//
// All-time reads, paged past PostgREST's 1,000-row cap (fetch-all.ts).
// Fine at Picacho's size; when it isn't, the fix is a daily rollup table.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAll } from "@/lib/admin/fetch-all";
import { failureKindFromLog } from "@/lib/generations/report-constants";
import { UPSCALE_MODEL_ID } from "@/lib/generations/upscale";
import { LAYERS_MODEL_ID } from "@/lib/generations/layers";
import { EFFECTS_DOOR } from "@/lib/editor/effects";
import { isToolKey, type ToolKey } from "./tools";
import {
  computeRetention,
  type MadeIn,
  type OpenIn,
  type PaidIn,
  type PersonIn,
  type PersonPath,
  type RenderIn,
  type Retention,
  type RetentionInput,
  type SubEventIn,
} from "./model";

type Row = Record<string, unknown>;

async function rows(
  label: string,
  page: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>,
): Promise<Row[] | null> {
  try {
    return await fetchAll<Row>(page);
  } catch (err) {
    console.warn(`retention: ${label} unread —`, err instanceof Error ? err.message : err);
    return null;
  }
}

function displayName(p: Row): string {
  const full = typeof p.full_name === "string" ? p.full_name.trim() : "";
  if (full) return full;
  const user = typeof p.username === "string" ? p.username.trim() : "";
  if (user) return user;
  const email = typeof p.email === "string" ? p.email : "";
  return email.split("@")[0] || "Someone";
}

function toolForGeneration(g: Row): ToolKey {
  if (g.recast) return "recast";
  if (g.press_tour) return "pressTour";
  if (g.model_id === UPSCALE_MODEL_ID) return "upscale";
  if (g.model_id === LAYERS_MODEL_ID) return "layers";
  return "generate";
}

/** `only`: one person's rows (their page), instead of everyone's. */
export async function loadRetentionInput(admin: SupabaseClient, now = Date.now(), only?: string): Promise<RetentionInput> {
  const mine = only ? { user_id: only } : {};
  const profiles = await fetchAll<Row>((from, to) =>
    admin
      .from("profiles")
      .select("id, email, full_name, username, created_at, plan, plan_status, last_seen_at, role, marketing_opt_out")
      .match(only ? { id: only } : {})
      .order("created_at", { ascending: true })
      .range(from, to),
  );

  const [gens, failedGens, opens, chat, edits, sets, notes, characters, posts, subs, purchases] = await Promise.all([
    rows("generations", (from, to) =>
      admin
        .from("generations")
        .select("user_id, created_at, status, model_id, recast, press_tour").match(mine)
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    rows("failed generations", (from, to) =>
      admin
        .from("generations")
        .select("user_id, created_at, pipeline_log").match(mine)
        .eq("status", "failed")
        .order("created_at", { ascending: true })
        .range(from, to),
    ),
    rows("user_tool_days", (from, to) => admin.from("user_tool_days").select("user_id, day, tool").match(mine).range(from, to)),
    rows("aly_chat_messages", (from, to) =>
      admin.from("aly_chat_messages").select("user_id, created_at").match(mine).eq("role", "user").range(from, to),
    ),
    rows("video_edits", (from, to) => admin.from("video_edits").select("user_id, created_at, director").match(mine).range(from, to)),
    rows("location_sets", (from, to) => admin.from("location_sets").select("user_id, created_at").match(mine).range(from, to)),
    rows("notes", (from, to) => admin.from("notes").select("user_id, created_at").match(mine).range(from, to)),
    rows("character_profiles", (from, to) => admin.from("character_profiles").select("user_id, created_at").match(mine).range(from, to)),
    rows("community_posts", (from, to) => admin.from("community_posts").select("user_id, created_at").match(mine).range(from, to)),
    rows("subscription_events", (from, to) =>
      admin.from("subscription_events").select("user_id, kind, plan, ends_at, created_at").match(mine).range(from, to),
    ),
    rows("credit_purchases", (from, to) =>
      admin.from("credit_purchases").select("user_id, created_at, refunded_at").match(mine).range(from, to),
    ),
  ]);

  const people: PersonIn[] = profiles.map((p) => ({
    id: String(p.id),
    name: displayName(p),
    email: (p.email as string | null) ?? null,
    createdAt: String(p.created_at),
    plan: (p.plan as string | null) ?? null,
    planStatus: (p.plan_status as string | null) ?? null,
    lastSeenAt: (p.last_seen_at as string | null) ?? null,
    role: (p.role as string | null) ?? null,
    optedOut: p.marketing_opt_out === true,
  }));

  // A failed render's kind (refused / broke / stopped) lives in its log.
  const failKind = new Map<string, string>();
  for (const f of failedGens ?? []) failKind.set(`${f.user_id}|${f.created_at}`, failureKindFromLog(f.pipeline_log));

  const madeKnown = new Set<ToolKey>();
  const renders: RenderIn[] = [];
  const made: MadeIn[] = [];
  if (gens) {
    madeKnown.add("generate").add("recast").add("upscale").add("layers").add("pressTour");
    for (const g of gens) {
      const userId = String(g.user_id);
      const at = String(g.created_at);
      const kind = g.status === "failed" ? (failKind.get(`${userId}|${at}`) ?? "broke") : null;
      // A render the person stopped themselves isn't a failure of ours.
      if (kind !== "stopped") {
        renders.push({ userId, at, ok: g.status === "succeeded", failed: g.status === "failed", refused: kind === "refused" });
      }
      made.push({ userId, at, tool: toolForGeneration(g) });
    }
  }
  const addMade = (list: Row[] | null, tool: ToolKey | ((r: Row) => ToolKey)) => {
    if (!list) return;
    const pick = typeof tool === "function" ? tool : () => tool;
    for (const r of list) {
      const t = pick(r);
      madeKnown.add(t);
      made.push({ userId: String(r.user_id), at: String(r.created_at), tool: t });
    }
  };
  addMade(chat, "chat");
  if (edits) madeKnown.add("cut").add("effects");
  addMade(edits, (r) =>
    (r.director as { door?: string } | null)?.door === EFFECTS_DOOR ? "effects" : "cut",
  );
  if (sets) madeKnown.add("sets");
  addMade(sets, "sets");
  if (notes) madeKnown.add("notes");
  addMade(notes, "notes");
  if (characters) madeKnown.add("characters");
  addMade(characters, "characters");
  if (posts) madeKnown.add("community");
  addMade(posts, "community");

  const openRows: OpenIn[] = (opens ?? [])
    .filter((o) => isToolKey(o.tool))
    .map((o) => ({ userId: String(o.user_id), day: String(o.day), tool: o.tool as ToolKey }));

  const subEvents: SubEventIn[] = (subs ?? [])
    .filter((s) => s.kind === "cancel_scheduled" || s.kind === "cancel_undone" || s.kind === "ended")
    .map((s) => ({
      userId: String(s.user_id),
      kind: s.kind as SubEventIn["kind"],
      plan: (s.plan as string | null) ?? null,
      endsAt: (s.ends_at as string | null) ?? null,
      at: String(s.created_at),
    }));

  const paid: PaidIn[] = (purchases ?? [])
    .filter((p) => !p.refunded_at)
    .map((p) => ({ userId: String(p.user_id), at: String(p.created_at) }));

  return { people, renders, made, opens: openRows, subEvents, paid, madeKnown, now };
}

export async function loadRetention(admin: SupabaseClient, days = 7, now = Date.now()): Promise<Retention> {
  return computeRetention(await loadRetentionInput(admin, now), days);
}

/** One person's path (their admin page and the phone's person screen); null for admins and unknown ids. */
export async function loadPersonPath(admin: SupabaseClient, userId: string, now = Date.now()): Promise<PersonPath | null> {
  try {
    return computeRetention(await loadRetentionInput(admin, now, userId)).paths.get(userId) ?? null;
  } catch (err) {
    console.warn("retention: person path unread —", err instanceof Error ? err.message : err);
    return null;
  }
}
