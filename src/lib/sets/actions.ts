"use server";

import { createClient, createAdminClient } from "@/lib/supabase/server";
import { rateLimited } from "@/lib/rate-limit";
import { mediaUrl } from "@/lib/media/url";
import { assertPromptAllowed, ContentPolicyRefusal } from "@/lib/generations/content-policy";
import { gatePrompt, recordPolicyRefusal } from "@/lib/generations/policy-log";
import { runGeneration } from "@/lib/generations/actions";
import { cancelAstraJob, pollAstraJob, submitAstraJob } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import { setsAccess, UUID_RE } from "@/lib/sets/access";
import { countSetBuildsThisMonth } from "@/lib/sets/data";
import {
  MAX_SET_FRAME_BYTES,
  MAX_SET_THUMB_BYTES,
  SET_BRIEF_MAX_CHARS,
  SET_BRIEF_MIN_CHARS,
  SET_BUILD_EFFORT,
  SET_BUILD_MAX_ATTEMPTS,
  SET_BUILD_MAX_OUTPUT_TOKENS,
  SET_BUILD_STALE_MS,
  SET_DIRECTION_MAX_CHARS,
  setFramePath,
  setThumbPath,
} from "@/lib/sets/set-config";
import {
  cleanText,
  normaliseSetLayout,
  normaliseSetSpec,
  parseSetSpecText,
  specTextForGate,
  type SetSpec,
} from "@/lib/sets/set-spec";
import {
  SET_BUILDER_INSTRUCTIONS,
  SET_SPEC_JSON_SCHEMA,
  SET_SPEC_SCHEMA_NAME,
  setBuildInput,
} from "@/lib/sets/set-builder-prompt";
import { buildSetShotPrompt } from "@/lib/sets/set-shot-prompt";
import { closeRetryInput, decideAfterValidAnswer, RETRY_SMALLER } from "@/lib/sets/build-retry";
import {
  SETS_SESSION_EXPIRED,
  SET_BRIEF_TOO_LONG,
  SET_BRIEF_TOO_SHORT,
  SET_BUILD_COULDNT_START,
  SET_BUILD_REFUSED,
  SET_BUILD_TOO_FAST,
  SET_DELETE_FAILED,
  SET_FRAME_SAVE_FAILED,
  SET_FRAME_TOO_LARGE,
  SET_FRAME_UNREADABLE,
  SET_NOT_FOUND,
  SET_NOT_READY,
  SET_PICK_CHARACTER,
  SET_SAVE_FAILED,
  SET_SHOOT_TOO_FAST,
  setFailureMessage,
  setMonthlyCapMessage,
} from "@/lib/sets/messages";

// Sets' server actions (Astra Sets, Phase 1, 2026-09-10).
//
// THE MONEY. A build's own spend (one Astra call, one automatic retry at
// most) is bounded by a monthly cap per plan and recorded to the cent in
// cost_usd; see set-config.ts for the arithmetic. The cap is enforced by
// RESERVING the build's row before anything is spent and counting the rows
// up to it, so concurrent submits cannot all read "under the cap", and by
// never letting a person delete a row (deletion is soft): a deleted build
// still counts, because it was still paid for. A shot is an ordinary image
// take through runGeneration — quoted, charged, gated, scored and refunded
// exactly as one sent from the composer, because it IS one.
//
// THE GATES. The brief is gated before OpenAI sees it (a refusal costs
// nothing and is logged against the person, as is OpenAI refusing the brief
// itself). Astra's own words — title, description, labels — are gated
// before they are saved, in the STRICT lane, because every render of the
// description is a strict-lane take (a frame always rides along); a refusal
// there is logged with provider "astra", which the session context does not
// count (policy-log.ts): the model wrote it, not the person. A shot's prompt
// and picture then pass the prompt gate and the output gate inside
// runGeneration, in the strict lane, like any take with an attachment.
//
// THE CHARACTER never reaches Astra: no photo, no name, no appearance.

