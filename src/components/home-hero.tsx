"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { HomeComposer } from "@/components/home-composer";
import { cn } from "@/lib/cn";

// Kept short and simple on purpose. A first version tried to animate the
// composer traveling down the screen and reshaping into Generate's docked
// composer mid-flight — it looked like a glitch rather than a transition,
// because it was trying to fake spatial continuity across a real page
// navigation with nothing else on screen to sell the illusion. A plain,
// confident fade of the whole block is far more reliable and reads as
// intentional rather than broken. Generate's card does a matching (but not
// identical-timed) fade-in on arrival — see justArrived/settled in
// generate-form.tsx.
const EXIT_MS = 180;

export function HomeHero({ greeting }: { greeting: string }) {
  const router = useRouter();
  const [leaving, setLeaving] = useState(false);

  function handleSubmit(dest: string) {
    if (leaving) return;

    const reduceMotion =
      typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      router.push(dest);
      return;
    }

    setLeaving(true);
    window.setTimeout(() => router.push(dest), EXIT_MS);
  }

  return (
    <div
      className={cn(
        "flex min-h-[60vh] flex-col items-center justify-center transition-all duration-[180ms] ease-in",
        leaving && "translate-y-1 scale-[0.98] opacity-0",
      )}
    >
      <h1 className="font-display text-2xl font-bold tracking-[-0.02em] text-neutral-900">{greeting}</h1>
      <div className="mt-6 w-full">
        <HomeComposer disabled={leaving} onSubmitPrompt={handleSubmit} />
      </div>
    </div>
  );
}
