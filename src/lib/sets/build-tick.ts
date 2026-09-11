import type { SupabaseClient } from "@supabase/supabase-js";
import { assertPromptAllowed, ContentPolicyRefusal } from "@/lib/generations/content-policy";
import { recordPolicyRefusal } from "@/lib/generations/policy-log";
import { cancelAstraJob, pollAstraJob, submitAstraJob, type AstraJobRequest } from "@/lib/generations/providers/astra";
import { openAiSafetyId } from "@/lib/openai/safety-id";
import {
  SET_BUILD_MAX_ATTEMPTS,
  SET_BUILD_STALE_MS,
  SET_PHOTO_BUILD_INPUT_TOKENS,
  SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS,
  SET_RESERVED_BRIEF,
} from "@/lib/sets/set-config";
import { normaliseSetSpec, parseSetSpecText, specTextForGate, type SetSpec } from "@/lib/sets/set-spec";
import { retryBuildRequest, type SetRetry } from "@/lib/sets/astra-request";
import { decideAfterValidAnswer } from "@/lib/sets/build-retry";
import { photoForRetry, readPhotoSources, removeSetPhoto } from "@/lib/sets/photo";
import type { SetKind } from "@/lib/sets/types";
import { SET_NOT_FOUND, setFailureMessage } from "@/lib/sets/messages";

// One tick of a set build (Astra Sets, 2026-09-10; in a module of its own
// since 2026-09-11, when a second caller arrived). Two callers run it:
//
//   - the page: pollSetBuild (actions.ts), a server action the Sets page
//     calls every 5 s for each set still building — after the session and
//     access checks (setsAccess);
//   - the finisher: the per-minute cron (finisher.ts, app/api/cron/sets),
//     for every set still building, with the page open or not — after the
//     kill switch, the flag and the owner's access rule (access-rule.ts,
//     the one setsAccess applies).
//
// NOT a "use server" module, on purpose: every export of one is an action
// any browser can call, and advanceSetBuild takes a user id on trust —
// checking who that is, is its caller's job. server-actions.test.ts fails
// the suite if a "use server" file ever exports it.

// What a reserved row holds until its brief has passed the gate, and what a
// photo build keeps there when the photographer adds no notes
// (set-config.ts). Never sent to Astra, never shown.
const RESERVED = SET_RESERVED_BRIEF;

/**
 * OpenAI refused the person's own input — their brief, or their photo and
 * notes: logged like any refusal of their words, and counted as session
 * context. A photo build without notes logs no text at all.
 */
export async function logBriefRefusedByAstra(userId: string, prompt: string | null) {
  await recordPolicyRefusal({ userId, gate: "prompt", reason: "astra_refused", prompt: prompt || null });
}

/**
 * OpenAI refused a CLOSING retry — the input it had already accepted, plus
 * Astra's own set and our instruction. Mostly text the model wrote, so it
 * is logged under the provider and never counts as the person's session
 * context (policy-log.ts recentRefusalCount).
 */
async function logClosingRetryRefused(userId: string, prompt: string | null) {
  await recordPolicyRefusal({ userId, gate: "prompt", reason: "astra_refused", prompt: prompt || null, provider: "astra" });
}

export type PollResult =
  | { error: string }
  | { error: null; state: "building" }
  | { error: null; state: "ready" }
  | { error: null; state: "failed"; message: string };

/**
 * What one tick did. `settledHere` is set only when THIS tick's own
 * conditional write moved the row out of "building" — the save as ready,
 * or the close as failed — and never for a row an earlier tick had already
 * settled: of any number of ticks racing each other, exactly one sees it.
 */
export type SetBuildTick = { result: PollResult; settledHere: "ready" | "failed" | null };

export type AdvanceSetBuildInput = {
  /** The service-role client: every read and write below names the owner itself. */
  admin: SupabaseClient;
  setId: string;
  /** The owner, already checked by the caller — the session's user, or the row's owner under the access rule. */
  userId: string;
  /**
   * Whether a photo build's retry may resend its photo (enabled.ts
   * isPhotoSetsEnabled), asked only when a retry is wanted.
   */
  photoSwitchOn: () => Promise<boolean>;
};

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

// One tick of a build, driven by the page or the finisher. Exactly one tick
// may act on a finished answer: it CLAIMS the row by swapping response_id
// for a sentinel, so two tabs polling the same set — or a tab and the
// finisher, or two finisher runs that overlap — cannot both save, both
// retry, or both count the cost. Every write after the claim is
// conditioned on still holding it; deleting the set clears it, and the
// tick then records what the build cost and cancels anything it started.
// A tick with no answer to claim settles a row only by a write conditioned
// on the row still building, so the same holds when two of them find one
// stale.
//
// THE ONE RETRY is spent on the first problem found: an answer that ran out
// of room or came back unusable is built again; a valid set that is OPEN —
// a side a camera can see past, measured by closure.ts — is sent back to
// be closed, and is kept meanwhile as a DRAFT in the spec column. A draft
// has passed every check, so from then on nothing ends in a failed build:
// whatever happens to the closing retry, the person gets the better of the
// two sets, or the draft.
export async function advanceSetBuild(input: AdvanceSetBuildInput): Promise<SetBuildTick> {
  let settledHere: SetBuildTick["settledHere"] = null;
  const result = await tick(input, (how) => {
    settledHere = how;
  });
  return { result, settledHere };
}

