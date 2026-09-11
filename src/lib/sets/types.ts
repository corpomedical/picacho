import type { SetLayout, SetSpec } from "./set-spec";

// What the Sets pages hand their client components. Plain data only — every
// value crosses the server→client boundary.

export type SetStatus = "building" | "ready" | "failed";

/** Built from a written brief, or from a photo (docs 3.2, 2026-09-11). */
export type SetKind = "text" | "photo";

export type SetSummary = {
  id: string;
  title: string;
  /** The brief — or, for a photo set, the photographer's notes ("" when none). */
  brief: string;
  status: SetStatus;
  createdAt: string;
  thumbUrl: string | null;
  /** The English wire sentence for a failed build (localized at display). */
  failure: string | null;
  fromPhoto: boolean;
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
  /** The brief — or, for a photo set, the photographer's notes ("" when none). */
  brief: string;
  status: SetStatus;
  failure: string | null;
  spec: SetSpec | null;
  layout: SetLayout | null;
  hasThumb: boolean;
  fromPhoto: boolean;
  /** The photo a ready photo set was built from, signed for its owner; null otherwise. */
  sourcePhotoUrl: string | null;
};

export type SetsHomeData =
  | { error: string }
  | {
      error: null;
      sets: SetSummary[];
      usedThisMonth: number;
      /** -1 = unlimited (admin). */
      monthlyLimit: number;
      /** Whether this person may build a set from a photo (admins, flag astra_photo_sets). */
      photoSetsOn: boolean;
    };

export type SetPageData =
  | { error: string }
  | {
      error: null;
      /** The identity score under which a still is flagged (the gate's bar). */
      identityBar: number;
      /** Whether this person may match a shot here (admins, flag astra_photo_sets); the action checks again. */
      matchOn: boolean;
      set: SetDetail;
      shots: SetShot[];
      characters: SetCharacter[];
    };
