"use client";

import { useId } from "react";
import { formatMsg } from "@/lib/i18n/format";
import type { StarAnswer } from "@/lib/press-tour/door-view";
import { cn } from "@/lib/cn";
import { ROW, RadioDot, TickBox } from "./controls";
import type { PressWords } from "./verdict";

// "Who is Eva?" and "Eva may appear in ads for products I sell"
// (critique #9): the star's say-so, asked once for the photos the character
// has now (star-consent.ts keeps it). Nothing is pre-ticked (S11). The
// fields only: the Starring tile and the product card each hold the answer
// and save it through recordStarConsent.

export type StarDraft = { answer: StarAnswer | null; adsOk: boolean };

export function StarAskFields({
  name,
  draft,
  onChange,
  disabled,
  m,
}: {
  name: string;
  draft: StarDraft;
  onChange: (next: StarDraft) => void;
  disabled?: boolean;
  m: PressWords;
}) {
  const id = useId();
  const who = name || m.untitledStar;
  const options: { value: StarAnswer; label: string }[] = [
    { value: "me", label: m.starMe },
    { value: "permission", label: m.starPermission },
    { value: "not_a_person", label: m.starNotPerson },
  ];
  return (
    <div>
      <fieldset disabled={disabled}>
        <legend className="text-[12.5px] leading-[1.42] text-[#9aa0ad]">{formatMsg(m.starAsk, { name: who })}</legend>
        <div className="mt-2 grid gap-2">
          {options.map((o) => (
            <label key={o.value} className={cn(ROW, "has-[:checked]:ring-[rgba(240,196,142,0.65)]")}>
              <RadioDot name={`${id}-who`} checked={draft.answer === o.value} onChange={() => onChange({ ...draft, answer: o.value })} disabled={disabled} />
              <span>{o.label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className={cn(ROW, "mt-2 items-start py-3 leading-[1.42]")}>
        <TickBox checked={draft.adsOk} onChange={(adsOk) => onChange({ ...draft, adsOk })} disabled={disabled} />
        <span>{formatMsg(m.starAdsOk, { name: who })}</span>
      </label>
    </div>
  );
}

/** The "You said…" line, printed only from the answer the server kept. */
export function saidLine(answer: StarAnswer, m: PressWords): string {
  return answer === "me" ? m.saidMe : answer === "permission" ? m.saidPermission : m.saidNotPerson;
}
