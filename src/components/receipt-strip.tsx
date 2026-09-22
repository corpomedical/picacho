"use client";

import type { Messages } from "@/lib/i18n/messages";
import type { PlanEntry, PlanIssue, SendPlan } from "@/lib/generations/send-plan";
import { formatMsg } from "@/lib/i18n/format";
import { getVideoModel } from "@/lib/generations/providers/video-models";
import { cn } from "@/lib/cn";

// The Send Receipt (P0 inventory + P1 issues): one always-mounted strip above
// the composer that shows exactly what the next send consists of, and —
// since P1 — the resolver's verdicts as persistent rows with one-tap
// remedies. These rows REPLACE the ad-hoc amber fences and the imperative
// aspect probe: same protections, one consistent surface, computed by the
// same module the server re-checks. Warn rows advise; block rows also
// short-circuit the submit (soft-block: the send click shows this same
// message and spends nothing — deliberately NOT a disabled button, so a
// resolver false-positive can never brick the composer).

function entryText(e: PlanEntry, g: Messages["generate"]): string | null {
  switch (e.slot) {
    case "identity": {
      if (e.consumption === "dropped") {
        if (e.noteCode === "EXTRA_ATTACHMENT_UNUSED") {
          return formatMsg(g.receiptExtraUnused, { n: e.label ?? "1" });
        }
        return `${g.receiptFace}: ${g.receiptSrcAttachment} — ${g.receiptUnused}`;
      }
      // No face source = no line (operator, 2026-08-26, third pass on this
      // area: with no character picked the line was uniform noise on every
      // model — the "Select character" pill above already owns that story,
      // and the engagement-gated NEEDS_REFERENCE_PHOTO row still blocks
      // where a character is required). The line exists only when it can
      // name a real source.
      if (e.consumption === "absent") return null;
      const src =
        e.source === "attachment"
          ? e.noteCode === "REPLACES_SAVED_FACE"
            ? `${g.receiptSrcAttachment} (${g.receiptReplacesSaved})`
            : g.receiptSrcAttachment
          : e.source === "gallery-pick"
            ? g.receiptSrcPick
            : e.source === "multiref"
              ? g.receiptFramesMulti
              : g.receiptSrcSaved;
      return `${g.receiptFace}: ${src}`;
    }
    case "outfit": {
      if (e.source === "attachment") {
        return e.consumption === "native"
          ? `${g.receiptOutfit}: ${g.receiptSrcAttachment}`
          : `${g.receiptOutfit}: ${g.receiptSrcAttachment} — ${g.receiptUnused}`;
      }
      return `${g.receiptOutfit}: ${e.consumption === "native" ? g.receiptAttached : g.receiptDescribed}`;
    }
    case "scene":
      return g.receiptScene;
    case "prop":
      return e.consumption === "native" ? g.receiptProp : g.receiptPropDescribed;
    case "reference":
      return e.consumption === "native" ? g.receiptReference : g.receiptReferenceDescribed;
    case "continuation":
      return e.consumption === "native" ? g.receiptContinuation : `${g.receiptContinuation} — ${g.receiptUnused}`;
    case "dialogue":
      return g.receiptDialogue;
    case "cast":
      return g.receiptCast;
    case "frames":
      return g.receiptFrames;
    case "storyboard":
      return g.receiptStoryboard;
    case "rulesOverride":
      return g.receiptRulesOff;
    default:
      return null;
  }
}

