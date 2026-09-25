"use client";

import { useEffect, useState } from "react";
import {
  LAMP_EVENT,
  readLampHidden,
  readLampPlace,
  writeLampHidden,
  writeLampPlace,
  type Place,
} from "@/components/producer/lamp-place";

// Where the lamp is on this device, and the way back (2026-09-25, operator:
// "Lets make it movable and dismissible"). A hidden lamp comes back here;
// a moved one can go back to its corner. Per device, like the lamp itself.
// English only while the Producer is admins-only, like its sheet.

function describe(hidden: boolean, place: Place): string {
  if (hidden) return "Hidden on this device.";
  if (place.kind === "home") return "In the bottom-right corner.";
  if (place.kind === "edge") return `Tucked into the ${place.edge} edge.`;
  return "Where you left it.";
}

export function ProducerLampForm() {
  const [hidden, setHidden] = useState(false);
  const [place, setPlace] = useState<Place>({ kind: "home" });

  useEffect(() => {
    const read = () => {
      setHidden(readLampHidden());
      setPlace(readLampPlace());
    };
    read();
    window.addEventListener(LAMP_EVENT, read);
    return () => window.removeEventListener(LAMP_EVENT, read);
  }, []);

  const button =
    "rounded-full border border-atelier-rule px-3.5 py-1.5 text-sm text-atelier-ink transition-colors hover:border-atelier-accent";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-atelier-ink">The lamp</p>
        <p className="mt-0.5 text-xs text-atelier-muted">
          {describe(hidden, place)} Drag it anywhere; let go at an edge to tuck it in, or drop it on × to hide it.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {hidden ? (
          <button type="button" onClick={() => writeLampHidden(false)} className={button}>
            Show the lamp
          </button>
        ) : (
          <button type="button" onClick={() => writeLampHidden(true)} className={button}>
            Hide it
          </button>
        )}
        {place.kind !== "home" && (
          <button type="button" onClick={() => writeLampPlace({ kind: "home" })} className={button}>
            Back to the corner
          </button>
        )}
      </div>
    </div>
  );
}
