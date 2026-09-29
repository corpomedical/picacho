"use client";

// Helios Studio (2026-09-26): the Blender-style workspace for one set, opened
// from the set page with ?studio=1. The engine is the approved draft's code
// (studio-engine.ts), loaded only here, on the client.
//
// Stage 3 (2026-09-29): the scene is kept on the account. The page hands in
// the saved copy (null when none, or the column isn't there yet), and the
// engine saves back through saveStudioScene about 5 s after a change,
// keeping its browser copy as the backup.
//
// "Photo with your character" (stage 3): Render ▸ sends the shot camera's
// frame through the set page's own Shoot (shootInSet, one press id per
// press, studio-press.ts), priced by the same quote the set page shows.
//
// Astra for any request (stage 4): the words, the scene summary and the
// last turns go to askStudioAstra with a fresh press id each; the plan
// comes back to the engine, which shows it and runs it only on Apply.

import { useEffect, useRef } from "react";
import { quoteSend } from "@/lib/generations/quote";
import { useLocale } from "@/lib/i18n/provider";
import { shootInSet } from "@/lib/sets/actions";
import { readSetPress } from "@/lib/sets/press-actions";
import type { SetSpec } from "@/lib/sets/set-spec";
import type { StudioScene } from "@/lib/sets/studio-scene";
import { saveStudioScene } from "@/lib/sets/studio-actions";
import { askStudioAstra } from "@/lib/sets/editor-actions";
import { STUDIO_ASTRA_RESENT } from "@/lib/sets/studio-astra";
import { stillQuoteInput } from "@/lib/sets/take";
import type { SetCharacter } from "@/lib/sets/types";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { STUDIO_CSS, STUDIO_HTML } from "./studio-markup";
import { pressStudioStill, type StudioPressPhase, type StudioShootInput } from "./studio-press";

export function HeliosStudio({
  setId,
  title,
  spec,
  savedScene,
  characters,
}: {
  setId: string;
  title: string;
  spec: SetSpec;
  savedScene: StudioScene | null;
  characters: SetCharacter[];
}) {
  const { t } = useLocale();
  // Read once, when the engine starts: a later render must not restart it.
  const savedRef = useRef(savedScene);
  const charactersRef = useRef(characters);
  const wordsRef = useRef({
    neverStarted: t.sets.pressNeverStarted,
    stillGoing: t.sets.pressStillGoing,
    unchecked: t.sets.pressUnchecked,
    inHistory: t.sets.pressInHistory,
    refresh: t.generate.refreshNeeded,
  });
  const unreachable = t.generate.submitFailed;
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let dead = false;
    void import("./studio-engine").then((m) => {
      if (dead) return;
      dispose = m.startStudio({
        setId,
        title,
        spec,
        backHref: `/app/sets/${setId}`,
        savedScene: savedRef.current,
        saveScene: async (scene: unknown) => {
          try {
            return await saveStudioScene(setId, scene);
          } catch {
            // A dropped connection or a new deploy: the browser copy holds it.
            return { error: "unreachable" };
          }
        },
        astra: {
          unreachable,
          ask: async (text: string, summary: unknown, turns: { who: "person" | "astra"; text: string }[]) => {
            try {
              const out = await askStudioAstra(setId, text, summary, turns, crypto.randomUUID());
              if (out.error !== null) return { error: "pending" in out && out.pending ? STUDIO_ASTRA_RESENT : out.error };
              return { error: null, plan: out.plan, answer: out.answer };
            } catch (err) {
              if (isStaleDeployError(err)) void reloadForNewDeploy({ delayMs: 1800 });
              return { error: unreachable };
            }
          },
        },
        render: {
          // THE price, from the function the server charges with (set-view.tsx's own).
          credits: quoteSend(stillQuoteInput()).totalCredits,
          characters: charactersRef.current.map((c) => ({ id: c.id, name: c.name, likenessNeeded: c.likenessNeeded === true })),
          setHref: `/app/sets/${setId}`,
          historyHref: (generationId: string) => `/app/history/${generationId}`,
          unreachable,
          shoot: (input: StudioShootInput, onPhase: (phase: StudioPressPhase) => void) =>
            pressStudioStill(
              {
                shoot: shootInSet,
                read: readSetPress,
                alive: () => !dead,
                words: wordsRef.current,
                onStale: () => void reloadForNewDeploy({ delayMs: 1800 }),
                onPhase,
              },
              setId,
              input,
            ),
        },
      });
    });
    return () => {
      dead = true;
      dispose?.();
    };
  }, [setId, title, spec, unreachable]);
  return (
    <div className="fixed inset-0 z-[70]" data-helios-studio>
      <style>{STUDIO_CSS}</style>
      <div className="h-full" dangerouslySetInnerHTML={{ __html: STUDIO_HTML }} />
    </div>
  );
}
