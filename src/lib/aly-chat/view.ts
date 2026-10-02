// What the chat page shows of a stored conversation (2026-09-29): the words,
// files, answers, documents and render cards — never Claude's raw blocks,
// which stay on the server. Client-safe; relative imports only.

import type { Brain, BrainChoice } from "./brains";
import type { CardPhoto } from "./card-photos-rules";
import type { FileRef, Source, StoredRow } from "./history";

export type ViewLane = {
  text: string;
  model: string;
  sources?: Source[];
  error?: string;
  status?: string;
  streaming?: boolean;
};

/** A card from prepare_send / plan_press_ad, and the render it became. */
export type ViewRender = {
  id: string;
  label: string;
  kind: "image" | "video" | "ad";
  characterId: string | null;
  characterName: string | null;
  prompt: string;
  modelId: string | null;
  modelName: string | null;
  seconds: number | null;
  credits: number;
  href: string;
  generationId?: string | null;
  /** Chat pictures that ride into the render (card-photos-rules.ts). */
  photos?: CardPhoto[];
};

export type ViewMsg =
  | { key: string; seq: number; role: "user"; text: string; files: FileRef[] }
  | {
      key: string;
      seq: number;
      role: "assistant";
      brain: BrainChoice | null;
      lanes: Partial<Record<Brain, ViewLane>>;
      kept: Brain;
      docs: { id: string; title: string; version: number }[];
      renders: ViewRender[];
      streaming?: boolean;
      error?: string;
      topUp?: boolean;
      /** Picacho Light: the renders of this live answer start by themselves (never stored). */
      autoStartRenders?: boolean;
    };

export function toView(rows: StoredRow[]): ViewMsg[] {
  return rows.map((r) => {
    if (r.role === "user") return { key: `u${r.seq}`, seq: r.seq, role: "user", text: r.content.text, files: r.content.files };
    const lanes: Partial<Record<Brain, ViewLane>> = {};
    for (const [b, lane] of Object.entries(r.content.lanes) as [Brain, NonNullable<(typeof r.content.lanes)[Brain]>][]) {
      if (!lane) continue;
      lanes[b] = { text: lane.text, model: lane.model, ...(lane.sources?.length ? { sources: lane.sources } : {}), ...(lane.error ? { error: lane.error } : {}) };
    }
    return {
      key: `a${r.seq}`,
      seq: r.seq,
      role: "assistant",
      brain: r.brain,
      lanes,
      kept: r.content.kept,
      docs: r.content.docs ?? [],
      renders: (r.content.renders ?? []) as ViewRender[],
    };
  });
}
