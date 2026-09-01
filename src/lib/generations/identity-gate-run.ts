import type { SupabaseClient } from "@supabase/supabase-js";
import { generateImage } from "@/lib/generations/providers/image";
import { scoreIdentityMatch } from "@/lib/generations/providers/openai";
import { persistGeneratedImage } from "@/lib/generations/core";
import {
  betterAttemptScore,
  gateLogLine,
  identityGateDecision,
  type GateDecision,
} from "@/lib/generations/identity-gate";
import type { ProviderBudget } from "@/lib/generations/providers/image";

// The identity gate's moving parts — scoring, the one free re-render, and
// picking the winner. The POLICY lives in identity-gate.ts, which is pure and
// unit-tested; this file is only the plumbing that acts on it.
//
// Split this way on purpose. Every rule about when to spend provider money is
// in a module that can be tested without a network, and everything here is
// mechanical: call the scorer, call the renderer, move a file, write a row.

/** How long a render may have taken before the gate declines to retry it. */
const GATE_WALL_CLOCK_BUDGET_MS = 110_000;

export type GateOutcome = {
  /** The URL to actually deliver — the better of the attempts. */
  resultUrl: string;
  /** The score of the delivered attempt, for the row and the UI. */
  matchScore: number | null;
  matchNotes: string | null;
  /** Free re-renders granted. Written to generations.identity_retries. */
  retries: number;
  /** Set when the gate settled — two misses. Written to identity_gated_at. */
  settledAt: string | null;
  /** True when the FIRST attempt was the one delivered. */
  keptPrevious: boolean;
  /** True when the delivered render is a blank/black frame (existing behaviour). */
  unusable: boolean;
  /** Lines to append to the pipeline log, in order. */
  logLines: string[];
  /** The storage URL of the losing attempt, if a retry happened. */
  discardedUrl: string | null;
};

export type GateDeps = {
  supabase: SupabaseClient;
  userId: string;
  /** The finished first attempt. */
  resultUrl: string;
  /** Absolute URL of the render, for the vision call. */
  absoluteResultUrl: string;
  /** Signed URL of the character's identity photo. */
  identityPhotoUrl: string;
  traitSummary: string;
  threshold: number;
  /** Everything needed to render the SAME image again. */
  rerender: {
    modelId: string;
    /** The already-compiled prompt from the winning attempt. */
    compiledPrompt: string;
    referenceImageUrl: string | string[] | null | undefined;
    outfitImageUrl?: string | null;
    propImageUrl?: string | null;
    /**
     * The SAME budget object the first render used. Passing it is what stops
     * the retry minting a second full allowance of paid provider calls —
     * runRealPipeline creates its budget internally, so calling the pipeline
     * again would have reset the ceiling the budget exists to enforce.
     */
    budget?: ProviderBudget;
  };
  /** Wall-clock ms already spent on this request, to protect maxDuration. */
  elapsedMs: number;
  absolutize: (url: string) => string;
};

async function score(
  imageUrl: string,
  identityPhotoUrl: string,
  traitSummary: string,
): Promise<{ score: number | null; notes: string | null; unusable: boolean }> {
  try {
    const verdict = await scoreIdentityMatch(imageUrl, identityPhotoUrl, traitSummary);
    if (!verdict) return { score: null, notes: null, unusable: false };
    return {
      score: typeof verdict.score === "number" ? verdict.score : null,
      notes: verdict.notes || null,
      unusable: Boolean(verdict.unusable),
    };
  } catch {
    // Best-effort, exactly as before the gate existed: a scoring hiccup must
    // never affect the generation. identityGateDecision reads null as "not
    // measured" and passes rather than spending money on a re-render.
    return { score: null, notes: null, unusable: false };
  }
}

/**
 * Runs the gate for ONE image generation and reports what should be
 * delivered. Never throws — a gate failure degrades to "deliver the first
 * attempt, charge normally", which is exactly the behaviour before this
 * existed.
 */
