"use client";

// Helios Studio (2026-09-26): the Blender-style workspace for one set, opened
// from the set page with ?studio=1. The engine is the approved draft's code
// (studio-engine.ts), loaded only here, on the client.

import { useEffect } from "react";
import type { SetSpec } from "@/lib/sets/set-spec";
import { STUDIO_CSS, STUDIO_HTML } from "./studio-markup";

export function HeliosStudio({ setId, title, spec }: { setId: string; title: string; spec: SetSpec }) {
  useEffect(() => {
    let dispose: (() => void) | null = null;
    let dead = false;
    void import("./studio-engine").then((m) => {
      if (!dead) dispose = m.startStudio({ setId, title, spec, backHref: `/app/sets/${setId}` });
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
