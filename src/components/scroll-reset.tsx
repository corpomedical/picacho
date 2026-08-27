"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

// Every page opens at the top (2026-08-27, operator: "pages start scrolled
// down"). The app shell scrolls a custom container ([data-app-scroll]), not
// the window — and Next only resets WINDOW scroll on navigation, so the
// container quietly kept its offset across routes: scroll deep into Media,
// tap Characters, and the character page opened mid-scroll. Window scroll
// is reset too for the pages outside the shell.
export function ScrollReset() {
  const pathname = usePathname();
  useEffect(() => {
    document.querySelector("[data-app-scroll]")?.scrollTo({ top: 0 });
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
}
