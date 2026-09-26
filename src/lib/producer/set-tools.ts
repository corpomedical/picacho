import type { SupabaseClient } from "@supabase/supabase-js";
import { UUID_RE, setsAccess } from "../sets/access";
import { clearSetEdit, saveSetEdit } from "../sets/editor-actions";
import { normaliseSetLayout, normaliseSetSpec, type SetSpec, type Vec3 } from "../sets/set-spec";
import { checkSet } from "../sets/set-check";
import { listThingModels } from "../sets/thing-model-store";
import {
  describeParts,
  describeThings,
  dropToFloor,
  findThing,
  moveThing,
  turnThing,
  uprightThing,
  type Axis,
  type FixResult,
} from "../sets/thing-fix";
import { setElements } from "../sets/elements";

// The Producer's hands in Helios (2026-09-25, operator: "My latest generation
// in Helios made the car upside down. Can you fix it so its standing on its
// wheels?", then "The assistant should be able to fix these things and know
// how to do them").
//
// READ the set as it stands (the Build copy when there is one): its things
// by the names the set page uses, whether each car stands on its wheels,
// which are drawn from a 3D model file, and the newest stills taken from it.
// FIX a thing — stand it upright, turn it, move it, set it on the floor —
// with the maths in lib/sets/thing-fix.ts, SAVED THROUGH THE BUILD EDITOR'S
// OWN SAVE (saveSetEdit): the same access check, owner check, normalising,
// held text and rate limit as the person's own edit. Astra's original is
// never touched. UNDO puts back the copy the last change replaced; that copy
// rides in the conversation (the tool round's display, which the model never
// reads), so no new table or file is needed.
//
// Free: none of this spends a credit. Re-shooting after a fix is the
// person's (Shoot, 1 credit).

type Ctx = { admin: SupabaseClient; userId: string };
export type SetChange = { setId: string; before: SetSpec | null };
export type SetToolResult = { text: string; isError?: boolean; setChange?: SetChange };

const err = (text: string): SetToolResult => ({ text, isError: true });

/** The set meant: the one named, else the one their newest still came from, else their newest set. */
async function whichSet(ctx: Ctx, setId: unknown): Promise<string | null> {
  if (typeof setId === "string" && UUID_RE.test(setId.trim())) return setId.trim();
  const { data: shot } = await ctx.admin
    .from("location_set_shots")
    .select("set_id")
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (shot?.set_id) return shot.set_id as string;
  const { data: set } = await ctx.admin
    .from("location_sets")
    .select("id")
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (set?.id as string | undefined) ?? null;
}

type Loaded = { id: string; title: string; status: string; original: SetSpec; edited: SetSpec | null; layout: unknown };

async function loadSet(ctx: Ctx, id: string): Promise<Loaded | null> {
  const { data: row } = await ctx.admin
    .from("location_sets")
    .select("id, title, status, spec, layout")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return null;
  const n = normaliseSetSpec(row.spec);
  if (!n.ok) return null;
  let edited: SetSpec | null = null;
  const { data: e } = await ctx.admin
    .from("location_sets")
    .select("edited_spec")
    .eq("id", id)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  if (e?.edited_spec) {
    const en = normaliseSetSpec(e.edited_spec);
    if (en.ok) edited = en.spec;
  }
  return { id, title: String(row.title ?? "") || n.spec.title, status: String(row.status), original: n.spec, edited, layout: row.layout ?? null };
}

/** Helios for this person (the same rule as every set page and action). */
async function gate(ctx: Ctx): Promise<string | null> {
  const access = await setsAccess();
  if (access.error !== null) return access.error;
  if (access.userId !== ctx.userId) return "That set isn't yours.";
  return null;
}

const m = (v: number) => `${Math.round(v * 10) / 10}`;
const SIDE_WORDS = { ahead: "in front of the figure", left: "to the figure's left", right: "to the figure's right", behind: "behind the figure" } as const;

