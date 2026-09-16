"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale } from "@/lib/i18n/provider";
import { isStaleDeployError } from "@/lib/stale-deploy";
import { pollSetBuild } from "@/lib/sets/actions";
import { SETS_NOT_OPEN, SETS_SESSION_EXPIRED, SETS_SUSPENDED, SETS_UNAVAILABLE, SET_NOT_FOUND } from "@/lib/sets/messages";

// A set still being built, opened from the Sets home with a message
// (Astra chat, 2026-09-14): the message above, Astra's building step
// below, and the page refreshes itself the moment the build settles — into
// the conversation, which then asks the message of the ready stage (the
// address still carries it), or into the failure the set page says.
//
// The collecting is the server's (pollSetBuild), exactly as the Sets home
// polls a building card; this page adds nothing to it and announces nothing
// — the home, if open in another tab, and the finisher do that.

const POLL_MS = 5000;
const POLL_MAX_MS = 30_000;
// Answers the set page itself knows what to do with — send the person to
// sign in, say the set is gone, say Sets are closed or the account is
// suspended — so the page is asked again rather than left saying "building".
const PAGE_ANSWERS = new Set([SETS_SESSION_EXPIRED, SETS_SUSPENDED, SETS_UNAVAILABLE, SETS_NOT_OPEN, SET_NOT_FOUND]);

export function SetBuilding({ setId, ask, hint }: { setId: string; ask: string | null; hint: string }) {
  const { t } = useLocale();
  const s = t.sets;
  const router = useRouter();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;
    let delay = POLL_MS;
    const tick = async () => {
      let threw = false;
      try {
        const res = await pollSetBuild(setId);
        if (cancelled) return;
        if (res.error !== null) {
          threw = true;
          // Asked again, the page answers for itself and this step leaves
          // the screen; after a passing blip it is still building, and the
          // poll carries on, backing off.
          if (PAGE_ANSWERS.has(res.error)) router.refresh();
        } else if (res.state !== "building") {
          router.refresh();
          return;
        }
      } catch (err) {
        if (isStaleDeployError(err)) {
          window.location.reload();
          return;
        }
        threw = true;
      }
      if (cancelled) return;
      delay = threw ? Math.min(POLL_MAX_MS, delay * 2) : POLL_MS;
      timerRef.current = setTimeout(tick, delay);
    };
    timerRef.current = setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [setId, router]);

  return (
    <div className="isolate relative rounded-[26px] bg-atelier-surface/80 shadow-[0_0_0_1px_var(--frost-ring),0_2px_6px_rgba(0,0,0,0.04),0_24px_56px_-20px_rgba(0,0,0,0.22)] backdrop-blur-xl">
      <div className="space-y-6 p-4 sm:p-6">
        {ask && (
          <div className="flex justify-end">
            <div className="max-w-[85%] whitespace-pre-wrap rounded-[18px] rounded-br-[6px] bg-atelier-surface px-4.5 py-3 text-sm leading-relaxed text-atelier-ink shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
              {ask}
            </div>
          </div>
        )}
        <div className="flex justify-start">
          <div className="max-w-[92%] rounded-[18px] rounded-bl-[6px] bg-atelier-surface px-4.5 py-4 shadow-[0_1px_2px_rgba(33,29,22,0.05),0_8px_20px_-14px_rgba(33,29,22,0.12)]">
            <div className="flex items-start gap-3">
              <span className="mt-2 h-1.5 w-1.5 flex-shrink-0 animate-pulse rounded-full bg-atelier-ink" />
              <div className="space-y-1">
                <p className="text-[10px] font-medium uppercase tracking-widest text-atelier-muted">{s.stepBuilding}</p>
                <p className="text-sm text-atelier-ink/80">{s.buildingLine}</p>
                <p className="text-xs text-atelier-muted">{hint}</p>
                <p className="text-xs">
                  <Link href="/app/sets" className="font-medium text-atelier-accent underline underline-offset-2">
                    {s.back}
                  </Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