// Typed issue code → localized sentence. Shared by the strip rows and the
// submit-time soft-block, so the click and the row always say the same thing.
export function issueMessage(
  issue: PlanIssue,
  g: Messages["generate"],
  modelName: string,
  // Composer cleanup case 3 (2026-08-26): when an image attachment is riding
  // the send, the characterless fence must acknowledge it — the old copy
  // ignored the upload entirely, which read as the system not seeing it.
  hasAttachmentRiding?: boolean,
): string {
  const name = issue.params?.name || "";
  switch (issue.code) {
    case "NEEDS_REFERENCE_PHOTO":
      if (!name && hasAttachmentRiding) return g.issueNeedsCharacterWithAttachment;
      return name
        ? formatMsg(g.issueNeedsReference, { model: modelName, name })
        : formatMsg(g.issueNeedsCharacter, { model: modelName });
    case "CONTINUE_NEEDS_SEEDANCE":
      return g.issueContinueSeedance;
    case "DIALOGUE_NEEDS_VOICE":
      return g.issueDialogueVoice;
    // Not a warning about damage — sync_mode "silence" pads rather than
    // trims, so nothing is lost. It is a warning that the clip will not be
    // the length that was chosen: output is max(video, audio), verified
    // against the real endpoint on 2026-09-04.
    case "DIALOGUE_CUE_PAST_CLIP":
      return formatMsg(g.issueDialogueCuePastClip, {
        start: issue.params?.start ?? "?",
        clip: issue.params?.clip ?? "?",
      });
    case "DIALOGUE_LONGER_THAN_CLIP":
      return formatMsg(g.issueDialogueTooLong, {
        spoken: issue.params?.spoken ?? "?",
        clip: issue.params?.clip ?? "?",
      });
    case "SEEDANCE25_PHOTOREAL":
      // The face can now arrive as an attachment with no character behind it
      // (2026-08-31), and this warning used to interpolate a name that does
      // not exist in that case — it read "if  is photoreal".
      // The destination is resolved from the capability table at plan time
      // (send-plan photorealFallback), so the copy names whichever model is
      // actually accepting today rather than a model hardcoded in a string.
      {
        const target = issue.params?.target ? getVideoModel(issue.params.target).name : null;
        const warn = name
          ? formatMsg(g.seedance25Warn, { name, model: modelName })
          : formatMsg(g.seedance25WarnNoCharacter, { model: modelName });
        return target ? `${warn} ${formatMsg(g.seedance25Instead, { model: target })}` : warn;
      }
    case "REF_ASPECT_OUT_OF_RANGE":
      return g.referenceAspectError;
    case "MODEL_CANNOT_MULTI_PERSON":
      return formatMsg(g.issueMultiPerson, { model: modelName });
  }
}

// The "why does this happen?" copy behind each warning that has one.
//
// Only provider-POLICY issues get an explainer: those are the ones where the
// refusal comes from someone else's rulebook, and where a person could
// reasonably conclude Picacho is the one saying no. Mechanical issues (a
// missing voice, an out-of-range photo) explain themselves in the message.
function issueExplainer(issue: PlanIssue, g: Messages["generate"]): string | null {
  switch (issue.code) {
    case "SEEDANCE25_PHOTOREAL":
      return g.seedance25Why;
    default:
      return null;
  }
}

function actionLabel(issue: PlanIssue, g: Messages["generate"]): string | null {
  switch (issue.action) {
    case "switch-photoreal-model":
      return issue.params?.target
        ? formatMsg(g.seedance25Switch, { model: getVideoModel(issue.params.target).name })
        : null;
    case "remove-attachment":
      return g.attachAnchorRemove;
    case "clear-continuation":
    case "clear-dialogue":
      return g.issueActClear;
    case "pick-character":
      return g.selectCharacter;
    default:
      return null;
  }
}

/** One receipt entry, ready to draw: microlabel + value + the ochre check
    when the input genuinely rides the send. */
export type ReceiptPart = {
  slot: PlanEntry["slot"];
  label: string | null;
  value: string;
  ok: boolean;
  accent: boolean;
};

