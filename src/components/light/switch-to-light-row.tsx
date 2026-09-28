"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { saveAppChoices } from "@/lib/light/actions";
import { LIGHT_HOME } from "@/lib/light/mode";

/**
 * The full studio's settings menu row to Picacho Light (operator,
 * 2026-09-28: "Light version should be available on the dropdown menu").
 */
export function SwitchToLightRow({ className, onDone }: { className: string; onDone: () => void }) {
  const { t } = useLocale();
  const l = t.light;
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");

  async function go() {
    setState("saving");
    const res = await saveAppChoices({ mode: "light" });
    if (res.error) {
      setState("failed");
      return;
    }
    onDone();
    router.replace(LIGHT_HOME);
    router.refresh();
  }

  return (
    <button type="button" onClick={() => void go()} disabled={state === "saving"} className={`${className} w-full text-left`}>
      <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12Z" />
      </svg>
      <span className="flex flex-col">
        <span>{state === "saving" ? l.saving : l.switchToLight}</span>
        <span className="text-[11px] opacity-75">{state === "failed" ? l.saveFailed : l.switchToLightHint}</span>
      </span>
    </button>
  );
}