export async function readSetTool(ctx: Ctx, input: { set_id?: unknown }): Promise<SetToolResult> {
  const blocked = await gate(ctx);
  if (blocked) return err(blocked);
  const id = await whichSet(ctx, input.set_id);
  if (!id) return err("They have no Helios sets yet.");
  const set = await loadSet(ctx, id);
  if (!set) return err("That set isn't theirs, or it no longer exists.");
  if (set.status !== "ready") return { text: `Set "${set.title}" (${id}) is ${set.status}: it can be read and fixed once it's ready.` };
  const working = set.edited ?? set.original;
  // Where the person left the figure (the page's saved arrangement), so "to its left" is theirs.
  const things = describeThings(working, normaliseSetLayout(set.layout, working)?.mark);
  const parts = describeParts(working);
  const models = await listThingModels(ctx.admin, ctx.userId, id).catch(() => []);
  const modelled = new Set(models.map((mo) => mo.key));
  const findings = checkSet(working).slice(0, 5);
  const { data: shots } = await ctx.admin
    .from("location_set_shots")
    .select("generation_id, created_at")
    .eq("set_id", id)
    .eq("user_id", ctx.userId)
    .order("created_at", { ascending: false })
    .limit(3);

  const lines = [
    `Set "${set.title}" (set_id ${id}). ${set.edited ? "It has been edited (Build, or an earlier fix); you are reading the edited copy." : "As Astra built it."}`,
    things.length === 0
      ? "It has no separate things (only structure: floor, walls, track)."
      : `Things in it (the names the set page uses; to fix one, pass its key — pick it by its name, colour and side here, never by guessing):\n${things
          .map((t) => {
            const standing =
              t.upright === "upside_down"
                ? "UPSIDE DOWN: its wheels are above its body"
                : t.upright === "upright"
                  ? "standing on its wheels"
                  : "no wheels";
            const floor = Math.abs(t.lowest) < 0.02 ? "on the floor" : t.lowest > 0 ? `${m(t.lowest)} m above the floor` : `${m(-t.lowest)} m into the floor`;
            const model = modelled.has(t.key)
              ? "; DRAWN FROM A 3D MODEL FILE on the stage (fixing its blocks won't change how the model faces; see the product guide)"
              : "";
            const alias = t.alias !== t.name ? `; also "${t.alias}"` : "";
            return `- ${t.name} (key ${t.key}${alias}): ${t.kind}, ${t.colour}, ${SIDE_WORDS[t.side]}, ${m(t.size[0])} × ${m(t.size[1])} × ${m(t.size[2])} m at x ${m(t.centre[0])}, z ${m(t.centre[2])}; ${standing}; ${floor}; ${t.blocks} blocks${t.fixable ? "" : "; shares repeated blocks, so it can't be moved as one"}${model}`;
          })
          .join("\n")}`,
    parts.length ? `Parts (the set itself, can't be moved): ${parts.join(", ")}.` : null,
    findings.length ? `The set's own check found: ${findings.map((f) => JSON.stringify(f)).join("; ")}` : null,
    shots && shots.length
      ? `Newest stills and takes from it (render ids for look_at_render): ${shots.map((s) => s.generation_id).join(", ")}.`
      : "No stills taken from it yet.",
  ].filter(Boolean);
  return { text: lines.join("\n\n") };
}

const AXES = ["x", "y", "z"] as const;

