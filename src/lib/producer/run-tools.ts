import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { loadFailureNotes } from "../agent/failure-notes";
import { lookAtRender } from "./look";
import { runNotesCommand } from "./notes";
import { notesStore } from "./store";
import { fixSetTool, readSetTool, undoSetTool, type SetChange, type SetToolResult } from "./set-tools";
import {
  TOOL_NAMES,
  readSearchFilters,
  searchText,
  validatePreparedSend,
  type PreparedSend,
  isVoiceAction,
  type VoiceAction,
} from "./tools";

// Runs the Producer's tool calls (2026-09-24). Every one of them is scoped to
// the person the ROUTE took from the session — never to an id the model
// wrote — and none of them spends a credit.

export type ToolCall = { id: string; name: string; input: unknown };

export type ToolOutcome = {
  result: {
    type: "tool_result";
    tool_use_id: string;
    content: string | ({ type: "text"; text: string } | { type: "image"; source: { type: "base64"; media_type: "image/jpeg"; data: string } })[];
    is_error?: boolean;
  };
  card?: PreparedSend;
  notesChanged?: boolean;
  /** A voice_control call: what the device should do with the mic/speaker. */
  voice?: VoiceAction;
  /** A set was changed: which, and the copy it replaced (kept for undo). */
  setChange?: SetChange;
};

