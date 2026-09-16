"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LocalDate } from "@/components/local-date";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { quoteSend } from "@/lib/generations/quote";
import { isStaleDeployError } from "@/lib/stale-deploy";
import { saveSetLayout, saveSetThumbnail, shootInSet, takeInSet } from "@/lib/sets/actions";
import { editSetWithAstra, saveSetEdit } from "@/lib/sets/editor-actions";
import { matchSetShot } from "@/lib/sets/match-actions";
import { readShotWords } from "@/lib/sets/words-actions";
import { fovForLens, nearestLens } from "@/lib/sets/build-scene";
import { clearMarks } from "@/lib/sets/marks";
import {
  SET_TAKE_DEFAULT_ENGINE,
  SET_TAKE_ENGINES,
  takeQuoteInput,
  type SetTakeEngine,
} from "@/lib/sets/take";
import {
  FILM_MAX_BEATS,
  filmAfterEdit,
  filmContextKey,
  filmRendered,
  filmRenderPlan,
  filmSeconds,
  normaliseSetFilm,
  textKey,
  type SetFilm,
} from "@/lib/sets/film";
import { oversizedSeating } from "@/lib/sets/human-scale";
import { readTakes, saveSetFilm } from "@/lib/sets/film-actions";
import { checkShotRig, saveSetRig } from "@/lib/sets/rig-actions";
import { RIG_PALETTES, findLook, formatFrame, normaliseSetRig, type RigCheckItem, type SetRig } from "@/lib/sets/rig";
import { bearingDeg, litSpec } from "@/lib/sets/light-schemes";
import { LAB_PREVIEW_SHADER, labPreviewCodes } from "@/lib/sets/lab-preview";
import { layMove, poseAlong, type FilmMove, type FilmTexture } from "@/lib/sets/moves";
import type { RigCheck } from "@/lib/sets/rig-check";
import { RigPanel } from "@/components/sets/rig-panel";
import { compareCrop, compareOutputSize, widenFovDeg, type CompareCrop } from "@/lib/sets/compare";
import { canBeLook, newestLook } from "@/lib/sets/look";
import { matchSummary, placeMatchedCamera, solveMatchPose, type CameraMove, type MatchClamp } from "@/lib/sets/match-shot";
import { SET_PHOTO_UNREADABLE, SET_TAKE_BAD_END } from "@/lib/sets/messages";
import { preparePhoto } from "@/lib/sets/photo-client";
import { facingFor, hasCameraWords, wordsToMatch, type ShotWords } from "@/lib/sets/shot-words";
import {
  SET_COMPARE_PX,
  SET_MAX_TILT_DOWN_DEG,
  SET_MAX_TILT_UP_DEG,
  SET_THUMB_PX,
} from "@/lib/sets/set-config";
import { SET_LIMITS, type SetLayout, type SetSpec, type Vec3 } from "@/lib/sets/set-spec";
import type { SetCharacter, SetShot } from "@/lib/sets/types";

// A Set, open (Astra Sets, 2026-09-10; a workspace since 2026-09-14, drawn
// and approved on the design canvas — docs/ASTRA_SETS.md). The stage is
// the page: the live frame, draggable as ever, with ONE pill controller
// floating at its foot (drawn first, then built to the drawing) — the
// setup on the left (who, the look, camera, lens, mark, Match a shot,
// History), the decision in the middle (Shoot lit and breathing, Another
// angle, the mode), and the wheel on the right, whose ring aims, whose
// collar turns the figure, and whose hub frames — then a filmstrip of the
// frame and every still. A still that lands takes the stage's place, with
// its score, previous and next, Back to the frame, and its own actions on
// the picture; the wheel's ← → then walk the stills and its hub goes back
// to the frame. The conversation with Astra is the panel beside it: the
// person's words as dark bubbles, Astra in plain text with a small mark,
// the frame it proposes as ONE card of five rows (who, where, camera, what
// happens, cost) with Shoot as the word that approves it, and a composer
// at the foot that keeps the words ("@" opens the who menu).
//
// The words are read by a small model into fields (shot-words.ts), never
// into text of its own: everything Astra says here is Picacho's own
// sentence, in the person's language. A reading that fails takes the
// message as what happens in the frame and says so.
//
// Nothing here touches money. The shot's price comes from quoteSend (the
// function the server charges with), and shootInSet hands the frame to
// runGeneration like any other image send. Everything drawn comes from the
// normalised spec through build-scene.ts; three.js loads dynamically, only
// on this route.

type Pose = { position: Vec3; target: Vec3; fovDeg: number };


/**
 * Fly the stage camera from one pose to another — the film's previz, free —
 * along the beat's own move (moves.ts poseAlong): round the person for an
 * arc or an orbit, her size held for a dolly zoom, straight for the rest.
 */
function tweenPose(api: { goTo(p: Pose): void }, a: Pose, b: Pose, ms: number, move: FilmMove | null = null): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      api.goTo(poseAlong(move, a, b, e));
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}
type Mark = { x: number; z: number; facingDeg: number };

type StageApi = {
  /** Whether exposure.ts lifted this set's fill light or exposure. */
  lifted: boolean;
  goTo(pose: Pose): void;
  setFov(fovDeg: number): void;
  placeMark(mark: Mark): void;
  pose(): Pose;
  /**
   * A JPEG of the view. Square by default (the still's frame); with `from`
   * and `aspect`, the view from that pose at the given width/height ratio,
   * long side `px` — camera 1 beside a photo set's photo (compare.ts).
   */
  snapshot(px: number, opts?: { hideFigure?: boolean; from?: Pose; aspect?: number }): string | null;
  /** The camera in front of the figure, the whole figure in the lens. */
  frameFigure(): void;
  /** Pan and tilt: turn the camera where it stands, in degrees (left, up). */
  aim(leftDeg: number, upDeg: number): void;
  /**
   * Match this shot: the camera to a solved pose (match-shot.ts), moved
   * toward the figure or to another side of it if something built stands
   * between them. Returns how it had to move.
   */
  matchTo(pose: Pose): CameraMove;
  /**
   * The still's frame (Helios Cinema): the scene from `from` — or the camera
   * as it stands — rendered at the rig format's render size with the pose's
   * own field of view across its height. What the frame lines show, exactly.
   *
   * `cut` cuts it to the band the frame lines draw, the way the server cuts
   * the still that comes back (frame-cut.ts): the picture, not the frame it
   * is shot in. The sketch the model is sent NEVER asks for this — it is
   * rendered whole at 3:2, with the cut asked for in words and made on the
   * server, which is what a set shot is priced and proved at.
   */
  frame(opts?: { from?: Pose; hideFigure?: boolean; cut?: boolean }): string | null;
  /** The frame lines follow the rig's format and the panels round the stage. */
  relayout(): void;
  /**
   * A laid move's camera, kept out of anything built (moves.ts knows the
   * set's reach, not its walls): cast from the figure's eyes toward the
   * camera, it stops 0.3 m short of the first thing in the way.
   */
  roomFor(pose: Pose): Pose;
  /** The stage's depth of field for the rig's stop; null draws everything sharp. */
  setDepth(stop: number | null): void;
  /** What the lab will make of the still, previewed on the live view (lab-preview.ts); 0 and 0 draws it as it is. */
  setLab(stock: number, lens: number): void;
  /** Width ÷ height the recorded frame's field of view is measured against (1: across its height). */
  canvasAspect(): number;
  /**
   * The set changed under the camera (an Astra edit from the conversation,
   * editor-actions.ts): the drawn scene is replaced whole, the camera and
   * the figure stay where they are.
   */
  rebuild(next: SetSpec): void;
};

/** What Astra did with the last message, said above the frame. */
type FrameNote = {
  /** The reader could not read the words, so they became what happens. */
  fallback: boolean;
  /** The words were about neither the frame nor the shot. */
  talk: boolean;
  /** How the camera had to move round something built, if it did. */
  moved: CameraMove | null;
  /** Just talking is on: the words were read, and nothing moved. */
  planned?: boolean;
};

/** A frame as Astra or the person set it, to step back to (this visit only). */
type Revision = {
  id: number;
  cameraId: string | null;
  pose: Pose;
  markId: string;
  mark: Mark;
  direction: string;
  /** Said in the History menu: the camera and lens it was. */
  label: string;
};

/** What this visit knows of a still it shot: how long it took and the frame it was shot from. */
type ShotFacts = { seconds: number; frame: string };

type MenuId = "camera" | "figure" | "history" | "mode" | "who" | "filmStart";

const ACCENT = "#c8923a";
const TURN_STEP = 30;
// Framing the figure: a full-length shot, a little headroom and floor.
const FRAME_HEIGHT_M = 2.3;
const FRAME_TARGET_Y = 0.95;
const FRAME_EYE_Y = 1.45;
// How far a tilt may go (SET_MAX_TILT_UP_DEG, SET_MAX_TILT_DOWN_DEG) is in
// set-config.ts: a matched shot is held to the same limits. The up limit
// keeps a tilt inside the orbit's maxPolarAngle below.
/** Frames kept to step back to. */
const REVISIONS_MAX = 12;
const DEG = Math.PI / 180;

// ---- the workspace's skin (2026-09-14, "make it work exactly like
// higgsfield"): the viewport IS the page, dark in both themes like the
// stage and the Build editor, with the conversation as a panel floating
// inside it and the setup as glass chips on the picture itself. ----
/** A glass chip on the stage. */
const DCHIP =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-white/10 bg-black/60 px-3 text-xs font-medium text-onmedia/90 backdrop-blur transition-colors hover:bg-black/80 aria-disabled:cursor-default aria-disabled:opacity-45";
/** The same chip, lit ochre — the kept look. */
const DCHIP_ON =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent bg-black/60 px-3 text-xs font-medium text-[#f0cda6] backdrop-blur shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]";
// A menu's surface, dark, WITHOUT where it sits: the placement belongs to
// the menu itself. Tailwind classes do not override by the order they are
// written — `top-auto` after DMENU's `top-full` left both edges pinned, and
// the mode menu at the composer's foot collapsed to a 14 px sliver with its
// three options scrolled out of sight (found on the stage, 2026-09-16).
const DMENU_BASE =
  "absolute z-40 flex max-h-80 min-w-[11rem] flex-col gap-0.5 overflow-y-auto rounded-[12px] border border-white/[0.11] bg-[#1d1e24] p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]";
/** A menu opened downward from a chip, dark. */
const DMENU = `${DMENU_BASE} left-0 top-full mt-2`;
/** The same menu opened upward, for a chip at the foot of the panel. */
const DMENU_UP = `${DMENU_BASE} left-0 bottom-full mb-2`;
/** The same menu, hung from the right edge of a chip near the window's. */
const DMENU_RIGHT = `${DMENU_BASE} right-0 top-full mt-2`;
/** The conversation panel's surface. */
const PANEL_BG = "border border-white/[0.11] bg-[rgba(25,26,32,0.96)] shadow-[0_24px_56px_-16px_rgba(0,0,0,0.6)]";

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3 opacity-60" aria-hidden>
      <path d="M3 4.5l3 3 3-3" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 19V5" />
      <path d="M6 11l6-6 6 6" />
    </svg>
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className ?? ""}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" className="opacity-25" />
      <path d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

function FrameIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M8 5v14M16 5v14M3 12h18" />
    </svg>
  );
}

/** Astra's mark beside what it says: the wordmark's A, ochre underlined — light on the workspace's dark, like the editor's. */
function AstraMark() {
  return (
    <span className="relative mt-0.5 inline-flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[6px] bg-[#ecedf1] font-display text-[12px] font-bold text-[#1b1c20]">
      A
      <span aria-hidden className="absolute bottom-1 left-1.5 right-1.5 h-[1.5px] bg-[#a84e24]" />
    </span>
  );
}

function Option({ active, onPick, hint, children }: { active: boolean; onPick: () => void; hint?: string; children: ReactNode }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={active}
      onClick={onPick}
      className={`flex h-9 w-full cursor-pointer items-center justify-between gap-4 rounded-[7px] px-2.5 text-left text-[13px] transition-colors ${
        active ? "bg-white/[0.08] font-medium text-[#ecedf1]" : "text-[#9aa0ad] hover:bg-white/[0.05] hover:text-[#ecedf1]"
      }`}
    >
      <span className="tabular-nums">{children}</span>
      {active ? <span aria-hidden>✓</span> : hint ? <span className="text-[11px] text-[#6b6f7a]">{hint}</span> : null}
    </button>
  );
}