export async function fixSetTool(
  ctx: Ctx,
  input: { set_id?: unknown; thing?: unknown; action?: unknown; axis?: unknown; degrees?: unknown; move?: unknown },
): Promise<SetToolResult> {
  const blocked = await gate(ctx);
  if (blocked) return err(blocked);
  const id = await whichSet(ctx, input.set_id);
  if (!id) return err("They have no Helios sets yet.");
  const set = await loadSet(ctx, id);
  if (!set) return err("That set isn't theirs, or it no longer exists.");
  if (set.status !== "ready") return err(`That set is ${set.status}; it can be fixed once it's ready.`);
  const working = set.edited ?? set.original;
  const ref = typeof input.thing === "string" ? input.thing : "";
  const el = ref ? findThing(working, ref) : null;
  if (!el) {
    const names = describeThings(working).map((t) => `${t.name} (${t.key})`);
    return err(`No thing called "${ref}" in that set. Its things: ${names.join(", ") || "none"}.`);
  }
  const name = describeThings(working).find((t) => t.key === el.key)?.name ?? ref;

  let result: FixResult;
  switch (input.action) {
    case "upright":
      result = uprightThing(working, el);
      break;
    case "turn": {
      const axis = (AXES as readonly unknown[]).includes(input.axis) ? (input.axis as Axis) : "y";
      const deg = typeof input.degrees === "number" && Number.isFinite(input.degrees) ? input.degrees : NaN;
      if (!Number.isFinite(deg) || deg === 0 || Math.abs(deg) > 360) return err("Say how many degrees to turn it (-360 to 360, not 0).");
      result = turnThing(working, el, axis, deg);
      break;
    }
    case "move": {
      const v = input.move as { x?: unknown; y?: unknown; z?: unknown } | null;
      const by = [v?.x, v?.y, v?.z].map((n) => (typeof n === "number" && Number.isFinite(n) ? Math.max(-50, Math.min(50, n)) : 0)) as Vec3;
      if (by.every((n) => n === 0)) return err("Say how far to move it, in metres (x across, y up, z along).");
      result = moveThing(working, el, by);
      break;
    }
    case "floor":
      result = dropToFloor(working, el);
      break;
    default:
      return err("action must be upright, turn, move or floor.");
  }
  if (!result.ok) return err(`${name} wasn't changed: ${result.why}.`);
  if (result.spec === working) return { text: `${name}: ${result.done}. Nothing needed changing.` };

  const saved = await saveSetEdit(id, result.spec);
  if (saved.error) return err(`The fix didn't save: ${saved.error}`);
  const after = setElements(result.spec).find((e) => e.fingerprint === el.fingerprint);
  const check = after ? describeThings(result.spec).find((t) => t.key === after.key) : null;
  return {
    text: `Done: ${name} ${result.done}. Saved to the set "${set.title}" (its Build copy; Astra's original is kept).${
      check ? ` Now: ${check.upright === "upright" ? "standing on its wheels" : check.upright === "upside_down" ? "still upside down" : "no wheels"}, lowest point ${m(check.lowest)} m.` : ""
    } Existing stills don't change; a new shot (Shoot, 1 credit, their press) shows the fix. undo_set_change puts it back.`,
    setChange: { setId: id, before: set.edited },
  };
}

/** The newest change the Producer made to a set, from the conversation's record of it. */
export async function undoSetTool(ctx: Ctx, input: { set_id?: unknown }): Promise<SetToolResult> {
  const blocked = await gate(ctx);
  if (blocked) return err(blocked);
  const want = typeof input.set_id === "string" && UUID_RE.test(input.set_id.trim()) ? input.set_id.trim() : null;
  const { data: rows } = await ctx.admin
    .from("producer_messages")
    .select("display, created_at")
    .eq("user_id", ctx.userId)
    .eq("display->>kind", "set_undo")
    .order("created_at", { ascending: false })
    .limit(10);
  let change: SetChange | null = null;
  for (const r of rows ?? []) {
    const changes = ((r.display as { changes?: unknown } | null)?.changes ?? []) as SetChange[];
    const hit = [...changes].reverse().find((c) => c && typeof c.setId === "string" && (!want || c.setId === want));
    if (hit) {
      change = hit;
      break;
    }
  }
  if (!change) return err("There's no change of mine to a set to undo in this conversation.");
  const set = await loadSet(ctx, change.setId);
  if (!set) return err("That set isn't theirs any more, or it no longer exists.");
  let restoreTo: SetSpec | null = null;
  if (change.before) {
    const n = normaliseSetSpec(change.before);
    if (!n.ok) return err("The copy to put back couldn't be read.");
    restoreTo = n.spec;
  }
  const saved = restoreTo ? await saveSetEdit(change.setId, restoreTo) : await clearSetEdit(change.setId);
  if (saved.error) return err(`The undo didn't save: ${saved.error}`);
  return {
    text: `Undone: the set "${set.title}" is back as it was before my last change${restoreTo ? "" : " (Astra's original)"}. Undoing again redoes it.`,
    setChange: { setId: change.setId, before: set.edited },
  };
}
