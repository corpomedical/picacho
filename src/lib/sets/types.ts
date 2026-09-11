import type { SetLayout, SetSpec } from "./set-spec";

// What the Sets pages hand their client components. Plain data only — every
// value crosses the server→client boundary.

export type SetStatus = "building" | "ready" | "failed";

export type SetSummary = {
  id: string;
  title: string;
  brief: string;
  status: SetStatus;
  createdAt: string;
  thumbUrl: string | null;
  /** The English wire sentence for a failed build (localized at display). */
  failure: string | null;
};

export type SetShot = {
  generationId: string;
  status: string;
  resultUrl: string | null;
  /** 0–100 identity score against the character's photo; null when unscored. */
  score: number | null;
  createdAt: string;
  /** Whose still it is: the look note only promises the outfit for the same character. */
  characterId: string | null;
};

export type SetCharacter = {
  id: string;
  name: string;
  thumbUrl: string | null;
  /** Their saved outfit photo rides every render (look.ts hasSavedOutfit), so a look never promises other clothes. */
  hasOutfit: boolean;
};

export type SetDetail = {
  id: string;
  title: string;
  description: string;
  brief: string;
  status: SetStatus;
  failure: string | null;
  spec: SetSpec | null;
  layout: SetLayout | null;
  hasThumb: boolean;
};

export type SetsHomeData =
  | { error: string }
  | {
      error: null;
      sets: SetSummary[];
      usedThisMonth: number;
      /** -1 = unlimited (admin). */
      monthlyLimit: number;
    };

export type SetPageData =
  | { error: string }
  | {
      error: null;
      /** The identity score under which a still is flagged (the gate's bar). */
      identityBar: number;
      set: SetDetail;
      shots: SetShot[];
      characters: SetCharacter[];
    };
