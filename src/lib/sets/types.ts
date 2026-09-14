import type { SetLayout, SetSpec } from "./set-spec";
import type { SetFilm } from "./film";

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
  /** Stills shot in it (the Sets dashboard, 2026-09-14), and when the last one was. */
  shots: number;
  lastShotAt: string | null;
};

export type SetShot = {
  generationId: string;
  status: string;
  resultUrl: string | null;
  /** The same still, larger, for the viewer beside the conversation (Astra chat, 2026-09-14). */
  viewUrl: string | null;
  /** 0–100 identity score against the character's photo; null when unscored. */
  score: number | null;
  createdAt: string;
  /**
   * Its objects can be cut out for a later shot's look: its camera and
   * figure were recorded (shot-camera.ts) and objects showed clear of the
   * person (look-cutout.ts seesLookObjects). look.ts canBeLook reads it.
   */
  hasLookObjects: boolean;
  /** What the person asked for, in their words (shot-words-store.ts); null before set-shot-words.sql or when nothing was said. */
  words: string | null;
  /** A still, or a take — a clip shot from one still to a newly framed end (take.ts, 2026-09-15). */
  kind: "still" | "take";
  /** A take's poster frame once it has arrived; stills carry none. */
  posterUrl: string | null;
  /** A take's length — takes come in engine lengths (take.ts); stills carry null. */
  seconds: number | null;
};

export type SetCharacter = {
  id: string;
  name: string;
  thumbUrl: string | null;
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
  /** The owner's working copy (the Set Editor, 2026-09-14): what the stage draws when it exists. */
  editedSpec: SetSpec | null;
  layout: SetLayout | null;
  /** The saved move (Helios Film, 2026-09-15): null until one is kept, or before helios-film.sql runs. */
  film: SetFilm | null;
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
      /** Stills shot in any of these sets since the billing month began (the dashboard). */
      shotsThisMonth: number;
      /** Whether this person may build a set from a photo (admins, flag astra_photo_sets). */
      photoSetsOn: boolean;
      /** Their characters with a saved photo: who the home's composer can shoot (Astra chat, 2026-09-14). */
      characters: SetCharacter[];
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
