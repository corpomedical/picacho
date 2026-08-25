"use client";

import type { Messages } from "@/lib/i18n/messages";
import type { PlanEntry, SendPlan } from "@/lib/generations/send-plan";
import { formatMsg } from "@/lib/i18n/format";

// The Send Receipt (P0, read-only): one quiet, always-mounted line above the
// composer that inventories exactly what the next send consists of — face
// source, outfit mode, armed continuation, typed dialogue, cast, frames.
// It renders in BOTH fold states, which is the whole point: nothing armed
// can hide behind the pull-up bar anymore (ghost dialogue, stale
// continuations, silently-dropped attachments all show here). P1 adds the
// issue rows that replace the amber fences; P0 changes no payloads and
// renders no judgments — just the truth.

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

export function ReceiptStrip({
  plan,
  headline,
  g,
}: {
  plan: SendPlan;
  headline: string;
  g: Messages["generate"];
}) {
  const parts = plan.entries
    .map((e) => entryText(e, g))
    .filter((s): s is string => Boolean(s));
  return (
    <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 px-4 text-[11px] leading-snug text-atelier-muted">
      <span className="font-medium text-atelier-ink/70">{headline}</span>
      {parts.map((p, i) => (
        <span key={i} className="flex items-center gap-2">
          <span aria-hidden className="text-atelier-muted/50">·</span>
          {p}
        </span>
      ))}
    </div>
  );
}
