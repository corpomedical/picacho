"use client";

// One video's editable project, open in the HyperFrames SDK: the timeline
// model it reads as, the edits it takes (each one an undo step), and the
// working copy it saves a moment after you stop — the preview frame then
// reloads that copy (?draft=1) at the same moment in the video.

import { useCallback, useEffect, useRef, useState } from "react";
import type { Composition } from "@hyperframes/sdk";
import { openProject, saveProjectDraft } from "@/lib/editor/actions";
import { buildTimeline, backdrops, type ProjectElement, type TimelineClip, type TimelineModel, type TimingEdit } from "@/lib/editor/timeline";

const SAVE_AFTER_MS = 900;

export type ProjectState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      model: TimelineModel;
      backdrops: TimelineClip[];
      base: string;
      /** Bumps after every saved change: the preview frame reloads its src with it. */
      previewVersion: number;
      saving: "idle" | "pending" | "saving" | "saved" | "failed";
      canUndo: boolean;
      canRedo: boolean;
    };

export function useProject(editId: string, generationId: string, clipNames: readonly string[]) {
  const comp = useRef<Composition | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const names = useRef(clipNames);
  const [state, setState] = useState<ProjectState>({ status: "loading" });

  useEffect(() => {
    names.current = clipNames;
  }, [clipNames]);

  const read = useCallback((): Pick<Extract<ProjectState, { status: "ready" }>, "model" | "backdrops" | "canUndo" | "canRedo"> | null => {
    const c = comp.current;
    if (!c) return null;
    const roots = c.getRootElements() as unknown as ProjectElement[];
    const timings = c.getElementTimings();
    return { model: buildTimeline(roots, timings, names.current), backdrops: backdrops(roots, timings), canUndo: c.canUndo(), canRedo: c.canRedo() };
  }, []);

  const save = useCallback(async () => {
    const c = comp.current;
    if (!c) return;
    setState((s) => (s.status === "ready" ? { ...s, saving: "saving" } : s));
    const res = await saveProjectDraft(editId, generationId, c.serialize());
    setState((s) =>
      s.status === "ready" ? { ...s, saving: res.error ? "failed" : "saved", previewVersion: res.error ? s.previewVersion : s.previewVersion + 1 } : s,
    );
  }, [editId, generationId]);

  const changed = useCallback(() => {
    const next = read();
    if (!next) return;
    setState((s) => (s.status === "ready" ? { ...s, ...next, saving: "pending" } : s));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void save(), SAVE_AFTER_MS);
  }, [read, save]);

  useEffect(() => {
    let alive = true;
    setState({ status: "loading" });
    (async () => {
      const opened = await openProject(editId, generationId);
      if (!alive) return;
      if (opened.error !== null) {
        setState({ status: "error", message: opened.error });
        return;
      }
      try {
        const { openComposition } = await import("@hyperframes/sdk");
        const c = await openComposition(opened.html);
        if (!alive) {
          c.dispose();
          return;
        }
        comp.current = c;
        const now = read();
        if (!now) return;
        setState({ status: "ready", ...now, base: opened.base, previewVersion: 0, saving: opened.draft ? "saved" : "idle" });
      } catch (err) {
        setState({ status: "error", message: err instanceof Error ? err.message : "Couldn't read this project." });
      }
    })();
    return () => {
      alive = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
      comp.current?.dispose();
      comp.current = null;
    };
  }, [editId, generationId, read]);

  /** Timing edits from the timeline, as one undo step. */
  const applyTimings = useCallback(
    (edits: TimingEdit[]) => {
      const c = comp.current;
      if (!c || edits.length === 0) return;
      c.batch(() => {
        for (const e of edits) {
          if (e.mediaStart !== undefined) c.setAttribute(e.id, "data-media-start", String(e.mediaStart));
          if (e.start !== undefined || e.duration !== undefined) c.setTiming(e.id, { start: e.start, duration: e.duration });
        }
      });
      changed();
    },
    [changed],
  );

  const setVolume = useCallback(
    (id: string, volume: number) => {
      comp.current?.setAttribute(id, "data-volume", String(Math.round(volume * 100) / 100));
      changed();
    },
    [changed],
  );

  const remove = useCallback(
    (ids: string[]) => {
      const c = comp.current;
      if (!c || ids.length === 0) return;
      c.batch(() => ids.forEach((id) => c.removeElement(id)));
      changed();
    },
    [changed],
  );

  /** Split: shorten the clip and add its second half as a new element beside it. */
  const split = useCallback(
    (first: TimingEdit, secondHtml: string, parentId: string | null) => {
      const c = comp.current;
      if (!c) return;
      c.batch(() => {
        if (first.duration !== undefined) c.setTiming(first.id, { duration: first.duration });
        c.dispatch({ type: "addElement", parent: parentId, index: Number.MAX_SAFE_INTEGER, html: secondHtml });
      });
      changed();
    },
    [changed],
  );

  const element = useCallback((id: string) => comp.current?.getElement(id) ?? null, []);
  const parentOf = useCallback((id: string): string | null => {
    const c = comp.current;
    if (!c) return null;
    const find = (els: readonly { id: string; children: readonly unknown[] }[], parent: string | null): string | null | undefined => {
      for (const e of els) {
        if (e.id === id) return parent;
        const hit = find(e.children as { id: string; children: readonly unknown[] }[], e.id);
        if (hit !== undefined) return hit;
      }
      return undefined;
    };
    return find(c.getRootElements() as unknown as { id: string; children: readonly unknown[] }[], null) ?? null;
  }, []);

  const undo = useCallback(() => {
    comp.current?.undo();
    changed();
  }, [changed]);
  const redo = useCallback(() => {
    comp.current?.redo();
    changed();
  }, [changed]);

  return { state, applyTimings, setVolume, remove, split, element, parentOf, undo, redo, saveNow: save };
}