async function tick(
  { admin, setId, userId, photoSwitchOn }: AdvanceSetBuildInput,
  settle: (how: "ready" | "failed") => void,
): Promise<PollResult> {
  const { data: row } = await admin
    .from("location_sets")
    .select("id, status, brief, response_id, attempts, cost_usd, failure, updated_at, spec")
    .eq("id", setId)
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (!row) return { error: SET_NOT_FOUND };
  if (row.status === "ready") return { error: null, state: "ready" };
  // Which kind of build this is, read on its own (photo.ts). The photo
  // columns not there yet reads as a text build, which every build is until
  // they are. A read that fails for any other reason is not an answer, and
  // this tick acts on nothing: on a guess of "text" a photo build's retry
  // would send its notes as a brief, with no photo and the text caps, and a
  // failure would leave its photo behind. The next tick reads again;
  // background mode keeps the answer meanwhile.
  const sources = await readPhotoSources(admin, [setId], userId);
  if (!sources.known) return { error: null, state: "building" };
  const src = sources.sources.get(setId) ?? null;
  const kind: SetKind = src ? "photo" : "text";
  if (row.status === "failed") return { error: null, state: "failed", message: setFailureMessage(row.failure, kind) };

  const stale = Date.now() - Date.parse(row.updated_at as string) > SET_BUILD_STALE_MS;
  const responseId = row.response_id as string | null;
  const priorCost = Number(row.cost_usd ?? 0);
  const attempts = Number(row.attempts ?? 1);
  const brief = row.brief as string;
  // A photo build's brief column holds the photographer's notes, or the
  // placeholder when there are none.
  const notes = kind === "photo" && brief !== RESERVED ? brief : "";
  // What a refusal of the person's own input is logged with: their words.
  const ownWords = kind === "photo" ? notes || null : brief;
  const safetyId = openAiSafetyId(userId);
  const kept = row.spec ? normaliseSetSpec(row.spec) : null;
  const draft = kept?.ok ? kept.spec : null;

  // What a retry sends (astra-request.ts retryBuildRequest): a text build
  // its brief, never the placeholder; a photo build its STORED photo, only
  // while the photo switch is on and only the bytes that passed the picture
  // check (photo.ts photoForRetry) — or no retry at all, never the notes
  // alone. Null: the set in hand, or the failure, stands. The photo is read
  // once, and only when a retry is wanted.
  let storedPhoto: string | null | undefined;
  const retryRequest = async (retry: SetRetry): Promise<AstraJobRequest | null> => {
    if (kind === "text") return retryBuildRequest({ kind, brief }, retry, safetyId);
    if (storedPhoto === undefined) storedPhoto = await photoForRetry(admin, src, photoSwitchOn);
    return retryBuildRequest({ kind, notes, photo: storedPhoto }, retry, safetyId);
  };

  const closeFailed = async (failure: string, costUsd: number) => {
    const { data: closed } = await admin
      .from("location_sets")
      .update({ status: "failed", failure, response_id: null, cost_usd: costUsd, updated_at: new Date().toISOString() })
      .eq("id", setId)
      .eq("status", "building")
      .select("id");
    // This write is what moved the row out of "building".
    if (closed?.length) settle("failed");
    // A failed card cannot be retried, so its photo has no use left; the
    // row keeps the record that it was a photo build. Removed whatever this
    // tick took the kind to be: the path is fixed, and removing it is
    // harmless for a set built from words, as in deleteSet.
    if (closed?.length) await removeSetPhoto(admin, userId, setId);
    return { error: null, state: "failed" as const, message: setFailureMessage(failure, kind) };
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
    settle("ready");
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

  // What a photo costs Astra was measured on three test builds (set-config.ts);
  // every photo attempt's usage is still logged, and one past its budget is
  // flagged, so live builds keep checking the bound.
  if (kind === "photo") {
    console.info("[sets] photo usage", { setId, attempt: attempts, usage: polled.usage });
    const bound = attempts <= 1 ? SET_PHOTO_BUILD_INPUT_TOKENS : SET_PHOTO_CLOSE_RETRY_INPUT_TOKENS;
    const inputTokens = polled.usage?.input_tokens ?? 0;
    if (typeof inputTokens === "number" && inputTokens > bound) {
      console.warn("[sets] photo input past its budget", { setId, attempt: attempts, inputTokens, bound });
    }
  }

  if (polled.state === "done") {
    const parsed = parseSetSpecText(polled.text);
    // A photo set without Astra's own first camera has nothing to lay
    // beside the photo: the normaliser's stand-in camera makes it invalid.
    if (parsed.ok && !(kind === "photo" && parsed.notes.includes("default_camera"))) {
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
        const request = await retryRequest({ why: "close", openSides: closure.sides, previous: spec });
        // Nothing may be resent: the set in hand is still a good set.
        if (!request) return finishReady(spec, cost, true);
        const retry = await submitAstraJob(request);
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
        if (retry.kind === "refused") await logClosingRetryRefused(userId, ownWords);
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
      if (draft) await logClosingRetryRefused(userId, ownWords);
      else await logBriefRefusedByAstra(userId, ownWords);
    }
  }

  // A closing retry that came back unusable leaves the draft, which is not.
  if (draft) return finishReady(draft, cost, true);

  // One automatic retry at our cost, never after a safety stop — and never
  // without something to send (retryRequest).
  const request =
    failure !== "refused" && failure !== "cancelled" && attempts < SET_BUILD_MAX_ATTEMPTS && !stale
      ? await retryRequest({ why: "again", tooLong: failure === "incomplete" })
      : null;
  if (request) {
    const retry = await submitAstraJob(request);
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
      await logBriefRefusedByAstra(userId, ownWords);
    }
  }
  return closeFailed(failure, cost);
}