export async function runImageIdentityGate(deps: GateDeps): Promise<GateOutcome> {
  const logLines: string[] = [];
  const first = await score(deps.absoluteResultUrl, deps.identityPhotoUrl, deps.traitSummary);

  // A blank/black frame short-circuits everything. It is not a weak likeness,
  // it is a non-delivery, and it has its own established handling in
  // actions.ts (auto-fail, clear the URL, refund, auto-report). Retrying it
  // would spend a second render on a safety-checker refusal that will refuse
  // again.
  if (first.unusable) {
    return {
      resultUrl: deps.resultUrl,
      matchScore: first.score,
      matchNotes: first.notes,
      retries: 0,
      settledAt: null,
      keptPrevious: false,
      unusable: true,
      logLines,
      discardedUrl: null,
    };
  }

  const decision = identityGateDecision({
    score: first.score,
    threshold: deps.threshold,
    retriesUsed: 0,
  });

  if (decision.action !== "retry") {
    return {
      resultUrl: deps.resultUrl,
      matchScore: first.score,
      matchNotes: first.notes,
      retries: 0,
      settledAt: null,
      keptPrevious: false,
      unusable: false,
      logLines,
      discardedUrl: null,
    };
  }

  // Under the bar. Before spending anything, check the clock.
  //
  // The image lane is fully synchronous under a hard 300s Vercel ceiling
  // (maxDuration on every route that hosts it — the Hobby plan's maximum, so
  // there is no larger number to move to). A gated request is render + score
  // + render + score, and if it overruns, BOTH renders are already billed and
  // persisted while the row is left at 'generating' for the hour it takes the
  // reaper to write it off. Declining the retry costs one weak render;
  // attempting it too late costs two renders and a stuck row.
  if (deps.elapsedMs > GATE_WALL_CLOCK_BUDGET_MS) {
    logLines.push(
      `The face scored ${decision.score} against this character's photo, but this render already took too long to re-run inside one request — delivering it rather than risking the whole thing timing out.`,
    );
    return {
      resultUrl: deps.resultUrl,
      matchScore: first.score,
      matchNotes: first.notes,
      retries: 0,
      settledAt: null,
      keptPrevious: false,
      unusable: false,
      logLines,
      discardedUrl: null,
    };
  }

  logLines.push(gateLogLine(decision, false)!);

  let secondUrl: string | null = null;
  try {
    secondUrl = await generateImage(
      deps.rerender.modelId,
      deps.rerender.compiledPrompt,
      deps.rerender.referenceImageUrl,
      (base64) => persistGeneratedImage(deps.supabase, deps.userId, base64),
      undefined,
      // The shared budget — see the note on the field.
      deps.rerender.budget,
      deps.rerender.outfitImageUrl,
      deps.rerender.propImageUrl,
    );
  } catch (err) {
    // The re-render failed. The first attempt is still good and still paid
    // for; deliver it and say nothing was charged extra, because nothing was.
    console.warn("Identity gate re-render failed; delivering the first attempt.", err);
    logLines.push("The second render didn't come back, so this is the first one.");
    return {
      resultUrl: deps.resultUrl,
      matchScore: first.score,
      matchNotes: first.notes,
      retries: 0,
      settledAt: null,
      keptPrevious: false,
      unusable: false,
      logLines,
      discardedUrl: null,
    };
  }

  const second = await score(deps.absolutize(secondUrl), deps.identityPhotoUrl, deps.traitSummary);

  const settled: GateDecision = identityGateDecision({
    score: second.score,
    threshold: deps.threshold,
    retriesUsed: 1,
    previousScore: first.score,
  });

  // Which FILE to deliver is asked separately from what the gate decided,
  // because "cleared the bar" and "is the better image" are different
  // questions and a retry can be both worse and passing.
  const keepFirst =
    ("keepPrevious" in settled && settled.keepPrevious === true) ||
    betterAttemptScore(first.score, second.score) === "first";

  const winnerUrl = keepFirst ? deps.resultUrl : secondUrl;
  const loserUrl = keepFirst ? secondUrl : deps.resultUrl;
  const winnerScore = keepFirst ? first.score : second.score;
  const winnerNotes = keepFirst ? first.notes : second.notes;

  if (settled.action === "settle") {
    // The caller performs the refund (it owns the credit bookkeeping) and
    // appends the honest log line afterwards, because the wording depends on
    // whether the refund actually happened.
    return {
      resultUrl: winnerUrl,
      matchScore: winnerScore,
      matchNotes: winnerNotes,
      retries: 1,
      settledAt: new Date().toISOString(),
      keptPrevious: keepFirst,
      unusable: keepFirst ? false : second.unusable,
      logLines,
      discardedUrl: loserUrl,
    };
  }

  // The retry cleared the bar.
  logLines.push(
    keepFirst
      ? `The second render scored ${second.score ?? "unrated"}, but the first held the face better — keeping that one. You were charged once.`
      : `The second render scored ${second.score} and holds the face. You were charged once.`,
  );

  return {
    resultUrl: winnerUrl,
    matchScore: winnerScore,
    matchNotes: winnerNotes,
    retries: 1,
    settledAt: null,
    keptPrevious: keepFirst,
    unusable: keepFirst ? false : second.unusable,
    logLines,
    discardedUrl: loserUrl,
  };
}