// The receipt's inventory as labeled parts (the slate composer draws them as
// cells and mono statements; the same strings, same resolver, new geometry —
// each entry's text splits at its first ": " into label + value; entries
// without that shape render as a value-only part).
export function planReceiptParts(
  plan: SendPlan,
  g: Messages["generate"],
  opts?: {
    /** When a spoken line is typed, the dialogue entry carries this note
        (the "+N cr" surcharge) as its value, in proof ochre. */
    dialogueNote?: string | null;
    /** Direction B (2026-09-18): when the character has several saved photos
        and this lane opens on one of them, FACE names WHICH one
        ("photo 1 of 6"). Only ever applied to the character's own saved
        photos — an attachment or multi-reference keeps its own words. The
        photo menu itself opens from the CAST cell. */
    facePhotoText?: string | null;
  },
): ReceiptPart[] {
  return plan.entries
    .map((e): ReceiptPart | null => {
      const text = entryText(e, g);
      if (!text) return null;
      if (e.slot === "dialogue" && opts?.dialogueNote) {
        return { slot: e.slot, label: g.receiptDialogue, value: opts.dialogueNote, ok: false, accent: true };
      }
      const ci = text.indexOf(": ");
      // The character's own saved photo — the default one, or the one picked
      // from their photos ("gallery-pick" is that pick, send-plan.ts).
      const savedFace =
        e.slot === "identity" &&
        e.consumption !== "dropped" &&
        (e.source === "character-default" || e.source === "gallery-pick");
      return {
        slot: e.slot,
        label: ci > 0 ? text.slice(0, ci) : null,
        value:
          savedFace && opts?.facePhotoText ? opts.facePhotoText : ci > 0 ? text.slice(ci + 2) : text,
        ok: e.consumption === "native",
        accent: false,
      };
    })
    .filter((p): p is ReceiptPart => p !== null);
}

/** Does the plan carry an attachment in a non-face slot? Feeds the
    characterless fence's wording (issueMessage above). */
export function planHasAttachmentRiding(plan: SendPlan): boolean {
  return plan.entries.some((e) => e.slot === "reference" || e.slot === "prop" || e.slot === "scene");
}

// The resolver's verdicts as persistent full-width rows with one-tap
// remedies — unchanged from the receipt band they came from (see the header
// comment). The slate composer renders them under the slate row; the
// submit-time soft-block keeps quoting the same issueMessage.
export function PlanIssueRows({
  issues,
  g,
  modelName,
  onAction,
  hasAttachmentRiding,
}: {
  issues: PlanIssue[];
  g: Messages["generate"];
  modelName: string;
  onAction: (issue: PlanIssue) => void;
  hasAttachmentRiding: boolean;
}) {
  if (issues.length === 0) return null;
  return (
    <div className="space-y-1.5">
      {issues.map((issue) => (
        <div
          key={issue.code}
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-[12px] px-3 py-2 text-[11.5px] leading-snug",
            issue.severity === "block"
              ? "bg-red-500/10 text-red-800 dark:text-red-300"
              : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
          )}
        >
          <span className="min-w-0 flex-1">
            {issueMessage(issue, g, modelName, hasAttachmentRiding)}
            {/* "Why does this happen?" — the warning tells you the render will
                be refused; without this it reads as Picacho refusing it. It is
                the provider's rule, verified with live requests, and people
                are entitled to know whose rule they are hitting before they
                decide to spend a credit on it. Kept as a <details> rather
                than a tooltip so it works on a phone, where there is no
                hover. */}
            {issueExplainer(issue, g) && (
              <details className="mt-1.5">
                <summary className="cursor-pointer list-none text-[11px] font-semibold underline decoration-dotted underline-offset-2 opacity-80 hover:opacity-100">
                  {g.issueWhyLabel}
                </summary>
                <p className="mt-1.5 max-w-[46ch] text-[11px] leading-relaxed opacity-90">
                  {issueExplainer(issue, g)}
                </p>
              </details>
            )}
          </span>
          {issue.action && (
            <button
              type="button"
              onClick={() => onAction(issue)}
              className="flex-shrink-0 rounded-full bg-atelier-ink px-2.5 py-1 text-[11px] font-semibold text-atelier-paper transition-opacity hover:opacity-90"
            >
              {actionLabel(issue, g)}
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