export function SetView({
  setId,
  title,
  spec: initialSpec,
  initialLayout,
  hasThumb,
  sourcePhotoUrl,
  characters,
  initialShots,
  identityBar,
  matchOn,
  initialAsk = null,
  initialCharacterId = null,
  initialAskFirst = true,
  savedFilm = null,
  initialFilmOpen = false,
  savedRig = null,
}: {
  setId: string;
  /** The set's name, said in the workspace's own bar. */
  title: string;
  spec: SetSpec;
  initialLayout: SetLayout | null;
  hasThumb: boolean;
  /** A photo set's photo (signed for its owner); null for a set built from words. */
  sourcePhotoUrl: string | null;
  characters: SetCharacter[];
  initialShots: SetShot[];
  identityBar: number;
  /** Whether "Match a shot" is offered (admins, the photo switch on); the action checks again. */
  matchOn: boolean;
  /** A message the person sent from the Sets home, asked the moment the stage is ready. */
  initialAsk?: string | null;
  /** The character picked on the Sets home. */
  initialCharacterId?: string | null;
  /** Whether Astra waits for the word after framing (Ask before shooting). */
  initialAskFirst?: boolean;
  /** The saved move (Helios Film): null until one is kept, or before helios-film.sql runs. */
  savedFilm?: SetFilm | null;
  /** Open on the Film dock (?film=1). */
  initialFilmOpen?: boolean;
  /** The saved rig (Helios Cinema): null until one is kept, or before helios-rig.sql runs. */
  savedRig?: SetRig | null;
}) {
  const { t, locale } = useLocale();
  const s = t.sets;

  // The set as drawn NOW: the working copy the page opened with, replaced
  // whole when an Astra edit lands from the conversation (send → editSet).
  // Everything below reads this, so the frame card, the marks and the
  // camera menus follow the edit; the engine swaps its scene via
  // api.rebuild and keeps its own initial bounds for the drag clamps.
  const [spec, setSpec] = useState<SetSpec>(initialSpec);
  // The set as one short key, for what a film was rendered in (film.ts).
  const setKey = useMemo(() => textKey(JSON.stringify(spec)), [spec]);

  const startPose: Pose = initialLayout?.camera ?? {
    position: spec.cameras[0].position,
    target: spec.cameras[0].target,
    fovDeg: spec.cameras[0].fovDeg,
  };
  const startMarkId = initialLayout?.markId ?? spec.marks[0].id;
  const startMark: Mark =
    initialLayout?.mark ??
    (() => {
      const m = spec.marks.find((x) => x.id === startMarkId) ?? spec.marks[0];
      return { x: m.x, z: m.z, facingDeg: m.facingDeg };
    })();

  const [cameraId, setCameraId] = useState<string | null>(initialLayout?.camera ? null : spec.cameras[0].id);
  const [fovDeg, setFovDeg] = useState(startPose.fovDeg);
  const [markId, setMarkId] = useState(startMarkId);
  const [mark, setMark] = useState<Mark>(startMark);
  // The camera as it stands, for what Astra says about the frame: kept up
  // to date whenever a move settles (scheduleSave), since a ref is not read
  // during render.
  const [poseNow, setPoseNow] = useState<Pose>(startPose);
  const [characterId, setCharacterId] = useState(
    () => characters.find((c) => c.id === initialCharacterId)?.id ?? characters[0]?.id ?? "",
  );
  // What happens in the frame: the shot prompt's direction, read out of the
  // person's last message (shot-words.ts) or, when the reader could not
  // read it, the message itself.
  const [direction, setDirection] = useState("");
  const [shooting, setShooting] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  // The stage is a dynamic import plus a WebGL context: until it exists,
  // nothing that drives it (camera, lens, mark, shoot) can do what it says.
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState<SetShot[]>(initialShots);
  const [lastMiss, setLastMiss] = useState<string | null>(null);
  // The thread: the person's messages since the last still, shown until the
  // still they lead to lands (then they are kept with the still, as one),
  // what Astra did with the last one, the composer's draft, the reader in
  // flight, and whether Astra waits for the word after framing. The
  // messages are mirrored in a ref, so a shot started from inside send()
  // reads the message it was called with as well as the ones before it.
  const [pendingAsks, setPendingAsks] = useState<string[]>([]);
  const pendingRef = useRef<string[]>([]);
  const [note, setNote] = useState<FrameNote | null>(null);
  const [draft, setDraft] = useState("");
  const [reading, setReading] = useState(false);
  const [askFirst, setAskFirst] = useState(initialAskFirst);
  // The third mode, the way 3D Jutsu has an ask-only mode: the words are
  // read and answered, but nothing moves and nothing is spent.
  const [justTalk, setJustTalk] = useState(false);
  // An Astra edit of the set itself, asked from the conversation: in
  // flight, and what the last one touched (said once, until the next turn).
  const [editingSet, setEditingSet] = useState(false);
  const [setChanged, setSetChanged] = useState<number | null>(null);
  // The conversation panel floats over the stage and can fold away.
  const [chatOpen, setChatOpen] = useState(true);
  // A photo set's photo beside camera 1, folded behind a chip.
  const [compareOpen, setCompareOpen] = useState(false);
  // A take under way: the still it starts from, while the end is framed.
  const [takeStart, setTakeStart] = useState<{ id: string; n: number } | null>(null);
  // Which engine renders the take (take.ts): Omni the take, Veo the premium
  // take. Reset to the default when a new take starts, so the price on the
  // button is never a leftover from an earlier, pricier choice.
  const [takeEngine, setTakeEngine] = useState<SetTakeEngine>(SET_TAKE_DEFAULT_ENGINE);

  // ---- the film: the move (Helios Film, drawn as canvas page H) ----
  // The dock replaces the filmstrip while it is open; the stage stays the
  // stage — orbit to a view, K keeps it as a beat's end. The move autosaves
  // like the editor's working copy; rendering is a chain of takes.
  const [filmOpen, setFilmOpen] = useState(initialFilmOpen);
  const [film, setFilm] = useState<SetFilm>(() => normaliseSetFilm(savedFilm));
  const [filmSel, setFilmSel] = useState<number | null>(null);
  /** Rendering: which beat the chain is on; null when idle. */
  const [filmBusy, setFilmBusy] = useState<{ beat: number; clipOnly: boolean } | null>(null);
  const [filmError, setFilmError] = useState("");
  /**
   * Every change to the move goes through here: the film is edited, then
   * filmAfterEdit (film.ts) says which rendered clips the change leaves
   * true — so the reel never plays a clip of a film that no longer exists.
   * Only the render writes clips, and it writes them with setFilm itself.
   * Nothing edits the film while a render runs: its clips are written in
   * beat order as they come back, and an edit that dropped some under it
   * would leave the next one in the wrong beat's place (filmBusyRef).
   */
  const filmBusyRef = useRef(false);
  const editFilm = useCallback((fn: (f: SetFilm) => SetFilm) => {
    if (filmBusyRef.current) return;
    setFilm((f) => filmAfterEdit(f, fn(f)));
  }, []);
  /** The reel: which clip is playing on the stage; null when closed. */
  const [reel, setReel] = useState<number | null>(null);
  /**
   * The reel's clips, one element each and all loading from the moment the
   * reel opens: when a clip ends the next is already there, so the film cuts
   * straight on instead of going black while a new player fetches it.
   */
  const reelVideosRef = useRef<(HTMLVideoElement | null)[]>([]);
  /** Clips that would not load while an earlier one played: said when the film reaches them. */
  const reelFailedRef = useRef<Set<number>>(new Set());
  /** The browser would not start a clip by itself: the reel waits for a tap. */
  const [reelWaiting, setReelWaiting] = useState(false);
  const [previz, setPreviz] = useState(false);

  // ---- the rig (Helios Cinema, drawn as canvas page I) ----
  // The camera department, docked left of the stage: the frame's shape, the
  // lens, the film stock, focus, light and palette, saved on the set like
  // the film. The stage reads it through a ref (it is built once), and shows
  // every choice before a credit moves: the frame lines, the field of view,
  // the depth of field, the light, the grade.
  const [rig, setRig] = useState<SetRig>(() => normaliseSetRig(savedRig));
  const rigRef = useRef<SetRig>(rig);
  const [rigOpen, setRigOpen] = useState(false);
  const [rigError, setRigError] = useState("");
  // The rig check, per still, while it reads or when it could not.
  const [rigChecking, setRigChecking] = useState<Record<string, "checking" | "failed">>({});
  const [rigCheckDismissed, setRigCheckDismissed] = useState<Record<string, true>>({});
  // What the panels leave of the stage for the frame lines (fit reads it).
  const insetsRef = useRef({ left: 14, right: 14, top: 64, bottom: 112 });

  // The human ruler's second line (human-scale.ts): on a photo set whose
  // furniture reads oversized against a person, one dismissible line offers
  // the fix through the same Astra edit the chat makes. Reads the LIVE
  // spec, so the line retires itself the moment a rescale lands.
  const [scaleDismissed, setScaleDismissed] = useState(false);
  // The composer's who menu, opened by "@" in the words or by the chip.
  const [mentionForced, setMentionForced] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  // Which toolbar menu is open, if any.
  const [menu, setMenu] = useState<MenuId | null>(null);
  // The viewer: a still in the stage's place, or the frame itself (null).
  const [viewing, setViewing] = useState<string | null>(null);
  // Frames set this visit, to step back to.
  const [revisions, setRevisions] = useState<Revision[]>([]);
  // What this visit knows of the stills it shot.
  const [shotFacts, setShotFacts] = useState<Record<string, ShotFacts>>({});
  // The look (2026-09-11): the earlier still whose objects the next shot
  // keeps, so the car is the same car. Only its objects ride, cut out onto
  // grey on the server, so the shot keeps its own camera (2026-09-12,
  // look-cutout.ts) — which needs the still's recorded camera and objects to
  // cut clear of its person, so only such stills are offered (look.ts
  // canBeLook). It follows the newest of them until the person picks one or
  // turns it off.
  const [lookId, setLookId] = useState<string | null>(() => newestLook(initialShots));
  // A ref, not state: a shot resolving tens of seconds after it started must
  // read the person's latest choice, not the one from the render it began in
  // (review, 2026-09-11 — turning the look off mid-render was undone).
  const lookPinnedRef = useRef(false);
  // The last shot asked for a look that could not be cut out, and went
  // without it: said once, under the shot, until the next one.
  const [lookDropped, setLookDropped] = useState(false);
  // A photo set: the photo's shape (from the picture once it loads), and
  // camera 1's view drawn at that shape to lay beside it. Nothing is saved.
  const [photoAspect, setPhotoAspect] = useState<number | null>(null);
  const [cameraOneShot, setCameraOneShot] = useState<string | null>(null);
  const compareTakenRef = useRef(false);
  // Match this shot (2026-09-11): the read in flight, what it said, and the
  // reference itself — held in this page's memory for the note beside the
  // line, never saved.
  const [matching, setMatching] = useState(false);
  const [matchError, setMatchError] = useState("");
  const [matched, setMatched] = useState<{
    photo: string;
    summary: ReturnType<typeof matchSummary>;
    moved: CameraMove;
  } | null>(null);
  const matchFileRef = useRef<HTMLInputElement | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<StageApi | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A figure dropped inside something built moved to open floor: the hint
  // says so for a few seconds, in place of the drag hint.
  const [figureMoved, setFigureMoved] = useState(false);
  const figureMovedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRef = useRef({ markId: startMarkId, mark: startMark });
  // The open menu, for the Esc handler (a ref is not read during render).
  const menuRef = useRef<MenuId | null>(null);
  // The set as it stood before the last Astra edit, for the changed line's Undo.
  const specBeforeEditRef = useRef<SetSpec | null>(null);
  // The stage calls this when an orbit settles; it points at scheduleSave,
  // which is declared below the stage's effect.
  const settledRef = useRef<(() => void) | null>(null);
  // The arrangement last saved (or loaded). Compared, not counted: effects
  // can run twice for one change (React's development double-invoke), and
  // opening a set is not arranging it.
  const savedMarkRef = useRef(JSON.stringify({ markId: startMarkId, mark: startMark }));
  // The message from the Sets home is asked once, the moment the stage is ready.
  const askedRef = useRef(false);
  const threadEndRef = useRef<HTMLDivElement>(null);

  // ---- the stage ----
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js");
        const { buildSetScene, buildStandIn, moveBuildInto, placeStandIn } = await import("@/lib/sets/build-scene");
        const { BASE_EXPOSURE, NO_LIFT, liftSet } = await import("@/lib/sets/exposure");
        if (disposed || !hostRef.current) return;

        const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
        const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.outputColorSpace = THREE.SRGBColorSpace;
        renderer.toneMapping = THREE.ACESFilmicToneMapping;
        renderer.toneMappingExposure = BASE_EXPOSURE;
        renderer.shadowMap.enabled = !coarse;
        // PCFSoftShadowMap is deprecated in this three.js and already falls
        // back to PCFShadowMap with a console warning on every set page.
        renderer.shadowMap.type = THREE.PCFShadowMap;
        const canvas = renderer.domElement;
        canvas.style.width = "100%";
        canvas.style.height = "100%";
        canvas.style.display = "block";
        canvas.style.touchAction = "none";
        host.appendChild(canvas);

        const scene = new THREE.Scene();
        const built = buildSetScene(THREE, spec, { shadows: !coarse });
        scene.add(built.root);
        if (built.background) scene.background = built.background;
        if (built.fog) scene.fog = built.fog;
        // What frees the CURRENT build's resources. An Astra edit from the
        // conversation rebuilds the scene INSIDE built.root (api.rebuild):
        // the group keeps its identity, so everything aimed at it — the
        // matcher above all — keeps working; only its children change.
        let disposeLive: () => void = () => built.dispose();

        const standIn = buildStandIn(THREE, ACCENT);
        placeStandIn(standIn, layoutRef.current.mark);
        scene.add(standIn.group);

        const camera = new THREE.PerspectiveCamera(startPose.fovDeg, 1, 0.05, built.farPlane);
        camera.position.set(...startPose.position);
        // The lens as the person set it: its field of view across the RENDER
        // frame's height (the rig's format, Helios Cinema). The canvas camera
        // is wider than that whenever the frame lines are shorter than the
        // canvas — fit() works out by how much (applyFov).
        let poseFov = startPose.fovDeg;
        /** The render frame's height on screen, pixels (fit). */
        let renderPx = 1;
        // The depth of field (the rig's stop): three.js's bokeh pass over the
        // live view only — the sketch the model sees is never blurred.
        let depthStop: number | null = null;
        let composer: import("three/examples/jsm/postprocessing/EffectComposer.js").EffectComposer | null = null;
        let bokeh: import("three/examples/jsm/postprocessing/BokehPass.js").BokehPass | null = null;
        let labPass: import("three/examples/jsm/postprocessing/ShaderPass.js").ShaderPass | null = null;
        let composerLoading = false;
        // What the lab will make of this still, shown on the live view
        // (lab-preview.ts): the stock and the lens's character, never on the
        // sketch the model sees — frame() and snapshot() render straight from
        // the renderer, past the composer.
        let lab = { stock: 0, lens: 0 };
        const labOn = () => lab.stock > 0 || lab.lens > 0;
        const frameUv = new THREE.Vector4(0, 0, 1, 1);

        const halfX = spec.bounds.x / 2;
        const halfZ = spec.bounds.z / 2;
        const raycaster = new THREE.Raycaster();
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = new THREE.Vector3();
        const ndc = new THREE.Vector2();
        let dragging = false;
        let controlsRef: InstanceType<typeof OrbitControls> | null = null;

        const toNdc = (e: PointerEvent) => {
          const r = canvas.getBoundingClientRect();
          ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          raycaster.setFromCamera(ndc, camera);
        };
        const overFigure = (e: PointerEvent) => {
          toNdc(e);
          return raycaster.intersectObject(standIn.figure, true).length > 0;
        };
        // Registered BEFORE the orbit controls, so a press on the figure
        // turns orbiting off before the controls see the same event.
        const onDown = (e: PointerEvent) => {
          if (!overFigure(e)) return;
          dragging = true;
          if (controlsRef) controlsRef.enabled = false;
          canvas.setPointerCapture(e.pointerId);
          canvas.style.cursor = "grabbing";
          e.preventDefault();
        };
        const onMove = (e: PointerEvent) => {
          if (!dragging) {
            if (e.pointerType === "mouse") canvas.style.cursor = overFigure(e) ? "grab" : "";
            return;
          }
          toNdc(e);
          if (!raycaster.ray.intersectPlane(ground, hit)) return;
          standIn.group.position.set(
            Math.min(halfX, Math.max(-halfX, hit.x)),
            0,
            Math.min(halfZ, Math.max(-halfZ, hit.z)),
          );
        };
        const onUp = (e: PointerEvent) => {
          if (!dragging) return;
          dragging = false;
          if (controlsRef) controlsRef.enabled = true;
          if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
          canvas.style.cursor = "";
          const p = standIn.group.position;
          // On open floor, as the server keeps it (normaliseSetLayout): a
          // figure inside a car or a wall is hidden in the sketch. It steps
          // out on the camera's side, where it stays in view.
          const dropped = { x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100 };
          const open = clearMarks(
            [{ ...dropped, facingDeg: layoutRef.current.mark.facingDeg }],
            spec.objects,
            spec.bounds,
            [camera.position.x, camera.position.z],
          );
          if (open.moved > 0) {
            setFigureMoved(true);
            if (figureMovedTimerRef.current) clearTimeout(figureMovedTimerRef.current);
            figureMovedTimerRef.current = setTimeout(() => setFigureMoved(false), 5000);
          }
          setMark(open.marks[0]);
        };
        canvas.addEventListener("pointerdown", onDown);
        canvas.addEventListener("pointermove", onMove);
        canvas.addEventListener("pointerup", onUp);
        canvas.addEventListener("pointercancel", onUp);
        // Double-click the figure to frame it (the "Frame the figure" button).
        const onDoubleClick = (e: MouseEvent) => {
          if (!overFigure(e as PointerEvent)) return;
          apiRef.current?.frameFigure();
          setCameraId(null);
          settledRef.current?.();
        };
        canvas.addEventListener("dblclick", onDoubleClick);

        const controls = new OrbitControls(camera, canvas);
        controlsRef = controls;
        controls.enableDamping = true;
        controls.dampingFactor = 0.08;
        controls.minDistance = 0.3;
        controls.maxDistance = Math.max(spec.bounds.x, spec.bounds.z) * 1.2 + 10;
        controls.maxPolarAngle = Math.PI * 0.62;
        controls.target.set(...startPose.target);
        controls.update();
        // A person grabbing the view makes it their own camera.
        controls.addEventListener("start", () => setCameraId(null));
        controls.addEventListener("end", () => settledRef.current?.());

        let raf = 0;
        let lastW = 0;
        let lastH = 0;
        let lastKey = "";
        /** The projection's full height when the frame lines sit off the canvas's centre (fit). */
        let fullH = 1;
        const applyFov = () => {
          camera.fov = widenFovDeg(poseFov, fullH / Math.max(1, renderPx));
          camera.updateProjectionMatrix();
        };
        const fit = () => {
          const w = host.clientWidth;
          const h = host.clientHeight;
          const ins = insetsRef.current;
          const format = rigRef.current.format;
          const key = `${w}x${h}|${ins.left},${ins.right},${ins.top},${ins.bottom}|${format}`;
          if (key === lastKey) return;
          if (w !== lastW || h !== lastH) {
            renderer.setSize(w, h, false);
            composer?.setSize(w, h);
          }
          lastKey = key;
          lastW = w;
          lastH = h;
          // The frame lines (Helios Cinema): the rig format's picture, as
          // large as the stage between the panels allows, centred on that
          // free stage. The camera's centre is moved there with a view offset
          // — the canvas is a window onto a larger projection whose middle is
          // the frame's — so the pose's aim stays the picture's centre. The
          // render it is cut from spans the pose's field of view across its
          // height; the projection is widened until that height on screen
          // does (compare.ts widenFovDeg), and the dark round the lines is
          // scene the still will not hold.
          const fr = formatFrame(format);
          const left = Math.min(ins.left, w / 2 - 40);
          const right = Math.min(ins.right, w / 2 - 40);
          const top = Math.min(ins.top, h / 2 - 40);
          const bottom = Math.min(ins.bottom, h / 2 - 40);
          const fx = (left + (w - right)) / 2;
          const fy = (top + (h - bottom)) / 2;
          let bw = Math.max(80, w - left - right - 24);
          let bh = bw / fr.bandAspect;
          const room = Math.max(80, h - top - bottom - 24);
          if (bh > room) {
            bh = room;
            bw = bh * fr.bandAspect;
          }
          renderPx = fr.bandAspect >= fr.renderAspect ? bw / fr.renderAspect : bh;
          const fullW = w + 2 * Math.abs(fx - w / 2);
          fullH = h + 2 * Math.abs(fy - h / 2);
          camera.aspect = fullW / Math.max(1, fullH);
          camera.setViewOffset(fullW, fullH, fullW / 2 - fx, fullH / 2 - fy, w, h);
          // Where the frame lines are, as the lab's preview reads them
          // (uv, bottom-up): the picture, and nothing round it.
          frameUv.set((fx - bw / 2) / w, 1 - (fy + bh / 2) / h, (fx + bw / 2) / w, 1 - (fy - bh / 2) / h);
          const g = guideRef.current;
          if (g) {
            g.style.width = `${bw}px`;
            g.style.height = `${bh}px`;
            g.style.left = `${fx - bw / 2}px`;
            g.style.top = `${fy - bh / 2}px`;
          }
          applyFov();
        };
        // The passes the stage draws through: the depth of field, then the
        // lab. Loaded once, the first time either is asked for.
        const ensureComposer = () => {
          if (composer || composerLoading) return;
          composerLoading = true;
          void (async () => {
            try {
              const [{ EffectComposer }, { RenderPass }, { BokehPass }, { ShaderPass }, { OutputPass }] = await Promise.all([
                import("three/examples/jsm/postprocessing/EffectComposer.js"),
                import("three/examples/jsm/postprocessing/RenderPass.js"),
                import("three/examples/jsm/postprocessing/BokehPass.js"),
                import("three/examples/jsm/postprocessing/ShaderPass.js"),
                import("three/examples/jsm/postprocessing/OutputPass.js"),
              ]);
              if (disposed) return;
              const c = new EffectComposer(renderer);
              c.addPass(new RenderPass(scene, camera));
              const b = new BokehPass(scene, camera, { focus: 4, aperture: 0, maxblur: 0 });
              c.addPass(b);
              c.addPass(new OutputPass());
              // The lab last, after the output pass: it works on the picture
              // as shown, the same values lab-grade.ts grades (lab-preview.ts).
              const l = new ShaderPass(LAB_PREVIEW_SHADER);
              l.uniforms.uTexel.value = new THREE.Vector2(1 / Math.max(1, lastW), 1 / Math.max(1, lastH));
              l.uniforms.uFrame.value = new THREE.Vector4(0, 0, 1, 1);
              c.addPass(l);
              c.setPixelRatio(renderer.getPixelRatio());
              c.setSize(lastW, lastH);
              composer = c;
              bokeh = b;
              labPass = l;
            } catch (err) {
              // No passes on this device: the stage stays as it is.
              console.warn("SetView post-processing unavailable:", err);
            }
          })();
        };
        // The figure's eyes, where the rig's focus is measured to.
        const eye = new THREE.Vector3();
        const renderLive = () => {
          if ((depthStop !== null || labOn()) && composer && bokeh) {
            const p = standIn.group.position;
            eye.set(p.x, 1.5, p.z);
            const s = Math.max(0.3, camera.position.distanceTo(eye));
            // The blur disc a real lens draws on a 24 mm frame, far behind
            // the focus: f² ÷ (N·s), as a share of the frame's height on
            // screen — the bokeh pass's reach is 0.4 of its maxblur. A
            // little over life size, so the stage shows what the stop does.
            const f = 12 / Math.tan((poseFov * Math.PI) / 360);
            // No stop chosen: the pass stays in the chain for the lab, drawing nothing.
            const discMm = depthStop === null ? 0 : (f * f) / (depthStop * s * 1000);
            const maxblur = depthStop === null ? 0 : Math.min(0.03, ((1.5 * discMm) / 48 / 0.4) * (renderPx / Math.max(1, lastH)));
            const u = bokeh.materialBokeh.uniforms;
            u.focus.value = s;
            u.maxblur.value = maxblur;
            u.aperture.value = maxblur / s;
            if (labPass) {
              const ratio = renderer.getPixelRatio();
              labPass.uniforms.uStock.value = lab.stock;
              labPass.uniforms.uLens.value = lab.lens;
              // The pass draws in the render target's own pixels, so the
              // glows and the grain keep their size on a 2× display.
              labPass.uniforms.uTexel.value.set(1 / Math.max(1, lastW * ratio), 1 / Math.max(1, lastH * ratio));
              labPass.uniforms.uScale.value = ratio;
              // Only the picture inside the frame lines wears the look.
              labPass.uniforms.uFrame.value.set(frameUv.x, frameUv.y, frameUv.z, frameUv.w);
            }
            composer.render();
          } else {
            renderer.render(scene, camera);
          }
        };
        const loop = () => {
          raf = requestAnimationFrame(loop);
          fit();
          controls.update();
          if (camera.position.y < 0.1) camera.position.y = 0.1;
          renderLive();
        };
        // One lift for the whole set, measured before the first frame is
        // shown (exposure.ts): a dark set gets more fill light, then more
        // exposure if fill is not enough, until its layout reads; the view,
        // every snapshot and the thumbnail share it. A measurement that
        // cannot run leaves the set as built.
        // The set is measured without the grey figure: standing where the
        // person left it, a stride from the first mark, it filled part of the
        // measured view and cut the podcast studio's lift from 16× to 11×
        // (2026-09-11). The lift belongs to the set, not to where the figure is.
        fit();
        let lift = NO_LIFT;
        standIn.group.visible = false;
        try {
          lift = liftSet(THREE, renderer, scene, spec, built.farPlane);
        } catch (err) {
          console.warn("SetView lighting measurement failed:", err);
        } finally {
          standIn.group.visible = true;
        }
        raf = requestAnimationFrame(loop);

        const cropSquare = (px: number): string | null => {
          const src = renderer.domElement;
          const side = Math.min(src.width, src.height);
          const out = document.createElement("canvas");
          out.width = px;
          out.height = px;
          const ctx = out.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, px, px);
          return out.toDataURL("image/jpeg", 0.9);
        };
        // A crop at a photo's shape (compare.ts), long side px.
        const cropRect = (crop: CompareCrop, px: number): string | null => {
          const src = renderer.domElement;
          const size = compareOutputSize(crop.sw, crop.sh, px);
          const out = document.createElement("canvas");
          out.width = size.width;
          out.height = size.height;
          const ctx = out.getContext("2d");
          if (!ctx) return null;
          ctx.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height);
          return out.toDataURL("image/jpeg", 0.9);
        };

        apiRef.current = {
          lifted: lift.fill > 1 || lift.exposure > BASE_EXPOSURE,
          goTo(pose) {
            camera.position.set(...pose.position);
            controls.target.set(...pose.target);
            poseFov = pose.fovDeg;
            applyFov();
            controls.update();
          },
          setFov(f) {
            poseFov = f;
            applyFov();
          },
          placeMark(m) {
            placeStandIn(standIn, m);
          },
          pose() {
            const r = (n: number) => Math.round(n * 1000) / 1000;
            return {
              position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
              target: [r(controls.target.x), r(controls.target.y), r(controls.target.z)],
              fovDeg: Math.round(poseFov * 100) / 100,
            };
          },
          frame(opts) {
            const fr = formatFrame(rigRef.current.format);
            const from = opts?.from ?? {
              position: [camera.position.x, camera.position.y, camera.position.z] as Vec3,
              target: [controls.target.x, controls.target.y, controls.target.z] as Vec3,
              fovDeg: poseFov,
            };
            // The ring and arrow are for arranging; the image model must
            // never see them and draw a ring on the floor.
            standIn.helpers.visible = false;
            if (opts?.hideFigure) standIn.figure.visible = false;
            const cam = new THREE.PerspectiveCamera(from.fovDeg, fr.renderW / fr.renderH, camera.near, camera.far);
            cam.position.set(...from.position);
            cam.lookAt(new THREE.Vector3(...from.target));
            cam.updateProjectionMatrix();
            // Drawn at the render's own size, then the canvas goes back as it
            // was before the browser shows a frame.
            const ratio = renderer.getPixelRatio();
            renderer.setPixelRatio(1);
            renderer.setSize(fr.renderW, fr.renderH, false);
            renderer.render(scene, cam);
            // The band the frame lines draw, centred, when the picture is
            // asked for rather than the frame it is shot in.
            const band = opts?.cut && fr.cut;
            const out = document.createElement("canvas");
            out.width = band ? fr.bandW : fr.renderW;
            out.height = band ? fr.bandH : fr.renderH;
            const ctx = out.getContext("2d");
            let url: string | null = null;
            if (ctx) {
              ctx.drawImage(renderer.domElement, band ? -Math.floor((fr.renderW - fr.bandW) / 2) : 0, band ? -Math.floor((fr.renderH - fr.bandH) / 2) : 0);
              url = out.toDataURL("image/jpeg", 0.9);
            }
            renderer.setPixelRatio(ratio);
            renderer.setSize(lastW, lastH, false);
            standIn.helpers.visible = true;
            standIn.figure.visible = true;
            renderLive();
            return url;
          },
          relayout() {
            lastKey = "";
            fit();
          },
          roomFor(pose) {
            const p = standIn.group.position;
            const from = new THREE.Vector3(p.x, FRAME_EYE_Y, p.z);
            const to = new THREE.Vector3(...pose.position);
            const dir = new THREE.Vector3().subVectors(to, from);
            const reach = dir.length();
            if (reach < 0.5) return pose;
            dir.normalize();
            raycaster.set(from, dir);
            raycaster.far = reach;
            const hit = raycaster.intersectObject(built.root, true)[0];
            raycaster.far = Infinity;
            if (!hit) return pose;
            const at = from.clone().addScaledVector(dir, Math.max(0.6, hit.distance - 0.3));
            const r = (n: number) => Math.round(n * 1000) / 1000;
            return { position: [r(at.x), r(at.y), r(at.z)], target: pose.target, fovDeg: pose.fovDeg };
          },
          setDepth(stop) {
            depthStop = coarse ? null : stop;
            if (depthStop !== null) ensureComposer();
          },
          setLab(stock, lens) {
            lab = coarse ? { stock: 0, lens: 0 } : { stock, lens };
            if (labOn()) ensureComposer();
          },
          snapshot(px, opts) {
            // The ring and arrow are for arranging; the image model must
            // never see them and draw a ring on the floor.
            standIn.helpers.visible = false;
            if (opts?.hideFigure) standIn.figure.visible = false;
            let url: string | null = null;
            // At a photo's shape: the largest centred rectangle of that
            // shape, with the camera widened where the rectangle is shorter
            // than the canvas, so the crop spans exactly the pose's fovDeg.
            const crop =
              opts?.from && opts.aspect ? compareCrop(renderer.domElement.width, renderer.domElement.height, opts.aspect) : null;
            if (opts?.from) {
              const cam = camera.clone();
              // The live camera looks through a view offset (fit); a snapshot
              // at the canvas's own shape and centre does not.
              cam.clearViewOffset();
              cam.aspect = lastW / Math.max(1, lastH);
              cam.position.set(...opts.from.position);
              cam.fov = crop ? widenFovDeg(opts.from.fovDeg, crop.fovScale) : opts.from.fovDeg;
              cam.lookAt(new THREE.Vector3(...opts.from.target));
              cam.updateProjectionMatrix();
              renderer.render(scene, cam);
            } else {
              renderer.render(scene, camera);
            }
            url = crop ? cropRect(crop, px) : cropSquare(px);
            standIn.helpers.visible = true;
            standIn.figure.visible = true;
            // Put the person's own view back before the browser shows a frame.
            renderer.render(scene, camera);
            return url;
          },
          frameFigure() {
            const p = standIn.group.position;
            const eye = new THREE.Vector3(p.x, FRAME_EYE_Y, p.z);
            // The whole figure inside the PICTURE: a rig format's band is only
            // part of the render's height (Scope keeps 643 of 1024 rows).
            const fr = formatFrame(rigRef.current.format);
            const want = FRAME_HEIGHT_M / 2 / (Math.tan((poseFov * Math.PI) / 360) * (fr.bandH / fr.renderH));
            // How far the camera can stand from the figure on a bearing
            // before something built is in the way (0.3 m short of it).
            const room = (dir: InstanceType<typeof THREE.Vector3>) => {
              raycaster.set(eye, dir);
              raycaster.far = want + 0.3;
              const hit = raycaster.intersectObject(built.root, true)[0];
              raycaster.far = Infinity;
              return hit ? hit.distance - 0.3 : want;
            };
            const bearing = (rad: number) => new THREE.Vector3(Math.sin(rad), 0, Math.cos(rad));
            // Where the figure faces, so the still sees the person's front;
            // failing that, the side the person is looking from; failing
            // that, whichever way has the most room.
            const facing = (layoutRef.current.mark.facingDeg * Math.PI) / 180;
            const fromCamera = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
            const tries = [facing, fromCamera, ...Array.from({ length: 8 }, (_, i) => (i * Math.PI) / 4)];
            let best = { dir: bearing(facing), room: -Infinity };
            for (const rad of tries) {
              const dir = bearing(rad);
              const r = room(dir);
              if (r >= Math.min(want, 1.2)) {
                best = { dir, room: r };
                break;
              }
              if (r > best.room) best = { dir, room: r };
            }
            const distance = Math.max(0.6, Math.min(want, best.room));
            camera.position.set(p.x + best.dir.x * distance, FRAME_EYE_Y, p.z + best.dir.z * distance);
            controls.target.set(p.x, FRAME_TARGET_Y, p.z);
            controls.update();
          },
          aim(leftDeg, upDeg) {
            const view = new THREE.Vector3().subVectors(controls.target, camera.position);
            const reach = view.length();
            if (reach < 1e-6) return;
            const yaw = Math.atan2(view.x, view.z) + (leftDeg * Math.PI) / 180;
            const pitch = Math.min(
              (SET_MAX_TILT_UP_DEG * Math.PI) / 180,
              Math.max((-SET_MAX_TILT_DOWN_DEG * Math.PI) / 180, Math.asin(view.y / reach) + (upDeg * Math.PI) / 180),
            );
            controls.target.set(
              camera.position.x + reach * Math.cos(pitch) * Math.sin(yaw),
              camera.position.y + reach * Math.sin(pitch),
              camera.position.z + reach * Math.cos(pitch) * Math.cos(yaw),
            );
            controls.update();
          },
          matchTo(pose) {
            // frameFigure's room, cast the other way: from the figure's eye
            // toward the solved camera, stopping short of anything built in
            // between, or trying frameFigure's other sides when the solved
            // one has no room (match-shot.ts placeMatchedCamera). Aimed along
            // the solved direction, so a moved camera keeps the framing, and
            // within the orbit's reach, so the controls never move it to fit.
            const p = standIn.group.position;
            const placed = placeMatchedCamera(THREE, built.root, pose, {
              mark: { x: p.x, z: p.z, facingDeg: layoutRef.current.mark.facingDeg },
              eyeY: FRAME_EYE_Y,
              bounds: spec.bounds,
              maxDistance: controls.maxDistance,
            });
            camera.position.set(...placed.position);
            controls.target.set(...placed.target);
            poseFov = pose.fovDeg;
            applyFov();
            controls.update();
            return placed.moved;
          },
          canvasAspect() {
            // The still's frame is rendered at its own shape with the pose's
            // field of view across its height (frame()) — what a landscape
            // canvas's centre square always was (look-cutout.ts, match-shot.ts).
            return 1;
          },
          rebuild(next) {
            // The new set's things move into the SAME root group, so the
            // matcher (placeMatchedCamera against built.root) never notices;
            // the old build's geometries and materials are freed, its things
            // leave the root (moveBuildInto), and the fresh build's own
            // dispose is kept for the edit after this one.
            const fresh = buildSetScene(THREE, next, { shadows: !coarse });
            disposeLive();
            disposeLive = moveBuildInto(built.root, fresh);
            scene.background = fresh.background;
            scene.fog = fresh.fog;
            camera.far = fresh.farPlane;
            camera.updateProjectionMatrix();
            placeStandIn(standIn, layoutRef.current.mark);
          },
        };

        setReady(true);

        // The card picture for the Sets page, once: the first camera, no
        // figure — the place itself. After a frame has sized the canvas.
        if (!hasThumb) {
          requestAnimationFrame(() => {
            const first = spec.cameras[0];
            const thumb = apiRef.current?.snapshot(SET_THUMB_PX, {
              hideFigure: true,
              from: { position: first.position, target: first.target, fovDeg: first.fovDeg },
            });
            if (thumb) void saveSetThumbnail(setId, thumb);
          });
        }

        cleanup = () => {
          cancelAnimationFrame(raf);
          canvas.removeEventListener("pointerdown", onDown);
          canvas.removeEventListener("pointermove", onMove);
          canvas.removeEventListener("pointerup", onUp);
          canvas.removeEventListener("pointercancel", onUp);
          canvas.removeEventListener("dblclick", onDoubleClick);
          controls.dispose();
          composer?.dispose();
          bokeh?.dispose();
          disposeLive();
          standIn.dispose();
          renderer.dispose();
          canvas.remove();
          apiRef.current = null;
        };
      } catch (err) {
        console.error("SetView failed to start:", err);
        if (!disposed) setLoadFailed(true);
      }
    })();

    return () => {
      disposed = true;
      cleanup?.();
    };
    // The stage is built once per set; everything after that is driven
    // through apiRef, so re-renders never rebuild the WebGL context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setId]);

  // ---- the arrangement follows state, and is saved a moment after it settles ----
  const scheduleSave = useCallback(() => {
    // What Astra says about the frame reads the camera as it stands now.
    const now = apiRef.current?.pose();
    if (now) setPoseNow(now);
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      // Without a running stage there is no camera to save, and saving
      // "no camera" would erase the one stored from an earlier visit.
      const api = apiRef.current;
      if (!api) return;
      void saveSetLayout(setId, { ...layoutRef.current, camera: api.pose() });
    }, 1500);
  }, [setId]);

  useEffect(() => {
    settledRef.current = scheduleSave;
  }, [scheduleSave]);

  useEffect(() => {
    layoutRef.current = { markId, mark };
    apiRef.current?.placeMark(mark);
    const key = JSON.stringify({ markId, mark });
    if (key === savedMarkRef.current) return;
    savedMarkRef.current = key;
    scheduleSave();
  }, [markId, mark, scheduleSave]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      if (figureMovedTimerRef.current) clearTimeout(figureMovedTimerRef.current);
    };
  }, []);

  // ---- the rig follows state: the stage reads it through a ref ----
  useEffect(() => {
    rigRef.current = rig;
  }, [rig]);

  // The frame lines follow the format and the panels round the stage: the
  // rig docked left, the conversation right, the setup chips above and the
  // filmstrip or the film dock below (md and up; a phone keeps the edges).
  useEffect(() => {
    const wide = typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches;
    insetsRef.current = {
      left: wide && rigOpen ? 356 : 14,
      right: wide ? (chatOpen ? 406 : 96) : 14,
      top: 64,
      bottom: filmOpen ? 196 : 112,
    };
    apiRef.current?.relayout();
  }, [rig.format, rigOpen, chatOpen, filmOpen, ready]);

  // The stop ring's depth of field, previewed on the live view only.
  useEffect(() => {
    if (ready) apiRef.current?.setDepth(rig.stop);
  }, [ready, rig.stop]);

  // The lab, previewed on the stage (lab-preview.ts): the film stock and the
  // lens's character, which the lab makes on the still after the render. The
  // palettes preview themselves as a grade over the canvas, Silver Print
  // among them, so the pass leaves colour alone.
  const rigStock = rig.stock;
  const rigLens = rig.lens;
  useEffect(() => {
    if (!ready) return;
    const { stock, lens } = labPreviewCodes({ stock: rigStock, lens: rigLens });
    apiRef.current?.setLab(stock, lens);
  }, [ready, rigStock, rigLens]);

  // A light scheme is a plot in the set (light-schemes.ts): the stage draws
  // a lit copy of the working copy round the figure's mark. Only when the
  // light, the set or the mark's place changed — the first ready of a set
  // with no scheme is the stage exactly as built.
  const litRef = useRef<{ spec: SetSpec; key: string }>({ spec: initialSpec, key: JSON.stringify(null) });
  const litKey = (light: SetRig["light"], m: { x: number; z: number }) => JSON.stringify(light ? [light, m.x, m.z] : null);
  /** Draw `next` on the stage now, lit by the rig's scheme — an Astra edit's thumbnail is shot right after. */
  function drawSet(next: SetSpec) {
    const m = layoutRef.current.mark;
    litRef.current = { spec: next, key: litKey(rigRef.current.light, m) };
    apiRef.current?.rebuild(litSpec(next, rigRef.current.light, m));
  }
  useEffect(() => {
    if (!ready) return;
    const key = litKey(rig.light, mark);
    if (litRef.current.spec === spec && litRef.current.key === key) return;
    // A beat after the last change: dragging the sun round the plot rebuilds
    // the stage once it rests, not on every step of the drag.
    const id = setTimeout(() => {
      litRef.current = { spec, key };
      apiRef.current?.rebuild(litSpec(spec, rig.light, mark));
    }, 60);
    return () => clearTimeout(id);
    // mark.facingDeg turns the figure only; the lights stay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, spec, rig.light, mark.x, mark.z]);

  // The rig autosaves like the film — a beat after the hands stop. The
  // first run is the loaded rig itself, not an edit.
  const rigLoadedRef = useRef(false);
  useEffect(() => {
    if (!rigLoadedRef.current) {
      rigLoadedRef.current = true;
      return;
    }
    const id = setTimeout(() => {
      void saveSetRig(setId, rig).then((r) => {
        setRigError(r.error ?? "");
      });
    }, 900);
    return () => clearTimeout(id);
  }, [rig, setId]);

  // ---- a photo set: camera 1 beside the photo ----
  // Once the stage is ready (its lift measured) and the photo's shape is
  // known: camera 1 stands where the photographer stood, so its view — no
  // figure, at the photo's shape — is what the photo should line up with.
  // In the next frame, like the card picture. Shown only; nothing is saved.
  useEffect(() => {
    if (!ready || !sourcePhotoUrl || !photoAspect || compareTakenRef.current) return;
    const first = spec.cameras[0];
    const raf = requestAnimationFrame(() => {
      compareTakenRef.current = true;
      const shot = apiRef.current?.snapshot(SET_COMPARE_PX, {
        hideFigure: true,
        from: { position: first.position, target: first.target, fovDeg: first.fovDeg },
        aspect: photoAspect,
      });
      if (shot) setCameraOneShot(shot);
    });
    return () => cancelAnimationFrame(raf);
  }, [ready, sourcePhotoUrl, photoAspect, spec]);

  // The photo's shape, from the picture itself: on load, or at once when the
  // browser already had it (a cached picture can finish before hydration).
  const readPhotoShape = useCallback((img: HTMLImageElement | null) => {
    if (img && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
      setPhotoAspect(img.naturalWidth / img.naturalHeight);
    }
  }, []);

  function pickCamera(id: string) {
    const cam = spec.cameras.find((c) => c.id === id);
    if (!cam) return;
    setCameraId(id);
    setFovDeg(cam.fovDeg);
    apiRef.current?.goTo({ position: cam.position, target: cam.target, fovDeg: cam.fovDeg });
    scheduleSave();
  }

  function pickLens(mm: number) {
    const f = fovForLens(mm);
    setFovDeg(f);
    apiRef.current?.setFov(f);
    scheduleSave();
  }

  function pickMark(id: string) {
    const m = spec.marks.find((x) => x.id === id);
    if (!m) return;
    setMarkId(id);
    setMark({ x: m.x, z: m.z, facingDeg: m.facingDeg });
  }

  function turn(delta: number) {
    setMark((m) => ({ ...m, facingDeg: (((m.facingDeg + delta) % 360) + 360) % 360 }));
  }

  function frameFigure() {
    apiRef.current?.frameFigure();
    setCameraId(null);
    scheduleSave();
  }


  // Match this shot: the reference is prepared here (upright, at most 2048 px,
  // a JPEG with no metadata — photo-client.ts), its camera is read on the
  // server, and only numbers come back. The camera is placed from them
  // against the figure's mark, the camera and the canvas as they are when
  // the answer lands, and saved like any camera move.
  async function pickReference(file: File | undefined) {
    // Never beside a shot: Next runs a page's server actions one at a time,
    // so a match started during a shot would say "reading" while it waited
    // for the whole shot, and a shot during a match would wait out the read.
    if (!file || matching || shooting || !ready) return;
    setMatchError("");
    setMatched(null);
    setMatching(true);
    try {
      let prepared: Awaited<ReturnType<typeof preparePhoto>>;
      try {
        prepared = await preparePhoto(file);
      } catch {
        setMatchError(SET_PHOTO_UNREADABLE);
        return;
      }
      if (!prepared.ok) {
        setMatchError(prepared.error);
        return;
      }
      let res: Awaited<ReturnType<typeof matchSetShot>>;
      try {
        res = await matchSetShot(setId, { photoDataUri: prepared.dataUri });
      } catch (err) {
        const stale = isStaleDeployError(err);
        setMatchError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
        if (stale) setTimeout(() => window.location.reload(), 1800);
        return;
      }
      if (res.error !== null) {
        setMatchError(res.error);
        return;
      }
      const api = apiRef.current;
      if (!api) {
        setMatchError(s.loadFailed);
        return;
      }
      const solved = solveMatchPose(res.match, {
        mark: layoutRef.current.mark,
        current: api.pose(),
        referenceAspect: prepared.width / prepared.height,
        bounds: spec.bounds,
        canvasAspect: api.canvasAspect(),
      });
      const moved = api.matchTo(solved.pose);
      setFovDeg(solved.pose.fovDeg);
      setCameraId(null);
      scheduleSave();
      // Said from where the camera actually stands, after any move around
      // something built: a limit it was moved off is not said (matchSummary).
      setMatched({ photo: prepared.dataUri, summary: matchSummary(res.match, solved, api.pose()), moved });
    } finally {
      setMatching(false);
    }
  }

  const clampNotes: Record<MatchClamp, string> = {
    wide: s.matchNoteWide,
    narrow: s.matchNoteNarrow,
    near: s.matchNoteNear,
    far: s.matchNoteFar,
    low: s.matchNoteLow,
    high: s.matchNoteHigh,
    tiltUp: formatMsg(s.matchNoteTiltUp, { deg: SET_MAX_TILT_UP_DEG }),
    tiltDown: formatMsg(s.matchNoteTiltDown, { deg: SET_MAX_TILT_DOWN_DEG }),
    subject: s.matchNoteSubject,
  };
  const moveNotes: Record<CameraMove, string | null> = {
    none: null,
    in: s.matchNotePulledIn,
    around: s.matchNoteMovedAround,
    blocked: s.matchNoteBlocked,
  };
  const matchedLine = (() => {
    if (!matched) return null;
    const { lensMm, heightM, tiltDeg, clamps } = matched.summary;
    const vars = {
      mm: lensMm,
      height: new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(heightM),
      tilt: Math.abs(tiltDeg),
    };
    const line = formatMsg(tiltDeg < 0 ? s.matchedDown : tiltDeg > 0 ? s.matchedUp : s.matchedLevel, vars);
    const moveNote = moveNotes[matched.moved];
    const notes = [...clamps.map((c) => clampNotes[c]), ...(moveNote ? [moveNote] : [])];
    return { line, notes: notes.join(" ") };
  })();

  // THE price, from the function the server charges with: one image take.
  const quote = quoteSend({
    contentType: "image",
    videoModelId: "kling",
    videoDurationSeconds: 5,
    videoResolution: null,
    storyboardTotalSeconds: null,
    referencePhotoCount: 0,
    framePicked: false,
    continuationSourceSeconds: null,
    dialoguePresent: false,
    renderCount: 1,
  });

  // ---- what the frame is, in words ----
  const activeLens = nearestLens(fovDeg);
  const character = characters.find((c) => c.id === characterId) ?? null;
  const characterName = character?.name || s.exampleCharacter;
  const labelOfMark = (id: string) => {
    const i = spec.marks.findIndex((m) => m.id === id);
    return spec.marks[i]?.label || formatMsg(s.markN, { n: i + 1 });
  };
  const labelOfCamera = (id: string | null) => {
    if (!id) return s.yourCamera;
    const i = spec.cameras.findIndex((c) => c.id === id);
    return spec.cameras[i]?.label || formatMsg(s.cameraN, { n: i + 1 });
  };
  const markLabel = labelOfMark(markId);
  const cameraLabel = labelOfCamera(cameraId);
  const lensLabel = formatMsg(s.lensMm, { mm: activeLens });

  const lookShot = shots.find((shot) => shot.generationId === lookId && canBeLook(shot)) ?? null;
  const latestStill = newestLook(shots);

  function pickLook(generationId: string | null) {
    setLookId(generationId);
    lookPinnedRef.current = true;
  }

  // ---- revisions: every frame set this visit, to step back to ----

  /** The frame as it stands, kept unless it is the one already kept last. */
  function keepRevision(directionNow: string, cameraNow: string | null) {
    const api = apiRef.current;
    if (!api) return;
    const pose = api.pose();
    const { markId: mId, mark: m } = layoutRef.current;
    const label = `${labelOfCamera(cameraNow)} · ${formatMsg(s.lensMm, { mm: nearestLens(pose.fovDeg) })}`;
    setRevisions((prev) => {
      const last = prev[prev.length - 1];
      if (
        last &&
        JSON.stringify(last.pose) === JSON.stringify(pose) &&
        last.markId === mId &&
        JSON.stringify(last.mark) === JSON.stringify(m) &&
        last.direction === directionNow
      ) {
        return prev;
      }
      const id = (last?.id ?? 0) + 1;
      return [...prev, { id, cameraId: cameraNow, pose, markId: mId, mark: m, direction: directionNow, label }].slice(-REVISIONS_MAX);
    });
  }

  function restoreRevision(r: Revision) {
    const api = apiRef.current;
    if (!api || shooting) return;
    api.goTo(r.pose);
    setFovDeg(r.pose.fovDeg);
    setCameraId(r.cameraId);
    setMarkId(r.markId);
    setMark(r.mark);
    setDirection(r.direction);
    setViewing(null);
    scheduleSave();
  }

  /**
   * The still: shot from the frame as it is, with what happens
   * (`directionNow` when send() knows it before state does), and every
   * message since the last still kept with it, as one.
   */
  async function shoot(directionNow?: string, push: RigCheckItem[] = []) {
    // Not during a match (pickReference says why): the frame would be taken
    // now, from a camera the match is about to move.
    if (shooting || matching || !characterId || !ready) return;
    setError("");
    setLastMiss(null);
    setLookDropped(false);
    setViewing(null);
    setMenu(null);
    const frame = apiRef.current?.frame();
    if (!frame) {
      setError(s.loadFailed);
      return;
    }
    setShooting(true);
    const startedAt = new Date().getTime();
    // The camera, the figure's mark (in the layout) and the canvas shape the
    // frame was just taken from: stored with the still as sent, they say
    // where its objects and its person are when it is a look.
    const pose = apiRef.current?.pose() ?? null;
    const canvasAspect = apiRef.current?.canvasAspect();
    // The messages this still answers, as one; the ref holds the one just
    // sent before state has caught up with it.
    const asked = pendingRef.current.length > 0 ? pendingRef.current.join("\n") : undefined;
    const said = directionNow ?? direction;
    const frameLabel = `${cameraLabel} · ${lensLabel} · ${markLabel}`;
    keepRevision(said, cameraId);
    let result: Awaited<ReturnType<typeof shootInSet>>;
    try {
      result = await shootInSet(setId, {
        frameDataUri: frame,
        characterId,
        direction: said,
        layout: { ...layoutRef.current, camera: pose },
        lifted: apiRef.current?.lifted === true,
        lookGenerationId: lookShot?.generationId ?? null,
        canvasAspect,
        words: asked,
        rig: rigRef.current,
        push,
      });
    } catch (err) {
      // The take may still be running on the server (a dropped connection
      // does not stop it); it lands in History either way.
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) setTimeout(() => window.location.reload(), 1800);
      return;
    } finally {
      setShooting(false);
    }
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    const shot: SetShot = {
      generationId: result.generationId,
      status: result.succeeded ? "succeeded" : "failed",
      resultUrl: result.resultUrl,
      viewUrl: result.resultUrl,
      posterUrl: null,
      kind: "still",
      seconds: null,
      score: result.score,
      createdAt: new Date().toISOString(),
      hasLookObjects: result.hasLookObjects,
      words: asked ?? null,
      format: result.format,
      rigAsked: result.checks,
      rigCheck: null,
      pose,
    };
    setShots((prev) => [shot, ...prev]);
    setShotFacts((prev) => ({ ...prev, [shot.generationId]: { seconds: Math.round((new Date().getTime() - startedAt) / 1000), frame: frameLabel } }));
    // The words now live with the still, above it.
    pendingRef.current = [];
    setPendingAsks([]);
    setNote(null);
    setLookDropped(result.lookDropped);
    if (!result.succeeded) setLastMiss(result.generationId);
    else if (canBeLook(shot) && !lookPinnedRef.current) setLookId(result.generationId);
    // The still takes the stage's place until the person goes back to the frame.
    if (result.succeeded) setViewing(result.generationId);
    // The rig check reads it back against what the rig asked for in words.
    if (result.succeeded && result.checks.length > 0) void runRigCheck(result.generationId);
  }

  /**
   * The rig check (rig-check.ts): the still read back from the picture
   * against each look its rig asked for, the verdicts kept with it. Never a
   * gate; a check that could not read the still says so, with a retry.
   */
  async function runRigCheck(generationId: string) {
    setRigChecking((prev) => ({ ...prev, [generationId]: "checking" }));
    let res: Awaited<ReturnType<typeof checkShotRig>>;
    try {
      res = await checkShotRig(setId, generationId);
    } catch {
      res = { error: "failed" };
    }
    if (res.error !== null) {
      setRigChecking((prev) => ({ ...prev, [generationId]: "failed" }));
      return;
    }
    const check: RigCheck | null = res.check;
    // No check and no error: nothing was kept to check it against (before
    // helios-rig.sql runs) — the line goes rather than offer a check that
    // cannot read anything.
    setShots((prev) =>
      prev.map((sh) => (sh.generationId === generationId ? (check ? { ...sh, rigCheck: check } : { ...sh, rigAsked: [] }) : sh)),
    );
    setRigChecking((prev) => {
      const next = { ...prev };
      delete next[generationId];
      return next;
    });
  }

  /**
   * A take (take.ts): the frame on the stage now is the END of the move —
   * shot first as an ordinary still with takeStart's still as its look, so
   * both frames show one world — then the clip renders between the two in
   * the background, and lands in the filmstrip as a take.
   */
  async function take(directionNow?: string) {
    if (!takeStart || shooting || matching || !characterId || !ready) return;
    setError("");
    setLastMiss(null);
    setViewing(null);
    setMenu(null);
    const frame = apiRef.current?.frame();
    if (!frame) {
      setError(s.loadFailed);
      return;
    }
    setShooting(true);
    const startedAt = new Date().getTime();
    const pose = apiRef.current?.pose() ?? null;
    const canvasAspect = apiRef.current?.canvasAspect();
    const asked = pendingRef.current.length > 0 ? pendingRef.current.join("\n") : undefined;
    const said = directionNow ?? direction;
    const frameLabel = `${cameraLabel} · ${lensLabel} · ${markLabel}`;
    keepRevision(said, cameraId);
    let result: Awaited<ReturnType<typeof takeInSet>>;
    try {
      result = await takeInSet(setId, {
        startGenerationId: takeStart.id,
        frameDataUri: frame,
        characterId,
        direction: said,
        layout: { ...layoutRef.current, camera: pose },
        engine: takeEngine,
        lifted: apiRef.current?.lifted === true,
        canvasAspect,
        words: asked,
        rig: rigRef.current,
      });
    } catch (err) {
      const stale = isStaleDeployError(err);
      setError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
      if (stale) setTimeout(() => window.location.reload(), 1800);
      return;
    } finally {
      setShooting(false);
    }
    if (result.error !== null) {
      setError(result.error);
      return;
    }
    const endStill: SetShot = {
      generationId: result.still.generationId,
      status: result.still.succeeded ? "succeeded" : "failed",
      resultUrl: result.still.resultUrl,
      viewUrl: result.still.resultUrl,
      posterUrl: null,
      kind: "still",
      seconds: null,
      score: result.still.score,
      createdAt: new Date().toISOString(),
      hasLookObjects: result.still.hasLookObjects,
      words: asked ?? null,
      format: result.still.format,
      rigAsked: result.still.checks,
      rigCheck: null,
      pose,
    };
    const rows: SetShot[] = result.takeGenerationId
      ? [
          {
            generationId: result.takeGenerationId,
            status: "generating",
            resultUrl: null,
            viewUrl: null,
            posterUrl: null,
            kind: "take",
            seconds: SET_TAKE_ENGINES[takeEngine].seconds,
            score: null,
            createdAt: new Date().toISOString(),
            hasLookObjects: false,
            words: asked ?? null,
            format: result.still.format,
            rigAsked: [],
            rigCheck: null,
            pose: null,
          },
          endStill,
        ]
      : [endStill];
    setShots((prev) => [...rows, ...prev]);
    setShotFacts((prev) => ({
      ...prev,
      [endStill.generationId]: { seconds: Math.round((new Date().getTime() - startedAt) / 1000), frame: frameLabel },
    }));
    pendingRef.current = [];
    setPendingAsks([]);
    setNote(null);
    setTakeStart(null);
    if (result.takeError) setError(result.takeError);
    if (result.still.succeeded) setViewing(result.takeGenerationId ?? result.still.generationId);
    if (result.still.succeeded && result.still.checks.length > 0) void runRigCheck(result.still.generationId);
  }

  // ---- the film's hands ----

  /** The view on the stage now becomes the next beat's end. */
  function filmAddKeyframe() {
    const pose = apiRef.current?.pose();
    if (!pose) return;
    editFilm((f) =>
      f.beats.length >= FILM_MAX_BEATS ? f : { ...f, beats: [...f.beats, { words: "", end: pose, move: null, textures: [] }] },
    );
    setFilmSel((n) => n ?? null);
  }

  /**
   * A move from the rig's library (moves.ts): the selected beat's end is
   * laid round the figure from where the beat starts — the keyframe before
   * it, or the stage as it stands for the first — and the stage flies it at
   * once, free. With no beat selected, the move becomes a new beat.
   */
  function filmMove(move: FilmMove) {
    const api = apiRef.current;
    // Not mid-flight: a pick then lays from where the last one is still
    // flying. Not while the film renders either: the move could not be kept.
    if (!api || previz || filmBusyRef.current) return;
    const at = filmSel !== null && film.beats[filmSel] ? filmSel : film.beats.length < FILM_MAX_BEATS ? film.beats.length : null;
    if (at === null) return;
    // Beat 1 starts where the film starts: the start still's own camera,
    // when it was recorded — never wherever the stage happens to be.
    const startPose = shots.find((sh) => sh.generationId === film.startId)?.pose ?? null;
    const from = at > 0 ? film.beats[at - 1].end : (startPose ?? api.pose());
    const m = layoutRef.current.mark;
    let end = api.roomFor(layMove(move, from, m, spec.bounds));
    // A dolly zoom stopped short by a wall re-solves its lens, so she still
    // keeps her size (moves.ts: distance × tan(fov / 2) is held).
    if (move === "dolly-zoom") {
      const size = Math.hypot(from.position[0] - m.x, from.position[2] - m.z) * Math.tan((from.fovDeg * Math.PI) / 360);
      const d = Math.hypot(end.position[0] - m.x, end.position[2] - m.z);
      if (d > 0.1) {
        const fov = (2 * Math.atan(size / d) * 180) / Math.PI;
        end = { ...end, fovDeg: Math.round(Math.min(SET_LIMITS.maxFovDeg, Math.max(SET_LIMITS.minLayoutFovDeg, fov)) * 100) / 100 };
      }
    }
    editFilm((f) => {
      const beats = [...f.beats];
      beats[at] = beats[at] ? { ...beats[at], end, move } : { words: "", end, move, textures: [] };
      return { ...f, beats };
    });
    setFilmSel(at);
    setPreviz(true);
    void tweenPose(api, from, end, 1400, move).then(() => {
      setPreviz(false);
      // The lens and the frame's words follow the stage to the beat's end.
      setFovDeg(end.fovDeg);
      setPoseNow(end);
    });
  }

  function filmTexture(texture: FilmTexture) {
    if (filmSel === null) return;
    editFilm((f) => ({
      ...f,
      beats: f.beats.map((b, i) =>
        i === filmSel ? { ...b, textures: b.textures.includes(texture) ? b.textures.filter((t) => t !== texture) : [...b.textures, texture] } : b,
      ),
    }));
  }

  function filmGoTo(i: number) {
    const b = film.beats[i];
    if (b) {
      apiRef.current?.goTo(b.end);
      setFovDeg(b.end.fovDeg);
      setPoseNow(b.end);
    }
    setFilmSel(i);
  }

  /** Fly the camera through the move — the previz, before a credit is spent. */
  async function playMove() {
    const api = apiRef.current;
    if (!api || previz || film.beats.length === 0) return;
    setPreviz(true);
    // The move flies from the start still's camera when it was recorded.
    const start = shots.find((sh) => sh.generationId === film.startId)?.pose ?? null;
    let from = start ?? api.pose();
    if (start) api.goTo(start);
    for (const beat of film.beats) {
      await tweenPose(api, from, beat.end, 1400, beat.move);
      from = beat.end;
    }
    setPreviz(false);
  }

  /**
   * What Render would do now (film.ts filmRenderPlan): the beats from the
   * first whose clip is gone or stale, opening on the still the beat before
   * closed on — nothing already paid for is rendered twice. With every beat
   * rendered, the button renders the whole film again, as a new take of it,
   * once its clips have landed. A film rendered with another person, rig,
   * mark or set renders from its start: its clips are of another film.
   */
  function filmPlanNow() {
    const context = filmContextKey({ characterId, rig, mark, setKey });
    const plan = filmRenderPlan(film, context, (id) => shots.find((sh) => sh.generationId === id)?.status ?? null);
    return { ...plan, context };
  }

  /**
   * Render the film: one take per beat, back to back — each beat's end
   * frame shot from its saved pose with the previous frame as its look, so
   * beat n opens on the exact frame beat n-1 closed on. Only what the film
   * needs (filmPlanNow): a beat whose end frame is finished renders its clip
   * alone, and from the first beat that needs a new end frame every beat
   * renders whole. A beat that fails stops the chain and says so;
   * everything already rendered is kept, in the filmstrip like any take.
   */
  async function renderFilm() {
    const api = apiRef.current;
    if (!api || filmBusy || shooting || !ready) return;
    if (!characterId || !film.startId) {
      setFilmError(s.filmNeedsStart);
      return;
    }
    if (film.beats.length === 0) return;
    setFilmError("");
    const plan = filmPlanNow();
    if (plan.again && plan.rendering) return;
    filmBusyRef.current = true;
    // The film as this render writes it, saved the moment each beat lands
    // rather than after the autosave's pause: a clip already paid for must
    // not be lost to a reload in between, or the next render pays again.
    // Nothing else edits the film meanwhile (filmBusyRef), so this copy is
    // it. From the first beat rendered whole, every beat is written afresh;
    // before it, the beats keep their end frames, and their clips unless a
    // job renders one again.
    const wholeFrom = plan.jobs.find((j) => j.end === null)?.beat ?? film.beats.length;
    const upTo = <T,>(xs: (T | null)[], n: number): (T | null)[] => {
      const out = xs.slice(0, n);
      while (out.length < n) out.push(null);
      return out;
    };
    let kept: SetFilm = { ...film, context: plan.context, clips: film.clips.slice(0, wholeFrom), ends: film.ends.slice(0, wholeFrom) };
    const keep = (next: SetFilm) => {
      kept = next;
      setFilm(next);
      void saveSetFilm(setId, next).then((r) => {
        if (r.error) setFilmError(r.error);
      });
    };
    keep(kept);
    setReel(null);
    setViewing(null);
    for (const job of plan.jobs) {
      const i = job.beat;
      const beat = film.beats[i];
      // A beat opens on the frame the one before it closed on, as this render left it.
      const startId = i === 0 ? film.startId : kept.ends[i - 1];
      if (!beat || !startId) break;
      setFilmBusy({ beat: i, clipOnly: job.end !== null });
      // Only a beat rendered whole shoots a frame; a clip alone ends on its own.
      const frame = job.end ? "" : api.frame({ from: beat.end });
      if (frame === null) {
        setFilmError(s.loadFailed);
        break;
      }
      let result: Awaited<ReturnType<typeof takeInSet>>;
      try {
        result = await takeInSet(setId, {
          startGenerationId: startId,
          endGenerationId: job.end,
          frameDataUri: frame,
          characterId,
          direction: beat.words,
          layout: { ...layoutRef.current, camera: beat.end },
          engine: film.engine,
          lifted: api.lifted === true,
          canvasAspect: api.canvasAspect(),
          rig: rigRef.current,
          move: beat.move,
          textures: beat.textures,
        });
      } catch (err) {
        const stale = isStaleDeployError(err);
        setFilmError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
        if (stale) setTimeout(() => window.location.reload(), 1800);
        break;
      }
      if (result.error !== null) {
        setFilmError(result.error);
        // The end frame it would have ended on is gone: the next render
        // shoots the beat whole.
        if (job.end && result.error === SET_TAKE_BAD_END) {
          const ends = [...kept.ends];
          ends[i] = null;
          keep({ ...kept, ends });
        }
        break;
      }
      const takeRow: SetShot | null = result.takeGenerationId
        ? {
            generationId: result.takeGenerationId,
            status: "generating",
            resultUrl: null,
            viewUrl: null,
            posterUrl: null,
            kind: "take",
            seconds: SET_TAKE_ENGINES[film.engine].seconds,
            score: null,
            createdAt: new Date().toISOString(),
            hasLookObjects: false,
            words: beat.words || null,
            format: result.still.format,
            rigAsked: [],
            rigCheck: null,
            pose: null,
          }
        : null;
      if (result.reusedEnd) {
        // The clip alone: its end frame is the beat's own, already in the set.
        if (takeRow) setShots((prev) => [takeRow, ...prev]);
        const clips = upTo(kept.clips, Math.max(kept.clips.length, i + 1));
        clips[i] = result.takeGenerationId;
        keep({ ...kept, clips });
      } else {
        const endStill: SetShot = {
          generationId: result.still.generationId,
          status: result.still.succeeded ? "succeeded" : "failed",
          resultUrl: result.still.resultUrl,
          viewUrl: result.still.resultUrl,
          posterUrl: null,
          kind: "still",
          seconds: null,
          score: result.still.score,
          createdAt: new Date().toISOString(),
          hasLookObjects: result.still.hasLookObjects,
          words: beat.words || null,
          format: result.still.format,
          rigAsked: result.still.checks,
          rigCheck: null,
          pose: beat.end,
        };
        setShots((prev) => [...(takeRow ? [takeRow] : []), endStill, ...prev]);
        // Kept on the film, so the reel is still there after the page closes
        // and a later render can open on this beat's end.
        keep({
          ...kept,
          clips: [...upTo(kept.clips, i), result.takeGenerationId],
          ends: [...upTo(kept.ends, i), result.still.succeeded ? result.still.generationId : null],
        });
      }
      if (!result.still.succeeded || result.takeGenerationId === null) {
        setFilmError(result.takeError ?? s.filmBeatFailed);
        break;
      }
    }
    filmBusyRef.current = false;
    setFilmBusy(null);
  }

  // ---- the conversation ----

  /**
   * What the words ask for, done to the stage: the mark, a named camera or
   * a camera solved from the side, size, height, tilt and lens (shot-words.ts
   * wordsToMatch, then the same solve and placing a matched shot gets), the
   * way the figure faces, and what happens. Returns how the camera had to
   * move round something built, or null when it did not move at all.
   */
  function applyWords(words: ShotWords): CameraMove | null {
    const api = apiRef.current;
    if (!api) return null;
    let m: Mark = layoutRef.current.mark;
    let mId = layoutRef.current.markId;
    if (words.markId) {
      const picked = spec.marks.find((x) => x.id === words.markId);
      if (picked) {
        m = { x: picked.x, z: picked.z, facingDeg: picked.facingDeg };
        mId = words.markId;
        setMarkId(words.markId);
        setMark(m);
        // The figure now, not after the render: the camera is placed against
        // where it stands (matchTo reads the stand-in's own position).
        api.placeMark(m);
      }
    }
    let moved: CameraMove | null = null;
    let cameraNow: string | null = cameraId;
    if (words.cameraId) {
      pickCamera(words.cameraId);
      cameraNow = words.cameraId;
      if (words.lensMm) pickLens(words.lensMm);
    } else if (hasCameraWords(words)) {
      const { match, from } = wordsToMatch(words, { mark: m, current: api.pose() });
      const solved = solveMatchPose(match, {
        mark: m,
        current: from,
        // The frame is the square: its shorter side is its whole side.
        referenceAspect: 1,
        bounds: spec.bounds,
        canvasAspect: api.canvasAspect(),
      });
      moved = api.matchTo(solved.pose);
      cameraNow = null;
      setFovDeg(solved.pose.fovDeg);
      setCameraId(null);
      scheduleSave();
    }
    if (words.facing) {
      const facingDeg = facingFor(words.facing, m, api.pose());
      m = { ...m, facingDeg };
      setMark(m);
    }
    const directionNow = words.direction || direction;
    if (words.direction) setDirection(words.direction);
    // The frame Astra set, kept to step back to: the mark as it will be
    // after the render, the camera as it stands now.
    layoutRef.current = { markId: mId, mark: m };
    keepRevision(directionNow, cameraNow);
    return moved;
  }

  /** The card picture follows an edit: camera 1, no figure, a frame after the rebuild settles. */
  function refreshThumbnail(next: SetSpec) {
    requestAnimationFrame(() => {
      const one = next.cameras[0];
      const thumb = apiRef.current?.snapshot(SET_THUMB_PX, {
        hideFigure: true,
        from: { position: one.position, target: one.target, fovDeg: one.fovDeg },
      });
      if (thumb) void saveSetThumbnail(setId, thumb);
    });
  }

  /**
   * Words about the place itself — "make the barriers brick red", "now
   * golden hour" — handed to Astra, which edits the set's data server-side
   * (editor-actions.ts, gated like a build) and hands the revised set back.
   * The stage rebuilds under the camera; the line under the frame says how
   * many pieces changed, with Undo beside it. The Build editor's tools and
   * Astra's original stay one press away for anything by hand.
   */
  async function editSet(message: string) {
    setEditingSet(true);
    const before = spec;
    const res = await editSetWithAstra(setId, message);
    setEditingSet(false);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    specBeforeEditRef.current = before;
    setSpec(res.spec);
    drawSet(res.spec);
    setSetChanged(res.changed);
    refreshThumbnail(res.spec);
  }

  /** The changed line's Undo: the set as it stood before the last Astra edit, saved back. */
  async function undoSetEdit() {
    const before = specBeforeEditRef.current;
    if (!before) return;
    specBeforeEditRef.current = null;
    setSetChanged(null);
    setSpec(before);
    drawSet(before);
    refreshThumbnail(before);
    await saveSetEdit(setId, before);
  }

  /**
   * A message from the composer, or the one carried from the Sets home: read
   * into a frame (readShotWords), done to the stage, and shot at once when
   * the words say so or Astra is not asked to wait.
   */
  async function send(text: string) {
    const message = text.trim();
    if (!message || reading || shooting || editingSet || !ready) return;
    setError("");
    setDraft("");
    setMentionForced(false);
    setViewing(null);
    setSetChanged(null);
    pendingRef.current = [...pendingRef.current, message];
    setPendingAsks(pendingRef.current);
    setNote(null);
    setReading(true);
    let words: ShotWords | null = null;
    try {
      const res = await readShotWords(setId, { text: message });
      if (res.error !== null) setError(res.error);
      else words = res.words;
    } catch (err) {
      const stale = isStaleDeployError(err);
      if (stale) {
        setError(t.generate.refreshNeeded);
        setTimeout(() => window.location.reload(), 1800);
        setReading(false);
        return;
      }
      // The reader is down: the words are what happens, and the frame is as it was.
    } finally {
      setReading(false);
    }
    // Just talking (3D Jutsu's ask-only mode): the words are read and
    // answered, but nothing moves and nothing is spent.
    if (justTalk) {
      setNote({ fallback: !words, talk: words?.intent === "talk", moved: null, planned: true });
      return;
    }
    if (!words) {
      setDirection(message);
      setNote({ fallback: true, talk: false, moved: null });
      keepRevision(message, cameraId);
      if (!askFirst) await (takeStart ? take(message) : shoot(message));
      return;
    }
    // Words about the place itself go to Astra, which edits the set.
    if (words.intent === "edit") {
      await editSet(message);
      return;
    }
    if (words.intent === "talk" && !words.direction && !hasCameraWords(words) && !words.markId && !words.facing) {
      setNote({ fallback: false, talk: true, moved: null });
      return;
    }
    const moved = applyWords(words);
    setNote({ fallback: false, talk: false, moved: moved && moved !== "none" ? moved : null });
    if (words.intent === "shoot" || !askFirst) await (takeStart ? take(words.direction || message) : shoot(words.direction || message));
  }

  // The message from the Sets home, once the stage can act on it — then the
  // address forgets it, so a reload does not ask again.
  useEffect(() => {
    if (!ready || !initialAsk || askedRef.current) return;
    askedRef.current = true;
    const url = new URL(window.location.href);
    for (const key of ["ask", "character", "askFirst"]) url.searchParams.delete(key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    void send(initialAsk);
    // send reads the latest state through closures; it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initialAsk]);

  // The thread grows downward; the newest turn is what the person is waiting for.
  useEffect(() => {
    if (pendingAsks.length === 0 && !shooting) return;
    threadEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [pendingAsks, shooting, shots.length]);

  // Esc steps out, the way 3D Jutsu's Esc leaves a camera view: an open
  // menu first, then the still viewer, back to the frame.
  useEffect(() => {
    menuRef.current = menu;
  }, [menu]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      if (menuRef.current) setMenu(null);
      else setViewing(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // K keeps the view on the stage as the next beat's end, while the film
  // dock is open — Blender's key, doing Blender's job.
  useEffect(() => {
    if (!filmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "k" && e.key !== "K") return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) return;
      const pose = apiRef.current?.pose();
      if (!pose) return;
      editFilm((f) =>
        f.beats.length >= FILM_MAX_BEATS ? f : { ...f, beats: [...f.beats, { words: "", end: pose, move: null, textures: [] }] },
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filmOpen, editFilm]);

  // The move autosaves like the editor's working copy — a beat after the
  // hands stop. The first run is the loaded film itself, not an edit.
  const filmLoadedRef = useRef(false);
  useEffect(() => {
    if (!filmLoadedRef.current) {
      filmLoadedRef.current = true;
      return;
    }
    const id = setTimeout(() => {
      void saveSetFilm(setId, film).then((r) => {
        if (r.error) setFilmError(r.error);
      });
    }, 1200);
    return () => clearTimeout(id);
  }, [film, setId]);

  // The reel: the clip whose turn it is plays, the others wait, loaded. A
  // browser that will not start a clip by itself gets a tap to go on.
  useEffect(() => {
    if (reel === null) return;
    reelVideosRef.current.forEach((video, i) => {
      if (!video) return;
      if (i === reel) void video.play().catch(() => setReelWaiting(true));
      else video.pause();
    });
  }, [reel]);

  // A take still rendering is watched, not waited on: while any kind:"take"
  // row is generating — a film's beat or an ordinary take — the page asks
  // after it every few seconds and the row turns into the clip in place.
  const generatingKey = shots
    .filter((sh) => sh.kind === "take" && sh.status === "generating")
    .map((sh) => sh.generationId)
    .join(",");
  useEffect(() => {
    if (!generatingKey) return;
    const ids = generatingKey.split(",");
    const timer = setInterval(() => {
      void readTakes(setId, ids).then((r) => {
        if (r.error !== null) return;
        const byId = new Map(r.takes.map((tk) => [tk.id, tk]));
        setShots((prev) =>
          prev.map((sh) => {
            const tk = sh.kind === "take" ? byId.get(sh.generationId) : undefined;
            return tk && tk.status !== sh.status
              ? { ...sh, status: tk.status, resultUrl: tk.resultUrl, posterUrl: tk.posterUrl }
              : sh;
          }),
        );
      });
    }, 8000);
    return () => clearInterval(timer);
  }, [generatingKey, setId]);

  /**
   * The frame as a picture on disk — 3D Jutsu's static-frame export. Cut to
   * the frame lines, because the frame lines are the picture: the still that
   * comes back is cut there too (frame-cut.ts), so a Scope frame downloads
   * as the 2.39 : 1 band it was composed in and not the 3:2 the model draws.
   */
  function downloadFrame() {
    const shot = apiRef.current?.frame({ cut: true });
    if (!shot) return;
    const a = document.createElement("a");
    a.href = shot;
    a.download = `${(title || "set").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-frame.jpg`;
    a.click();
  }

  /** Another angle: the set's next camera, in the same frame. */
  function anotherAngle() {
    if (!ready || shooting) return;
    const at = spec.cameras.findIndex((c) => c.id === cameraId);
    const next = spec.cameras[(at + 1) % spec.cameras.length];
    pickCamera(next.id);
    setViewing(null);
    pendingRef.current = [...pendingRef.current, s.anotherAngle];
    setPendingAsks(pendingRef.current);
    setNote({ fallback: false, talk: false, moved: null });
    keepRevision(direction, next.id);
  }

  // ---- the composer's who menu: "@" in the words, or the chip ----
  const mentionMatch = /(?:^|\s)@([^\s@]*)$/.exec(draft);
  const mentionQuery = mentionForced ? "" : (mentionMatch?.[1] ?? null);
  const mentionOpen = characters.length > 0 && mentionQuery !== null;
  const mentionList = mentionOpen ? characters.filter((c) => c.name.toLowerCase().startsWith(mentionQuery.toLowerCase())) : [];

  function pickMention(c: SetCharacter) {
    setCharacterId(c.id);
    if (mentionMatch) setDraft(draft.replace(/(^|\s)@[^\s@]*$/, "$1"));
    setMentionForced(false);
    draftRef.current?.focus();
  }

  const chip = (active: boolean) =>
    `flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${
      active
        ? "bg-[rgba(224,164,104,0.15)] text-[#f0cda6] shadow-[inset_0_0_0_1px_rgba(240,196,142,0.5)]"
        : "bg-white/[0.06] text-[#9aa0ad] hover:bg-white/[0.1] hover:text-[#ecedf1]"
    }`;
  const glassBtn =
    "inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-onmedia/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-onmedia transition-colors hover:bg-black/75";
  // Which way the figure faces, as the camera sees it: toward it, away from
  // it, or to the picture's left or right (shot-words.ts facingFor's rule,
  // read back).
  const facingLabel = (() => {
    const bearing = Math.atan2(poseNow.position[0] - mark.x, poseNow.position[2] - mark.z) / DEG;
    const d = ((((mark.facingDeg - bearing) % 360) + 540) % 360) - 180;
    if (Math.abs(d) <= 45) return s.facingCamera;
    if (Math.abs(d) >= 135) return s.facingAway;
    return d > 0 ? s.facingRight : s.facingLeft;
  })();
  const placedLine = formatMsg(s.placedLine, { name: characterName, mark: markLabel, facing: facingLabel, camera: cameraLabel, lens: lensLabel });
  const credits = quote.totalCredits === 1 ? s.creditsOne : formatMsg(s.creditsMany, { n: quote.totalCredits });
  // A take's whole price: the end still plus the clip, as the server charges them.
  const takeCredits = quote.totalCredits + quoteSend(takeQuoteInput(takeEngine)).totalCredits;
  // What Render would render now, and its price: every beat is one take —
  // an end frame and a clip — priced by the same quotes the server charges.
  const filmPlan = filmPlanNow();
  const clipCredits = quoteSend(takeQuoteInput(film.engine)).totalCredits;
  const filmCredits = filmPlan.jobs.reduce((sum, job) => sum + clipCredits + (job.end ? 0 : quote.totalCredits), 0);
  const filmWholeFrom = filmPlan.jobs.every((job) => job.end === null) ? (filmPlan.jobs[0]?.beat ?? 0) : null;
  const filmRenderLabel = filmBusy
    ? formatMsg(filmBusy.clipOnly ? s.filmRenderingClip : s.filmRendering, { i: filmBusy.beat + 1, n: film.beats.length })
    : filmPlan.again
      ? filmPlan.rendering
        ? s.filmClipsRendering
        : formatMsg(s.filmRenderAgain, { n: filmCredits })
      : filmWholeFrom === null
        ? formatMsg(s.filmRenderMissing, { n: filmCredits })
        : filmWholeFrom > 0
          ? formatMsg(s.filmRenderFrom, { b: filmWholeFrom + 1, n: filmCredits })
          : formatMsg(s.filmRender, { n: filmCredits });
  // The reel plays the clips the film remembers (film.clips), so a film
  // rendered on an earlier visit can be watched again — the beats' rows are
  // the set's own shots either way.
  const filmClipShots = film.clips.map((id) => (id ? (shots.find((sh) => sh.generationId === id) ?? null) : null));
  const reelReady = filmRendered(film) && filmClipShots.every((sh) => sh !== null && sh.status === "succeeded" && Boolean(sh.resultUrl));
  const reelShots = reelReady ? (filmClipShots as SetShot[]) : [];
  const filmStartShot = film.startId ? (shots.find((sh) => sh.generationId === film.startId) ?? null) : null;
  const filmStartOptions = shots.filter((sh) => sh.kind === "still" && sh.status === "succeeded");
  const scaleWarn = Boolean(sourcePhotoUrl) && !scaleDismissed && ready && oversizedSeating(spec);
  const shootLabel = shooting
    ? s.shooting
    : quote.totalCredits === 1
      ? s.shootButtonOne
      : formatMsg(s.shootButton, { n: quote.totalCredits });
  const frameLead = note?.planned
    ? s.justTalkNote
    : note?.talk
      ? s.talkReply
      : [note?.fallback ? s.wordsFallback : null, note?.moved ? formatMsg(s.frameLineMoved, { name: characterName }) : null]
          .filter(Boolean)
          .join(" ");
  const frameNumber = revisions[revisions.length - 1]?.id ?? 1;

  // ---- the rig check, said and shown (rig-check.ts) ----
  const rigCheckedLine = (check: RigCheck) => {
    const landed = check.verdicts.filter((v) => v.landed).length;
    return landed === check.verdicts.length ? s.rig.checkedAllLine : formatMsg(s.rig.checkedLine, { n: landed, m: check.verdicts.length });
  };
  const rigCheckCard = (shot: SetShot, frameWords: string | null) => {
    if (shot.kind !== "still" || shot.status !== "succeeded" || shot.rigAsked.length === 0 || rigCheckDismissed[shot.generationId]) return null;
    const state = rigChecking[shot.generationId];
    const check = shot.rigCheck;
    if (!check) {
      return (
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-white/[0.05] px-3.5 py-3 text-xs text-[#9aa0ad] ring-1 ring-white/[0.07]">
          {state === "checking" ? (
            <>
              <Spinner className="h-3.5 w-3.5 flex-shrink-0" />
              {s.rig.checking}
            </>
          ) : (
            <>
              <span className="text-[11px] font-medium uppercase tracking-widest">{s.rig.checkTitle}</span>
              {state === "failed" && <span>{t.serverText.setRigCheckFailed}</span>}
              <button type="button" onClick={() => void runRigCheck(shot.generationId)} className="cursor-pointer font-medium text-[#e0a468] hover:underline">
                {s.rig.checkRetry}
              </button>
            </>
          )}
        </div>
      );
    }
    const missed = check.verdicts.filter((v) => !v.landed).map((v) => v.item);
    const landed = check.verdicts.length - missed.length;
    const againLabel =
      missed.length === 1
        ? formatMsg(s.rig.checkAgainOne, { look: s.rig.checkItems[missed[0]].toLowerCase(), credits })
        : formatMsg(s.rig.checkAgainMany, { n: missed.length, credits });
    return (
      <div className="space-y-3 rounded-[14px] bg-white/[0.05] p-3.5 ring-1 ring-white/[0.07]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0ad]">{s.rig.checkTitle}</span>
          <span className="text-xs tabular-nums text-[#ecedf1]">
            {missed.length === 0 ? s.rig.checkAll : formatMsg(s.rig.checkLanded, { n: landed, m: check.verdicts.length })}
          </span>
        </div>
        <ul className="space-y-2.5">
          {check.verdicts.map((v) => (
            <li key={v.item} className="grid grid-cols-[18px_minmax(0,1fr)] gap-x-2.5">
              <span
                aria-hidden
                className={`mt-px flex h-[18px] w-[18px] items-center justify-center rounded-full ${
                  v.landed ? "bg-[rgba(95,158,110,0.18)] text-[#7fc08f]" : "bg-[rgba(224,164,104,0.18)] text-[#f0cda6]"
                }`}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" className="h-[11px] w-[11px]">
                  {v.landed ? <path d="M5 12.5l4.5 4.5L19 7.5" /> : <path d="M7 7l10 10M17 7L7 17" />}
                </svg>
              </span>
              <span className={`text-[13px] leading-[18px] ${v.landed ? "text-[#ecedf1]" : "text-[#f0cda6]"}`}>
                {s.rig.checkItems[v.item]}
                {v.evidence && <span className="block text-xs leading-[17px] text-[#9aa0ad]">{v.evidence}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="flex flex-wrap items-center gap-2 border-t border-white/[0.07] pt-2.5 text-xs text-[#9aa0ad]">
          <span className="inline-flex h-[18px] items-center whitespace-nowrap rounded-full bg-[rgba(224,164,104,0.08)] px-2 text-[10px] font-medium text-[#e3c9a6] shadow-[inset_0_0_0_1px_rgba(224,164,104,0.25)]">
            {s.rig.held}
          </span>
          {frameWords ? `${s.rig.formats[shot.format]} · ${frameWords}` : formatMsg(s.rig.checkHeld, { format: s.rig.formats[shot.format] })}
        </p>
        <div className="flex flex-wrap items-center gap-3">
          {missed.length > 0 && (
            <button
              type="button"
              onClick={() => void shoot(undefined, missed)}
              disabled={shooting || matching || !characterId || !ready || Boolean(takeStart)}
              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-[8px] bg-[#e0a468] px-3.5 text-[13px] font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {againLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => setRigCheckDismissed((prev) => ({ ...prev, [shot.generationId]: true }))}
            className="cursor-pointer text-[13px] font-medium text-[#9aa0ad] hover:text-[#ecedf1]"
          >
            {s.rig.checkDismiss}
          </button>
        </div>
        <p className="text-[11px] leading-[15px] text-[#6b6f7a]">{s.rig.checkNote}</p>
      </div>
    );
  };

  // ---- the rig, in words and on the stage ----
  const rigPalette = findLook(RIG_PALETTES, rig.palette);
  const gradeFilter = rig.gradeStage && rigPalette ? rigPalette.filter : null;
  const gradeTint = rig.gradeStage && rigPalette ? rigPalette.tint : null;
  const stopLabel = rig.stop !== null ? `f/${rig.stop}` : null;
  const rigChipLabel = [s.rig.chip, s.rig.formats[rig.format], lensLabel, stopLabel].filter(Boolean).join(" · ");
  const rigLooksLine = [rig.stock ? s.rig.stocks[rig.stock] : null, rig.lens ? s.rig.lenses[rig.lens] : null, stopLabel]
    .filter(Boolean)
    .join(" · ");
  // Camera to the figure's eyes, and the bearing the light plot and the
  // schemes are reckoned from — as the camera stood when it last settled.
  const eyeDistance = Math.hypot(poseNow.position[0] - mark.x, poseNow.position[1] - 1.5, poseNow.position[2] - mark.z);
  const cameraBearing = bearingDeg(mark, { x: poseNow.position[0], z: poseNow.position[2] });
  /** The format a shot was cut to, said beside it (the square says nothing). */
  const formatNote = (shot: SetShot) => (shot.format !== "square" ? s.rig.formats[shot.format] : null);
  /** A take whose frames were cut wider or squarer than the 16:9 it renders at: the band it plays inside. */
  const takeBand = (shot: SetShot) =>
    shot.kind === "take" && (shot.format === "scope" || shot.format === "flat" || shot.format === "classic") ? formatFrame(shot.format).bandAspect : null;
  // Oldest first: the thread reads down to the frame.
  const thread = [...shots].reverse();
  const viewingAt = viewing ? shots.findIndex((x) => x.generationId === viewing) : -1;
  const viewingShot = viewingAt >= 0 ? shots[viewingAt] : null;
  const stillLine = (shot: SetShot) => {
    const low = shot.score !== null && shot.score < identityBar;
    return shot.status !== "succeeded"
      ? s.stillFailed
      : shot.score === null
        ? s.stillUnscored
        : formatMsg(low ? s.stillBelow : s.stillAbove, { score: shot.score, bar: identityBar });
  };
  const stillNumber = (shot: SetShot) => {
    const same = shots.filter((x) => x.kind === shot.kind);
    return same.length - same.findIndex((x) => x.generationId === shot.generationId);
  };
  const tile = (active: boolean) =>
    `relative h-16 w-16 flex-shrink-0 cursor-pointer overflow-hidden rounded-[10px] bg-black/60 transition-shadow ${
      active ? "ring-2 ring-[#e0a468]" : "ring-1 ring-white/15 hover:ring-white/40"
    }`;
  const toggleMenu = (id: MenuId) => setMenu((m) => (m === id ? null : id));

  // One set of options each, shared by the toolbar's dropdowns and the
  // pill's keys — the same picks, wherever the menu opened.
  const cameraOptions = (
    <>
      {spec.cameras.map((c, i) => (
        <Option
          key={c.id}
          active={cameraId === c.id}
          onPick={() => {
            pickCamera(c.id);
            setMenu(null);
          }}
        >
          {c.label || formatMsg(s.cameraN, { n: i + 1 })}
        </Option>
      ))}
      {cameraId === null && (
        <Option active onPick={() => setMenu(null)}>
          {s.yourCamera}
        </Option>
      )}
    </>
  );
  const figureOptions = spec.marks.map((m, i) => (
    <Option
      key={m.id}
      active={markId === m.id}
      onPick={() => {
        pickMark(m.id);
        setMenu(null);
      }}
    >
      {m.label || formatMsg(s.markN, { n: i + 1 })}
    </Option>
  ));
  const historyOptions = [...revisions].reverse().map((r) => (
    <Option
      key={r.id}
      active={r.id === frameNumber}
      hint={r.label}
      onPick={() => {
        restoreRevision(r);
        setMenu(null);
      }}
    >
      {formatMsg(s.revisionN, { n: r.id })}
    </Option>
  ));
  const modeOptions = (
    <>
      <Option
        active={askFirst && !justTalk}
        onPick={() => {
          setAskFirst(true);
          setJustTalk(false);
          setMenu(null);
        }}
      >
        {s.askBeforeShooting}
      </Option>
      <Option
        active={!askFirst && !justTalk}
        onPick={() => {
          setAskFirst(false);
          setJustTalk(false);
          setMenu(null);
        }}
      >
        {s.shootWithoutAsking}
      </Option>
      <Option
        active={justTalk}
        onPick={() => {
          setJustTalk(true);
          setMenu(null);
        }}
      >
        {s.justTalking}
      </Option>
    </>
  );

  return (
    <div data-set-workspace className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#101116] text-[#c6c9d1]">
      {(menu || mentionForced) && (
        <div
          className="fixed inset-0 z-20"
          onClick={() => {
            setMenu(null);
            setMentionForced(false);
          }}
          aria-hidden
        />
      )}

      {/* The workspace's own bar: where you are, the set's two lives, History and the frame on disk. */}
      <div className="flex h-12 flex-none items-center gap-3 border-b border-white/[0.07] bg-[#191a20] px-3.5">
        <Link href="/app/sets" className="whitespace-nowrap text-xs font-medium text-[#9aa0ad] hover:text-[#ecedf1]">
          ← {s.back}
        </Link>
        <span aria-hidden className="h-5 w-px bg-white/[0.09]" />
        <h1 className="min-w-0 truncate font-display text-[14px] font-semibold text-[#ecedf1]">{title || s.untitled}</h1>
        <span className="hidden whitespace-nowrap text-[11px] tabular-nums text-[#6b6f7a] sm:inline">
          {shots.length === 1 ? s.shotsOne : formatMsg(s.shotsMany, { n: shots.length })}
        </span>
        <span className="flex-1" />
        <span className="hidden h-7 items-center gap-0.5 rounded-[6px] bg-white/[0.05] p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)] sm:flex">
          <Link
            href={`/app/sets/${setId}?build=1`}
            className="flex h-6 cursor-pointer items-center rounded-[4px] px-3.5 text-[12px] font-medium text-[#9aa0ad] hover:text-[#ecedf1]"
          >
            {s.editorBuildTab}
          </Link>
          <button
            type="button"
            onClick={() => {
              setFilmOpen(false);
              setReel(null);
              window.history.replaceState(null, "", `/app/sets/${setId}`);
            }}
            className={
              filmOpen
                ? "flex h-6 cursor-pointer items-center rounded-[4px] px-3.5 text-[12px] font-medium text-[#9aa0ad] hover:text-[#ecedf1]"
                : "flex h-6 items-center rounded-[4px] bg-[#2a2b33] px-3.5 text-[12px] font-medium text-[#e0a468] shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
            }
            aria-current={filmOpen ? undefined : "page"}
          >
            {s.editorShootTab}
          </button>
          <button
            type="button"
            onClick={() => {
              setFilmOpen(true);
              setTakeStart(null);
              setViewing(null);
              window.history.replaceState(null, "", `/app/sets/${setId}?film=1`);
            }}
            className={
              filmOpen
                ? "flex h-6 items-center rounded-[4px] bg-[#2a2b33] px-3.5 text-[12px] font-medium text-[#e0a468] shadow-[0_1px_2px_rgba(0,0,0,0.3)]"
                : "flex h-6 cursor-pointer items-center rounded-[4px] px-3.5 text-[12px] font-medium text-[#9aa0ad] hover:text-[#ecedf1]"
            }
            aria-current={filmOpen ? "page" : undefined}
          >
            {s.filmTab}
          </button>
        </span>
        <span className="flex-1" />
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu("history")}
            aria-haspopup="listbox"
            aria-expanded={menu === "history"}
            disabled={revisions.length < 2}
            className="flex h-8 cursor-pointer items-center gap-1.5 rounded-[6px] px-2.5 text-xs font-medium text-[#9aa0ad] hover:text-[#ecedf1] disabled:cursor-default disabled:opacity-40"
          >
            {s.historyLabel} · {formatMsg(s.revisionN, { n: frameNumber })}
            <Chevron />
          </button>
          {menu === "history" && (
            <div role="listbox" aria-label={s.historyLabel} className={DMENU_RIGHT}>
              {historyOptions}
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={downloadFrame}
          disabled={!ready}
          title={s.downloadFrame}
          aria-label={s.downloadFrame}
          className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-[6px] text-[#9aa0ad] hover:text-[#ecedf1] disabled:cursor-default disabled:opacity-40"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 19h16" />
          </svg>
        </button>
      </div>

      {/* The viewport, with everything floating on it. */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="absolute inset-0" style={gradeFilter ? { filter: gradeFilter } : undefined} />
          {/* the palette's grade, previewed over the stage (never the sketch) */}
          {gradeTint && <div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: gradeTint }} />}
          <div
            ref={guideRef}
            aria-hidden
            className={`pointer-events-none absolute rounded-[2px] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline outline-1 outline-white/45 ${viewingShot ? "hidden" : ""}`}
          />
          {loadFailed && !viewingShot && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#101116]/90 p-6 text-center text-sm text-onmedia/80">{s.loadFailed}</div>
          )}

          {/* The setup, as chips on the picture itself. */}
          {!viewingShot && (
            <div
              className={`absolute left-3.5 top-3.5 z-20 flex flex-wrap items-center gap-2 right-3.5 ${rigOpen ? "md:left-[356px]" : ""} ${
                chatOpen ? "md:right-[404px]" : "md:right-24"
              }`}
            >
              <div className="relative">
                <button
                  type="button"
                  onClick={() => toggleMenu("who")}
                  aria-haspopup="listbox"
                  aria-expanded={menu === "who"}
                  disabled={characters.length === 0}
                  title={s.mentionHint}
                  className={`${DCHIP} pl-1.5`}
                >
                  {character?.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={character.thumbUrl} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-white/25" />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-white/15" />
                  )}
                  {character?.name || s.characterLabel}
                  <Chevron />
                </button>
                {menu === "who" && (
                  <div role="listbox" aria-label={s.mentionTitle} className={DMENU}>
                    {characters.map((c) => (
                      <Option
                        key={c.id}
                        active={characterId === c.id}
                        onPick={() => {
                          setCharacterId(c.id);
                          setMenu(null);
                        }}
                      >
                        {c.name}
                      </Option>
                    ))}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => pickLook(lookShot ? null : latestStill)}
                aria-pressed={Boolean(lookShot)}
                disabled={!lookShot && !latestStill}
                title={lookShot ? s.lookOn : latestStill ? s.lookUseLatest : s.lookFirst}
                className={lookShot ? DCHIP_ON : DCHIP}
              >
                {s.lookLabel} · {lookShot ? <LocalDate date={lookShot.createdAt} /> : s.lookOff}
              </button>
              <div className="relative">
                <button type="button" onClick={() => toggleMenu("camera")} aria-haspopup="listbox" aria-expanded={menu === "camera"} disabled={!ready} className={DCHIP}>
                  {cameraLabel}
                  <Chevron />
                </button>
                {menu === "camera" && (
                  <div role="listbox" aria-label={s.toolbarCamera} className={DMENU}>
                    {cameraOptions}
                  </div>
                )}
              </div>
              <button
                type="button"
                onClick={() => setRigOpen((v) => !v)}
                aria-pressed={rigOpen}
                aria-expanded={rigOpen}
                disabled={!ready}
                className={rigOpen ? DCHIP_ON : DCHIP}
              >
                {rigChipLabel}
                <Chevron />
              </button>
              {spec.marks.length > 1 && (
                <div className="relative">
                  <button type="button" onClick={() => toggleMenu("figure")} aria-haspopup="listbox" aria-expanded={menu === "figure"} disabled={!ready} className={DCHIP}>
                    {markLabel}
                    <Chevron />
                  </button>
                  {menu === "figure" && (
                    <div role="listbox" aria-label={s.toolbarFigure} className={DMENU}>
                      {figureOptions}
                    </div>
                  )}
                </div>
              )}
              <button type="button" onClick={() => turn(-TURN_STEP)} disabled={!ready} aria-label={s.turnLeft} title={s.turnLeft} className={`${DCHIP} w-8 justify-center px-0`}>
                ↺
              </button>
              <button type="button" onClick={() => turn(TURN_STEP)} disabled={!ready} aria-label={s.turnRight} title={s.turnRight} className={`${DCHIP} w-8 justify-center px-0`}>
                ↻
              </button>
              <button type="button" onClick={frameFigure} disabled={!ready} className={DCHIP}>
                {s.frameFigure}
              </button>
              {matchOn && (
                <>
                  <input
                    ref={matchFileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      // Cleared, so choosing the same picture again still counts as a choice.
                      e.target.value = "";
                      void pickReference(file);
                    }}
                  />
                  <button type="button" onClick={() => matchFileRef.current?.click()} disabled={!ready || matching || shooting} className={DCHIP}>
                    {s.matchShot}
                  </button>
                </>
              )}
              {sourcePhotoUrl && (
                <button type="button" onClick={() => setCompareOpen((v) => !v)} aria-pressed={compareOpen} className={compareOpen ? DCHIP_ON : DCHIP}>
                  {s.compareTitle}
                </button>
              )}
            </div>
          )}

          {/* the human ruler's line: a photo build whose furniture dwarfs a person, and the fix one press away */}
          {scaleWarn && !takeStart && !viewingShot && (
            <div className="absolute left-3.5 top-16 z-20 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center rounded-full border border-onmedia/10 bg-black/60 px-3 py-1.5 text-xs font-medium text-onmedia">
                {s.scaleWarnLine}
              </span>
              <button
                type="button"
                disabled={editingSet}
                onClick={() => {
                  setScaleDismissed(true);
                  void editSet(s.scaleFixAsk);
                }}
                className="cursor-pointer rounded-full bg-[#e0a468] px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {s.scaleWarnFix}
              </button>
              <button
                type="button"
                onClick={() => setScaleDismissed(true)}
                aria-label={t.common.dismiss}
                title={t.common.dismiss}
                className={`${glassBtn} w-8 justify-center px-0`}
              >
                ×
              </button>
            </div>
          )}

          {/* a take under way: where it starts, until the end frame is taken */}
          {takeStart && !viewingShot && (
            <div className="absolute left-3.5 top-16 z-20 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-[#e0a468] px-3 py-1.5 text-xs font-semibold text-black">{formatMsg(s.takeBanner, { n: takeStart.n })}</span>
              <button type="button" onClick={() => setTakeStart(null)} className={glassBtn}>
                {t.common.cancel}
              </button>
            </div>
          )}

          {/* the drag hint, above the filmstrip (Film has its dock instead) */}
          {!viewingShot && !loadFailed && !filmOpen && (
            <span
              aria-live="polite"
              className={`pointer-events-none absolute bottom-[104px] left-3.5 z-10 max-w-[60%] rounded-full border border-onmedia/10 bg-black/60 px-3 py-1 text-[11px] text-onmedia/80 ${
                rigOpen ? "md:left-[356px]" : ""
              }`}
            >
              {figureMoved ? s.figureMovedOut : s.dragHint}
            </span>
          )}

          {/* Match this shot: the read in progress, what it matched, or what went wrong */}
          {matchOn && (matching || matched || matchError) && (
            <div className={`absolute left-3.5 top-16 z-20 max-w-md space-y-1.5 rounded-[12px] p-3 ${PANEL_BG}`}>
              {matching ? (
                <p className="text-xs text-[#9aa0ad]" aria-live="polite">
                  {s.matchReading}
                </p>
              ) : matched && matchedLine ? (
                <div className="flex items-start gap-2.5" aria-live="polite">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={matched.photo} alt={s.matchReferenceAlt} className="h-12 w-auto max-w-[5.5rem] shrink-0 rounded-[4px] border border-white/10 object-cover" />
                  <div className="min-w-0 flex-1 space-y-0.5 text-xs leading-relaxed">
                    <p className="text-[#ecedf1]/90">{matchedLine.line}</p>
                    {matchedLine.notes && <p className="text-[#9aa0ad]">{matchedLine.notes}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMatched(null)}
                    aria-label={t.common.dismiss}
                    title={t.common.dismiss}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-sm text-[#9aa0ad] transition-colors hover:text-[#ecedf1]"
                  >
                    ×
                  </button>
                </div>
              ) : null}
              {matchError && <p className="text-xs text-red-400">{localizeServerText(matchError, t)}</p>}
            </div>
          )}

          {/* The reel: the film's beats playing as one, where the viewport was.
              Every clip is on the page and loading while the first plays, and
              each plays inside its frame lines, as a take does in the viewer. */}
          {reel !== null && reelReady && reelShots[reel] && (
            <div className="absolute inset-0 z-20 bg-black" style={{ containerType: "size" }}>
              {reelShots.map((shot, i) => {
                const band = takeBand(shot);
                return (
                  <div
                    key={shot.generationId}
                    aria-hidden={i !== reel}
                    className={`absolute inset-0 flex items-center justify-center ${i === reel ? "" : "pointer-events-none opacity-0"}`}
                  >
                    <div
                      className="overflow-hidden"
                      style={band ? { aspectRatio: String(band), width: `min(100cqw, ${band} * 100cqh)` } : { width: "100%", height: "100%" }}
                    >
                      <video
                        ref={(el) => {
                          reelVideosRef.current[i] = el;
                        }}
                        src={shot.resultUrl ?? undefined}
                        preload="auto"
                        playsInline
                        onPlaying={() => setReelWaiting(false)}
                        onEnded={() => {
                          // The next clip would not load: say so where the film would have cut to it.
                          if (reelFailedRef.current.has(i + 1)) {
                            setFilmError(s.filmClipFailed);
                            setReel(null);
                            return;
                          }
                          setReel((r) => (r === i ? (i + 1 < reelShots.length ? i + 1 : null) : r));
                        }}
                        // A clip that will not load leaves black where the film was:
                        // say so and give the stage back, rather than wait forever —
                        // at once for the clip playing, at its turn for a later one.
                        onError={() => {
                          if (i === reel) {
                            setFilmError(s.filmClipFailed);
                            setReel(null);
                          } else {
                            reelFailedRef.current.add(i);
                          }
                        }}
                        className={`h-full w-full ${band ? "object-cover" : "object-contain"}`}
                      />
                    </div>
                  </div>
                );
              })}
              {reelWaiting && (
                <button
                  type="button"
                  onClick={() => {
                    setReelWaiting(false);
                    void reelVideosRef.current[reel]?.play().catch(() => setReelWaiting(true));
                  }}
                  className="absolute inset-0 flex cursor-pointer items-center justify-center"
                >
                  <span className="rounded-full bg-black/60 px-5 py-3 text-sm font-medium text-onmedia">▶ {s.filmPlayFilm}</span>
                </button>
              )}
              <span className="absolute left-3.5 top-3.5 rounded-full bg-black/60 px-3 py-1.5 text-xs font-medium text-onmedia tabular-nums">
                {formatMsg(s.filmBeatLabel, { n: reel + 1 })} · {reel + 1}/{reelShots.length}
              </span>
              <button
                type="button"
                onClick={() => setReel(null)}
                aria-label={t.common.dismiss}
                title={t.common.dismiss}
                className="absolute right-3.5 top-3.5 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-onmedia hover:bg-black/80"
              >
                ×
              </button>
            </div>
          )}

          {/* A still in the stage's place: the stage stays underneath, running. */}
          {viewingShot && (
            <div className="absolute inset-0 z-10 bg-[#101116]">
              {viewingShot.kind === "take" ? (
                viewingShot.resultUrl ? (
                  takeBand(viewingShot) ? (
                    // A take shot in a rig format renders 16:9 and plays inside its
                    // frame lines, the band its stills were cut to (shot-rig.ts).
                    <div className="flex h-full w-full items-center justify-center" style={{ containerType: "size" }}>
                      <div
                        className="overflow-hidden"
                        style={{ aspectRatio: String(takeBand(viewingShot)), width: `min(100cqw, ${takeBand(viewingShot)} * 100cqh)` }}
                      >
                        <video src={viewingShot.resultUrl} controls autoPlay loop poster={viewingShot.posterUrl ?? undefined} className="h-full w-full object-cover" />
                      </div>
                    </div>
                  ) : (
                    <video src={viewingShot.resultUrl} controls autoPlay loop poster={viewingShot.posterUrl ?? undefined} className="h-full w-full object-contain" />
                  )
                ) : (
                  <span className="flex h-full items-center justify-center px-10 text-center text-sm text-onmedia/70">{s.takeRendering}</span>
                )
              ) : viewingShot.viewUrl || viewingShot.resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={viewingShot.viewUrl ?? viewingShot.resultUrl ?? ""} alt="" className="h-full w-full object-contain" />
              ) : (
                <span className="flex h-full items-center justify-center text-sm text-onmedia/60">{s.openTake}</span>
              )}
              <span
                className={`absolute left-3.5 top-3.5 rounded-full px-3 py-1.5 text-xs font-semibold tabular-nums ${
                  viewingShot.score === null
                    ? "bg-black/60 text-onmedia/80"
                    : viewingShot.score < identityBar
                      ? "bg-amber-500 text-black"
                      : "bg-black/60 text-onmedia"
                }`}
              >
                {viewingShot.score === null ? s.unscored : stillLine(viewingShot)}
              </span>
              <button type="button" onClick={() => setViewing(null)} className={`absolute top-3.5 ${glassBtn} right-3.5 ${chatOpen ? "md:right-[404px]" : ""}`}>
                <FrameIcon className="h-3.5 w-3.5" />
                {s.backToFrame}
              </button>
              {shots.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setViewing(shots[(viewingAt - 1 + shots.length) % shots.length].generationId)}
                    aria-label={s.previousStill}
                    title={s.previousStill}
                    className="absolute left-3.5 top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-onmedia/10 bg-black/60 text-lg text-onmedia/80 transition-colors hover:text-onmedia"
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewing(shots[(viewingAt + 1) % shots.length].generationId)}
                    aria-label={s.nextStill}
                    title={s.nextStill}
                    className={`absolute top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-onmedia/10 bg-black/60 text-lg text-onmedia/80 transition-colors hover:text-onmedia right-3.5 ${chatOpen ? "md:right-[404px]" : ""}`}
                  >
                    ›
                  </button>
                </>
              )}
              <div className={`absolute bottom-3.5 left-3.5 flex flex-wrap items-center justify-between gap-2 right-3.5 ${chatOpen ? "md:right-[404px]" : ""}`}>
                <span className="rounded-full border border-onmedia/10 bg-black/60 px-3 py-1 text-[11px] text-onmedia/80 tabular-nums">
                  {formatMsg(viewingShot.kind === "take" ? s.takeTile : s.stillTile, { n: stillNumber(viewingShot) })} · <LocalDate date={viewingShot.createdAt} />
                  {formatNote(viewingShot) ? ` · ${formatNote(viewingShot)}` : ""}
                  {shotFacts[viewingShot.generationId] ? ` · ${shotFacts[viewingShot.generationId].frame}` : ""}
                </span>
                <span className="flex items-center gap-1.5">
                  {canBeLook(viewingShot) && viewingShot.generationId !== lookShot?.generationId && (
                    <button type="button" onClick={() => pickLook(viewingShot.generationId)} className={glassBtn}>
                      {s.keepLook}
                    </button>
                  )}
                  {viewingShot.generationId === lookShot?.generationId && (
                    <span className="rounded-full bg-[#e0a468] px-3 py-1.5 text-xs font-semibold text-black">{s.lookKept}</span>
                  )}
                  {viewingShot.kind === "still" && viewingShot.status === "succeeded" && (
                    <button
                      type="button"
                      onClick={() => {
                        setTakeStart({ id: viewingShot.generationId, n: stillNumber(viewingShot) });
                        setTakeEngine(SET_TAKE_DEFAULT_ENGINE);
                        setViewing(null);
                      }}
                      className={glassBtn}
                    >
                      {s.takeItSomewhere}
                    </button>
                  )}
                  <Link href={`/app/history/${viewingShot.generationId}`} className={glassBtn}>
                    {s.openTake}
                  </Link>
                </span>
              </div>
            </div>
          )}

          {/* The filmstrip — the workspace's timeline: the frame, then every still, newest first */}
          {!filmOpen && (
          <div
            className={`absolute bottom-3.5 left-3.5 z-10 flex items-center gap-2 overflow-x-auto rounded-[14px] border border-white/[0.08] bg-black/40 p-1.5 backdrop-blur right-3.5 ${
              chatOpen ? "md:right-[404px]" : "md:right-24"
            } ${rigOpen ? "md:left-[356px]" : ""} ${viewingShot ? "hidden md:flex" : ""}`}
          >
            <button
              type="button"
              onClick={() => setViewing(null)}
              aria-pressed={!viewingShot}
              title={s.frameTile}
              className={`${tile(!viewingShot)} flex flex-col items-center justify-center gap-1 text-[9px] font-semibold uppercase tracking-[0.04em] text-onmedia/85`}
            >
              <FrameIcon className="h-4 w-4" />
              {s.frameTile}
            </button>
            {shots.map((shot) => (
              <button
                key={shot.generationId}
                type="button"
                onClick={() => setViewing(shot.generationId)}
                aria-pressed={viewing === shot.generationId}
                title={formatMsg(shot.kind === "take" ? s.takeTile : s.stillTile, { n: stillNumber(shot) })}
                className={tile(viewing === shot.generationId)}
              >
                {shot.kind === "take" ? (
                  shot.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shot.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center text-lg text-onmedia/70">▶</span>
                  )
                ) : shot.resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shot.resultUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-onmedia/60">{formatMsg(s.stillTile, { n: stillNumber(shot) })}</span>
                )}
                {shot.score !== null && (
                  <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-px text-[9px] font-semibold text-onmedia tabular-nums">{shot.score}</span>
                )}
                {shot.generationId === lookShot?.generationId && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-[#e0a468] px-1.5 py-px text-[9px] font-bold uppercase text-black">{s.lookBadge}</span>
                )}
                {shot.kind === "take" && shot.posterUrl && (
                  <span aria-hidden className="absolute bottom-1 right-1 text-[10px] text-onmedia">▶</span>
                )}
              </button>
            ))}
            {shots.length > 0 && (
              <span className="mx-1.5 whitespace-nowrap text-[11px] text-[#9aa0ad] tabular-nums">
                {shots.length === 1 ? s.shotsOne : formatMsg(s.shotsMany, { n: shots.length })} · {s.newestFirst}
              </span>
            )}
          </div>
          )}

          {/* The film dock (canvas page H): the move where the filmstrip was —
              transport and price above, then the start still and a cell per
              beat. The stage stays the stage: orbit, then K keeps the view. */}
          {filmOpen && (
            <div
              className={`absolute bottom-3.5 left-3.5 z-10 flex flex-col gap-2 rounded-[14px] border border-white/[0.08] bg-black/40 p-2 backdrop-blur right-3.5 ${
                chatOpen ? "md:right-[404px]" : "md:right-24"
              } ${rigOpen ? "md:left-[356px]" : ""} ${viewingShot ? "hidden md:flex" : ""}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void playMove()}
                  disabled={!ready || previz || film.beats.length === 0}
                  className={chip(false)}
                >
                  ▶ {s.filmPlayMove}
                </button>
                <span className="whitespace-nowrap text-[11px] text-[#9aa0ad] tabular-nums">
                  {formatMsg(s.filmLength, { s: filmSeconds(film), n: film.beats.length })}
                </span>
                <span className="flex-1" />
                <button
                  type="button"
                  onClick={() => editFilm((f) => ({ ...f, engine: "omni" }))}
                  disabled={Boolean(filmBusy)}
                  className={chip(film.engine === "omni")}
                >
                  {formatMsg(s.takeEngineOmni, { s: SET_TAKE_ENGINES.omni.seconds })}
                </button>
                <button
                  type="button"
                  onClick={() => editFilm((f) => ({ ...f, engine: "veo" }))}
                  disabled={Boolean(filmBusy)}
                  className={chip(film.engine === "veo")}
                >
                  {formatMsg(s.takeEngineVeo, { s: SET_TAKE_ENGINES.veo.seconds })}
                </button>
                {reelReady && (
                  <button
                    type="button"
                    onClick={() => {
                      reelFailedRef.current = new Set();
                      setReelWaiting(false);
                      setReel(0);
                    }}
                    className={chip(false)}
                  >
                    ▶ {s.filmPlayFilm}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void renderFilm()}
                  disabled={
                    !ready ||
                    Boolean(filmBusy) ||
                    shooting ||
                    matching ||
                    film.beats.length === 0 ||
                    !film.startId ||
                    !characterId ||
                    (filmPlan.again && filmPlan.rendering)
                  }
                  className="inline-flex h-8 cursor-pointer items-center justify-center rounded-[8px] bg-[#e0a468] px-3.5 text-xs font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:opacity-40"
                >
                  {filmRenderLabel}
                </button>
              </div>
              <div className="flex items-stretch gap-2 overflow-x-auto">
                <div className="relative flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => toggleMenu("filmStart")}
                    disabled={Boolean(filmBusy)}
                    aria-haspopup="listbox"
                    aria-expanded={menu === "filmStart"}
                    title={s.filmStarts}
                    className={`${tile(false)} flex flex-col items-center justify-center gap-1 text-[9px] font-semibold uppercase tracking-[0.04em] text-onmedia/85`}
                  >
                    {filmStartShot?.resultUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={filmStartShot.resultUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      s.filmStarts
                    )}
                  </button>
                  {menu === "filmStart" && (
                    <div
                      role="listbox"
                      aria-label={s.filmStarts}
                      className={DMENU_UP}
                    >
                      {filmStartOptions.length === 0 ? (
                        <span className="block px-3 py-2 text-xs text-[#9aa0ad]">{s.filmPickStill}</span>
                      ) : (
                        filmStartOptions.map((shot) => (
                          <button
                            key={shot.generationId}
                            type="button"
                            role="option"
                            aria-selected={film.startId === shot.generationId}
                            onClick={() => {
                              editFilm((f) => ({ ...f, startId: shot.generationId }));
                              setMenu(null);
                            }}
                            className={`flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-1.5 text-left text-xs hover:bg-white/[0.06] ${
                              film.startId === shot.generationId ? "text-[#e0a468]" : "text-[#c6c9d1]"
                            }`}
                          >
                            {formatMsg(s.stillTile, { n: stillNumber(shot) })}
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
                {film.beats.map((b, i) => (
                  <div
                    key={i}
                    className={`flex min-w-[190px] max-w-[280px] flex-1 flex-col gap-1.5 rounded-[10px] bg-white/[0.04] p-2 ring-1 ${
                      filmSel === i ? "ring-[#e0a468]" : "ring-white/[0.08]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#6b6f7a]">
                      <button type="button" onClick={() => filmGoTo(i)} className="cursor-pointer hover:text-[#e0a468]">
                        {formatMsg(s.filmBeatLabel, { n: i + 1 })}
                      </button>
                      <span className="normal-case tabular-nums">
                        {formatMsg(s.takeSeconds, { s: SET_TAKE_ENGINES[film.engine].seconds })}
                      </span>
                      {b.move && (
                        <span className="rounded-[4px] bg-[rgba(224,164,104,0.14)] px-1.5 text-[10px] font-semibold normal-case tracking-[0.02em] text-[#f0cda6]">
                          {s.rig.moves[b.move]}
                        </span>
                      )}
                      {filmBusy?.beat === i ? (
                        <span className="normal-case text-[#e0a468]">{filmBusy.clipOnly ? s.filmBeatClip : s.filmBeatStill}</span>
                      ) : filmClipShots[i] ? (
                        <span
                          className={`normal-case ${
                            filmClipShots[i]!.status === "succeeded"
                              ? "text-[#5f9e6e]"
                              : filmClipShots[i]!.status === "failed"
                                ? "text-red-400"
                                : "text-[#e0a468]"
                          }`}
                        >
                          {filmClipShots[i]!.status === "succeeded"
                            ? s.filmBeatDone
                            : filmClipShots[i]!.status === "failed"
                              ? s.filmBeatClipFailed
                              : s.filmBeatClip}
                        </span>
                      ) : null}
                      <span className="flex-1" />
                      <button
                        type="button"
                        onClick={() => {
                          editFilm((f) => ({ ...f, beats: f.beats.filter((_, j) => j !== i) }));
                          setFilmSel(null);
                        }}
                        disabled={Boolean(filmBusy)}
                        aria-label={formatMsg(s.filmRemoveBeat, { n: i + 1 })}
                        title={formatMsg(s.filmRemoveBeat, { n: i + 1 })}
                        className="cursor-pointer hover:text-[#ecedf1] disabled:cursor-default disabled:opacity-40"
                      >
                        ×
                      </button>
                    </div>
                    <input
                      value={b.words}
                      onChange={(e) =>
                        editFilm((f) => ({
                          ...f,
                          beats: f.beats.map((bb, j) => (j === i ? { ...bb, words: e.target.value } : bb)),
                        }))
                      }
                      onFocus={() => setFilmSel(i)}
                      disabled={Boolean(filmBusy)}
                      placeholder={s.filmBeatWords}
                      className="h-7 rounded-[6px] bg-black/40 px-2 text-xs text-[#ecedf1] ring-1 ring-white/[0.08] placeholder:text-[#565a64] focus:outline-none focus:ring-[#e0a468]/60"
                    />
                  </div>
                ))}
                {film.beats.length < FILM_MAX_BEATS && (
                  <button
                    type="button"
                    onClick={filmAddKeyframe}
                    disabled={!ready || Boolean(filmBusy)}
                    className={`${chip(false)} h-auto min-h-[52px] flex-shrink-0 whitespace-nowrap`}
                  >
                    + {s.filmKeyframe}
                  </button>
                )}
              </div>
              {filmError && <p className="px-1 text-xs text-red-400">{localizeServerText(filmError, t)}</p>}
            </div>
          )}

          {/* A photo set: the photo beside camera 1, where the photographer stood */}
          {sourcePhotoUrl && compareOpen && (
            <div className={`absolute bottom-[104px] left-3.5 z-20 w-[min(640px,80%)] space-y-2.5 rounded-[14px] p-3.5 ${PANEL_BG}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0ad]">{s.compareTitle}</h2>
                <button
                  type="button"
                  onClick={() => setCompareOpen(false)}
                  aria-label={t.common.dismiss}
                  title={t.common.dismiss}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-sm text-[#9aa0ad] hover:text-[#ecedf1]"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <figure className="space-y-1.5">
                  <div className="overflow-hidden rounded-media border border-white/10 bg-black/60" style={{ aspectRatio: photoAspect ?? 4 / 3 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img ref={readPhotoShape} src={sourcePhotoUrl} alt={s.comparePhoto} onLoad={(e) => readPhotoShape(e.currentTarget)} className="h-full w-full object-cover" />
                  </div>
                  <figcaption className="text-xs text-[#9aa0ad]">{s.comparePhoto}</figcaption>
                </figure>
                <figure className="space-y-1.5">
                  <div className="overflow-hidden rounded-media border border-white/10 bg-black/60" style={{ aspectRatio: photoAspect ?? 4 / 3 }}>
                    {cameraOneShot ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={cameraOneShot} alt={formatMsg(s.cameraN, { n: 1 })} className="h-full w-full object-cover" />
                    ) : (
                      <div
                        aria-hidden
                        className="h-full w-full opacity-40 [background-image:linear-gradient(to_right,rgba(255,255,255,0.08)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.08)_1px,transparent_1px)] [background-size:28px_28px]"
                      />
                    )}
                  </div>
                  <figcaption className="text-xs text-[#9aa0ad]">{formatMsg(s.cameraN, { n: 1 })}</figcaption>
                </figure>
              </div>
              <p className="text-[11px] text-[#6b6f7a]">{s.compareNote}</p>
            </div>
          )}
        </div>

        {/* The rig: the camera department, docked left of the stage (canvas page I). */}
        {rigOpen && (
          <RigPanel
            rig={rig}
            onChange={setRig}
            s={s}
            locale={locale}
            fovDeg={fovDeg}
            onLens={pickLens}
            distanceM={eyeDistance}
            figureName={characterName}
            cameraBearingDeg={cameraBearing}
            film={
              filmOpen
                ? {
                    beat: filmSel !== null && film.beats[filmSel] ? filmSel + 1 : null,
                    move: filmSel !== null ? (film.beats[filmSel]?.move ?? null) : null,
                    textures: filmSel !== null ? (film.beats[filmSel]?.textures ?? []) : [],
                    onMove: filmMove,
                    onTexture: filmTexture,
                  }
                : null
            }
            onClose={() => setRigOpen(false)}
          />
        )}

        {/* The conversation, floating in the viewport — 3D Jutsu's chat panel, ours. */}
        {chatOpen ? (
          <aside
            className={`z-30 flex min-h-0 flex-col overflow-hidden max-md:h-[42%] max-md:flex-none max-md:border-t max-md:border-white/[0.11] max-md:bg-[#16171c] md:absolute md:bottom-3.5 md:right-3.5 md:top-3.5 md:w-[392px] md:rounded-[16px] ${PANEL_BG} max-md:border-x-0 max-md:border-b-0 max-md:shadow-none`}
          >
            <div className="flex items-center justify-between border-b border-white/[0.07] px-4 py-3">
              <span className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0ad]">{s.astraLabel}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-[#6b6f7a]">{s.panelMeta}</span>
                <button
                  type="button"
                  onClick={() => setChatOpen(false)}
                  title={s.chatHide}
                  aria-label={s.chatHide}
                  className="hidden h-6 w-6 cursor-pointer items-center justify-center rounded text-[#6b6f7a] hover:text-[#ecedf1] md:flex"
                >
                  ›
                </button>
              </span>
            </div>

            <div className="flex flex-1 flex-col gap-4 overflow-y-auto p-4">
              {thread.map((shot) => {
                if (shot.kind === "take") {
                  return (
                    <Fragment key={shot.generationId}>
                      <div className="max-w-[86%] self-end whitespace-pre-wrap rounded-[16px] rounded-br-[4px] bg-[#ecedf1] px-3.5 py-2.5 text-sm leading-relaxed text-[#1b1c20]">
                        {shot.words ?? s.shootWord}
                      </div>
                      <div className="flex items-start gap-2.5">
                        <AstraMark />
                        <div className="min-w-0 flex-1 space-y-2.5">
                          <p className="text-sm leading-relaxed text-[#c6c9d1]">{shot.status === "succeeded" ? stillLine(shot) : s.takeRendering}</p>
                          <div className="rounded-[14px] bg-white/[0.05] p-3 ring-1 ring-white/[0.07] space-y-3">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => setViewing(shot.generationId)}
                                title={formatMsg(s.takeTile, { n: stillNumber(shot) })}
                                className="relative h-24 w-24 flex-shrink-0 cursor-pointer overflow-hidden rounded-[10px] bg-black/60 ring-1 ring-white/15"
                              >
                                {shot.posterUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={shot.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                                ) : (
                                  <span className="flex h-full items-center justify-center text-lg text-onmedia/70">▶</span>
                                )}
                              </button>
                              <div className="min-w-0 flex flex-col gap-1">
                                <span className="text-[13px] font-medium text-[#ecedf1]">{formatMsg(s.takeTile, { n: stillNumber(shot) })}</span>
                                <span className="text-xs text-[#9aa0ad] tabular-nums">
                                  {formatMsg(s.takeSeconds, { s: shot.seconds ?? SET_TAKE_ENGINES[SET_TAKE_DEFAULT_ENGINE].seconds })} · <LocalDate date={shot.createdAt} />
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link href={`/app/history/${shot.generationId}`} className={chip(false)}>
                                {s.openTake}
                              </Link>
                            </div>
                          </div>
                        </div>
                      </div>
                    </Fragment>
                  );
                }
                // A still with no recorded camera, or nothing to cut out of it
                // clear of its people, offers no look (look.ts).
                const lookable = canBeLook(shot);
                const isLook = lookable && shot.generationId === lookShot?.generationId;
                const facts = shotFacts[shot.generationId];
                return (
                  <Fragment key={shot.generationId}>
                    <div className="max-w-[86%] self-end whitespace-pre-wrap rounded-[16px] rounded-br-[4px] bg-[#ecedf1] px-3.5 py-2.5 text-sm leading-relaxed text-[#1b1c20]">
                      {shot.words ?? s.shootWord}
                    </div>
                    <div className="flex items-start gap-2.5">
                      <AstraMark />
                      <div className="min-w-0 flex-1 space-y-2.5">
                        <p className="text-sm leading-relaxed text-[#c6c9d1]">
                          {facts ? `${formatMsg(s.shotInSeconds, { s: facts.seconds })} ` : ""}
                          {stillLine(shot)}
                          {isLook ? ` ${s.lookOnLine}` : ""}
                          {shot.rigCheck ? ` ${rigCheckedLine(shot.rigCheck)}` : ""}
                        </p>
                        <div className="rounded-[14px] bg-white/[0.05] p-3 ring-1 ring-white/[0.07] space-y-3">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setViewing(shot.generationId)}
                              title={formatMsg(s.stillTile, { n: stillNumber(shot) })}
                              className={`relative h-24 w-24 flex-shrink-0 cursor-pointer overflow-hidden rounded-[10px] bg-black/60 ${
                                isLook ? "ring-2 ring-[#e0a468]" : "ring-1 ring-white/15"
                              }`}
                            >
                              {shot.resultUrl ? (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={shot.resultUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                              ) : (
                                <span className="flex h-full items-center justify-center text-[10px] text-onmedia/60">{s.openTake}</span>
                              )}
                            </button>
                            <div className="min-w-0 flex flex-col gap-1">
                              <span className="text-[13px] font-medium text-[#ecedf1]">{formatMsg(s.stillTile, { n: stillNumber(shot) })}</span>
                              <span className="text-xs text-[#9aa0ad] tabular-nums">
                                {shot.score !== null ? `${formatMsg(s.identityScore, { score: shot.score })} · ` : ""}
                                <LocalDate date={shot.createdAt} />
                              </span>
                              {facts && <span className="text-xs text-[#9aa0ad]">{facts.frame}</span>}
                            </div>
                          </div>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {isLook ? (
                              <span className="inline-flex h-8 items-center rounded-full bg-[#e0a468] px-3 text-[11px] font-semibold text-black">{s.lookKept}</span>
                            ) : lookable ? (
                              <button type="button" onClick={() => pickLook(shot.generationId)} className={chip(false)}>
                                {s.keepLook}
                              </button>
                            ) : null}
                            <button type="button" onClick={anotherAngle} disabled={!ready || shooting} className={chip(false)}>
                              {s.anotherAngle}
                            </button>
                            <Link href={`/app/history/${shot.generationId}`} className={chip(false)}>
                              {s.openTake}
                            </Link>
                          </div>
                        </div>
                        {rigCheckCard(shot, facts?.frame ?? null)}
                      </div>
                    </div>
                  </Fragment>
                );
              })}

              {pendingAsks.map((ask, i) => (
                <div key={`ask-${i}`} className="max-w-[86%] self-end whitespace-pre-wrap rounded-[16px] rounded-br-[4px] bg-[#ecedf1] px-3.5 py-2.5 text-sm leading-relaxed text-[#1b1c20]">
                  {ask}
                </div>
              ))}

              {/* An Astra edit of the set, landed: how much of it changed. */}
              {setChanged !== null && (
                <div className="flex items-start gap-2.5">
                  <AstraMark />
                  <p className="text-sm leading-relaxed text-[#c6c9d1]">
                    {setChanged === 0 ? s.editorAskNothing : setChanged === 1 ? s.editorAskDoneOne : formatMsg(s.editorAskDone, { n: setChanged })}{" "}
                    {setChanged > 0 && (
                      <button type="button" onClick={() => void undoSetEdit()} className="cursor-pointer font-medium text-[#e0a468]">
                        {s.editorUndo}
                      </button>
                    )}
                  </p>
                </div>
              )}

              {/* Astra's turn: the frame in a sentence, then as a card, and Shoot to approve it */}
              <div className="flex items-start gap-2.5">
                <AstraMark />
                <div className="min-w-0 flex-1 space-y-2.5">
                  {characters.length === 0 ? (
                    <p className="text-sm leading-relaxed text-[#c6c9d1]">
                      {s.noCharacters}{" "}
                      <Link href="/app/character/new" className="font-medium text-[#e0a468] underline underline-offset-2">
                        {s.createCharacter}
                      </Link>
                    </p>
                  ) : (
                    <>
                      <p className="text-sm leading-relaxed text-[#c6c9d1]">
                        {frameLead ? `${frameLead} ` : ""}
                        {placedLine} {s.frameProse}
                      </p>
                      <div className="rounded-[14px] bg-white/[0.05] p-4 ring-1 ring-white/[0.07] space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium uppercase tracking-widest text-[#9aa0ad]">{s.frameCard}</span>
                          <span className="text-xs text-[#6b6f7a] tabular-nums">{formatMsg(s.revisionN, { n: frameNumber })}</span>
                        </div>
                        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px] leading-[18px]">
                          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rowWho}</dt>
                          <dd className="flex items-center gap-1.5 text-[#ecedf1]">
                            {character?.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={character.thumbUrl} alt="" className="h-[18px] w-[18px] rounded-full object-cover" />
                            ) : (
                              <span className="h-[18px] w-[18px] rounded-full bg-white/15" />
                            )}
                            {characterName}
                          </dd>
                          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rowWhere}</dt>
                          <dd className="text-[#ecedf1]">
                            {markLabel} · {facingLabel}
                          </dd>
                          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rowCamera}</dt>
                          <dd className="text-[#ecedf1] tabular-nums">
                            {cameraLabel} · {lensLabel}
                            {rig.format !== "square" ? ` · ${s.rig.formats[rig.format]}` : ""}
                          </dd>
                          {rigLooksLine && (
                            <>
                              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rig.rowRig}</dt>
                              <dd className="text-[#f0cda6] tabular-nums">{rigLooksLine}</dd>
                            </>
                          )}
                          {rig.light && (
                            <>
                              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rig.rowLight}</dt>
                              <dd className="text-[#f0cda6] tabular-nums">
                                {s.rig.lights[rig.light.scheme]} · {formatMsg(s.rig.lightHeight, { deg: Math.round(rig.light.elevationDeg) })}
                              </dd>
                            </>
                          )}
                          {rig.palette && (
                            <>
                              <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rig.rowPalette}</dt>
                              <dd className="text-[#f0cda6]">{s.rig.palettes[rig.palette]}</dd>
                            </>
                          )}
                          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rowHappens}</dt>
                          <dd className={direction ? "text-[#ecedf1]" : "text-[#6b6f7a]"}>{direction || "—"}</dd>
                          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rowCost}</dt>
                          <dd className="text-[#ecedf1] tabular-nums">{formatMsg(s.costLine, { credits })}</dd>
                        </dl>
                        {takeStart && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-1">
                            <button type="button" onClick={() => setTakeEngine("omni")} className={chip(takeEngine === "omni")}>
                              {formatMsg(s.takeEngineOmni, { s: SET_TAKE_ENGINES.omni.seconds })}
                            </button>
                            <button type="button" onClick={() => setTakeEngine("veo")} className={chip(takeEngine === "veo")}>
                              {formatMsg(s.takeEngineVeo, { s: SET_TAKE_ENGINES.veo.seconds })}
                            </button>
                          </div>
                        )}
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void (takeStart ? take() : shoot())}
                            disabled={shooting || matching || !characterId || loadFailed || !ready}
                            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[8px] bg-[#e0a468] px-[18px] text-sm font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            {takeStart ? formatMsg(s.takeButton, { n: takeCredits }) : shootLabel}
                          </button>
                          <button
                            type="button"
                            onClick={anotherAngle}
                            disabled={!ready || shooting}
                            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[8px] bg-white/[0.06] px-4 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-colors hover:bg-white/[0.1] disabled:opacity-40"
                          >
                            {s.anotherAngle}
                          </button>
                        </div>
                        {error && <p className="text-sm text-red-400">{localizeServerText(error, t)}</p>}
                        {rigError && <p className="text-xs text-red-400">{localizeServerText(rigError, t)}</p>}
                        {lastMiss && (
                          <p className="text-sm text-[#9aa0ad]">
                            {s.shotDidNotFinish}{" "}
                            <Link href={`/app/history/${lastMiss}`} className="font-medium text-[#e0a468] underline underline-offset-2">
                              {s.openTake}
                            </Link>
                          </p>
                        )}
                        {lookDropped && (
                          <p className="text-xs text-[#9aa0ad]" aria-live="polite">
                            {s.lookDropped}
                          </p>
                        )}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {(reading || shooting || editingSet) && (
                <div className="flex items-center gap-2.5">
                  <AstraMark />
                  <p className="flex items-center gap-2 text-sm text-[#9aa0ad]">
                    <Spinner className="h-4 w-4 flex-shrink-0" />
                    {editingSet ? s.editorAsking : shooting ? `${s.shooting} ${s.shootingLine}` : s.threadReading}
                  </p>
                </div>
              )}
              <div ref={threadEndRef} aria-hidden />
            </div>

            {/* The composer at the panel's foot: the words, then who, the mode and the price */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (mentionOpen && mentionList[0]) pickMention(mentionList[0]);
                else if (draft.trim()) void send(draft);
                // Just talking is the mode that spends nothing: with nothing
                // written there is nothing to answer, and an empty send used
                // to shoot anyway (found in the rundown, 2026-09-16).
                else if (!justTalk) void (takeStart ? take() : shoot());
              }}
              className="relative border-t border-white/[0.07] px-3.5 pb-3.5 pt-3"
            >
              {mentionOpen && (
                <div
                  role="listbox"
                  aria-label={s.mentionTitle}
                  className="absolute bottom-full left-3.5 z-30 mb-2 w-max min-w-[13rem] rounded-[12px] border border-white/[0.11] bg-[#1d1e24] p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]"
                >
                  <p className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-widest text-[#9aa0ad]">{s.mentionTitle}</p>
                  {mentionList.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-xs text-[#9aa0ad]">{s.mentionHint}</p>
                  ) : (
                    mentionList.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={characterId === c.id}
                        onClick={() => pickMention(c)}
                        className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] transition-colors ${
                          characterId === c.id ? "bg-white/[0.08] font-medium text-[#ecedf1]" : "text-[#9aa0ad] hover:bg-white/[0.05] hover:text-[#ecedf1]"
                        }`}
                      >
                        {c.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumbUrl} alt="" className="h-[22px] w-[22px] rounded-full object-cover" />
                        ) : (
                          <span className="h-[22px] w-[22px] rounded-full bg-white/15" />
                        )}
                        {c.name}
                      </button>
                    ))
                  )}
                </div>
              )}
              <textarea
                ref={draftRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && mentionOpen) {
                    e.preventDefault();
                    setMentionForced(false);
                    return;
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (mentionOpen && mentionList[0]) pickMention(mentionList[0]);
                    else if (draft.trim()) void send(draft);
                  }
                }}
                rows={2}
                aria-label={s.threadPlaceholder}
                placeholder={reading ? s.threadReading : s.threadPlaceholder}
                disabled={reading || shooting || editingSet}
                className="block min-h-[44px] w-full resize-none border-none bg-transparent px-2 py-1.5 text-sm text-[#ecedf1] outline-none placeholder:text-[#6b6f7a] disabled:opacity-60"
              />
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMentionForced((open) => !open)}
                  aria-haspopup="listbox"
                  aria-expanded={mentionOpen}
                  disabled={characters.length === 0}
                  className={chip(false)}
                  title={s.mentionHint}
                >
                  @ {character?.name || s.characterLabel}
                </button>
                <div className="relative">
                  <button type="button" onClick={() => toggleMenu("mode")} aria-haspopup="listbox" aria-expanded={menu === "mode"} title={s.modeHint} className={chip(justTalk)}>
                    {justTalk ? s.justTalking : askFirst ? s.askBeforeShooting : s.shootWithoutAsking}
                    <Chevron />
                  </button>
                  {menu === "mode" && (
                    <div role="listbox" aria-label={s.modeHint} className={DMENU_UP}>
                      {modeOptions}
                    </div>
                  )}
                </div>
                {!justTalk && (
                  <span className="flex h-8 items-center whitespace-nowrap rounded-full bg-white/[0.06] px-3 text-xs text-[#9aa0ad] tabular-nums">
                    {s.engineChip} · {credits}
                  </span>
                )}
                <span className="flex-1" />
                <button
                  type="submit"
                  disabled={reading || shooting || editingSet || !ready || (!draft.trim() && (!characterId || justTalk))}
                  title={draft.trim() || justTalk ? s.threadPlaceholder : shootLabel}
                  aria-label={draft.trim() || justTalk ? s.threadPlaceholder : shootLabel}
                  className="flex h-9 w-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#e0a468] text-[#1b1c20] transition-opacity hover:opacity-90 disabled:bg-white/[0.06] disabled:text-[#9aa0ad]"
                >
                  {reading || shooting || editingSet ? <Spinner className="h-4 w-4" /> : <SendIcon className="h-4 w-4" />}
                </button>
              </div>
            </form>
          </aside>
        ) : (
          <button type="button" onClick={() => setChatOpen(true)} className={`absolute bottom-3.5 right-3.5 z-30 ${DCHIP} h-10 pl-1.5`}>
            <AstraMark />
            {s.astraLabel}
          </button>
        )}
      </div>
    </div>
  );
}
