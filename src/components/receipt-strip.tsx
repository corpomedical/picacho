"use client";

import type { Messages } from "@/lib/i18n/messages";
import type { PlanEntry, PlanIssue, SendPlan } from "@/lib/generations/send-plan";
import { formatMsg } from "@/lib/i18n/format";
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
      if (e.consumption === "absent") return `${g.receiptFace}: ${g.receiptGenericPerson}`;
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
    case "outfit":
      return `${g.receiptOutfit}: ${e.consumption === "native" ? g.receiptAttached : g.receiptDescribed}`;
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
): string {
  const name = issue.params?.name || "";
  switch (issue.code) {
    case "NEEDS_REFERENCE_PHOTO":
      return name
        ? formatMsg(g.issueNeedsReference, { model: modelName, name })
        : formatMsg(g.issueNeedsCharacter, { model: modelName });
    case "CONTINUE_NEEDS_SEEDANCE":
      return g.issueContinueSeedance;
    case "DIALOGUE_NEEDS_VOICE":
      return g.issueDialogueVoice;
    case "SEEDANCE25_PHOTOREAL":
      return formatMsg(g.seedance25Warn, { name });
    case "REF_ASPECT_OUT_OF_RANGE":
      return g.referenceAspectError;
    case "MODEL_CANNOT_MULTI_PERSON":
      return formatMsg(g.issueMultiPerson, { model: modelName });
  }
}

function actionLabel(issue: PlanIssue, g: Messages["generate"]): string | null {
  switch (issue.action) {
    case "switch-seedance-2":
      return g.seedance25Switch;
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

export function ReceiptStrip({
  plan,
  headline,
  g,
  modelName,
  onAction,
}: {
  plan: SendPlan;
  headline: string;
  g: Messages["generate"];
  modelName: string;
  onAction: (issue: PlanIssue) => void;
}) {
  const parts = plan.entries
    .map((e) => entryText(e, g))
    .filter((s): s is string => Boolean(s));
  return (
    <div className="mb-1.5 space-y-1 px-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] leading-snug text-atelier-muted">
        <span className="font-medium text-atelier-ink/70">{headline}</span>
        {parts.map((p, i) => (
          <span key={i} className="flex items-center gap-2">
            <span aria-hidden className="text-atelier-muted/50">·</span>
            {p}
          </span>
        ))}
      </div>
      {plan.issues.map((issue) => (
        <div
          key={issue.code}
          className={cn(
            "flex flex-wrap items-center gap-2 rounded-[12px] px-3 py-2 text-[11.5px] leading-snug",
            issue.severity === "block"
              ? "bg-red-500/10 text-red-800 dark:text-red-300"
              : "bg-amber-500/10 text-amber-800 dark:text-amber-300",
          )}
        >
          <span className="min-w-0 flex-1">{issueMessage(issue, g, modelName)}</span>
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
