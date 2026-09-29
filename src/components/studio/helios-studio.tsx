"use client";

// Helios Studio (2026-09-26): the Blender-style workspace for one set, opened
// from the set page with ?studio=1. The engine is the approved draft's code
// (studio-engine.ts), loaded only here, on the client.
//
// Stage 3 (2026-09-29): the scene is kept on the account. The page hands in
// the saved copy (null when none, or the column isn't there yet), and the
// engine saves back through saveStudioScene about 5 s after a change,
// keeping its browser copy as the backup.

import { useEffect, useRef } from "react";
import type { SetSpec } from "@/lib/sets/set-spec";
import type { StudioScene } from "@/lib/sets/studio-scene";
import { saveStudioScene } from "@/lib/sets/studio-actions";
import { STUDIO_CSS, STUDIO_HTML } from "./studio-markup";

export function HeliosStudio({
  setId,
  title,
  spec,
  savedScene,
}: {
  setId: string;
  title: string;
  spec: SetSpec;
  savedScene: StudioScene | null;
}) {
  // Read once, when the engine starts: a later render must not restart it.
  const savedRef = useRef(savedScene);
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
      });
    });
    return () => {
      dead = true;
      dispose?.();
    };
  }, [setId, title, spec]);
  return (
    <div className="fixed inset-0 z-[70]" data-helios-studio>
      <style>{STUDIO_CSS}</style>
      <div className="h-full" dangerouslySetInnerHTML={{ __html: STUDIO_HTML }} />
    </div>
  );
}
