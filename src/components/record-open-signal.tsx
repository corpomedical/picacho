"use client";

import { useEffect } from "react";
import { recordOpened } from "@/lib/generations/actions";

// Records that a person actually looked at one render.
//
// A client component on purpose. The obvious place for this was the history
// page's own server component, one line beside the query — and that would be
// wrong: Next prefetches links, so the page renders on the server for renders
// nobody ever opened, and every one of those would be stamped "opened".
// Mounting in the browser is the only version of this signal that is true.
//
// Fires once per render id and never blocks anything: the action is fail-soft
// and the table's unique index means opening the same take ten times is still
// one row, so there is nothing to debounce.
export function RecordOpenSignal({ generationId }: { generationId: string }) {
  useEffect(() => {
    if (!generationId) return;
    void recordOpened(generationId);
  }, [generationId]);

  return null;
}