const JPEG_DATA_URI = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;
// What a reserved row holds until its brief has passed the gate: a refused
// brief is never written, not even for the seconds the gate takes.
const RESERVED = "-";

function astraRequest(input: string, userId: string) {
  return {
    instructions: SET_BUILDER_INSTRUCTIONS,
    input,
    schemaName: SET_SPEC_SCHEMA_NAME,
    schema: SET_SPEC_JSON_SCHEMA as unknown as Record<string, unknown>,
    maxOutputTokens: SET_BUILD_MAX_OUTPUT_TOKENS,
    effort: SET_BUILD_EFFORT,
    safetyIdentifier: openAiSafetyId(userId),
  };
}

/** OpenAI refused the person's own brief: logged like any refusal of their words. */
async function logBriefRefusedByAstra(userId: string, brief: string) {
  await recordPolicyRefusal({ userId, gate: "prompt", reason: "astra_refused", prompt: brief });
}

/**
 * OpenAI refused a CLOSING retry — the brief it had already accepted, plus
 * Astra's own set and our instruction. Mostly text the model wrote, so it
 * is logged under the provider and never counts as the person's session
 * context (policy-log.ts recentRefusalCount).
 */
async function logClosingRetryRefused(userId: string, brief: string) {
  await recordPolicyRefusal({ userId, gate: "prompt", reason: "astra_refused", prompt: brief, provider: "astra" });
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function submitSetBuild(briefInput: string): Promise<{ error: string } | { error: null; id: string }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;

  const raw = typeof briefInput === "string" ? briefInput.trim() : "";
  if (raw.length > SET_BRIEF_MAX_CHARS) return { error: SET_BRIEF_TOO_LONG };
  const brief = cleanText(raw, SET_BRIEF_MAX_CHARS);
  if (brief.length < SET_BRIEF_MIN_CHARS) return { error: SET_BRIEF_TOO_SHORT };

  // Burst brake. Fails closed like every limiter; admins get more room for
  // testing, not unlimited.
  if (await rateLimited(userId, "set-build", 60 * 60, access.isAdmin ? 12 : 4)) {
    return { error: SET_BUILD_TOO_FAST };
  }

  // RESERVE, then count. The row exists before the cap is checked, and the
  // count runs up to and including it — so of any number of submits racing
  // each other, only as many as the cap allows see themselves inside it.
  const admin = createAdminClient();
  const { data: row, error: insertError } = await admin
    .from("location_sets")
    .insert({ user_id: userId, brief: RESERVED, status: "building", attempts: 0 })
    .select("id, created_at")
    .single();
  if (insertError || !row) {
    console.error("submitSetBuild reserve failed:", insertError?.message);
    return { error: SET_BUILD_COULDNT_START };
  }
  const setId = row.id as string;
  const release = () => admin.from("location_sets").delete().eq("id", setId);

  if (access.monthlyLimit >= 0) {
    const upToMine = await countSetBuildsThisMonth(userId, access.periodStart, row.created_at as string);
    // A count that cannot be read is not "none used": the cap fails closed.
    if (upToMine === null) {
      await release();
      return { error: SET_BUILD_COULDNT_START };
    }
    if (upToMine > access.monthlyLimit) {
      await release();
      return { error: setMonthlyCapMessage(upToMine - 1) };
    }
  }

  // The person's own words, judged before anything leaves Picacho. A
  // refusal costs nothing, releases the reservation, and counts as session
  // context like any other.
  try {
    await gatePrompt({ prompt: brief, userId, hasRealPersonReference: false });
  } catch (err) {
    await release();
    if (err instanceof ContentPolicyRefusal) return { error: err.userMessage };
    throw err;
  }
  // The retry reads the brief back from the row, so this write is checked:
  // a retry must never send the placeholder.
  const { data: briefed, error: briefError } = await admin
    .from("location_sets")
    .update({ brief })
    .eq("id", setId)
    .is("deleted_at", null)
    .select("id");
  if (briefError || !briefed?.length) {
    await release();
    return { error: SET_BUILD_COULDNT_START };
  }

  const submitted = await submitAstraJob(astraRequest(setBuildInput(brief), userId));
  if (!submitted.ok) {
    console.error("submitSetBuild astra submit failed:", submitted.kind, submitted.detail);
    await admin
      .from("location_sets")
      .update({ status: "failed", failure: submitted.kind === "refused" ? "refused" : "start", updated_at: new Date().toISOString() })
      .eq("id", setId);
    if (submitted.kind === "refused") {
      await logBriefRefusedByAstra(userId, brief);
      return { error: SET_BUILD_REFUSED };
    }
    return { error: SET_BUILD_COULDNT_START };
  }
  // A job whose id is stored nowhere can be neither collected nor
  // cancelled, and OpenAI bills it anyway — so this write is checked.
  const { data: recorded, error: recordError } = await admin
    .from("location_sets")
    .update({ response_id: submitted.responseId, attempts: 1, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .is("deleted_at", null)
    .select("id");
  if (recordError || !recorded?.length) {
    await cancelAstraJob(submitted.responseId);
    await admin
      .from("location_sets")
      .update({ status: "failed", failure: "start", updated_at: new Date().toISOString() })
      .eq("id", setId);
    return { error: SET_BUILD_COULDNT_START };
  }
  return { error: null, id: setId };
}

type PollResult =
  | { error: string }
  | { error: null; state: "building" }
  | { error: null; state: "ready" }
  | { error: null; state: "failed"; message: string };

/** How open a set is, measured (closure.ts). Never costs a build: a check that cannot run reads as closed. */
async function closureOf(spec: SetSpec): Promise<{ open: number; sides: string[] }> {
  try {
    const THREE = await import("three");
    const { measureClosure, describeOpenSides } = await import("@/lib/sets/closure");
    const report = measureClosure(THREE, spec);
    return { open: report.openBearings.length, sides: describeOpenSides(spec, report.openSides) };
  } catch (err) {
    console.error("[sets] closure measurement failed:", err instanceof Error ? err.message : err);
    return { open: 0, sides: [] };
  }
}

// One tick of a build, driven by the page. Exactly one tick may act on a
// finished answer: it CLAIMS the row by swapping response_id for a sentinel,
// so two tabs polling the same set cannot both save, both retry, or both
// count the cost. Every write after the claim is conditioned on still
// holding it; deleting the set clears it, and the tick then records what
// the build cost and cancels anything it started.
//
// THE ONE RETRY is spent on the first problem found: an answer that ran out
// of room or came back unusable is built again; a valid set that is OPEN —
// a side a camera can see past, measured by closure.ts — is sent back to
// be closed, and is kept meanwhile as a DRAFT in the spec column. A draft
// has passed every check, so from then on nothing ends in a failed build:
// whatever happens to the closing retry, the person gets the better of the
// two sets, or the draft.
export async function pollSetBuild(setId: string): Promise<PollResult> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const { userId } = access;
  const admin = createAdminClient();

  const { data: row } = await admin
    .from("location_sets")
    .select("id, status, brief, response_id, attempts, cost_usd, failure, updated_at, spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  if (row.status === "ready") return { error: null, state: "ready" };
  if (row.status === "failed") return { error: null, state: "failed", message: setFailureMessage(row.failure) };

  const stale = Date.now() - Date.parse(row.updated_at as string) > SET_BUILD_STALE_MS;
  const responseId = row.response_id as string | null;
  const priorCost = Number(row.cost_usd ?? 0);
  const attempts = Number(row.attempts ?? 1);
  const brief = row.brief as string;
  const kept = row.spec ? normaliseSetSpec(row.spec) : null;
  const draft = kept?.ok ? kept.spec : null;

  const closeFailed = async (failure: string, costUsd: number) => {
    await admin
      .from("location_sets")
      .update({ status: "failed", failure, response_id: null, cost_usd: costUsd, updated_at: new Date().toISOString() })
      .eq("id", setId)
      .eq("status", "building");
    return { error: null, state: "failed" as const, message: setFailureMessage(failure) };
  };
  // The set was deleted while this tick held the claim: keep the record of
  // what it cost, and say so the way a missing set is said.
  const deletedMeanwhile = async (costUsd: number) => {
    await admin.from("location_sets").update({ cost_usd: costUsd }).eq("id", setId);
    return { error: SET_NOT_FOUND };
  };
  const finishReady = async (spec: SetSpec, costUsd: number, holdsClaim: boolean): Promise<PollResult> => {
    let write = admin
      .from("location_sets")
      .update({
        status: "ready",
        spec,
        title: spec.title,
        description: spec.description,
        response_id: null,
        failure: null,
        cost_usd: costUsd,
        updated_at: new Date().toISOString(),
      })
      .eq("id", setId)
      .eq("status", "building");
    write = holdsClaim ? write.eq("response_id", "claiming") : write.is("deleted_at", null);
    const { data: saved, error: saveError } = await write.select("id");
    if (saveError) {
      console.error("pollSetBuild save failed:", saveError.message);
      return closeFailed("save", costUsd);
    }
    if (!saved?.length) return holdsClaim ? deletedMeanwhile(costUsd) : { error: null, state: "building" };
    return { error: null, state: "ready" };
  };

  // No answer to collect: another tick holds the claim, or the submit never
  // recorded its id. Either finishes, or goes stale — and a stale build with
  // a draft delivers the draft rather than failing.
  if (!responseId || responseId === "claiming") {
    if (stale) return draft ? finishReady(draft, priorCost, false) : closeFailed("lost", priorCost);
    return { error: null, state: "building" };
  }

  const polled = await pollAstraJob(responseId);
  if (polled.state === "working") {
    if (stale) {
      await cancelAstraJob(responseId);
      return draft ? finishReady(draft, priorCost, false) : closeFailed("lost", priorCost);
    }
    return { error: null, state: "building" };
  }

  const { data: claimed } = await admin
    .from("location_sets")
    .update({ response_id: "claiming", updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("status", "building")
    .eq("response_id", responseId)
    .is("deleted_at", null)
    .select("id");
  if (!claimed?.length) return { error: null, state: "building" };

  const cost = Math.round((priorCost + polled.costUsd) * 10_000) / 10_000;
  let failure: string;

  if (polled.state === "done") {
    const parsed = parseSetSpecText(polled.text);
    if (parsed.ok) {
      const spec = parsed.spec;
      const words = specTextForGate(spec);
      // Astra's words, judged before anyone reads them — in the strict lane,
      // the lane every shot of this set will render them in. Logged under
      // the provider, so the person's next hour is not judged harder for
      // text they did not write.
      try {
        await assertPromptAllowed({ prompt: words, hasRealPersonReference: true });
      } catch (err) {
        if (!(err instanceof ContentPolicyRefusal)) throw err;
        await recordPolicyRefusal({
          userId,
          gate: "prompt",
          reason: err.reason,
          strictLane: true,
          prompt: words,
          provider: "astra",
        });
        if (err.reason === "unavailable") {
          // Not a reading: hand the answer back to the next tick, which
          // tries the check again while background mode still holds it.
          await admin
            .from("location_sets")
            .update({ response_id: responseId })
            .eq("id", setId)
            .eq("response_id", "claiming");
          return { error: null, state: "building" };
        }
        return draft ? finishReady(draft, cost, true) : closeFailed("refused", cost);
      }

      const closure = await closureOf(spec);
      const draftOpen = draft ? (await closureOf(draft)).open : null;
      console.info("[sets] closure", { setId, attempt: attempts, open: closure.open, sides: closure.sides, draftOpen });
      const next = decideAfterValidAnswer({
        open: closure.open,
        attempts,
        maxAttempts: SET_BUILD_MAX_ATTEMPTS,
        stale,
        draftOpen,
      });
      if (next.kind === "retry-close") {
        const retry = await submitAstraJob(astraRequest(closeRetryInput(brief, closure.sides, spec), userId));
        if (retry.ok) {
          const { data: resumed, error: resumeError } = await admin
            .from("location_sets")
            .update({
              spec,
              title: spec.title,
              description: spec.description,
              response_id: retry.responseId,
              attempts: attempts + 1,
              cost_usd: cost,
              updated_at: new Date().toISOString(),
            })
            .eq("id", setId)
            .eq("response_id", "claiming")
            .select("id");
          if (resumeError || !resumed?.length) {
            // Nobody could ever collect this job: stop it before it bills.
            await cancelAstraJob(retry.responseId);
            if (!resumeError) return deletedMeanwhile(cost);
            // A write that failed is not a deletion: the set in hand is
            // still a good set, so deliver it.
            console.error("pollSetBuild closing-retry write failed:", resumeError.message);
            return finishReady(spec, cost, true);
          }
          return { error: null, state: "building" };
        }
        // The closing retry could not start. The set in hand is still a
        // good set; deliver it.
        if (retry.kind === "refused") await logClosingRetryRefused(userId, brief);
        return finishReady(spec, cost, true);
      }
      return finishReady(next.use === "draft" && draft ? draft : spec, cost, true);
    }
    failure = "invalid";
  } else {
    failure = polled.kind;
    if (polled.kind === "refused") {
      // With a draft in hand this answer was a closing retry: its input was
      // mostly the model's own set, not the person's words.
      if (draft) await logClosingRetryRefused(userId, brief);
      else await logBriefRefusedByAstra(userId, brief);
    }
  }

  // A closing retry that came back unusable leaves the draft, which is not.
  if (draft) return finishReady(draft, cost, true);

  // One automatic retry at our cost, never after a safety stop.
  if (failure !== "refused" && failure !== "cancelled" && attempts < SET_BUILD_MAX_ATTEMPTS && !stale) {
    const input = setBuildInput(brief) + (failure === "incomplete" ? RETRY_SMALLER : "");
    const retry = await submitAstraJob(astraRequest(input, userId));
    if (retry.ok) {
      const { data: resumed, error: resumeError } = await admin
        .from("location_sets")
        .update({ response_id: retry.responseId, attempts: attempts + 1, cost_usd: cost, updated_at: new Date().toISOString() })
        .eq("id", setId)
        .eq("response_id", "claiming")
        .select("id");
      if (resumeError || !resumed?.length) {
        // Nobody could ever collect this job: stop it before it bills.
        await cancelAstraJob(retry.responseId);
        if (resumeError) {
          console.error("pollSetBuild retry write failed:", resumeError.message);
          return closeFailed("save", cost);
        }
        return deletedMeanwhile(cost);
      }
      return { error: null, state: "building" };
    }
    if (retry.kind === "refused") {
      failure = "refused";
      await logBriefRefusedByAstra(userId, brief);
    }
  }
  return closeFailed(failure, cost);
}

// ---------------------------------------------------------------------------
// Arranging and shooting
// ---------------------------------------------------------------------------

async function readyOwnedSpec(
  setId: string,
  userId: string,
): Promise<{ error: string } | { error: null; spec: SetSpec }> {
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const { data: row } = await createAdminClient()
    .from("location_sets")
    .select("status, spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  if (row.status !== "ready") return { error: SET_NOT_READY };
  const n = normaliseSetSpec(row.spec);
  if (!n.ok) return { error: SET_NOT_FOUND };
  return { error: null, spec: n.spec };
}

/** Where the person put the stand-in and the camera. Free: nothing is called. */
export async function saveSetLayout(setId: string, layout: unknown): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const owned = await readyOwnedSpec(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  const clean = normaliseSetLayout(layout, owned.spec);
  if (!clean) return { error: SET_SAVE_FAILED };
  if (await rateLimited(access.userId, "set-layout", 60, 30)) return { error: SET_SAVE_FAILED };
  const { error } = await createAdminClient()
    .from("location_sets")
    .update({ layout: clean, updated_at: new Date().toISOString() })
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null);
  return { error: error ? SET_SAVE_FAILED : null };
}

/** The card picture on the Sets page, taken by the browser from the first camera. */
export async function saveSetThumbnail(setId: string, dataUri: string): Promise<{ error: string | null }> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  if (typeof dataUri !== "string" || !JPEG_DATA_URI.test(dataUri)) return { error: SET_FRAME_UNREADABLE };
  const bytes = Buffer.from(dataUri.slice(dataUri.indexOf(",") + 1), "base64");
  if (bytes.byteLength > MAX_SET_THUMB_BYTES) return { error: SET_FRAME_TOO_LARGE };
  if (bytes.byteLength < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: SET_FRAME_UNREADABLE };
  const owned = await readyOwnedSpec(setId, access.userId);
  if (owned.error !== null) return { error: owned.error };
  if (await rateLimited(access.userId, "set-thumb", 600, 20)) return { error: SET_SAVE_FAILED };
  const admin = createAdminClient();
  const path = setThumbPath(access.userId, setId);
  const { data: before } = await admin
    .from("location_sets")
    .select("thumb_path")
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .maybeSingle();
  const { error: uploadError } = await admin.storage
    .from("generated-images")
    .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
  if (uploadError) return { error: SET_SAVE_FAILED };
  const { data: moved } = await admin
    .from("location_sets")
    .update({ thumb_path: path })
    .eq("id", setId)
    .eq("user_id", access.userId)
    .is("deleted_at", null)
    .select("id");
  // A card from before the current thumbnail version (set-config.ts) lived
  // at another path; once the row points at the new one, the old file goes.
  const old = typeof before?.thumb_path === "string" ? before.thumb_path : null;
  if (moved?.length && old && old !== path && old.startsWith(`${access.userId}/sets/`)) {
    await admin.storage.from("generated-images").remove([old]);
  }
  return { error: null };
}

type ShootResult =
  | { error: string }
  | { error: null; generationId: string; succeeded: boolean; resultUrl: string | null; score: number | null };

/**
 * One still in a Set: the square snapshot the person framed, their
 * character, and a line about the moment. An ordinary image take from here
 * on — see the header.
 */
export async function shootInSet(
  setId: string,
  input: { frameDataUri: string; characterId: string; direction: string; layout: unknown; lifted?: boolean },
): Promise<ShootResult> {
  const access = await setsAccess();
  if (access.error !== null) return { error: access.error };
  const { userId } = access;

  const frame = typeof input?.frameDataUri === "string" ? input.frameDataUri : "";
  if (!JPEG_DATA_URI.test(frame)) return { error: SET_FRAME_UNREADABLE };
  const bytes = Buffer.from(frame.slice(frame.indexOf(",") + 1), "base64");
  if (bytes.byteLength > MAX_SET_FRAME_BYTES) return { error: SET_FRAME_TOO_LARGE };
  if (bytes.byteLength < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return { error: SET_FRAME_UNREADABLE };

  const owned = await readyOwnedSpec(setId, userId);
  if (owned.error !== null) return { error: owned.error };

  const characterId = typeof input.characterId === "string" ? input.characterId : "";
  if (!UUID_RE.test(characterId)) return { error: SET_PICK_CHARACTER };
  const { data: character } = await access.supabase
    .from("character_profiles")
    .select("id, reference_image_urls")
    .eq("id", characterId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!character || !Array.isArray(character.reference_image_urls) || character.reference_image_urls.length === 0) {
    return { error: SET_PICK_CHARACTER };
  }

  if (await rateLimited(userId, "set-shot", 60 * 10, 12)) return { error: SET_SHOOT_TOO_FAST };

  const admin = createAdminClient();
  const framePath = setFramePath(userId, crypto.randomUUID());
  const { error: uploadError } = await admin.storage
    .from("chat-attachments")
    .upload(framePath, bytes, { contentType: "image/jpeg", upsert: false });
  if (uploadError) {
    console.error("shootInSet frame upload failed:", uploadError.message);
    return { error: SET_FRAME_SAVE_FAILED };
  }

  const direction = cleanText(input.direction, SET_DIRECTION_MAX_CHARS);
  const fd = new FormData();
  // `lifted` only chooses whether the prompt explains a brightened sketch;
  // a false value from a crafted request changes one sentence, still gated.
  fd.set("prompt", buildSetShotPrompt({ description: owned.spec.description, direction, lifted: input.lifted === true }));
  fd.set("content_type", "image");
  fd.set("character_id", characterId);
  // The prompt is already the one the image model should read: the drafter
  // would rewrite the composition instructions it exists to carry. Still
  // gated, in the strict lane, inside runGeneration.
  fd.set("prompt_is_final", "1");
  fd.set("attachment_roles", JSON.stringify([{ url: mediaUrl("chat-attachments", framePath), role: "reference" }]));

  const result = await runGeneration(fd);
  if (result.error !== null) {
    // Refused or never started: no take holds the frame, so nothing else
    // would ever clean it up.
    await admin.storage.from("chat-attachments").remove([framePath]);
    return { error: result.error };
  }

  const { error: shotError } = await admin
    .from("location_set_shots")
    .insert({ set_id: setId, generation_id: result.id, user_id: userId });
  if (shotError) console.error("shootInSet couldn't record the shot:", shotError.message);
  const layout = normaliseSetLayout(input.layout, owned.spec);
  if (layout) {
    await admin
      .from("location_sets")
      .update({ layout, updated_at: new Date().toISOString() })
      .eq("id", setId)
      .eq("user_id", userId)
      .is("deleted_at", null);
  }

  return {
    error: null,
    generationId: result.id,
    succeeded: result.succeeded,
    resultUrl: result.resultUrl,
    score: typeof result.matchScore === "number" ? result.matchScore : null,
  };
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

// Deleting your own set needs no switch and no plan: a person can always
// remove what is theirs. It is a SOFT delete — the row stays, emptied of
// the person's words and the set itself, because the monthly cap counts
// builds and a deleted build was still a build (see the header). The takes
// shot in it stay in History: they are takes, and deleting one is History's
// decision.
export async function deleteSet(setId: string): Promise<{ error: string | null }> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return { error: SETS_SESSION_EXPIRED };
  if (!UUID_RE.test(setId)) return { error: SET_NOT_FOUND };
  const userId = userData.user.id;
  const admin = createAdminClient();

  // The job id is cleared ON THE VALUE READ, and the read is repeated if the
  // row moved on in between: a tick can swap the claim for a retry's id
  // between this read and this write, and cancelling the stale value would
  // leave that retry running, uncollected and unbilled to the set.
  for (let tries = 0; tries < 3; tries++) {
    const { data: row } = await admin
      .from("location_sets")
      .select("status, response_id, thumb_path")
      .eq("id", setId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!row) return { error: SET_DELETE_FAILED };

    const now = new Date().toISOString();
    let write = admin
      .from("location_sets")
      .update({
        deleted_at: now,
        updated_at: now,
        // Clearing the id is what tells a tick holding the claim that the set
        // is gone (every write after a claim is conditioned on it).
        response_id: null,
        brief: RESERVED,
        title: "",
        description: "",
        spec: null,
        layout: null,
        thumb_path: null,
      })
      .eq("id", setId)
      .eq("user_id", userId)
      .is("deleted_at", null);
    write = row.response_id === null ? write.is("response_id", null) : write.eq("response_id", row.response_id as string);
    const { data: gone, error } = await write.select("id");
    if (error) {
      console.error("deleteSet failed:", error.message);
      return { error: SET_DELETE_FAILED };
    }
    if (!gone?.length) continue;
    if (row.status === "building" && typeof row.response_id === "string" && row.response_id !== "claiming") {
      await cancelAstraJob(row.response_id);
    }
    if (row.thumb_path) {
      await admin.storage.from("generated-images").remove([row.thumb_path as string]);
    }
    return { error: null };
  }
  return { error: SET_DELETE_FAILED };
}