export type ToolContext = {
  /** The person's own session client — RLS plus explicit user_id filters. */
  supabase: SupabaseClient;
  /** Service role, for the Producer's own tables. */
  admin: SupabaseClient;
  userId: string;
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

const errorResult = (id: string, text: string): ToolOutcome => ({
  result: { type: "tool_result", tool_use_id: id, content: text, is_error: true },
});

async function cast(ctx: ToolContext): Promise<{ id: string; name: string }[]> {
  const { data } = await ctx.supabase
    .from("character_profiles")
    .select("id, name")
    .eq("user_id", ctx.userId)
    .limit(100);
  return (data ?? []).map((c) => ({ id: c.id as string, name: String(c.name ?? "") }));
}

async function searchRenders(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  const f = readSearchFilters(asRecord(call.input));
  let q = ctx.supabase
    .from("generations")
    .select(
      "id, created_at, status, content_type, model_id, video_model_id, video_duration_seconds, match_score, credits_used, character_profile_id, prompt_input",
    )
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(f.limit);

  const people = await cast(ctx);
  const names = new Map(people.map((c) => [c.id, c.name]));
  if (f.character) {
    const wanted = f.character.toLowerCase();
    const ids = people.filter((c) => c.name.toLowerCase().includes(wanted)).map((c) => c.id);
    if (ids.length === 0) {
      return { result: { type: "tool_result", tool_use_id: call.id, content: `No character of theirs is called "${f.character}".` } };
    }
    q = q.in("character_profile_id", ids);
  }
  if (f.kind) q = q.eq("content_type", f.kind);
  if (f.scoreBelow !== null) q = q.lt("match_score", f.scoreBelow);
  if (f.scoreAtLeast !== null) q = q.gte("match_score", f.scoreAtLeast);
  if (f.days !== null) q = q.gte("created_at", new Date(Date.now() - f.days * 86_400_000).toISOString());
  const words = f.text ? searchText(f.text) : "";
  if (words) q = q.or(`prompt_input.ilike."%${words}%",match_notes.ilike."%${words}%"`);

  const { data, error } = await q;
  if (error) {
    console.error("producer: search failed —", error.message);
    return errorResult(call.id, "The search didn't run. Try fewer filters.");
  }
  if (!data || data.length === 0) {
    return { result: { type: "tool_result", tool_use_id: call.id, content: "Nothing matched." } };
  }
  // Why each failed one failed and whether its credits came back — the
  // composer's own words (lib/agent/failure-notes.ts, 2026-09-26).
  const failureNotes = await loadFailureNotes(
    ctx.supabase,
    ctx.userId,
    data.filter((g) => g.status === "failed").map((g) => g.id as string),
  );
  const lines = data.map((g) => {
    const model = g.model_id ?? g.video_model_id ?? (g.content_type === "image" ? "image" : "?");
    const who = g.character_profile_id ? names.get(g.character_profile_id as string) ?? "a character" : "no character";
    const score = typeof g.match_score === "number" ? `score ${g.match_score}` : "unscored";
    const len = g.video_duration_seconds ? ` ${g.video_duration_seconds}s` : "";
    const asked = String(g.prompt_input ?? "").replace(/\s+/g, " ").slice(0, 160);
    const failure = failureNotes.get(g.id as string);
    return `- ${g.id} | ${String(g.created_at).slice(0, 10)} | ${g.content_type}${len} on ${model} | ${who} | ${g.status}${
      failure ? ` (${failure.replace(/\s+/g, " ").replace(/\|/g, "/").slice(0, 360)})` : ""
    } | ${score} | ${g.credits_used ?? 0} cr | "${asked}"`;
  });
  return { result: { type: "tool_result", tool_use_id: call.id, content: lines.join("\n") } };
}

async function look(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  const r = await lookAtRender(ctx.supabase, ctx.userId, asRecord(call.input).render_id);
  if (!r.ok) return errorResult(call.id, r.error);
  const content: ToolOutcome["result"]["content"] = [{ type: "text", text: r.summary }];
  if (r.image) content.push({ type: "image", source: { type: "base64", ...r.image } });
  return { result: { type: "tool_result", tool_use_id: call.id, content } };
}

async function prepare(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  const checked = validatePreparedSend(asRecord(call.input), await cast(ctx), () => randomUUID().slice(0, 8));
  if ("error" in checked) return errorResult(call.id, checked.error);
  const c = checked.card;
  const what =
    c.kind === "video"
      ? `${c.modelName}, ${c.seconds}s, ${c.credits} credit${c.credits === 1 ? "" : "s"}`
      : `image, ${c.credits} credit`;
  return {
    result: {
      type: "tool_result",
      tool_use_id: call.id,
      content: `Prepared "${c.label}" (${what}${c.characterName ? `, with ${c.characterName}` : ""}). The person sees it as a card and sends it themselves; nothing has rendered.`,
    },
    card: c,
  };
}

async function memory(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  try {
    const r = await runNotesCommand(notesStore(ctx.admin, ctx.userId), asRecord(call.input));
    return {
      result: { type: "tool_result", tool_use_id: call.id, content: r.text, ...(r.isError ? { is_error: true } : {}) },
      notesChanged: r.changed,
    };
  } catch (err) {
    console.error("producer: notes failed —", err instanceof Error ? err.message : err);
    return errorResult(call.id, "The notes couldn't be reached just now.");
  }
}

function voiceControl(call: ToolCall): ToolOutcome {
  const action = asRecord(call.input).action;
  if (!isVoiceAction(action)) return errorResult(call.id, "action must be end_voice, mute_replies or unmute_replies.");
  const said =
    action === "end_voice"
      ? "Voice is ending: the microphone and speaker switch off after your goodbye plays."
      : action === "mute_replies"
        ? "Your answers will no longer be read aloud; you are still listening."
        : "Your answers will be read aloud again.";
  return { result: { type: "tool_result", tool_use_id: call.id, content: said }, voice: action };
}

function fromSet(call: ToolCall, r: SetToolResult): ToolOutcome {
  return {
    result: { type: "tool_result", tool_use_id: call.id, content: r.text, ...(r.isError ? { is_error: true } : {}) },
    ...(r.setChange ? { setChange: r.setChange } : {}),
  };
}

export async function runTool(ctx: ToolContext, call: ToolCall): Promise<ToolOutcome> {
  switch (call.name) {
    case TOOL_NAMES.readSet:
      return fromSet(call, await readSetTool(ctx, asRecord(call.input)));
    case TOOL_NAMES.fixSet:
      return fromSet(call, await fixSetTool(ctx, asRecord(call.input)));
    case TOOL_NAMES.undoSet:
      return fromSet(call, await undoSetTool(ctx, asRecord(call.input)));
    case TOOL_NAMES.voice:
      return voiceControl(call);
    case TOOL_NAMES.search:
      return searchRenders(ctx, call);
    case TOOL_NAMES.look:
      return look(ctx, call);
    case TOOL_NAMES.prepare:
      return prepare(ctx, call);
    case TOOL_NAMES.memory:
      return memory(ctx, call);
    default:
      return errorResult(call.id, `There is no tool called ${call.name}.`);
  }
}

/** What the sheet says while a tool runs. */
export function toolStatus(name: string): string {
  switch (name) {
    case TOOL_NAMES.search:
      return "Searching your renders";
    case TOOL_NAMES.look:
      return "Looking at the render";
    case TOOL_NAMES.prepare:
      return "Preparing a send";
    case TOOL_NAMES.memory:
      return "Checking my notes";
    case TOOL_NAMES.voice:
      return "Adjusting voice";
    case TOOL_NAMES.readSet:
      return "Reading the set";
    case TOOL_NAMES.fixSet:
      return "Fixing the set";
    case TOOL_NAMES.undoSet:
      return "Undoing the change";
    default:
      return "Working";
  }
}
