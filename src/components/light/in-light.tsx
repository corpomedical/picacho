"use client";

import { createContext, useContext } from "react";
import { lightHref } from "@/lib/light/mode";

// True everywhere under Picacho Light's frame (app/app/layout.tsx wraps the
// Light branch in it), so shared pieces (Aly's cards, the gallery) keep
// their links inside Light instead of opening the studio.
const InLightContext = createContext(false);

export function InLightProvider({ children }: { children: React.ReactNode }) {
  return <InLightContext.Provider value={true}>{children}</InLightContext.Provider>;
}

/** Whether this page is inside Picacho Light's frame. */
export function useInLight(): boolean {
  return useContext(InLightContext);
}

/** The link as this page should open it: kept in Light when in Light. */
export function useModeHref(): (href: string) => string {
  const inLight = useContext(InLightContext);
  return inLight ? lightHref : (href) => href;
}
