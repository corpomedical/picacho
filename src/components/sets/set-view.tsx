"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LocalDate } from "@/components/local-date";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { quoteSend } from "@/lib/generations/quote";
import { isStaleDeployError, reloadForNewDeploy } from "@/lib/stale-deploy";
import { saveSetLayout, saveSetThumbnail, shootInSet, takeInSet } from "@/lib/sets/actions";
import { readSetPress } from "@/lib/sets/press-actions";
import { followPress, lateThrow, lostAnswer, newPressId, pressReadOf, stillGoingAnswer, type LostWords, type PressRead, type PressRows } from "@/lib/sets/press-follow";
import { shotFileName, shotFileUrl } from "@/lib/sets/still-file";
import { downloadResult, downloadResultNative } from "@/components/download-button";
import { isNativeAppClient } from "@/lib/native/platform";
import { recordDownload } from "@/lib/generations/actions";
import { addElementPhoto, assignElementPhoto, prepareElementSheets, removeElementPhoto, settleElementPhotos } from "@/lib/sets/element-actions";
import { thumbUrl } from "@/lib/media/url";
import { editSetWithAstra, readAstraEdit, rebuildThingFromPhotos, undoAstraEdit } from "@/lib/sets/editor-actions";
import type { EditUndo } from "@/lib/sets/edit-seal";
import { followAstraEdit, type FollowedEdit } from "@/lib/sets/astra-follow";
import { THING_REBUILD_OPEN_TO_ALL, rebuiltThingIn } from "@/lib/sets/thing-rebuild";
import { SELECTABLE_IMAGE_MODEL_IDS, getImageModel } from "@/lib/generations/providers/image-models";
import { matchSetShot } from "@/lib/sets/match-actions";
import { readShotTurn, readShotWords } from "@/lib/sets/words-actions";
import { STAND_IN_EYE_M, fovForLens, nearestLens, type StageQuality } from "@/lib/sets/build-scene";
import { dockTabAfter, dockTabsFor, railToolForKey, studioChecked, studioHeld, studioLab, type DockTab, type RailTool, type StatusItem, type StudioMode } from "@/lib/sets/studio";
import { VIEW_MODES, viewModeMaterial, type ViewMode } from "@/lib/sets/view-modes";
import { azimuthOf, hourFromAzimuth, measureMetres, scaleBar, sunDirection, type MeasurePoint } from "@/lib/sets/furniture";
import { PATH_MAX_POINTS, alongPath, pathLength, type Gaze } from "@/lib/sets/people";
import { MOVERS_PER_BEAT, canMove, moverAlong, movedSpec, placementBefore, turnAbout, type Mover, type Placement } from "@/lib/sets/movers";
import { SKETCH_MODEL_MATERIAL, THING_MODEL_BUCKET, fitThingModel, modelHome, modelUrlAllowed, type ThingModel } from "@/lib/sets/thing-model";
import { keepThingModel, pollThingBuild, removeThingModel, reserveThingModel, startThingBuild, turnThingModel } from "@/lib/sets/model-actions";
import { THING_BUILD_POLL_MS, THING_BUILD_WAIT_MS } from "@/lib/sets/thing-build";
import { createClient as createBrowserClient } from "@/lib/supabase/client";
import type { RigTab } from "@/lib/sets/rig-dock";
import { SceneTree, sceneNames, type SceneTarget } from "./scene-tree";
import { Sequencer } from "./sequencer";
import { beatAtTime, beatSpans, timeOf } from "@/lib/sets/sequencer";
import { StatusList, StudioBar, StudioDock, StudioRail, StudioStatus, useWide, useWideAt } from "./studio-frame";
import { ThingsPanel, ThingsStrip, type LooseBundle, type PanelRow } from "./things-panel";
import { clearMarks } from "@/lib/sets/marks";
import { BADGE_HIT_SLOP_PX, FIGURE_TAP_WAIT_MS, TAP_SLOP_PX, badgeAt, elementForHits, isTap, type ElementHit, type StageHit, type TapStart } from "@/lib/sets/stage-pick";
import { ELEMENT_SHEETS_PER_STILL, FIGURE_KEY, SHEET_LANES, elementPlaces, planShotSheets, resolvePhotos, setElements as elementsOf, type ElementPhoto, type SetElement, type ShotElementStatus } from "@/lib/sets/elements";
import { afterShotWhy, beforeShoot, pageState, ridesState, statusWords as elementStatusWords, type ElementState } from "@/lib/sets/element-status";
import { findVehicles } from "@/lib/sets/vehicles";
import { shotCameraOf } from "@/lib/sets/shot-camera";
import { ElementCard, type CardElement } from "./element-card";
import { answerLikeness } from "@/lib/characters/likeness-actions";
import { LIKENESS_ANSWERS, type LikenessAnswer } from "@/lib/characters/likeness";
import { CastStrip, type CastChip } from "./cast-strip";
import { FirstVisit, HELIOS_TOUR_KEY } from "./first-visit";
import { AstraChangeCard } from "./astra-change-card";
import { AstraReply, shownLines } from "./astra-reply";
import { askProducer } from "@/lib/producer/ask-event";
import { astraCardWords, astraTooBig } from "@/lib/sets/astra-card";
import {
  retryableTakes,
  SET_TAKE_DEFAULT_ENGINE,
  SET_TAKE_ENGINES,
  stillQuoteInput,
  takesCredits,
  type SetTakeEngine,
  type TakeSource,
} from "@/lib/sets/take";
import {
  FILM_MAX_BEATS,
  filmStages,
  filmAfterEdit,
  filmContextKey,
  filmJobCount,
  filmRendered,
  filmRenderPlan,
  filmSeconds,
  normaliseSetFilm,
  textKey,
  type SetFilm,
} from "@/lib/sets/film";
import { oversizedSeating } from "@/lib/sets/human-scale";
import { checkFilmCredits, readTakes, saveSetFilm } from "@/lib/sets/film-actions";
import { checkShotRig, saveSetRig } from "@/lib/sets/rig-actions";
import { RIG_PALETTES, depthOfField, exposureGain, findLook, focalMm, formatFrame, letterbox, normaliseSetRig, sensorCocMm, sensorHeightMm, shutterFraction, type RigCheckItem, type SetRig } from "@/lib/sets/rig";
import { bearingDeg } from "@/lib/sets/light-schemes";
import { stagedSpec, timeLabel, sunAt } from "@/lib/sets/time-of-day";
import { filterCommands, rigCommandIds, rigPatchFor, shootCommands, stepIndex, TIME_PRESETS, type ShootCommandContext } from "@/lib/sets/commands";
import { CommandPalette } from "./command-palette";
import { labPreviewCodes } from "@/lib/sets/lab-preview";
import { beatJumps, layBeatMove, poseAlong, relayMoves, samePose, type FilmMove, type FilmTexture } from "@/lib/sets/moves";
import { planFilmOverlay, type FilmOverlayPlan } from "@/lib/sets/film-overlay";
import { joinMp4 } from "@/lib/media/mp4-join";
import type { RigCheck } from "@/lib/sets/rig-check";
import { RigPanel } from "@/components/sets/rig-panel";
import { compareCrop, compareOutputSize, widenFovDeg, type CompareCrop } from "@/lib/sets/compare";
import { canBeLook, newestLook } from "@/lib/sets/look";
import { matchSummary, placeMatchedCamera, solveMatchPose, type CameraMove, type MatchClamp, type ShotMatch } from "@/lib/sets/match-shot";
import {
  SET_LIKENESS_NEEDED,
  SET_PHOTO_UNREADABLE,
  SET_PICK_CHARACTER,
  SET_SAVE_FAILED,
  SET_TAKE_BAD_END,
  SET_TAKE_END_OTHER_PERSON,
  SET_TAKE_NEEDS_PLAN,
  SET_TAKE_RETRY_END_OTHER_PERSON,
  SET_TAKE_START_OTHER_PERSON,
  THING_BUILD_FAILED,
  THING_MODEL_SAVE_FAILED,
} from "@/lib/sets/messages";
import { preparePhoto } from "@/lib/sets/photo-client";
import { facingFor, hasCameraWords, SHOT_WORDS_MAX_CHARS, wordsToMatch, type FigureFacing, type ShotWords } from "@/lib/sets/shot-words";
import type { CantCode, FrameX, ReaderAliases, ReaderStep, ReaderWhy, ShotReading } from "@/lib/sets/shot-reading";
import type { EditFrame } from "@/lib/sets/set-edit-prompt";
import { READER_CONTEXT_MAX, cameraSideOf, type ReaderNow } from "@/lib/sets/reader-context";
import {
  TURN_UNDO_MAX,
  USE_HOUR_READING,
  cameraSpotOf,
  cameraStep,
  facingToward,
  frameXAfter,
  framedMatch,
  gazeFor,
  largestObjectOf,
  lookPatch,
  nudgeMark,
  paidDecision,
  pickTakeStart,
  planTurn,
  pointBeside,
  pressFor,
  resolveWhich,
  secondButton,
  shiftPose,
  shootDecision,
  snapshotDiff,
  spotToMatch,
  turnedFacing,
  undoPlan,
  vehicleOf,
  type CameraSpot,
  type Need,
  type PageState,
  type PlanCharacter,
  type SecondButton,
  type ShootDecision,
  type StepClamp,
  type TakeMove,
  type TakeStart,
  type TurnPlan,
  type TurnSnapshot,
  type TurnSource,
  type TurnState,
} from "@/lib/sets/turn-plan";
import {
  composeReply,
  creditsLabel,
  fill,
  frameRowsChanged,
  replyThingsOf,
  replyWordsOf,
  turnDid,
  type FrameRow,
  type Outcome,
  type PageNote,
  type ReplyAction,
  type ReplyButton,
  type ReplyFacts,
  type ReplyModel,
  type TurnOutcomes,
} from "@/lib/sets/turn-reply";
import {
  HELIOS_SIMPLE_FOR_ALL,
  SET_COMPARE_PX,
  SET_MAX_TILT_DOWN_DEG,
  SET_MAX_TILT_UP_DEG,
  SET_THUMB_PX,
} from "@/lib/sets/set-config";
import { SET_LIMITS, STAND_POSES, specInstanceCount, type SetLayout, type SetSpec, type StandPose, type Vec3 } from "@/lib/sets/set-spec";
import { REHEARSAL_BITRATE, REHEARSAL_FPS, REHEARSAL_MAX_SECONDS, REHEARSAL_MIMES, clipSize, flightSteps, recordSize, rehearsalFits, rehearsalSeconds } from "@/lib/sets/rehearsal";
import type { SetCharacter, SetShot } from "@/lib/sets/types";
import { dropUnsaved, keepUnsaved, savedFilmKey, savedRigKey, takeUnsaved } from "@/lib/sets/unsaved";

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
// Nothing here touches money. The prices come from quoteSend (the function
// the server charges with, through take.ts), and shootInSet hands the frame
// to runGeneration like any other image send. Every paid press carries its
// own id, and a press whose answer is lost is followed by that id, never
// pressed again (press-follow.ts, 2026-09-25). Everything drawn comes from the
// normalised spec through build-scene.ts; three.js loads dynamically, only
// on this route.

type Pose = { position: Vec3; target: Vec3; fovDeg: number };


/** How long the stage takes to fly one beat's move. */
const MOVE_FLIGHT_MS = 1400;
/** A pointer rests this long on a move before the stage flies it: a sweep across the moves flies nothing. */
const MOVE_PREVIEW_REST_MS = 200;
/** A hovered move holds its end this long before it flies again. */
const MOVE_PREVIEW_HOLD_MS = 700;

/**
 * Fly the stage camera from one pose to another — the film's previz, free —
 * along the beat's own move (moves.ts poseAlong): round the person for an
 * arc or an orbit, her size held for a dolly zoom, straight for the rest.
 * A flight whose `alive` turns false lands where it is, at once.
 */
function tweenPose(
  api: { goTo(p: Pose): void },
  a: Pose,
  b: Pose,
  ms: number,
  move: FilmMove | null = null,
  alive: () => boolean = () => true,
  onStep?: (eased: number) => void,
): Promise<void> {
  return new Promise((resolve) => {
    const t0 = performance.now();
    const step = (now: number) => {
      if (!alive()) {
        resolve();
        return;
      }
      const k = Math.min(1, (now - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      api.goTo(poseAlong(move, a, b, e));
      onStep?.(e);
      if (k < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}
type Mark = { x: number; z: number; facingDeg: number };
/** Where the camera and the figure stand: what the stage's Undo steps back to. */
type StageState = { pose: Pose; cameraId: string | null; markId: string; mark: Mark };
const sameStage = (a: StageState, b: StageState) => JSON.stringify(a) === JSON.stringify(b);

/** The viewport's furniture (cut C): what the page hands the loop to move. */
type Furniture = {
  sun: HTMLElement | null;
  sunWords: (hour: number | null, elevationDeg: number) => string;
  bracket: HTMLElement | null;
  gizmo: SVGSVGElement | null;
  scale: HTMLElement | null;
  scaleWords: (metres: number) => string;
  measure: SVGSVGElement | null;
  measureWords: (metres: number) => string;
  points: readonly MeasurePoint[];
  /** The eye-line (cut D): where the figure looks, as a line from the eyes, with its words. */
  eyeline: SVGSVGElement | null;
  gazeTarget: { x: number; y: number; z: number } | "camera" | null;
  gazeText: string;
  /** The path (cut D): the selected beat's walk, from where it opens through its points to its figure. */
  pathSvg: SVGSVGElement | null;
  pathFrom: MeasurePoint | null;
  pathPoints: readonly MeasurePoint[];
  pathTo: MeasurePoint | null;
};

type StageApi = {
  /** Whether exposure.ts lifted this set's fill light or exposure. */
  lifted: boolean;
  goTo(pose: Pose): void;
  setFov(fovDeg: number): void;
  placeMark(mark: Mark): void;
  /** How the figure stands (cut 5): the stand-in's pose, in every frame shot from here on. */
  setPose(pose: StandPose): void;
  pose(): Pose;
  /** The viewport's mode (view-modes.ts): Lit, Clay, Wire or Depth, on the live view only — never the sketch. */
  setViewMode(mode: ViewMode): void;
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
  /** `grey`: things (element keys) drawn plain grey, their own sheets carrying their colour (2026-09-24). */
  frame(opts?: { from?: Pose; hideFigure?: boolean; cut?: boolean; grey?: readonly string[] }): string | null;
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
  /** The camera department (cut 2): how bright the stage is drawn, over the lift — the sketch carries it. */
  setExposureGain(gain: number): void;
  /** The viewfinder's false colour, on the live view only. */
  setFalseColour(on: boolean): void;
  /** Where the viewfinder's histogram is drawn, or null for none. */
  setHistogram(canvas: HTMLCanvasElement | null): void;
  /** The focus readout at the figure's eyes while the stop is set: the element, and the words for a distance. */
  setFocusHud(el: HTMLElement | null, words: ((distanceM: number) => string) | null): void;
  /** The viewport's furniture (cut C, furniture.ts): elements the loop moves — the sun, the focus bracket, the gizmo, the scale, the measure line. */
  setFurniture(f: Furniture | null): void;
  /** The hour the sun would stand at, dragged to this point of the canvas; null when the point is below the horizon. */
  sunHourAt(clientX: number, clientY: number): number | null;
  /** The light meter (cut 3): the words for the face's brightness, a share of white in per cent, or null for off. */
  setMeter(words: ((pct: number) => string) | null): void;
  /** Width ÷ height the recorded frame's field of view is measured against (1: across its height). */
  canvasAspect(): number;
  /**
   * The set changed under the camera (an Astra edit from the conversation,
   * editor-actions.ts): the drawn scene is replaced whole, the camera and
   * the figure stay where they are.
   */
  rebuild(next: SetSpec): void;
  /**
   * Film's overlay (film-overlay.ts): the move's path, its keyframes named
   * (`names`, in order), the selected beat's lenses. Drawn over the live
   * view for the person alone, as a scene of its own: no frame or snapshot
   * draws it. Null clears it.
   */
  setFilmOverlay(plan: FilmOverlayPlan | null, names: string[]): void;
  /** The overlay steps aside while the camera flies (the previz, a hover's flight): the view is then the path's own camera. */
  holdFilmOverlay(reason: "previz" | "hover", on: boolean): void;
  /** The set's things (elements.ts, R1): which blocks make each, what a tap and a thumbnail read. Replaced whole. */
  setElements(els: readonly StageElement[]): void;
  /** What a tap at this point of the page touched: a thumbnail first, then the nearest block or the figure (stage-pick.ts). */
  elementAt(clientX: number, clientY: number): ElementHit;
  /** The things' thumbnails over the stage, at each thing's anchor (the figure's over its head). Empty clears them. */
  setElementBadges(badges: readonly ElementBadge[]): void;
  /** The thing whose card is open, boxed on the stage; null for none. */
  setElementPicked(key: string | null): void;
  /**
   * The rehearsal (rehearsal.ts, 2026-09-23): the film's flight recorded off
   * the stage as a clip, frame by frame, in the sketch the image model is
   * sent — the grey mock in motion, which a re-shoot engine is given as the
   * shot's movement. `recordStart` opens the recorder (null when the browser
   * can't make a file an engine takes), `recordFrame` draws one frame from a
   * pose, `recordStop` closes it and hands back the clip.
   */
  recordStart(): { width: number; height: number; mime: string } | null;
  recordFrame(pose: Pose): void;
  recordStop(): Promise<{ blob: Blob; mime: string; frames: number } | null>;
  /**
   * The movers (movers.ts, 2026-09-23): the things that move in a beat,
   * driven to where they have got to, without rebuilding the stage — the
   * previz and the rehearsal draw one of these a frame. An empty list puts
   * everything back where the set was built. The frame a beat is SHOT on is
   * drawn from a set with them moved instead (movedSpec), so the sketch and
   * the words about it agree.
   */
  placeThings(placements: readonly Placement[]): void;
  /**
   * Real models (thing-model.ts, 2026-09-24): each thing given a model file
   * is drawn as that model instead of its blocks, fitted to where the blocks
   * stand; a thing left out goes back to its blocks. Answers, per model,
   * whether it loaded — a file that is not a model says so on its card.
   */
  /** `painted`: how many of the model's sides its drawings paint (blueprint-paint.ts); 0 when none fit. */
  setThingModels(models: readonly ThingModel[]): Promise<{ key: string; ok: boolean; painted?: number }[]>;
};

/** A model on a thing, as the page holds it (thing-model.ts): where it loads from, and whether it is kept with the set. */
type ThingOnStage = ThingModel & {
  name: string;
  storedKey: string | null;
  kept: "saving" | "saved" | "unsaved" | null;
  note: string | null;
};

/** What a tap on the ground lays (set-view's laying): null lays nothing. */
type Laying = "path" | "gaze" | "mover" | "mover-way" | null;

/** What the stage needs of a thing (elements.ts SetElement): its blocks, its box and where its thumbnail floats. */
type StageElement = Pick<SetElement, "key" | "members" | "anchor" | "min" | "max">;
/** A thing's thumbnail (R1): its first photo, ringed in the accent when its sheet rides the next still, with how many photos it has. */
type ElementBadge = { key: string; url: string; count: number; state: "rides" | "idle"; round?: boolean };

/** The overlay's inks (canvas pages H and I): the path and a lens in light, the selected lens in the accent. */
const OVERLAY_INK = "#ecedf1";
const OVERLAY_ACCENT = "#e0a468";

/** A keyframe on the path: a diamond on the point, its name beside it. Built from text nodes only. */
function overlayKeyLabel(name: string, selected: boolean): HTMLDivElement {
  const el = document.createElement("div");
  el.style.cssText = "position:relative;width:0;height:0;pointer-events:none";
  const size = selected ? 13 : 10;
  const diamond = document.createElement("span");
  diamond.style.cssText = `position:absolute;left:${-size / 2}px;top:${-size / 2}px;width:${size}px;height:${size}px;transform:rotate(45deg);border-radius:2px;background:${
    selected ? OVERLAY_ACCENT : OVERLAY_INK
  };box-shadow:0 0 0 1px rgba(0,0,0,0.5)`;
  const text = document.createElement("span");
  text.textContent = name;
  text.style.cssText = `position:absolute;left:12px;top:-9px;white-space:nowrap;border-radius:999px;background:rgba(0,0,0,0.55);padding:1px 7px;font-size:11px;line-height:16px;font-weight:${
    selected ? 600 : 500
  };color:${selected ? "#f0cda6" : "#d6d9e0"}`;
  el.append(diamond, text);
  return el;
}

/**
 * A thing's thumbnail on the stage (R1): the photo in a ring — the accent
 * when its sheet rides, a faint dash when it does not — and "+n" for the
 * photos behind it. Built from DOM nodes only. It never takes the pointer:
 * a drag that starts on it still orbits, and a tap finds it by its box
 * (stage-pick.ts badgeAt).
 */
function elementBadge(b: ElementBadge, coarse: boolean): HTMLDivElement {
  const size = coarse ? 32 : 28;
  const el = document.createElement("div");
  el.dataset.elementBadge = b.key;
  el.style.cssText = `position:relative;width:${size}px;height:${size}px;pointer-events:none;transition:opacity 150ms`;
  const img = document.createElement("img");
  img.src = b.url;
  img.alt = "";
  img.draggable = false;
  const ring = b.state === "rides" ? `2px solid ${OVERLAY_ACCENT}` : "1.5px dashed rgba(214,217,224,0.6)";
  img.style.cssText = `display:block;width:100%;height:100%;object-fit:cover;box-sizing:border-box;border-radius:${b.round ? "50%" : "7px"};border:${ring};box-shadow:0 1px 4px rgba(0,0,0,0.55);background:#1a1b1f`;
  el.append(img);
  if (b.count > 1) {
    const more = document.createElement("span");
    more.textContent = `+${b.count - 1}`;
    more.style.cssText = "position:absolute;right:-6px;bottom:-5px;border-radius:999px;background:rgba(0,0,0,0.75);padding:0 5px;font-size:10px;line-height:14px;font-weight:600;color:#ecedf1";
    el.append(more);
  }
  return el;
}

/** What Astra did with the last message, said above the frame. */
type FrameNote = {
  /**
   * The reader could not read the words (down, busy, not the shape): the
   * message, kept for "Use my words as what happens". Nothing changed and
   * nothing was shot (Helios Cut 2, step 1, 2026-09-25): the words used to
   * become what happens on their own, and "Shoot without asking" shot them.
   */
  down?: string;
  /** The message built this set on the Sets home, so its place part was not sent to Astra again. */
  built?: boolean;
  /** The words were about neither the frame nor the shot. */
  talk: boolean;
  /** How the camera had to move round something built, if it did. */
  moved: CameraMove | null;
  /** Just talking is on: the words were read, and nothing moved. */
  planned?: boolean;
  /**
   * The Sets home's message asked to shoot, and arrived in "Ask before
   * shooting": framed, and nothing shot until the person presses Shoot
   * (Helios Cut 3, money fix).
   */
  held?: boolean;
};

/**
 * A shot the chat decided, waiting for the render that holds its turn
 * (Helios Cut 2, spec §3.3): its one press id, still or take, and the turn
 * that asked for it.
 */
type ShootDue = { pressId: string; kind: "still" | "take"; turnId: number };
/** How long a due shot waits after the render that holds its turn: longer than the light's 60 ms rebuild. */
const SHOOT_DUE_MS = 150;

/** Where a turn came from and how its reading came back (Helios Cut 2, step 11a). */
type TurnContext = {
  source: TurnSource;
  why: ReaderWhy;
  dropped: readonly string[];
  messageCut: boolean;
  origin: "build" | null;
  /** The Sets home's message, run on arrival: in "Ask before shooting" it never shoots (Helios Cut 3, money fix). */
  home?: boolean;
  /** The reader's short names for this set's things and people, for LAST TURNS. */
  aliases: ReaderAliases;
  /** The person's message; null for a button's turn. */
  asked: string | null;
  /** A button's turn: the button's own label, so the reader's LAST TURNS says what was pressed (review of Cut 2, U1). */
  pressed: string | null;
};
const NO_ALIASES: ReaderAliases = { things: {}, people: {} };
/** A button's turn (Do it, a which-one, Use the hour, Undo): a stored reading, never read again, never shot. */
const TURN_BUTTON: TurnContext = { source: "button", why: "ok", dropped: [], messageCut: false, origin: null, aliases: NO_ALIASES, asked: null, pressed: null };
/**
 * A priced "Do it and shoot · n" or "Do it and take · n": the row runs as a
 * button turn, then the shot it paid for is decided on what the row ran
 * into (turn-plan.ts paidDecision; review of Cut 2, S1).
 */
type PaidRow = { paid: "still" | "take" };

/** One turn of the set's chat (reader v2): what was asked, what the page made of it and did, and the reply said from that. */
type ChatTurn = {
  id: number;
  asked: string | null;
  /** "build" for the Sets home's message to the set it just built: Try again reads it as that again (review of Cut 2, S5). */
  origin: "build" | null;
  /**
   * The reader's short names this turn was said in: a button pressed on it
   * runs with them, so its LAST TURNS line names the same car (review of
   * Cut 2, U1), and the label it was pressed by.
   */
  aliases: ReaderAliases;
  pressed: string | null;
  plan: TurnPlan;
  /** What the page's steps reached; null for a turn nothing ran for (said as planned). */
  outcomes: TurnOutcomes | null;
  /** The page as the reply read it after the turn, with the shot it decided. */
  facts: ReplyFacts;
  reply: ReplyModel;
  /** What the turn did in the page's own words, for the reader's LAST TURNS (turn-reply.ts turnDid). */
  did: string;
  /** The stills and takes on the strip when it was said: one that lands after it carries its words, and the turn folds into it. */
  shotsAt: number;
  /** Answered — a later turn, or a press on this one: its buttons go (Undo stays while it is the newest). */
  settled: boolean;
};
/** A turn kept to undo, with the turn it belongs to (an Astra change it pressed joins it later). */
type PageSnapshot = TurnSnapshot & { turnId: number };
/** Turns shown this visit, like the frame's revisions. */
const TURNS_KEPT = 12;
/** The chat's "/" menu shows this many of ⌘K's commands at once; typing narrows them (Cut 2, step 11b). */
const SLASH_ROWS = 8;
/** Past this many characters the composer counts toward what the reader reads (SHOT_WORDS_MAX_CHARS, 600; spec §3.7). */
const COMPOSER_COUNT_FROM = 500;
/** What a camera word step changes, for its chip: the last step of each kind says where the camera got to. */
const STEP_DIMENSION: Record<ReaderStep, "distance" | "height" | "side" | "tilt" | "lens"> = {
  closer: "distance",
  further: "distance",
  higher: "height",
  lower: "height",
  left: "side",
  right: "side",
  other_side: "side",
  tilt_up: "tilt",
  tilt_down: "tilt",
  wider: "lens",
  longer: "lens",
};

/** The ⌘K ids a rig restored by Undo is back on, as chips: each look, the hour and the exposure (commands.ts). */
function rigRestoredChips(from: SetRig, to: SetRig): Outcome[] {
  const ids = new Set(rigCommandIds());
  const out: Outcome[] = [];
  const id = (x: string) => (ids.has(x) ? out.push({ kind: "rig", id: x }) : 0);
  if (to.format !== from.format) id(`format:${to.format}`);
  if (to.squeeze !== from.squeeze) id(`squeeze:${to.squeeze}`);
  if (to.stop !== from.stop) id(to.stop === null ? "stop:off" : `stop:${to.stop}`);
  if ((to.light?.scheme ?? null) !== (from.light?.scheme ?? null)) id(to.light ? `light:${to.light.scheme}` : "light:as-built");
  if (to.time !== from.time) {
    const preset = TIME_PRESETS.find((p) => p.hour === to.time);
    if (to.time === null) id("time:as-built");
    else if (preset) id(`time:${preset.id}`);
    else out.push({ kind: "hour", hour: to.time });
  }
  if (to.stock !== from.stock) id(to.stock ? `stock:${to.stock}` : "stock:none");
  if (to.lens !== from.lens) id(to.lens ? `character:${to.lens}` : "character:none");
  if (to.palette !== from.palette) id(to.palette ? `palette:${to.palette}` : "palette:none");
  if (to.era !== from.era) id(to.era ? `era:${to.era}` : "era:none");
  if (to.genre !== from.genre && to.genre) id(`genre:${to.genre}`);
  if (to.ev !== from.ev) out.push({ kind: "ev", ev: to.ev });
  return out;
}

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
/** A take's two frames and what rendered between them (take.ts), with the words that asked for it: enough to render the clip again. */
type TakeFrames = TakeSource & { words?: string };
/** What a Shoot and a Take answer: a lost answer followed by its press id comes back as the same (press-follow.ts). */
type ShootAnswer = Awaited<ReturnType<typeof shootInSet>>;
type TakeAnswer = Awaited<ReturnType<typeof takeInSet>>;

const sourceOf = (f: TakeFrames): TakeSource => ({ start: f.start, end: f.end, characterId: f.characterId, direction: f.direction, engine: f.engine });
/** A take's frames as the retry sends them: what it was rendered from (SetShot.takeFrom) and the words kept with it. */
const framesOf = (source: TakeSource, shot: SetShot): TakeFrames => ({ ...source, words: shot.words ?? undefined });

type MenuId = "camera" | "figure" | "pose" | "gaze" | "look" | "history" | "mode" | "who" | "filmStart" | "engine";

const ACCENT = "#c8923a";
const TURN_STEP = 30;
// Framing the figure: a full-length shot, a little headroom and floor.
const FRAME_HEIGHT_M = 2.3;
const FRAME_TARGET_Y = 0.95;
// How far a tilt may go (SET_MAX_TILT_UP_DEG, SET_MAX_TILT_DOWN_DEG) is in
// set-config.ts: a matched shot is held to the same limits. The up limit
// keeps a tilt inside the orbit's maxPolarAngle below.
/** Frames kept to step back to. */
const REVISIONS_MAX = 12;
/** How many moves the stage's Undo remembers this visit. */
const STAGE_UNDO_MAX = 40;
/** Gestures closer together than this are one move: a scroll's ticks, a quick run of drags or turns. */
const STAGE_GESTURE_GAP_MS = 700;
const DEG = Math.PI / 180;

// ---- the workspace's skin (2026-09-14, "make it work exactly like
// higgsfield"): the viewport IS the page, dark in both themes like the
// stage and the Build editor, with the conversation as a panel floating
// inside it and the setup as glass chips on the picture itself. ----
/** A glass chip on the stage. */
const DCHIP =
  "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-[rgba(255,255,255,0.1)] bg-black/60 px-3 text-xs font-medium text-onmedia/90 backdrop-blur transition-colors hover:bg-black/80 disabled:cursor-default disabled:text-onmedia/60";
/** The same chip, lit ochre — the kept look. */
const DCHIP_ON =
  // A 70% scrim, not 60%: the ochre read at 3.8:1 over a daylight render.
  "inline-flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-full border border-transparent bg-black/70 px-3 text-xs font-medium text-[#f0cda6] backdrop-blur shadow-[inset_0_0_0_1.5px_rgba(240,196,142,0.75)]";
// A menu's surface, dark, WITHOUT where it sits: the placement belongs to
// the menu itself. Tailwind classes do not override by the order they are
// written — `top-auto` after DMENU's `top-full` left both edges pinned, and
// the mode menu at the composer's foot collapsed to a 14 px sliver with its
// three options scrolled out of sight (found on the stage, 2026-09-16).
const DMENU_BASE =
  "absolute z-40 flex max-h-80 min-w-[11rem] flex-col gap-0.5 overflow-y-auto rounded-[12px] border border-[rgba(255,255,255,0.11)] bg-[#1d1e24] p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]";
/** A menu opened downward from a chip, dark. */
const DMENU = `${DMENU_BASE} left-0 top-full mt-2`;
/** The same menu opened upward, for a chip at the foot of the panel. */
const DMENU_UP = `${DMENU_BASE} left-0 bottom-full mb-2`;
/** The same menu, hung from the right edge of a chip near the window's. */
const DMENU_RIGHT = `${DMENU_BASE} right-0 top-full mt-2`;
/** The conversation panel's surface. */
const PANEL_BG = "border border-[rgba(255,255,255,0.11)] bg-[rgba(25,26,32,0.96)] shadow-[0_24px_56px_-16px_rgba(0,0,0,0.6)]";

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
        active ? "bg-[rgba(255,255,255,0.08)] font-medium text-[#ecedf1]" : "text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#ecedf1]"
      }`}
    >
      <span className="tabular-nums">{children}</span>
      {active ? <span aria-hidden>✓</span> : hint ? <span className="text-[11px] text-[#9aa0ad]">{hint}</span> : null}
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
  modelsOn = false,
  simpleLayout = false,
  initialThingModels = [],
  takesOn,
  liveOn = false,
  initialAsk = null,
  initialCharacterId = null,
  initialAskFirst = true,
  savedFilm = null,
  initialFilmOpen = false,
  initialCutOpen = false,
  savedRig = null,
  initialElementPhotos = { photos: [], sheets: [] },
  stillModel = "gpt-image",
  unshootable = [],
  astraEditsLeft,
  astraEditsCap,
  initialAskBuilt = false,
  readerV2 = false,
  producerOn = false,
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
  /** Whether a model file can be put on a thing (thing-model.ts): admins, while our own model builder is proved. */
  modelsOn?: boolean;
  /**
   * Whether the new layout (Set · Shoot · Film) is offered here: admins, and
   * every account once set-config.ts HELIOS_SIMPLE_FOR_ALL is on (data.ts
   * simpleLayout; Helios Cut 3, step 10). Its own gate, not models'.
   */
  simpleLayout?: boolean;
  /** The models kept with the set (thing-model-store.ts): each thing's newest, by the key it was kept under. */
  initialThingModels?: { key: string; url: string; flip: boolean }[];
  /**
   * Whether this plan takes clips and renders films — start-and-end-frame
   * clips, every paid plan's (set-config.ts setTakesEligible). Otherwise the
   * page says so before a take is framed; takeInSet checks again.
   */
  takesOn: boolean;
  /** Whether a finished still offers "Direct it live" — /app/live opening on the still, the shot's words as the opening (Live, 2026-09-24). */
  liveOn?: boolean;
  /** The photos on the set's things and the sheets already drawn (R1, references.ts listElementPhotos). */
  initialElementPhotos?: { photos: ElementPhoto[]; sheets: string[] };
  /** The picture model stills are drawn with: the things' sheets ride GPT Image only (elements.ts planShotSheets). */
  stillModel?: string;
  /** The person's characters with no photo yet (R1): named when this page is asked to cast one. */
  unshootable?: { id: string; name: string }[];
  /**
   * The month's Astra changes left when the page was drawn (data.ts
   * astraEditsLeft): null for no cap (admins) or a count that could not be
   * read. The Astra card says it; the action holds the cap.
   */
  astraEditsLeft: number | null;
  /** The plan's Astra changes a month (set-config.ts setEditsMonthlyLimit): −1 for no cap, 0 for none. */
  astraEditsCap: number;
  /**
   * The chat reads with reader v2 and runs each message as one turn
   * (Helios Cut 2, step 11a, 2026-09-25): admins until the phrase check
   * passes (data.ts readerV2). Otherwise, or when the server says "off",
   * the chat is v1's, with the same money guards.
   */
  readerV2?: boolean;
  /** The Producer's lamp is on this page, so "do it elsewhere" can hand the words to it (Cut 2, step 12). */
  producerOn?: boolean;
  /**
   * The message in `initialAsk` is the one the Sets home just built this
   * set from (?from=build): what it says about the place is already built,
   * so it is never handed to Astra again (Helios Cut 2, 2026-09-25).
   */
  initialAskBuilt?: boolean;
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
  /** The Cut mode (cut C): the film's clips in order, where the reel plays. */
  initialCutOpen?: boolean;
  /** The saved rig (Helios Cinema): null until one is kept, or before helios-rig.sql runs. */
  savedRig?: SetRig | null;
}) {
  const { t, locale } = useLocale();
  const router = useRouter();
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
  // The figure's pose (cut 5): saved with the arrangement, drawn in the sketch.
  const [pose, setPose] = useState<StandPose>(initialLayout?.pose ?? "stand");
  // The camera as it stands, for what Astra says about the frame: kept up
  // to date whenever a move settles (scheduleSave), since a ref is not read
  // during render.
  const [poseNow, setPoseNow] = useState<Pose>(startPose);
  // Who plays the figure (R1): the character asked for (?character=, the
  // character form coming back), else the one this set last cast, else the
  // first.
  const [characterId, setCharacterId] = useState(
    () =>
      characters.find((c) => c.id === initialCharacterId)?.id ??
      characters.find((c) => c.id === initialLayout?.castId)?.id ??
      characters[0]?.id ??
      "",
  );
  // What happens in the frame: the shot prompt's direction, read out of the
  // person's last message (shot-words.ts) or, when the reader could not
  // read it, the message itself.
  const [direction, setDirection] = useState("");
  const [shooting, setShooting] = useState(false);
  // A paid press whose answer was lost is being followed by its id
  // (press-follow.ts, 2026-09-25): Shoot stays held meanwhile, and the page
  // says "still rendering" instead of "try again" — once a read has shown the
  // press at work. Until then it says it is checking (review, 2026-09-25: an
  // offline press said "still rendering" for five and a half minutes).
  const [following, setFollowing] = useState<"checking" | "rendering" | null>(null);
  // The still engine a press in flight was sent with, for the line that
  // names it while it is drawn (the pill may change meanwhile).
  const [pressEngine, setPressEngine] = useState<string>(stillModel);
  const [error, setError] = useState(() => {
    const asked = initialCharacterId && !characters.some((c) => c.id === initialCharacterId) ? unshootable.find((u) => u.id === initialCharacterId) : undefined;
    return asked ? formatMsg(t.sets.cast.notCastable, { name: asked.name }) : "";
  });
  // ---- a deploy that leaves this tab behind ----
  // Once a deploy lands while the page is open, every call from it throws
  // (stale-deploy.ts), and only a reload cures that. The page says so and
  // reloads, once (reloadForNewDeploy's guard); what the autosaves could not
  // save is kept for this tab (unsaved.ts) and comes back after the reload.
  const staleRef = useRef(false);
  const refreshNeeded = t.generate.refreshNeeded;
  /** Whether `err` is that; if so, the reload is on its way. */
  /**
   * Whether `err` is a deploy that left this tab behind — and, if so, the one
   * shared reload is on its way (stale-deploy.ts: at most one per tab per
   * 30 s, the guard AppErrorReporter uses). Every place that used to call
   * reloaded the page itself now asks this, so a failure a reload
   * cannot cure reloads an autosaving page once, not over and over
   * (2026-09-18). The caller says it in its own words, on its own line.
   */
  const staleHere = useCallback((err: unknown): boolean => {
    if (!isStaleDeployError(err)) return false;
    if (staleRef.current) return true;
    if (reloadForNewDeploy({ delayMs: 1800 })) staleRef.current = true;
    return true;
  }, []);
  /** The same, said on the page's own error line. */
  const leftBehind = useCallback(
    (err: unknown): boolean => {
      if (!staleHere(err)) return false;
      setError(refreshNeeded);
      return true;
    },
    [staleHere, refreshNeeded],
  );
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
  /** A thing Astra is rebuilding from its photos (thing-rebuild.ts), and what the last rebuild said, on its card. */
  const [rebuilding, setRebuilding] = useState<string | null>(null);
  /** A thing whose 3D model is being built from its photo (thing-build.ts), and why the last build didn't land, on its card. */
  const [buildingModel, setBuildingModel] = useState<string | null>(null);
  const [buildNote, setBuildNote] = useState<{ key: string; text: string } | null>(null);
  /**
   * The picture engine stills are drawn with (2026-09-24, "Cant change from
   * gpt to nano banana"): the composer's own two lanes, remembered in this
   * browser, the admin default until one is picked. The server re-checks it.
   */
  const [stillEngine, setStillEngine] = useState<string>(stillModel);
  useEffect(() => {
    try {
      const kept = window.localStorage.getItem("helios.stillEngine");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read once from the browser after hydration
      if (kept && (SELECTABLE_IMAGE_MODEL_IDS as readonly string[]).includes(kept)) setStillEngine(kept);
    } catch {
      // No storage: the default stays.
    }
  }, []);
  function pickStillEngine(id: string) {
    setStillEngine(id);
    setMenu(null);
    try {
      window.localStorage.setItem("helios.stillEngine", id);
    } catch {
      // Remembered for this visit only.
    }
  }
  /** The look stayed out of the last still on purpose: it showed a thing now drawn from its own photos. */
  const [lookAside, setLookAside] = useState(false);
  const [rebuildNote, setRebuildNote] = useState<{ key: string; text: string; ok: boolean; from?: string } | null>(null);
  const [setChanged, setSetChanged] = useState<number | null>(null);
  // What the changed line's Undo did, said once where the line stood: the
  // change is undone (and still counts this month), or its pieces are but
  // its description could not come back (Helios Cut 2, step 2).
  const [undoNote, setUndoNote] = useState<"undone" | "textKept" | null>(null);
  // The month's Astra changes left, as the last answer that carried a
  // number said it (Helios Cut 2, step 1, 2026-09-25): seeded from the
  // page's read and replaced only by a NUMBER — an edit's or a rebuild's
  // answer, success or not, or a followed press once it has ended. A null
  // (no cap, or a count that could not be read) keeps the last one, so the
  // card never goes stale on a count it had, nor claims "no monthly cap".
  //
  // A change that SAVED with no count (the month's count could not be read)
  // makes the count unknown instead: the last number was from before it,
  // one too many (review of Cut 2, S4). A change that did not save gives its
  // reservation back, so the last number stays true.
  const [editsLeft, setEditsLeft] = useState<number | null>(astraEditsLeft);
  const keepEditsLeft = (n: number | null | undefined, saved = false) => {
    const next = typeof n === "number" && Number.isFinite(n) ? Math.max(0, n) : saved ? null : undefined;
    if (next !== undefined) setEditsLeft(next);
  };
  // A change to the set itself, waiting on the Astra card for its press:
  // the person's words, as they asked. Nothing reaches Astra without that
  // press, in any mode (the owner's decision 1).
  const [astraAsk, setAstraAsk] = useState<{ words: string } | null>(null);
  // The chat's turns (Helios Cut 2, reader v2, step 11a): this visit's, the
  // newest last, each with its reply; the turns kept to undo; and whether
  // the server said reader v2 is not this account's after all ("off").
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const turnIdRef = useRef(0);
  const turnUndoRef = useRef<PageSnapshot[]>([]);
  const [readerOff, setReaderOff] = useState(false);
  const readerOffRef = useRef(false);
  const v2On = readerV2 && !readerOff;
  // Every sentence of a reply, from the person's own catalog (turn-reply.ts).
  const replyWords = useMemo(() => replyWordsOf(t), [t]);
  // The conversation panel floats over the stage and can fold away.
  const [chatOpen, setChatOpen] = useState(true);
  // A photo set's photo beside camera 1, folded behind a chip.
  const [compareOpen, setCompareOpen] = useState(false);
  // A take under way: the still it starts from, while the end is framed —
  // and who set it up (Helios Cut 2, critic item 1, 2026-09-25). The person,
  // by "Take it somewhere", or the chat, for a moving shot it was asked for:
  // the chat's own take renders only from a press priced as a take, never
  // from a message, a mode or a generic Shoot (turn-plan.ts pressFor).
  const [takeStart, setTakeStart] = useState<TakeStart | null>(null);
  // The move and textures a take rides with (moves.ts), kept for take():
  // set by the chat for a moving shot; gone with the take.
  const takeMoveRef = useRef<TakeMove | null>(null);
  useEffect(() => {
    if (!takeStart) takeMoveRef.current = null;
  }, [takeStart]);
  // Where she stands across the frame, the thirds (Helios Cut 2, the
  // owner's decision 5): set by the chat's words, kept by its later word
  // solves, and ended by any move made by hand (keepStage), so NOW never
  // says "on the left third" after an orbit (check of the spec, item 6).
  const frameXRef = useRef<FrameX>("centre");
  // The saved outfit photo sits the next still or take out, when the chat's
  // words said what they wear (Helios Cut 2, step 9's outfit: false).
  const outfitOffRef = useRef(false);
  // Every press id a Shoot or a Take has sent this visit: one press, one
  // send, even when a decision's own id is handed in twice (spec §3.8 rule 8).
  const sentPressIdsRef = useRef<Set<string>>(new Set());
  // Which engine renders the take (take.ts): Omni the take, Veo the premium
  // take. Reset to the default when a new take starts, so the price on the
  // button is never a leftover from an earlier, pricier choice.
  const [takeEngine, setTakeEngine] = useState<SetTakeEngine>(SET_TAKE_DEFAULT_ENGINE);

  // ---- the film: the move (Helios Film, drawn as canvas page H) ----
  // The dock replaces the filmstrip while it is open; the stage stays the
  // stage — orbit to a view, K keeps it as a beat's end. The move autosaves
  // like the editor's working copy; rendering is a chain of takes.
  const [filmOpen, setFilmOpen] = useState(initialFilmOpen);
  const [cutOpen, setCutOpen] = useState(initialCutOpen);
  const [film, setFilm] = useState<SetFilm>(() => normaliseSetFilm(savedFilm));
  // What the server holds of the film, compared the way unsaved.ts compares
  // it: as loaded, then as each save landed.
  const [loadedFilmKey] = useState(() => savedFilmKey(savedFilm));
  const filmSavedRef = useRef(loadedFilmKey);
  const [filmSel, setFilmSel] = useState<number | null>(null);
  /** Rendering: which beat the chain is on, and whether its lost answer is being followed (press-follow.ts); null when idle. */
  const [filmBusy, setFilmBusy] = useState<{ beat: number; clipOnly: boolean; following?: "checking" | "rendering" } | null>(null);
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
  /**
   * This page is still on screen. A film renders beat after beat from here
   * (renderFilm), and a link inside the app unmounts the page without ending
   * that chain: the beats that were left were still rendered and still
   * charged, while filmLeaveConfirm promises the render stops after the beat
   * it is on (found reviewing Helios, fixed 2026-09-18). Nothing in flight is
   * abandoned — that beat is paid for, so it is waited for and kept — but no
   * new beat is started.
   */
  const aliveRef = useRef(true);
  useEffect(() => {
    // Set on every mount, not only at creation: React runs a page's effects
    // again when it shows it again (development runs them twice on purpose),
    // and a flag cleared by the first cleanup and never set back read
    // "left the page" for good — every film render then stopped before its
    // first beat, saying nothing (2026-09-21, "the buttons do not work").
    aliveRef.current = true;
    return () => {
      aliveRef.current = false;
    };
  }, []);
  /**
   * Save the film, never throwing. A film that does not save is kept for
   * this tab (unsaved.ts) and said in the dock; once a deploy has left the
   * tab behind nothing more is sent, and the reload saves it.
   */
  const saveFilm = useCallback(
    (next: SetFilm) => {
      const missed = () => keepUnsaved(setId, "film", next, filmSavedRef.current);
      if (staleRef.current) {
        missed();
        return;
      }
      const sentAt = new Date().getTime();
      saveSetFilm(setId, next).then(
        (r) => {
          if (r.error === null) {
            filmSavedRef.current = savedFilmKey(next);
            dropUnsaved(setId, "film", sentAt);
            return;
          }
          missed();
          setFilmError(r.error);
        },
        (err) => {
          missed();
          if (!leftBehind(err)) setFilmError(SET_SAVE_FAILED);
        },
      );
    },
    [setId, leftBehind],
  );
  const editFilm = useCallback((fn: (f: SetFilm) => SetFilm) => {
    if (filmBusyRef.current) return;
    setFilm((f) => filmAfterEdit(f, fn(f)));
  }, []);
  // A film with no start picks the newest finished still for itself, the
  // moment Film or Cut opens (2026-09-21): a new film used to wait on the
  // start tile's menu, and until then Render stayed disabled with nothing
  // saying why. The tile shows which still it is; the menu still changes it.
  const newestFinishedStill = shots.find((sh) => sh.kind === "still" && sh.status === "succeeded")?.generationId ?? null;
  useEffect(() => {
    if (!(filmOpen || cutOpen) || film.startId || !newestFinishedStill) return;
    editFilm((f) => (f.startId ? f : { ...f, startId: newestFinishedStill }));
  }, [filmOpen, cutOpen, film.startId, newestFinishedStill, editFilm]);
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
  /** The film's one file is being made (downloadFilm). */
  const [filmFileBusy, setFilmFileBusy] = useState(false);
  const [previz, setPreviz] = useState(false);
  // The rehearsal (rehearsal.ts, 2026-09-23): the film's flight recorded off
  // the stage as a clip — what a re-shoot engine is given as the shot's
  // motion. Held in the page only until it is sent or the page is left.
  const [recording, setRecording] = useState(false);
  // The new layout (things-panel.tsx, 2026-09-24): offered where
  // `simpleLayout` says (admins, and everyone once HELIOS_SIMPLE_FOR_ALL is
  // on), switched from the bar, remembered in this browser (or
  // ?layout=simple / ?layout=classic). While it is an admin's draft it is
  // off until asked for; once it is everyone's it is the default, and it
  // starts on, so a load never paints Classic first; a stored "classic"
  // opts that browser out. The stage, the shots and every action are the
  // same; only where they are drawn changes. Set and Shoot are both today's
  // shooting mode, told apart by what the right-hand panel holds; Film is
  // Film.
  const [simple, setSimple] = useState<boolean>(() => simpleLayout && HELIOS_SIMPLE_FOR_ALL);
  const [simpleStep, setSimpleStep] = useState<"set" | "shoot">("set");
  useEffect(() => {
    if (!simpleLayout) return;
    let want: boolean = HELIOS_SIMPLE_FOR_ALL;
    try {
      const asked = new URLSearchParams(window.location.search).get("layout");
      const stored = asked ? null : window.localStorage.getItem("helios.layout");
      want = asked ? asked === "simple" : HELIOS_SIMPLE_FOR_ALL ? stored !== "classic" : stored === "simple";
    } catch {
      // No storage (a private window): the default layout.
    }
    setSimple(want);
  }, [simpleLayout]);
  // The first visit (first-visit.tsx; Helios Cut 3, step 9): three tips on a
  // set with no stills, once per browser. `tips` is the one showing, null
  // when the card is away. ?tour=1 shows them again.
  const [tips, setTips] = useState<number | null>(null);
  const tourAskedRef = useRef(false);
  // ?tour=1 is read once and the address forgets it here, in its own effect:
  // the ?ask= effect below clears the address only when a message came, so
  // left to it a reload would replay the tips.
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("tour")) return;
    tourAskedRef.current = url.searchParams.get("tour") === "1";
    url.searchParams.delete("tour");
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, []);
  const tipsCheckedRef = useRef(false);
  useEffect(() => {
    if (!ready || tipsCheckedRef.current) return;
    tipsCheckedRef.current = true;
    let seen = false;
    try {
      seen = window.localStorage.getItem(HELIOS_TOUR_KEY) === "1";
    } catch {
      // Blocked storage counts as seen, like the video tour: a card that
      // could never be put away for good would come back on every visit.
      seen = true;
    }
    if (tourAskedRef.current || (!seen && initialShots.length === 0)) setTips(0);
  }, [ready, initialShots.length]);
  /** × and Close: the tips are away, and this browser has seen them. */
  function closeTips() {
    setTips(null);
    try {
      window.localStorage.setItem(HELIOS_TOUR_KEY, "1");
    } catch {
      // Blocked storage already counts as seen.
    }
  }
  /**
   * Models on things (thing-model.ts, 2026-09-24): the stage draws each in
   * place of its thing's blocks. A model loaded here shows at once from the
   * file itself, and is kept with the set behind it (model-actions.ts);
   * `storedKey` is the key it is kept under, which after an edit to the
   * set may not be the key its thing has now (modelHome).
   */
  const [thingModels, setThingModels] = useState<ThingOnStage[]>(() => {
    const at = elementsOf(initialSpec);
    return initialThingModels.flatMap((m) => {
      const key = modelHome(m.key, at);
      return key ? [{ key, url: m.url, flip: m.flip, name: "", storedKey: m.key, kept: "saved" as const, note: null }] : [];
    });
  });
  const [thingModelState, setThingModelState] = useState<Record<string, "loading" | "ready" | "failed">>({});
  /** How many sides of each model its drawings paint (blueprint-paint.ts): 0 when none fit. */
  const [thingPainted, setThingPainted] = useState<Record<string, number>>({});
  const thingModelsRef = useRef(thingModels);
  useEffect(() => {
    thingModelsRef.current = thingModels;
  }, [thingModels]);
  useEffect(() => () => {
    for (const m of thingModelsRef.current) if (m.url.startsWith("blob:")) URL.revokeObjectURL(m.url);
  }, []);
  const [rehearsal, setRehearsal] = useState<{ url: string; mime: string; seconds: number; frames: number; bytes: number } | null>(null);
  const rehearsalBlobRef = useRef<Blob | null>(null);
  // The clip is held by the browser until the page is left: its object URL
  // is the only thing keeping those bytes, so it is let go on the way out.
  const rehearsalUrlRef = useRef<string | null>(null);
  useEffect(() => {
    rehearsalUrlRef.current = rehearsal?.url ?? null;
  }, [rehearsal]);
  useEffect(() => () => {
    if (rehearsalUrlRef.current) URL.revokeObjectURL(rehearsalUrlRef.current);
  }, []);
  // The sequencer (cut B): where the playhead stands, seconds into the
  // film, and which previz run is the live one — Stop retires it.
  const [playhead, setPlayhead] = useState(0);
  const previzRunRef = useRef(0);
  /** The move pick in the air, if any: its run and the pose it flew from (filmMove). */
  const pickFlightRef = useRef<{ run: number; from: Pose } | null>(null);

  // ---- the rig (Helios Cinema, drawn as canvas page I) ----
  // The camera department, docked left of the stage: the frame's shape, the
  // lens, the film stock, focus, light and palette, saved on the set like
  // the film. The stage reads it through a ref (it is built once), and shows
  // every choice before a credit moves: the frame lines, the field of view,
  // the depth of field, the light, the grade.
  const [rig, setRig] = useState<SetRig>(() => normaliseSetRig(savedRig));
  const rigRef = useRef<SetRig>(rig);
  // The rig as the server holds it, like the film's.
  const [loadedRigKey] = useState(() => savedRigKey(savedRig));
  const rigSavedRef = useRef(loadedRigKey);
  const [rigOpen, setRigOpen] = useState(false);
  // The command palette (the studio, cut 4): ⌘K, or the pill in the bar.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // The studio's frame (studio.ts, studio-frame.tsx; cut A, 2026-09-17):
  // the dock's tab, the rail's tool, the viewport's mode, the frame rate
  // for the status bar. Film opening takes the dock to its tab; closing on
  // it goes back to Camera (adjust-state-during-render, as the rig did).
  const wide = useWide();
  /**
   * The width the new layout's three columns need (Helios Cut 3, step 11):
   * the list and the panel take 272 + 340 px, which leaves the stage 568 px
   * at 1180 (an iPad Air on its side). Between a phone and this, Classic.
   */
  const wide3 = useWideAt("(min-width: 1180px)");
  /** The new layout is drawn: switched on, where it is offered, on a screen wide enough for its three columns. */
  const simpleOn = simple && wide3 && simpleLayout;
  /** The new layout on a phone: the same steps; in Set the list is a strip over the stage's foot, and nothing else moves. */
  const simplePhone = simple && !wide && simpleLayout;
  /** A phone's Set step: the setup chips step aside (they are Shoot's), and the strip names who and what is in the set. */
  const simplePhoneSet = simplePhone && !filmOpen && !cutOpen && simpleStep === "set";
  const [dockTab, setDockTab] = useState<DockTab>("astra");
  const [dockFilmWas, setDockFilmWas] = useState(filmOpen);
  if (dockFilmWas !== filmOpen) {
    setDockFilmWas(filmOpen);
    // Leaving Film in the new layout goes back to the conversation, not the
    // camera department (Helios Cut 3, step 13): Shoot's panel would
    // otherwise open it unasked. Opening Film, and Classic at every width
    // (a tablet's too, where `simple` can be on but the layout is Classic),
    // keep the dock's own rule, so Classic's Film tab still opens.
    setDockTab(simpleOn && !filmOpen ? "astra" : dockTabAfter(dockTab, "shoot", filmOpen, filmOpen));
  }
  const [stageTool, setStageTool] = useState<RailTool>("select");
  const stageToolRef = useRef<RailTool>("select");
  useEffect(() => {
    stageToolRef.current = stageTool;
  }, [stageTool]);
  const [viewMode, setViewMode] = useState<ViewMode>("lit");
  const [fps, setFps] = useState(0);
  const [sceneQuery, setSceneQuery] = useState("");
  // The viewport's furniture (cut C): the measure tool's points on the
  // ground, the sun's drag, and the elements the loop moves.
  const [measurePts, setMeasurePts] = useState<MeasurePoint[]>([]);
  const measureAddRef = useRef<(p: MeasurePoint) => void>(() => {});
  useEffect(() => {
    measureAddRef.current = (p) => setMeasurePts((pts) => (pts.length >= 2 ? [p] : [...pts, p]));
  }, []);
  const sunDragRef = useRef(false);
  const sunRef = useRef<HTMLButtonElement>(null);
  const bracketRef = useRef<HTMLDivElement>(null);
  const gizmoRef = useRef<SVGSVGElement>(null);
  const scaleRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<SVGSVGElement>(null);
  // The people (cut D, people.ts): where the figure looks, saved with the
  // arrangement; and a laying mode, when the next press on the ground is
  // the gaze's point or a point of the selected beat's path.
  const [gaze, setGaze] = useState<Gaze | null>(initialLayout?.gaze ?? null);
  useEffect(() => {
    layoutRef.current = { ...layoutRef.current, gaze };
  }, [gaze]);
  // What a tap on the ground lays: the figure's path, its eye-line, or
  // where the open card's thing drives to in this beat and the way it goes
  // (movers.ts, 2026-09-23).
  const [laying, setLaying] = useState<Laying>(null);
  const layingRef = useRef<Laying>(null);
  useEffect(() => {
    layingRef.current = laying;
  }, [laying]);
  const layAddRef = useRef<(kind: NonNullable<Laying>, p: MeasurePoint) => void>(() => {});
  const eyelineRef = useRef<SVGSVGElement>(null);
  const pathRef = useRef<SVGSVGElement>(null);
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
  // The chat's "/" menu (Helios Cut 2, step 11b): ⌘K's commands, typed
  // into the composer — the row picked with ↑↓, and Esc to write a message
  // that starts with "/" instead.
  const [slashAt, setSlashAt] = useState(0);
  const [slashOff, setSlashOff] = useState(false);
  const draftRef = useRef<HTMLTextAreaElement | null>(null);
  // Which toolbar menu is open, if any.
  const [menu, setMenu] = useState<MenuId | null>(null);
  // The viewer: a still in the stage's place, or the frame itself (null).
  const [viewing, setViewing] = useState<string | null>(null);
  // Frames set this visit, to step back to.
  const [revisions, setRevisions] = useState<Revision[]>([]);
  // What this visit knows of the stills it shot.
  const [shotFacts, setShotFacts] = useState<Record<string, ShotFacts>>({});
  // What each take was rendered from rides on its row (SetShot.takeFrom:
  // the server's for takes of earlier visits, shot-take.ts; the page's own
  // for takes started now), so a clip that fails can be rendered again
  // between the same two frames — only the clip to pay for, and the frame
  // the person already saw. A film's beats are the film's to render again
  // (filmJobs), so they carry none.
  // A take whose end frame came in and whose clip could not start.
  const [takeRetry, setTakeRetry] = useState<TakeFrames | null>(null);
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
  // The same pin as state, for what is worked out while drawing (the film's
  // look and its price): a ref is not read during render.
  const [lookPinned, setLookPinned] = useState(false);
  // The set's things and their reference photos (R1, 2026-09-21, "add an
  // option for the user to upload references — person, vehicle, objects"):
  // a tap on a car or an object opens its card, its photos become one
  // sheet, and the sheet rides every still that sees it (elements.ts).
  // The photos as the server lists them, the sheets already drawn (by
  // hash), the open card (null key: a part of the set itself) with the dock
  // tab it opened from, an upload's phase, the last shot's answer about each
  // thing, the sheets drawing now, and a sheet's last failed try, by hash.
  const [elementPhotos, setElementPhotos] = useState<ElementPhoto[]>(initialElementPhotos.photos);
  const [sheetHashes, setSheetHashes] = useState<string[]>(initialElementPhotos.sheets);
  const [elementCard, setElementCard] = useState<{ key: string | null; prevTab: DockTab | null } | null>(null);
  const [photoPhase, setPhotoPhase] = useState<"idle" | "preparing" | "checking">("idle");
  const [photoError, setPhotoError] = useState("");
  const [shotElements, setShotElements] = useState<ShotElementStatus[] | null>(null);
  const [sheetPrep, setSheetPrep] = useState<string[]>([]);
  const [sheetLast, setSheetLast] = useState<Record<string, "refused" | "failed">>({});
  const [followedKeys, setFollowedKeys] = useState<string[]>([]);
  // Who is in a character's photos (R1.12, likeness.ts): answered here this
  // visit, the answer being picked, and the save in flight.
  const [answeredIds, setAnsweredIds] = useState<string[]>([]);
  const [likenessPick, setLikenessPick] = useState<LikenessAnswer | null>(null);
  const [likenessBusy, setLikenessBusy] = useState(false);
  const [likenessNote, setLikenessNote] = useState("");
  // The order the person gave the things (the strip's drag, the card's Move): the first ride when a still is full.
  const [elementOrder, setElementOrder] = useState<string[]>(initialLayout?.elementOrder ?? []);
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
  /**
   * What the page has in hand THIS moment. A call that comes back after an
   * await reads its state from the closure it was made in, which is the
   * state when it started: a message sent and then Shoot pressed while
   * Astra read the words took, and charged, two stills (found reviewing
   * Helios, 2026-09-17). Set before anything is sent, cleared in the same
   * `finally` as the flag it stands for.
   */
  const busyRef = useRef({ shooting: false, taking: false, editing: false, matching: false });
  const [matchError, setMatchError] = useState("");
  const [matched, setMatched] = useState<{
    photo: string;
    summary: ReturnType<typeof matchSummary>;
    moved: CameraMove;
  } | null>(null);
  const matchFileRef = useRef<HTMLInputElement | null>(null);

  const hostRef = useRef<HTMLDivElement>(null);
  const guideRef = useRef<HTMLDivElement>(null);
  // The viewfinder's histogram and the focus readout (the camera department, cut 2).
  const histogramRef = useRef<HTMLCanvasElement>(null);
  const focusHudRef = useRef<HTMLDivElement>(null);
  // Film's keyframe labels: a layer of their own over the canvas, outside
  // the host so the palette's grade preview never tints them.
  const overlayHostRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<StageApi | null>(null);
  // A move under the pointer in the rig flies on the stage, free (canvas
  // page I: "hover a move to fly it here"). Nothing is kept: the stage goes
  // back to where it stood (home) when the pointer leaves, a pick or a play
  // takes over, or the moves close. token: the flight in the air; a newer
  // preview or a stop grounds it.
  const movePreviewRef = useRef<{ home: Pose | null; token: number; timer: ReturnType<typeof setTimeout> | null }>({
    home: null,
    token: 0,
    timer: null,
  });
  const stopMovePreview = useCallback(() => {
    const p = movePreviewRef.current;
    p.token += 1;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    if (p.home) apiRef.current?.goTo(p.home);
    p.home = null;
    apiRef.current?.holdFilmOverlay("hover", false);
  }, []);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // A figure dropped inside something built moved to open floor: the hint
  // says so for a few seconds, in place of the drag hint.
  const [figureMoved, setFigureMoved] = useState(false);
  const figureMovedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutRef = useRef({
    markId: startMarkId,
    mark: startMark,
    pose: initialLayout?.pose ?? "stand",
    gaze: initialLayout?.gaze ?? null,
    // The person's order for the things' sheets (R1, the cast strip): saved with the arrangement.
    elementOrder: initialLayout?.elementOrder ?? ([] as string[]),
    // Who plays the figure (R1): saved with the arrangement, the next visit's cast.
    castId: characterId || undefined,
  });
  // A new cast is kept for the next visit, saved a moment after, like any arrangement.
  useEffect(() => {
    if (!characterId || layoutRef.current.castId === characterId) return;
    layoutRef.current = { ...layoutRef.current, castId: characterId };
    settledRef.current?.();
  }, [characterId]);
  // Every beat's move laid from where that beat starts NOW (moves.ts
  // relayMoves): another opening still, a beat's end set by hand, a beat
  // removed or the figure moved changes where the beats after it start, and
  // a move laid from the old start asks the take to join two cameras the
  // move does not. The first real film's "Arc left" had been laid from
  // still 1 and rendered from still 6, and cross-faded ("the camera moved
  // differently from what was selected", 2026-09-21). The clips from the
  // first beat that moves on go with it (filmAfterEdit), as for any edit;
  // never while the film renders, and only once the stage can say where a
  // camera has room.
  const filmStartPose = shots.find((sh) => sh.generationId === film.startId)?.pose ?? null;
  // A beat framed by hand that crosses the set with no move: its take
  // cross-fades instead of moving (moves.ts beatJumps), and the Film tab
  // says so before Render, beside the beat.
  const filmJumps = film.beats.map((b, i) => {
    const from = i === 0 ? filmStartPose : film.beats[i - 1].end;
    return b.move === null && from !== null && beatJumps(from, b.end, mark);
  });
  useEffect(() => {
    const api = apiRef.current;
    if (!ready || !api || filmBusyRef.current) return;
    const beats = relayMoves(film.beats, filmStartPose, mark, spec.bounds, (p) => api.roomFor(p));
    if (beats !== film.beats) editFilm((f) => (f.beats === film.beats ? { ...f, beats: [...beats] } : f));
  }, [ready, film.beats, filmStartPose, mark, spec.bounds, editFilm]);
  // The open menu, for the Esc handler (a ref is not read during render).
  const menuRef = useRef<MenuId | null>(null);
  // The set as it stood before the last Astra edit, for the changed line's
  // Undo, and whether that Undo is being saved.
  const specBeforeEditRef = useRef<SetSpec | null>(null);
  // What that Undo needs to give back Astra's words too (Helios Cut 2, step
  // 2, 2026-09-25): the change's kind, and for an edit the server's seal
  // over the words it replaced (edit-seal.ts) — none for an edit read back
  // after a dropped connection. Kept with the `before` it belongs to.
  const lastEditUndoRef = useRef<{ before: SetSpec; kind: "edit" | "rebuild"; undo: EditUndo | null } | null>(null);
  const undoingRef = useRef(false);
  // The stage calls this when an orbit settles; it points at scheduleSave,
  // which is declared below the stage's effect.
  const settledRef = useRef<(() => void) | null>(null);
  // Undo for the stage (2026-09-16): where the camera and the figure stood
  // before each move made by hand, to step back to. The History menu keeps
  // only the frames that were shot or asked for; a stray drag after careful
  // framing had no way back. The stage calls stageTouchRef as a gesture
  // begins; the page calls keepStage before it moves anything itself.
  const stageUndoRef = useRef<StageState[]>([]);
  const stageRedoRef = useRef<StageState[]>([]);
  const stageTouchedAtRef = useRef(0);
  const stageTouchRef = useRef<(() => void) | null>(null);
  // An orbit's press: kept for Undo as the view stood, the third left alone
  // until the view MOVES — a click that moves nothing keeps it (review of
  // Cut 2, understanding N3).
  const stageHoldRef = useRef<(() => void) | null>(null);
  // A tap on a thing on the stage (R1, stage-pick.ts): what the page does
  // with it. Null leaves the stage as it was — a press is an orbit or a drag.
  const elementTapRef = useRef<((hit: ElementHit) => void) | null>(null);
  const stageStepRef = useRef<{ undo: () => void; redo: () => void } | null>(null);
  const [stageUndoCount, setStageUndoCount] = useState(0);
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
        const { buildSetScene, buildStandIn, moveBuildInto, placeStandIn, sketchStage } = await import("@/lib/sets/build-scene");
        const { BASE_EXPOSURE, NO_LIFT, liftSet } = await import("@/lib/sets/exposure");
        const { Sky } = await import("three/examples/jsm/objects/Sky.js");
        const { RectAreaLightUniformsLib } = await import("three/examples/jsm/lights/RectAreaLightUniformsLib.js");
        const { makeStageTextures } = await import("@/lib/sets/stage-materials");
        const { loadStagePasses, makeStageComposer } = await import("@/lib/sets/stage-post");
        // An area light (the light department) needs its lookup tables once per page.
        RectAreaLightUniformsLib.init();
        const { CSS2DObject, CSS2DRenderer } = await import("three/examples/jsm/renderers/CSS2DRenderer.js");
        if (disposed || !hostRef.current) return;

        const coarse = window.matchMedia?.("(pointer: coarse)").matches ?? false;
        // The full stage (build-scene.ts StageQuality): a phone keeps the
        // basic one, and ?stage=basic shows it anywhere, for comparing.
        const quality: StageQuality = coarse || new URLSearchParams(window.location.search).get("stage") === "basic" ? "basic" : "full";
        const full = quality === "full";
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
        // The full stage's surfaces and sky: textures made once for the page,
        // and the sky's light baked for the environment by the renderer.
        const textures = full ? makeStageTextures(THREE) : null;
        const pmrem = full ? new THREE.PMREMGenerator(renderer) : null;
        const stageOpts = { shadows: !coarse, quality, textures, sky: pmrem ? { Sky, pmrem } : null };
        const built = buildSetScene(THREE, spec, stageOpts);
        /** Every block of the set by "object:copy" (build-scene.ts userData), for the movers and nothing else. */
        const indexBlocks = () => {
          const out = new Map<string, import("three").Mesh>();
          for (const o of built.root.children) {
            const mesh = o as import("three").Mesh;
            if (typeof mesh.userData?.oi === "number") out.set(`${mesh.userData.oi}:${mesh.userData.copy}`, mesh);
          }
          return out;
        };
        scene.add(built.root);
        if (built.background) scene.background = built.background;
        if (built.fog) scene.fog = built.fog;
        scene.environment = built.environment;
        scene.environmentIntensity = built.environmentIntensity;
        // What frees the CURRENT build's resources. An Astra edit from the
        // conversation rebuilds the scene INSIDE built.root (api.rebuild):
        // the group keeps its identity, so everything aimed at it — the
        // matcher above all — keeps working; only its children change.
        let disposeLive: () => void = () => built.dispose();

        const standIn = buildStandIn(THREE, ACCENT, undefined, layoutRef.current.pose);
        // Where the figure's eyes are, by its pose (build-scene.ts): the
        // focus readout, the bracket, the eye-line and the rays from the
        // eyes all start here. A fixed 1.45 m sat on a standing figure's
        // chest ("This is a mess", 2026-09-17).
        let standPose: StandPose = layoutRef.current.pose;
        const eyeY = () => STAND_IN_EYE_M[standPose];
        placeStandIn(standIn, layoutRef.current.mark);
        scene.add(standIn.group);

        // Film's overlay: a scene of its own, drawn over the live view after
        // everything else — so the depth of field never blurs it, and no
        // frame or snapshot, which draw `scene`, can hold it — with the
        // keyframes as labels in a layer over the canvas.
        const overlayScene = new THREE.Scene();
        const overlayRoot = new THREE.Group();
        overlayScene.add(overlayRoot);
        const labelLayer = new CSS2DRenderer();
        labelLayer.domElement.style.position = "absolute";
        labelLayer.domElement.style.inset = "0";
        overlayHostRef.current?.appendChild(labelLayer.domElement);
        const overlayHolds = new Set<string>();
        let overlayOn = false;
        // The things' thumbnails and the picked thing's box (R1): in the
        // overlay's own scene beside the film's, so no frame or snapshot
        // draws them either, and they step aside with it.
        const badgeRoot = new THREE.Group();
        const pickRoot = new THREE.Group();
        overlayScene.add(badgeRoot, pickRoot);
        const showOverlay = () => {
          overlayRoot.visible = overlayOn && overlayHolds.size === 0;
          badgeRoot.visible = badgeRoot.children.length > 0 && overlayHolds.size === 0;
          pickRoot.visible = overlayHolds.size === 0;
        };
        const clearOverlay = () => {
          overlayRoot.traverse((o) => {
            const drawn = o as { geometry?: { dispose(): void }; material?: { dispose(): void } };
            drawn.geometry?.dispose();
            drawn.material?.dispose();
            if (o instanceof CSS2DObject) o.element.remove();
          });
          overlayRoot.clear();
        };
        let stageEls: readonly StageElement[] = [];
        let keyOfCopy = new Map<string, string>();
        /** Every block by which object and copy it is, for the movers: the picker's map the other way round. */
        let meshOfCopy = indexBlocks();
        /** Where each thing that has been driven stands now (placeThings), for the box a tap draws round it. */
        let placedNow = new Map<string, Placement>();
        // Real models (thing-model.ts): a group of their own beside the
        // set's, so a rebuild — which empties the set's group — never takes
        // them with it. Each stands where its thing's blocks stand, and its
        // blocks are hidden while it does.
        const skinRoot = new THREE.Group();
        /** A thing drawn plain grey in a still's sketch (greySketch). */
        const sketchGrey = new THREE.MeshStandardMaterial({ color: 0x9c9c9c, roughness: 0.9, metalness: 0 });
        skinRoot.name = "thing-models";
        scene.add(skinRoot);
        const skins = new Map<string, { url: string; flip: boolean; drawings: string; group: import("three").Group; at: [number, number, number]; painted: number; unpaint: () => void }>();
        const blocksOf = (key: string) => {
          const el = stageEls.find((x) => x.key === key);
          return el ? el.members.map(([oi, copy]) => meshOfCopy.get(`${oi}:${copy}`)).filter((m): m is import("three").Mesh => Boolean(m)) : [];
        };
        const hideBlocks = () => {
          for (const mesh of meshOfCopy.values()) mesh.visible = true;
          for (const key of skins.keys()) for (const mesh of blocksOf(key)) mesh.visible = false;
        };
        /** A model stands where its thing has been driven, or where it was built (placeThings). */
        const placeSkin = (key: string) => {
          const skin = skins.get(key);
          if (!skin) return;
          const p = placedNow.get(key);
          skin.group.position.set(p ? p.x : skin.at[0], skin.at[1], p ? p.z : skin.at[2]);
          skin.group.rotation.y = p ? p.turnDeg * (Math.PI / 180) : 0;
        };
        const dropSkin = (key: string) => {
          const skin = skins.get(key);
          if (!skin) return;
          skin.unpaint();
          skin.group.traverse((o) => {
            const mesh = o as import("three").Mesh;
            if (!mesh.isMesh) return;
            mesh.geometry?.dispose();
            const mats = [mesh.material, mesh.userData.sketchMaterial].flat().filter(Boolean) as import("three").Material[];
            for (const m of mats) {
              for (const v of Object.values(m)) if (v && typeof v === "object" && (v as import("three").Texture).isTexture) (v as import("three").Texture).dispose();
              m.dispose();
            }
          });
          skinRoot.remove(skin.group);
          skins.delete(key);
        };
        // A stage with no sky light of its own (the basic one, on a phone)
        // leaves a model's metal paint nothing to reflect, and it draws
        // black (2026-09-24, the first concept car on this stage). Such a
        // model gets a neutral room to reflect, as any model viewer gives
        // it; made once, the first time one is needed.
        let roomLight: import("three").Texture | null = null;
        const lightModel = async (model: import("three").Object3D) => {
          if (scene.environment) return;
          if (!roomLight) {
            const { RoomEnvironment } = await import("three/examples/jsm/environments/RoomEnvironment.js");
            const gen = new THREE.PMREMGenerator(renderer);
            roomLight = gen.fromScene(new RoomEnvironment(), 0.04).texture;
            gen.dispose();
          }
          model.traverse((o) => {
            const mesh = o as import("three").Mesh;
            if (!mesh.isMesh) return;
            for (const m of [mesh.material].flat() as import("three").MeshStandardMaterial[]) {
              if (m && "envMap" in m) {
                m.envMap = roomLight;
                m.needsUpdate = true;
              }
            }
          });
        };
        /**
         * Things drawn plain grey in a still's sketch (2026-09-24, "Each
         * rendered image is a different car"): a thing whose own sheet rides
         * is only its place, size and heading here, so the blocks' colour
         * (Astra's red, against the person's photo of a yellow car) cannot
         * fight the sheet. What shows which way it faces stays: its lamps
         * glow, and its tyres, glass and dark trim stay dark. A model on the
         * thing is its own paint and stays as it is. Returns what to put back.
         */
        const greySketch = (keys: readonly string[]): [import("three").Mesh, import("three").Material | import("three").Material[]][] => {
          const out: [import("three").Mesh, import("three").Material | import("three").Material[]][] = [];
          if (keys.length === 0) return out;
          built.root.traverse((o) => {
            const mesh = o as import("three").Mesh;
            if (!mesh.isMesh || !mesh.visible || typeof mesh.userData.oi !== "number") return;
            const key = keyOfCopy.get(`${mesh.userData.oi}:${mesh.userData.copy}`);
            if (!key || !keys.includes(key)) return;
            const m = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as import("three").MeshStandardMaterial;
            if (m.emissiveIntensity > 0 && m.emissive && m.emissive.getHex() !== 0) return;
            const c = m.color;
            if (c && 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b < 0.03) return;
            out.push([mesh, mesh.material]);
            mesh.material = sketchGrey;
          });
          return out;
        };
        /** The models flat for the sketch, as sketchStage does the blocks: their own paint, nothing metal. */
        const skinSketch = (on: boolean) => {
          skinRoot.traverse((o) => {
            const mesh = o as import("three").Mesh;
            if (!mesh.isMesh || !mesh.userData.sketchMaterial) return;
            if (on) {
              mesh.userData.stageMaterial = mesh.material;
              mesh.material = mesh.userData.sketchMaterial as import("three").Material;
            } else if (mesh.userData.stageMaterial) {
              mesh.material = mesh.userData.stageMaterial as import("three").Material;
              delete mesh.userData.stageMaterial;
            }
          });
        };
        /** Where a block stood when the set was drawn, and which blocks are away from it (placeThings). */
        const homes = new WeakMap<import("three").Mesh, { x: number; y: number; z: number; rotY: number }>();
        const moved = new Set<import("three").Mesh>();
        let pickedKey: string | null = null;
        const clearBadges = () => {
          for (const o of badgeRoot.children) if (o instanceof CSS2DObject) o.element.remove();
          badgeRoot.clear();
        };
        const clearPick = () => {
          pickRoot.traverse((o) => {
            const drawn = o as { geometry?: { dispose(): void }; material?: { dispose(): void } };
            drawn.geometry?.dispose();
            drawn.material?.dispose();
          });
          pickRoot.clear();
        };
        const drawPick = () => {
          clearPick();
          const e = pickedKey ? stageEls.find((x) => x.key === pickedKey) : undefined;
          if (!e) return;
          const box = new THREE.Box3(new THREE.Vector3(...e.min), new THREE.Vector3(...e.max)).expandByScalar(0.06);
          // A thing a beat has driven is boxed where it stands now, not where
          // it was built (movers.ts placeThings): its corners go round its own
          // middle and along with it.
          const away = placedNow.get(e.key);
          if (away) {
            const about = { x: (e.min[0] + e.max[0]) / 2, z: (e.min[2] + e.max[2]) / 2 };
            const shift = { x: away.x - about.x, z: away.z - about.z };
            const corners: import("three").Vector3[] = [];
            for (const x of [box.min.x, box.max.x])
              for (const y of [box.min.y, box.max.y])
                for (const z of [box.min.z, box.max.z]) {
                  const t = turnAbout({ x, z }, about, away.turnDeg);
                  corners.push(new THREE.Vector3(t.x + shift.x, y, t.z + shift.z));
                }
            box.makeEmpty();
            for (const c of corners) box.expandByPoint(c);
          }
          const helper = new THREE.Box3Helper(box, new THREE.Color(OVERLAY_ACCENT));
          const m = helper.material as import("three").LineBasicMaterial;
          m.depthTest = false;
          m.depthWrite = false;
          m.transparent = true;
          m.opacity = 0.9;
          m.toneMapped = false;
          pickRoot.add(helper);
        };

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
        // The viewport's mode (view-modes.ts): the scene's override material
        // for the live draw only — set just before it, cleared right after,
        // so frame() and snapshot() never see it.
        let viewOverride: import("three").Material | null = null;
        /** The one camera every snapshot renders through (see snapshot). */
        let snapCam: import("three").PerspectiveCamera | null = null;
        const labOn = () => lab.stock > 0 || lab.lens > 0;
        // The camera department (cut 2): the exposure over the lift, the
        // viewfinder's false colour and histogram, the focus readout.
        let exposureGainNow = 1;
        let falseColourOn = false;
        let falsePass: import("three/examples/jsm/postprocessing/ShaderPass.js").ShaderPass | null = null;
        let histogramCanvas: HTMLCanvasElement | null = null;
        let focusHud: HTMLElement | null = null;
        let furniture: Furniture | null = null;
        const sunV = new THREE.Vector3();
        const axisV = new THREE.Vector3();
        const ptV = new THREE.Vector3();
        let focusWords: ((distanceM: number) => string) | null = null;
        let meterWords: ((pct: number) => string) | null = null;
        let meterLast = "";
        const meterScratch = document.createElement("canvas");
        meterScratch.width = 9;
        meterScratch.height = 9;
        /** The displayed brightness round a canvas point, 0–100 % of white. */
        const meterAt = (x: number, y: number): number | null => {
          const ctx = meterScratch.getContext("2d", { willReadFrequently: true });
          if (!ctx) return null;
          const r = renderer.getPixelRatio();
          ctx.drawImage(renderer.domElement, x * r - 4, y * r - 4, 9, 9, 0, 0, 9, 9);
          const d = ctx.getImageData(0, 0, 9, 9).data;
          let sum = 0;
          for (let i = 0; i < d.length; i += 4) sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
          return Math.round((sum / (81 * 255)) * 100);
        };
        let frameCount = 0;
        let fpsFrames = 0;
        let fpsAt = performance.now();
        const eyeHud = new THREE.Vector3();
        const histoScratch = document.createElement("canvas");
        histoScratch.width = 96;
        histoScratch.height = 54;
        /** The picture inside the frame lines as 32 bins of brightness, drawn as bars; the ends in amber. */
        const drawHistogram = (out: HTMLCanvasElement) => {
          const sctx = histoScratch.getContext("2d", { willReadFrequently: true });
          const octx = out.getContext("2d");
          if (!sctx || !octx) return;
          const src = renderer.domElement;
          const sx = frameUv.x * src.width;
          const sw = Math.max(1, (frameUv.z - frameUv.x) * src.width);
          const sy = (1 - frameUv.w) * src.height;
          const sh = Math.max(1, (frameUv.w - frameUv.y) * src.height);
          sctx.drawImage(src, sx, sy, sw, sh, 0, 0, histoScratch.width, histoScratch.height);
          const d = sctx.getImageData(0, 0, histoScratch.width, histoScratch.height).data;
          const bins = new Uint32Array(32);
          for (let i = 0; i < d.length; i += 4) bins[Math.min(31, ((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 8) | 0)] += 1;
          let max = 1;
          for (const b of bins) if (b > max) max = b;
          const W = out.width;
          const H = out.height;
          octx.clearRect(0, 0, W, H);
          const bw = W / 32;
          for (let i = 0; i < 32; i++) {
            const h = Math.round((bins[i] / max) * (H - 2));
            octx.fillStyle = i < 2 || i > 29 ? "rgba(224,164,104,0.95)" : "rgba(236,237,241,0.85)";
            octx.fillRect(i * bw, H - h, Math.max(1, bw - 1), h);
          }
        };
        const frameUv = new THREE.Vector4(0, 0, 1, 1);

        const halfX = spec.bounds.x / 2;
        const halfZ = spec.bounds.z / 2;
        const raycaster = new THREE.Raycaster();
        const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const hit = new THREE.Vector3();
        const ndc = new THREE.Vector2();
        let dragging = false;
        // A press on the figure with the Select tool moves it only once it
        // has travelled past the tap's slop (R1): a still press is a tap,
        // and neither jumps the figure nor saves its mark again. Move and
        // Turn place it on the press, as they always did.
        let dragLive = false;
        let dragFrom: { x: number; y: number; type: string } | null = null;
        // The point of the figure the Select press took hold of: the drag
        // slides it on a level plane at that height, so the grabbed point
        // stays under the pointer. The ground under a pointer on the torso
        // lies metres behind the figure, and it jumped there.
        const grabPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        let grabOffset: { x: number; z: number } | null = null;
        let measuring = false;
        let controlsRef: InstanceType<typeof OrbitControls> | null = null;
        // A tap (stage-pick.ts): a press that neither travelled nor lasted,
        // with no second finger down. Watched only while the page listens.
        const pointersDown = new Set<number>();
        let tapStart: TapStart | null = null;
        let tapSpoiled = false;
        let figureTapTimer: ReturnType<typeof setTimeout> | null = null;

        const toNdc = (e: PointerEvent) => {
          const r = canvas.getBoundingClientRect();
          ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
          raycaster.setFromCamera(ndc, camera);
        };
        const overFigure = (e: PointerEvent) => {
          toNdc(e);
          return raycaster.intersectObject(standIn.figure, true).length > 0;
        };
        // The rail's tools (studio.ts): Select drags the figure only when
        // pressed on it; Move takes it wherever the press lands and follows
        // the drag; Turn faces it toward the press and every drag after.
        const moveTo = (p: { x: number; z: number }) => {
          standIn.group.position.set(Math.min(halfX, Math.max(-halfX, p.x)), 0, Math.min(halfZ, Math.max(-halfZ, p.z)));
        };
        let turnedDeg: number | null = null;
        const turnTo = (p: { x: number; z: number }) => {
          const g = standIn.group.position;
          const dx = p.x - g.x;
          const dz = p.z - g.z;
          if (Math.hypot(dx, dz) < 0.05) return;
          turnedDeg = Math.round((((Math.atan2(dx, dz) * 180) / Math.PI) % 360) + 360) % 360;
          standIn.group.rotation.set(0, (turnedDeg * Math.PI) / 180, 0);
        };
        // What a point of the page touches (stage-pick.ts): a thumbnail by
        // its box first, then the nearest of the figure and the set's blocks.
        const pickAt = (clientX: number, clientY: number): ElementHit => {
          if (badgeRoot.visible) {
            const rects: { key: string; left: number; top: number; right: number; bottom: number }[] = [];
            for (const o of badgeRoot.children) {
              if (!(o instanceof CSS2DObject) || o.element.style.display === "none") continue;
              const r = o.element.getBoundingClientRect();
              if (r.width > 0) rects.push({ key: String(o.userData.key), left: r.left, top: r.top, right: r.right, bottom: r.bottom });
            }
            const key = badgeAt(rects, clientX, clientY, coarse ? BADGE_HIT_SLOP_PX.coarse : BADGE_HIT_SLOP_PX.fine);
            if (key) return { kind: "element", key };
          }
          const r = canvas.getBoundingClientRect();
          ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
          raycaster.setFromCamera(ndc, camera);
          const hits: StageHit[] = [
            ...raycaster.intersectObject(standIn.figure, true).map((h) => ({ oi: null, copy: null, figure: true, ground: false, sky: false, distance: h.distance })),
            ...raycaster.intersectObject(skinRoot, true).flatMap((h): StageHit[] => {
              const el = stageEls.find((x) => x.key === h.object.userData.skinOf);
              const first = el?.members[0];
              return first ? [{ oi: first[0], copy: first[1], figure: false, ground: false, sky: false, distance: h.distance }] : [];
            }),
            ...raycaster.intersectObject(built.root, true).map((h): StageHit => {
              const ud = h.object.userData;
              const block = typeof ud.oi === "number" && typeof ud.copy === "number";
              const onGround = h.object.name === "ground";
              // Anything else drawn — the sky, a dome — lets the tap through.
              return { oi: block ? ud.oi : null, copy: block ? ud.copy : null, figure: false, ground: onGround, sky: !block && !onGround, distance: h.distance };
            }),
          ];
          return elementForHits(hits, (oi, copy) => keyOfCopy.get(`${oi}:${copy}`) ?? null, FIGURE_KEY);
        };
        // A tap goes to the page; one on the figure waits a moment, so a
        // double-click (frame the figure) wins over it.
        const tapAt = (clientX: number, clientY: number) => {
          if (!elementTapRef.current) return;
          const hit = pickAt(clientX, clientY);
          if (figureTapTimer) clearTimeout(figureTapTimer);
          figureTapTimer = null;
          if (hit?.kind === "element" && hit.key === FIGURE_KEY) {
            figureTapTimer = setTimeout(() => {
              figureTapTimer = null;
              elementTapRef.current?.(hit);
            }, FIGURE_TAP_WAIT_MS);
          } else elementTapRef.current(hit);
        };
        const slopOf = (type: string) => (type === "touch" ? TAP_SLOP_PX.touch : type === "pen" ? TAP_SLOP_PX.pen : TAP_SLOP_PX.mouse);
        // Registered BEFORE the orbit controls, so a press on the figure
        // turns orbiting off before the controls see the same event.
        const onDown = (e: PointerEvent) => {
          const tool = stageToolRef.current;
          // A second finger is a pinch, never a tap. A new gesture's first
          // pointer starts the count again, so a lost pointer-up can't spoil
          // every tap after it.
          if (e.isPrimary) pointersDown.clear();
          pointersDown.add(e.pointerId);
          if (pointersDown.size > 1) tapSpoiled = true;
          else if (elementTapRef.current && tool === "select" && !layingRef.current && e.button === 0) {
            tapStart = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, t: performance.now() };
            tapSpoiled = false;
          }
          // Laying (cut D): the press on the ground is the gaze's point, or the next point of the beat's path.
          const laying = layingRef.current;
          if (laying) {
            if (e.button !== 0) return;
            toNdc(e);
            if (raycaster.ray.intersectPlane(ground, hit)) layAddRef.current(laying, { x: Math.round(hit.x * 100) / 100, z: Math.round(hit.z * 100) / 100 });
            measuring = true;
            if (controlsRef) controlsRef.enabled = false;
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
          }
          // Measure (cut C): a press on the ground is a point; two make the line.
          if (tool === "measure") {
            if (e.button !== 0) return;
            toNdc(e);
            if (raycaster.ray.intersectPlane(ground, hit)) measureAddRef.current({ x: Math.round(hit.x * 100) / 100, z: Math.round(hit.z * 100) / 100 });
            // A measuring press is not an orbit: the controls sit this one out.
            measuring = true;
            if (controlsRef) controlsRef.enabled = false;
            canvas.setPointerCapture(e.pointerId);
            e.preventDefault();
            return;
          }
          if (tool === "select" ? !overFigure(e) : e.button !== 0) return;
          if (tool !== "select") {
            toNdc(e);
            if (!raycaster.ray.intersectPlane(ground, hit)) return;
            if (tool === "turn") turnTo(hit);
            else moveTo(hit);
            stageTouchRef.current?.();
            dragLive = true;
          } else {
            // Select: nothing moves, and nothing is kept for Undo, until the press travels.
            dragLive = false;
            dragFrom = { x: e.clientX, y: e.clientY, type: e.pointerType };
            const held = raycaster.intersectObject(standIn.figure, true)[0];
            grabOffset = held ? { x: standIn.group.position.x - held.point.x, z: standIn.group.position.z - held.point.z } : null;
            if (held) grabPlane.constant = -held.point.y;
          }
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
          if (!dragLive) {
            if (dragFrom && Math.hypot(e.clientX - dragFrom.x, e.clientY - dragFrom.y) <= slopOf(dragFrom.type)) return;
            dragLive = true;
            stageTouchRef.current?.();
          }
          toNdc(e);
          if (stageToolRef.current === "select" && grabOffset) {
            if (!raycaster.ray.intersectPlane(grabPlane, hit)) return;
            moveTo({ x: hit.x + grabOffset.x, z: hit.z + grabOffset.z });
            return;
          }
          if (!raycaster.ray.intersectPlane(ground, hit)) return;
          if (stageToolRef.current === "turn") turnTo(hit);
          else moveTo(hit);
        };
        const onUp = (e: PointerEvent) => {
          const tapped =
            tapStart !== null && !tapSpoiled && e.type === "pointerup" && isTap(tapStart, { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() }, false);
          if (tapStart?.id === e.pointerId) tapStart = null;
          pointersDown.delete(e.pointerId);
          if (measuring) {
            measuring = false;
            if (controlsRef) controlsRef.enabled = true;
            if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
            return;
          }
          if (!dragging) {
            if (tapped) tapAt(e.clientX, e.clientY);
            return;
          }
          dragging = false;
          grabOffset = null;
          if (controlsRef) controlsRef.enabled = true;
          if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
          canvas.style.cursor = "";
          // A still press on the figure (Select): it never moved, so its
          // mark stands as saved. A tap on it, if the page listens.
          if (!dragLive) {
            dragFrom = null;
            if (tapped) tapAt(e.clientX, e.clientY);
            return;
          }
          if (stageToolRef.current === "turn") {
            if (turnedDeg !== null) setMark({ ...layoutRef.current.mark, facingDeg: turnedDeg });
            turnedDeg = null;
            return;
          }
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
          // The double-click wins over the tap its first click made.
          if (figureTapTimer) clearTimeout(figureTapTimer);
          figureTapTimer = null;
          if (!overFigure(e as PointerEvent)) return;
          stageTouchRef.current?.();
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
        // A person grabbing the view makes it their own camera — kept first,
        // for Undo, as it stood before the grab. Only once it MOVES (R1): a
        // still press — a tap on a thing — keeps the camera it names. The
        // flag goes at the end, so a later move from code never drops it.
        let orbitArmed = false;
        controls.addEventListener("start", () => {
          stageHoldRef.current?.();
          orbitArmed = true;
        });
        controls.addEventListener("change", () => {
          if (!orbitArmed) return;
          orbitArmed = false;
          setCameraId(null);
          // The view moved by hand: a third the chat set ends here, not on the press (check of the spec, item 6).
          frameXRef.current = frameXAfter(frameXRef.current, { kind: "hand" });
        });
        controls.addEventListener("end", () => {
          orbitArmed = false;
          stageTouchedAtRef.current = performance.now();
          settledRef.current?.();
        });

        let raf = 0;
        let lastW = 0;
        let lastH = 0;
        let lastKey = "";
        /** The projection's full height when the frame lines sit off the canvas's centre (fit). */
        let fullH = 1;
        const applyFov = () => {
          // The rig's anamorphic squeeze: the negative sees that much wider
          // for the same lens and the band widens with it (rig.ts
          // formatFrame), so the stage draws the wider field UNDISTORTED —
          // where the projection's x used to be scaled, which squashed
          // everything the person arranged and everything the model was sent
          // (2026-09-18).
          camera.fov = widenFovDeg(poseFov, (fullH / Math.max(1, renderPx)) * rigRef.current.squeeze);
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
            labelLayer.setSize(w, h);
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
          const fr = formatFrame(format, rigRef.current.squeeze);
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
              // stage-post.ts: on the full stage the occlusion, the depth of
              // field, the bloom and the lab, from the first frame; on the
              // basic stage the depth of field and the lab, when asked for.
              const passes = await loadStagePasses();
              if (disposed) return;
              const made = makeStageComposer(THREE, passes, renderer, scene, camera, {
                quality,
                night: spec.sky.kind === "night",
                width: lastW,
                height: lastH,
              });
              composer = made.composer;
              bokeh = made.bokeh;
              labPass = made.lab;
              falsePass = made.falseColour;
            } catch (err) {
              // No passes on this device: the stage stays as it is.
              console.warn("SetView post-processing unavailable:", err);
            }
          })();
        };
        // The figure's eyes, where the rig's focus is measured to.
        const eye = new THREE.Vector3();
        const renderLive = () => {
          scene.overrideMaterial = viewOverride;
          if ((full || falseColourOn || depthStop !== null || labOn()) && composer && bokeh) {
            if (falsePass) falsePass.uniforms.uOn.value = falseColourOn ? 1 : 0;
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
          scene.overrideMaterial = null;
          if (overlayRoot.visible || (pickRoot.visible && pickRoot.children.length > 0)) {
            renderer.autoClear = false;
            renderer.render(overlayScene, camera);
            renderer.autoClear = true;
          }
          labelLayer.render(overlayScene, camera);
        };
        // A thumbnail whose thing stands behind something built dims, so the
        // one in front reads first: a ray from the camera to it, which its
        // own thing's blocks and the sky never block.
        const badgeWorld = new THREE.Vector3();
        const badgeDir = new THREE.Vector3();
        const dimCoveredBadges = () => {
          for (const o of badgeRoot.children) {
            if (!(o instanceof CSS2DObject)) continue;
            o.getWorldPosition(badgeWorld);
            const d = camera.position.distanceTo(badgeWorld);
            raycaster.set(camera.position, badgeDir.copy(badgeWorld).sub(camera.position).normalize());
            raycaster.far = Math.max(0, d - 0.2);
            const own = o.userData.key;
            const covered = raycaster.intersectObject(built.root, true).some((h) => {
              const ud = h.object.userData;
              if (typeof ud.oi !== "number") return h.object.name === "ground";
              return keyOfCopy.get(`${ud.oi}:${ud.copy}`) !== own;
            });
            raycaster.far = Infinity;
            const want = covered ? "0.35" : "1";
            if (o.element.style.opacity !== want) o.element.style.opacity = want;
          }
        };
        const loop = () => {
          raf = requestAnimationFrame(loop);
          fit();
          controls.update();
          if (camera.position.y < 0.1) camera.position.y = 0.1;
          if (badgeRoot.visible) {
            // The figure's thumbnail rides over its head wherever it is dragged.
            for (const o of badgeRoot.children) {
              if (o.userData.key === FIGURE_KEY) o.position.set(standIn.group.position.x, eyeY(), standIn.group.position.z);
            }
            if (frameCount % 8 === 0) dimCoveredBadges();
          }
          renderLive();
          frameCount += 1;
          // The frame rate, for the status bar, once a second.
          fpsFrames += 1;
          const nowMs = performance.now();
          if (nowMs - fpsAt >= 1000) {
            setFps(Math.round((fpsFrames * 1000) / (nowMs - fpsAt)));
            fpsFrames = 0;
            fpsAt = nowMs;
          }
          // The focus readout: at the figure's eyes on screen, the distance
          // and what the stop holds sharp at it (the words come from the page).
          if (focusHud) {
            const focusOn = depthStop !== null && focusWords !== null;
            if (focusOn || meterWords) {
              const p = standIn.group.position;
              eyeHud.set(p.x, eyeY(), p.z);
              const d = camera.position.distanceTo(eyeHud);
              eyeHud.project(camera);
              const x = ((eyeHud.x + 1) / 2) * lastW;
              const y = ((1 - eyeHud.y) / 2) * lastH;
              const off = eyeHud.z > 1 || x < 0 || x > lastW || y < 0 || y > lastH;
              focusHud.hidden = off;
              if (!off) {
                focusHud.style.transform = `translate(${x.toFixed(0)}px, ${(y - 30).toFixed(0)}px)`;
                const parts: string[] = [];
                if (focusOn && focusWords) parts.push(focusWords(d));
                if (meterWords && frameCount % 4 === 0) {
                  const pct = meterAt(x, y);
                  if (pct !== null) meterLast = meterWords(pct);
                }
                if (meterWords && meterLast) parts.push(meterLast);
                const text = parts.join(" · ");
                if (focusHud.textContent !== text) focusHud.textContent = text;
              }
            } else focusHud.hidden = true;
          }
          if (histogramCanvas && frameCount % 6 === 0) drawHistogram(histogramCanvas);
          // The viewport's furniture (cut C, furniture.ts): moved every other frame.
          if (furniture && frameCount % 2 === 0) {
            const f = furniture;
            const project = (v: InstanceType<typeof THREE.Vector3>) => {
              v.project(camera);
              return { x: ((v.x + 1) / 2) * lastW, y: ((1 - v.y) / 2) * lastH, behind: v.z > 1 };
            };
            // The sun, where it stands: the rig's hour, else the set's own sun.
            if (f.sun) {
              const hour = rigRef.current.time;
              let dir: [number, number, number] | null = null;
              if (hour !== null) dir = sunDirection(hour);
              else {
                const sunL = spec.lights.find((l) => l.kind === "sun");
                if (sunL) {
                  const dx = sunL.position[0] - sunL.target[0];
                  const dy = sunL.position[1] - sunL.target[1];
                  const dz = sunL.position[2] - sunL.target[2];
                  const len = Math.hypot(dx, dy, dz) || 1;
                  dir = [dx / len, dy / len, dz / len];
                }
              }
              if (!dir || dir[1] <= 0) f.sun.hidden = true;
              else {
                const p = standIn.group.position;
                sunV.set(p.x + dir[0] * 300, dir[1] * 300, p.z + dir[2] * 300);
                const sp = project(sunV);
                // Behind the camera it is not drawn; out of the frame it sits
                // at the edge, where it can still be taken hold of.
                const off = sp.behind;
                f.sun.hidden = off;
                if (!off) {
                  const x = Math.min(lastW - 28, Math.max(28, sp.x));
                  const y = Math.min(lastH - 28, Math.max(28, sp.y));
                  const clamped = x !== sp.x || y !== sp.y;
                  f.sun.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`;
                  f.sun.style.opacity = clamped ? "0.6" : "1";
                  const el = Math.round((Math.asin(Math.max(-1, Math.min(1, dir[1]))) * 180) / Math.PI);
                  const text = f.sunWords(hour, el);
                  if (f.sun.dataset.words !== text) {
                    f.sun.dataset.words = text;
                    const label = f.sun.querySelector("span");
                    if (label) label.textContent = text;
                  }
                }
              }
            }
            // The focus bracket on the eyes, sized to the head, with a stop set.
            if (f.bracket) {
              if (depthStop === null) f.bracket.hidden = true;
              else {
                const p = standIn.group.position;
                const e = project(ptV.set(p.x, eyeY(), p.z));
                const t = project(ptV.set(p.x, eyeY() + 0.12, p.z));
                const headPx = Math.abs(e.y - t.y) * 2.6;
                const off = e.behind || e.x < 0 || e.x > lastW || e.y < 0 || e.y > lastH || headPx < 6;
                f.bracket.hidden = off;
                if (!off) {
                  const size = Math.max(18, Math.min(160, headPx));
                  f.bracket.style.width = `${size.toFixed(0)}px`;
                  f.bracket.style.height = `${size.toFixed(0)}px`;
                  f.bracket.style.transform = `translate(${(e.x - size / 2).toFixed(0)}px, ${(e.y - size / 2).toFixed(0)}px)`;
                }
              }
            }
            // The gizmo: the set's axes as the camera sees them.
            if (f.gizmo && frameCount % 4 === 0) {
              const q = camera.quaternion.clone().invert();
              const axes: [string, number, number, number][] = [
                ["x", 1, 0, 0],
                ["y", 0, 1, 0],
                ["z", 0, 0, 1],
              ];
              for (const [name, ax, ay, az] of axes) {
                axisV.set(ax, ay, az).applyQuaternion(q);
                const line = f.gizmo.querySelector<SVGLineElement>(`[data-axis="${name}"]`);
                const dot = f.gizmo.querySelector<SVGCircleElement>(`[data-axis-dot="${name}"]`);
                const text = f.gizmo.querySelector<SVGTextElement>(`[data-axis-text="${name}"]`);
                const x = (axisV.x * 17).toFixed(1);
                const y = (-axisV.y * 17).toFixed(1);
                if (line) {
                  line.setAttribute("x2", x);
                  line.setAttribute("y2", y);
                }
                if (dot) {
                  dot.setAttribute("cx", x);
                  dot.setAttribute("cy", y);
                  dot.setAttribute("r", axisV.z > 0 ? "4.5" : "3.5");
                }
                if (text) {
                  text.setAttribute("x", x);
                  text.setAttribute("y", (Number(y) + 2.2).toFixed(1));
                }
              }
            }
            // The scale: a round length at the figure's depth.
            if (f.scale && frameCount % 8 === 0) {
              const p = standIn.group.position;
              const dist = Math.max(0.3, ptV.set(p.x, eyeY(), p.z).distanceTo(camera.position));
              const pxPerMetre = lastH / (2 * dist * Math.tan((camera.fov * Math.PI) / 360));
              const bar = scaleBar(pxPerMetre);
              const line = f.scale.querySelector<HTMLElement>("i");
              const label = f.scale.querySelector("span");
              if (line) line.style.width = `${bar.px}px`;
              const text = f.scaleWords(bar.metres);
              if (label && label.textContent !== text) label.textContent = text;
              f.scale.hidden = bar.px < 8;
            }
            // The eye-line (cut D): from the eyes to what the figure looks at.
            if (f.eyeline) {
              const svg = f.eyeline;
              const target = f.gazeTarget;
              svg.style.display = target === null ? "none" : "";
              if (target !== null) {
                const p = standIn.group.position;
                const eye = project(ptV.set(p.x, eyeY(), p.z));
                const line = svg.querySelector<SVGLineElement>("line");
                const label = svg.querySelector<SVGTextElement>("text");
                const dot = svg.querySelector<SVGCircleElement>("circle");
                if (target === "camera") {
                  // Into the lens: a short line toward the viewer, and the words.
                  if (line) {
                    line.setAttribute("x1", eye.x.toFixed(1));
                    line.setAttribute("y1", eye.y.toFixed(1));
                    line.setAttribute("x2", eye.x.toFixed(1));
                    line.setAttribute("y2", (eye.y + 26).toFixed(1));
                  }
                  if (dot) {
                    dot.setAttribute("cx", eye.x.toFixed(1));
                    dot.setAttribute("cy", (eye.y + 26).toFixed(1));
                  }
                  if (label) {
                    label.setAttribute("x", eye.x.toFixed(1));
                    label.setAttribute("y", (eye.y + 42).toFixed(1));
                  }
                } else {
                  const t = project(ptV.set(target.x, target.y, target.z));
                  if (line) {
                    line.setAttribute("x1", eye.x.toFixed(1));
                    line.setAttribute("y1", eye.y.toFixed(1));
                    line.setAttribute("x2", t.x.toFixed(1));
                    line.setAttribute("y2", t.y.toFixed(1));
                  }
                  if (dot) {
                    dot.setAttribute("cx", t.x.toFixed(1));
                    dot.setAttribute("cy", t.y.toFixed(1));
                  }
                  if (label) {
                    label.setAttribute("x", ((eye.x + t.x) / 2).toFixed(1));
                    label.setAttribute("y", ((eye.y + t.y) / 2 - 8).toFixed(1));
                  }
                }
                if (label && label.textContent !== f.gazeText) label.textContent = f.gazeText;
                svg.style.opacity = eye.behind ? "0" : "1";
              }
            }
            // The path (cut D): the selected beat's walk, on the ground.
            if (f.pathSvg) {
              const svg = f.pathSvg;
              const on = f.pathFrom !== null && f.pathTo !== null;
              svg.style.display = on ? "none" : "none";
              if (on && f.pathFrom && f.pathTo) {
                svg.style.display = "";
                const stops = [f.pathFrom, ...f.pathPoints, f.pathTo];
                const pts = stops.map((q) => project(ptV.set(q.x, 0.02, q.z)));
                const poly = svg.querySelector<SVGPolylineElement>("polyline");
                if (poly) poly.setAttribute("points", pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" "));
                const dots = svg.querySelectorAll<SVGCircleElement>("circle");
                dots.forEach((c, i) => {
                  const q = pts[i + 1];
                  if (!q || i + 1 >= pts.length - 1) {
                    c.style.display = "none";
                    return;
                  }
                  c.style.display = "";
                  c.setAttribute("cx", q.x.toFixed(1));
                  c.setAttribute("cy", q.y.toFixed(1));
                });
              }
            }
            // The measure line, between the points on the ground.
            if (f.measure) {
              const pts = f.points;
              f.measure.style.display = pts.length === 0 ? "none" : "";
              if (pts.length > 0) {
                const a = project(ptV.set(pts[0].x, 0.02, pts[0].z));
                const line = f.measure.querySelector<SVGLineElement>("line");
                const c1 = f.measure.querySelector<SVGCircleElement>('[data-end="a"]');
                const c2 = f.measure.querySelector<SVGCircleElement>('[data-end="b"]');
                const label = f.measure.querySelector<SVGTextElement>("text");
                if (c1) {
                  c1.setAttribute("cx", a.x.toFixed(1));
                  c1.setAttribute("cy", a.y.toFixed(1));
                }
                if (pts.length > 1) {
                  const b = project(ptV.set(pts[1].x, 0.02, pts[1].z));
                  if (line) {
                    line.setAttribute("x1", a.x.toFixed(1));
                    line.setAttribute("y1", a.y.toFixed(1));
                    line.setAttribute("x2", b.x.toFixed(1));
                    line.setAttribute("y2", b.y.toFixed(1));
                    line.style.display = "";
                  }
                  if (c2) {
                    c2.setAttribute("cx", b.x.toFixed(1));
                    c2.setAttribute("cy", b.y.toFixed(1));
                    c2.style.display = "";
                  }
                  if (label) {
                    label.setAttribute("x", ((a.x + b.x) / 2).toFixed(1));
                    label.setAttribute("y", ((a.y + b.y) / 2 - 8).toFixed(1));
                    const text = f.measureWords(measureMetres(pts[0], pts[1]));
                    if (label.textContent !== text) label.textContent = text;
                    label.style.display = "";
                  }
                } else {
                  if (line) line.style.display = "none";
                  if (c2) c2.style.display = "none";
                  if (label) label.style.display = "none";
                }
              }
            }
          }
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
        // The sketch's own lift, for the frame the image model reads
        // (frame(), build-scene.ts sketchStage): measured on the sketch, as
        // every lift was before the full stage, with a neutral light of its
        // own that stays off while the stage is shown. The stage's lift is
        // measured after it, on the stage, with the sketch's light off.
        let sketchLift = NO_LIFT;
        let sketchFill: import("three").HemisphereLight | null = null;
        let sketchFillOn = 0;
        let stageFill: import("three").HemisphereLight | null = null;
        let stageFillOn = 0;
        /**
         * Measure the set's lift, and the sketch's own. Run at load and
         * again on every rebuild — an hour, a light plot, an Astra change:
         * it was measured ONCE, so a night set staged at noon rendered
         * through the night's exposure and the prompt's "lifted" sentence
         * described a sketch that no longer existed (found reviewing Helios,
         * fixed 2026-09-18). liftSet adds its own neutral fill and leaves it
         * on the scene, so the lights the last measurement left go first —
         * else every hour would leave one behind, brightening the stage.
         */
        const measureLift = (forSpec: SetSpec, farPlane: number) => {
          for (const old of [sketchFill, stageFill]) {
            if (!old) continue;
            scene.remove(old);
            old.dispose();
          }
          sketchFill = null;
          stageFill = null;
          sketchFillOn = 0;
          stageFillOn = 0;
          lift = NO_LIFT;
          sketchLift = NO_LIFT;
          standIn.group.visible = false;
          try {
            if (full) {
              sketchStage(scene, built.root, true);
              try {
                sketchLift = liftSet(THREE, renderer, scene, forSpec, farPlane);
              } finally {
                sketchStage(scene, built.root, false);
              }
              sketchFill = (scene.getObjectByName("lift-fill") as import("three").HemisphereLight | undefined) ?? null;
              if (sketchFill) {
                sketchFill.name = "lift-fill-sketch";
                sketchFillOn = sketchFill.intensity;
                sketchFill.intensity = 0;
              }
            }
            lift = liftSet(THREE, renderer, scene, forSpec, farPlane);
            stageFill = (scene.getObjectByName("lift-fill") as import("three").HemisphereLight | undefined) ?? null;
            stageFillOn = stageFill?.intensity ?? 0;
            if (!full) sketchLift = lift;
          } catch (err) {
            console.warn("SetView lighting measurement failed:", err);
          } finally {
            standIn.group.visible = true;
          }
        };
        measureLift(spec, built.farPlane);
        raf = requestAnimationFrame(loop);
        if (full) ensureComposer();

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

        /**
         * The sketch, drawn into a canvas: the recipe a still has always
         * been taken with (frame()), now shared with the rehearsal recorder
         * so a recorded frame IS the picture the image model is sent. The
         * helpers are hidden, the stage wears its flat sketch materials at
         * the sketch's own lift, it is rendered at the rig's render size,
         * and everything is put back before the browser shows a frame.
         * `target` reuses a canvas (the recorder's, whose size must not
         * change mid-clip); without one a canvas is made to fit.
         */
        const drawSketch = (
          opts?: { from?: Pose; hideFigure?: boolean; cut?: boolean; grey?: readonly string[] },
          target?: HTMLCanvasElement,
        ): { out: HTMLCanvasElement; fr: ReturnType<typeof formatFrame> } | null => {
          const fr = formatFrame(rigRef.current.format, rigRef.current.squeeze);
          const pose = opts?.from ?? {
            position: [camera.position.x, camera.position.y, camera.position.z] as Vec3,
            target: [controls.target.x, controls.target.y, controls.target.z] as Vec3,
            fovDeg: poseFov,
          };
          // The negative the picture is cut from: the squeeze widens what
          // the lens sees, and fr's band widens by the same, so the picture
          // keeps the lens's height and gains the width — undistorted.
          const from = { ...pose, fovDeg: widenFovDeg(pose.fovDeg, rigRef.current.squeeze) };
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
          // The sketch (build-scene.ts sketchStage, 2026-09-17): the full
          // stage is for the person's eyes; the image model reads the flat
          // sketch the shot prompt describes, at the sketch's own lift and
          // this rig's exposure. The stage is back before the browser
          // shows a frame.
          sketchStage(scene, built.root, true);
          skinSketch(true);
          const greyed = greySketch(opts?.grey ?? []);
          if (sketchFill) sketchFill.intensity = sketchFillOn;
          // Only a full build has two lifts: on a basic one (a phone, a
          // coarse pointer) this light IS the sketch's own lift, and
          // turning it off would hand the model a dark sketch while the
          // prompt says it was brightened.
          if (full && stageFill) stageFill.intensity = 0;
          renderer.toneMappingExposure = sketchLift.exposure * exposureGainNow;
          try {
            renderer.render(scene, cam);
          } finally {
            renderer.toneMappingExposure = lift.exposure * exposureGainNow;
            if (stageFill) stageFill.intensity = stageFillOn;
            if (sketchFill) sketchFill.intensity = 0;
            for (const [mesh, was] of greyed) mesh.material = was;
            sketchStage(scene, built.root, false);
            skinSketch(false);
          }
          // The band the frame lines draw, centred, when the picture is
          // asked for rather than the frame it is shot in.
          const band = Boolean(opts?.cut && fr.cut);
          const out = target ?? document.createElement("canvas");
          if (!target) {
            out.width = band ? fr.bandW : fr.renderW;
            out.height = band ? fr.bandH : fr.renderH;
          }
          const ctx = out.getContext("2d");
          let drew = false;
          if (ctx) {
            // What of the render the picture is: the whole frame, or the
            // band's middle when the picture is asked for as it is cut.
            const srcW = band ? fr.bandW : fr.renderW;
            const srcH = band ? fr.bandH : fr.renderH;
            const sx = Math.floor((fr.renderW - srcW) / 2);
            const sy = Math.floor((fr.renderH - srcH) / 2);
            // A canvas of its own (a still) takes the render at its own
            // size; a canvas we were handed (the recorder's, smaller than
            // the stage — rehearsal.ts recordSize) takes it scaled to fit,
            // never cropped.
            const k = out.width / srcW;
            ctx.drawImage(renderer.domElement, sx, sy, srcW, srcH, 0, 0, out.width, out.height);
            // The strips outside the band, painted dark on the frame the
            // model reads (rig.ts letterbox): the picture is the band, and
            // the prompt says so. The band picture has none to paint.
            if (!band) {
              ctx.fillStyle = "#0a0a0a";
              for (const r of letterbox(fr)) ctx.fillRect((r.x - sx) * k, (r.y - sy) * k, r.w * k, r.h * k);
            }
            drew = true;
          }
          renderer.setPixelRatio(ratio);
          renderer.setSize(lastW, lastH, false);
          standIn.helpers.visible = true;
          standIn.figure.visible = true;
          return drew ? { out, fr } : null;
        };
        /** The rehearsal being recorded now (rehearsal.ts), or null. */
        let recording: { out: HTMLCanvasElement; track: CanvasCaptureMediaStreamTrack; rec: MediaRecorder; chunks: Blob[]; mime: string; frames: number } | null = null;

        apiRef.current = {
          // The sketch's lift: it is the sketch the prompt's sentence is about.
          lifted: sketchLift.fill > 1 || sketchLift.exposure > BASE_EXPOSURE,
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
          setPose(p) {
            standIn.setPose(p);
            standPose = p;
          },
          pose() {
            const r = (n: number) => Math.round(n * 1000) / 1000;
            return {
              position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
              target: [r(controls.target.x), r(controls.target.y), r(controls.target.z)],
              fovDeg: Math.round(poseFov * 100) / 100,
            };
          },
          setViewMode(mode) {
            viewOverride?.dispose();
            viewOverride = viewModeMaterial(THREE, mode);
          },
          frame(opts) {
            const drawn = drawSketch(opts);
            if (!drawn) return null;
            const url = drawn.out.toDataURL("image/jpeg", 0.9);
            renderLive();
            return url;
          },
          recordStart() {
            if (recording) return { width: recording.out.width, height: recording.out.height, mime: recording.mime };
            const fr = formatFrame(rigRef.current.format, rigRef.current.squeeze);
            const band = fr.cut;
            // The film's own shape, small enough that every frame can be
            // drawn and encoded in its moment (rehearsal.ts recordSize).
            const size = recordSize(band ? fr.bandW : fr.renderW, band ? fr.bandH : fr.renderH);
            const out = document.createElement("canvas");
            out.width = size.width;
            out.height = size.height;
            const mime = REHEARSAL_MIMES.find((m: string) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
            if (!mime) return null;
            // Frames only when the recorder is handed one (captureStream(0)),
            // so a hidden tab's throttled animation frames cannot thin the
            // clip out: every frame below is drawn and then requested.
            const stream = out.captureStream(0);
            const track = stream.getVideoTracks()[0] as CanvasCaptureMediaStreamTrack | undefined;
            if (!track) return null;
            const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: REHEARSAL_BITRATE });
            const chunks: Blob[] = [];
            rec.ondataavailable = (e) => {
              if (e.data.size > 0) chunks.push(e.data);
            };
            rec.start(250);
            recording = { out, track, rec, chunks, mime, frames: 0 };
            return { width: out.width, height: out.height, mime };
          },
          recordFrame(pose) {
            const live = recording;
            if (!live || live.rec.state !== "recording") return;
            drawSketch({ from: pose, cut: true }, live.out);
            live.track.requestFrame();
            live.frames += 1;
          },
          async recordStop() {
            const live = recording;
            recording = null;
            if (!live) return null;
            const done = new Promise<void>((resolve) => {
              live.rec.onstop = () => resolve();
            });
            if (live.rec.state !== "inactive") live.rec.stop();
            await done;
            live.track.stop();
            renderLive();
            if (live.frames === 0) return null;
            return { blob: new Blob(live.chunks, { type: live.mime }), mime: live.mime, frames: live.frames };
          },
          relayout() {
            lastKey = "";
            fit();
          },
          roomFor(pose) {
            const p = standIn.group.position;
            const from = new THREE.Vector3(p.x, eyeY(), p.z);
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
          setExposureGain(gain) {
            exposureGainNow = Math.max(1 / 16, Math.min(16, gain));
            renderer.toneMappingExposure = lift.exposure * exposureGainNow;
          },
          setFalseColour(on) {
            falseColourOn = on;
            if (on) ensureComposer();
          },
          setHistogram(c) {
            histogramCanvas = c;
          },
          setFocusHud(el, words) {
            focusHud = el;
            focusWords = words;
            if (el && !words && !meterWords) el.hidden = true;
          },
          setFurniture(f) {
            furniture = f;
          },
          sunHourAt(clientX, clientY) {
            const r = canvas.getBoundingClientRect();
            ndc.set(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
            raycaster.setFromCamera(ndc, camera);
            const d = raycaster.ray.direction;
            if (d.y <= 0.02) return null;
            return hourFromAzimuth(azimuthOf(d.x, d.z));
          },
          setMeter(words) {
            meterWords = words;
            meterLast = "";
            if (!words && focusHud && (depthStop === null || !focusWords)) focusHud.hidden = true;
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
              // One camera for every snapshot, kept with the stage: three
              // holds a transmission render target per CAMERA ID, the size
              // of the drawing buffer, and never frees it — a clone each
              // time left one behind on every thumbnail, compare and Astra
              // edit (found reviewing Helios, 2026-09-17).
              const cam = snapCam ?? (snapCam = camera.clone());
              cam.copy(camera);
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
            const eye = new THREE.Vector3(p.x, eyeY(), p.z);
            // The whole figure inside the PICTURE: a rig format's band is only
            // part of the render's height (Scope keeps 643 of 1024 rows).
            const fr = formatFrame(rigRef.current.format, rigRef.current.squeeze);
            const want = FRAME_HEIGHT_M / 2 / (Math.tan((poseFov * Math.PI) / 360) * fr.heightShare);
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
            camera.position.set(p.x + best.dir.x * distance, eyeY(), p.z + best.dir.z * distance);
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
              eyeY: eyeY(),
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
            const fresh = buildSetScene(THREE, next, stageOpts);
            disposeLive();
            disposeLive = moveBuildInto(built.root, fresh);
            scene.background = fresh.background;
            scene.fog = fresh.fog;
            scene.environment = fresh.environment;
            scene.environmentIntensity = fresh.environmentIntensity;
            camera.far = fresh.farPlane;
            camera.updateProjectionMatrix();
            placeStandIn(standIn, layoutRef.current.mark);
            // The blocks are new ones: nothing is away from where it was
            // built any more, and the movers index the set as it now is.
            moved.clear();
            meshOfCopy = indexBlocks();
            hideBlocks();
            // The lift belongs to the set that is drawn: an hour, a light
            // plot or an Astra change is another set to measure.
            measureLift(next, fresh.farPlane);
          },
          setFilmOverlay(plan, names) {
            clearOverlay();
            overlayOn = plan !== null;
            if (plan) {
              const v = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
              const flat = { transparent: true, depthTest: false, depthWrite: false, toneMapped: false } as const;
              if (plan.path.length > 1) {
                const line = new THREE.Line(
                  new THREE.BufferGeometry().setFromPoints(plan.path.map(v)),
                  new THREE.LineDashedMaterial({ ...flat, color: OVERLAY_INK, opacity: 0.6, dashSize: 0.3, gapSize: 0.22 }),
                );
                line.computeLineDistances();
                overlayRoot.add(line);
              }
              for (const cone of plan.cones) {
                const a = v(cone.apex);
                const [c0, c1, c2, c3] = cone.corners.map(v);
                const color = cone.selected ? OVERLAY_ACCENT : OVERLAY_INK;
                overlayRoot.add(
                  new THREE.Mesh(
                    new THREE.BufferGeometry().setFromPoints([a, c0, c1, a, c1, c2, a, c2, c3, a, c3, c0]),
                    new THREE.MeshBasicMaterial({ ...flat, color, opacity: cone.selected ? 0.1 : 0.05, side: THREE.DoubleSide }),
                  ),
                );
                const edges = new THREE.LineSegments(
                  new THREE.BufferGeometry().setFromPoints([a, c0, a, c1, a, c2, a, c3, c0, c1, c1, c2, c2, c3, c3, c0]),
                  cone.selected
                    ? new THREE.LineBasicMaterial({ ...flat, color, opacity: 0.65 })
                    : new THREE.LineDashedMaterial({ ...flat, color, opacity: 0.35, dashSize: 0.2, gapSize: 0.16 }),
                );
                if (!cone.selected) edges.computeLineDistances();
                overlayRoot.add(edges);
              }
              plan.keys.forEach((key, i) => {
                const label = new CSS2DObject(overlayKeyLabel(names[i] ?? String(key.number), key.selected));
                label.center.set(0, 0);
                label.position.copy(v(key.at));
                overlayRoot.add(label);
              });
            }
            showOverlay();
          },
          holdFilmOverlay(reason, on) {
            if (on) overlayHolds.add(reason);
            else overlayHolds.delete(reason);
            showOverlay();
          },
          setElements(els) {
            stageEls = els;
            keyOfCopy = new Map(els.flatMap((e) => e.members.map(([oi, copy]) => [`${oi}:${copy}`, e.key] as const)));
            for (const key of [...skins.keys()]) if (!els.some((e) => e.key === key)) dropSkin(key);
            hideBlocks();
            drawPick();
          },
          elementAt(clientX, clientY) {
            return pickAt(clientX, clientY);
          },
          setElementBadges(badges) {
            clearBadges();
            for (const b of badges) {
              const el = b.key === FIGURE_KEY ? null : stageEls.find((x) => x.key === b.key);
              if (b.key !== FIGURE_KEY && !el) continue;
              const label = new CSS2DObject(elementBadge(b, coarse));
              // Its bottom edge on the anchor: the photo floats just above the thing.
              label.center.set(0.5, 1);
              label.userData.key = b.key;
              if (el) label.position.set(...el.anchor);
              // The figure's rides at its eyes, lifted clear of the focus readout drawn there.
              else label.element.style.marginTop = "-36px";
              badgeRoot.add(label);
            }
            showOverlay();
          },
          setElementPicked(key) {
            pickedKey = key;
            drawPick();
          },
          async setThingModels(models) {
            const wanted = new Map(models.filter((m) => modelUrlAllowed(m.url)).map((m) => [m.key, m]));
            const drawingsOf = (m: ThingModel) => (m.drawings ?? []).join("|");
            for (const [key, skin] of [...skins]) {
              const w = wanted.get(key);
              if (!w || w.url !== skin.url || w.flip !== skin.flip || drawingsOf(w) !== skin.drawings) dropSkin(key);
            }
            const { GLTFLoader } = await import("three/examples/jsm/loaders/GLTFLoader.js");
            const results: { key: string; ok: boolean; painted?: number }[] = [];
            for (const [key, m] of wanted) {
              const held = skins.get(key);
              if (held) {
                results.push({ key, ok: true, painted: held.painted });
                continue;
              }
              const el = stageEls.find((x) => x.key === key);
              if (!el) {
                results.push({ key, ok: false });
                continue;
              }
              try {
                const gltf = await new GLTFLoader().loadAsync(m.url);
                const model = gltf.scene;
                const box = new THREE.Box3().setFromObject(model);
                if (box.isEmpty()) throw new Error("empty model");
                const fit = fitThingModel(
                  { min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] },
                  { min: el.min, max: el.max },
                  m.flip,
                );
                model.rotation.y = fit.turnDeg * (Math.PI / 180);
                model.scale.setScalar(fit.scale);
                model.position.set(...fit.offset);
                model.traverse((o) => {
                  const mesh = o as import("three").Mesh;
                  if (!mesh.isMesh) return;
                  mesh.castShadow = !coarse;
                  mesh.receiveShadow = !coarse;
                  mesh.userData.skinOf = key;
                  const own = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as import("three").MeshStandardMaterial;
                  mesh.userData.sketchMaterial = new THREE.MeshStandardMaterial({
                    map: own?.map ?? null,
                    color: own?.color ?? new THREE.Color(0xbbbbbb),
                    ...SKETCH_MODEL_MATERIAL,
                  });
                });
                // The thing's own drawings painted onto its sides, the stage's
                // paint and the sketch's both (blueprint-paint.ts, 2026-09-24):
                // TRELLIS keeps a thing's shape and invents its details.
                let painted: Awaited<ReturnType<typeof import("./blueprint-stage").paintFromDrawings>> = { sides: [], dispose: () => {} };
                if (m.drawings?.length) {
                  try {
                    const { paintFromDrawings } = await import("./blueprint-stage");
                    painted = await paintFromDrawings(THREE, renderer, model, m.drawings);
                  } catch (err) {
                    console.warn("A thing's drawings could not be painted onto its model:", err);
                  }
                }
                await lightModel(model);
                const group = new THREE.Group();
                group.add(model);
                skinRoot.add(group);
                skins.set(key, { url: m.url, flip: m.flip, drawings: drawingsOf(m), group, at: fit.at, painted: painted.sides.length, unpaint: painted.dispose });
                placeSkin(key);
                results.push({ key, ok: true, painted: painted.sides.length });
              } catch (err) {
                console.warn("A thing's model would not load:", err);
                results.push({ key, ok: false });
              }
            }
            hideBlocks();
            renderLive();
            return results;
          },
          placeThings(placements) {
            placedNow = new Map(placements.map((p) => [p.key, p]));
            // Where each block stood when the set was drawn, kept the first
            // time it is moved: a rebuild makes new blocks, and clears this.
            const home = (mesh: import("three").Mesh) => {
              const held = homes.get(mesh);
              if (held) return held;
              const fresh = { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z, rotY: mesh.rotation.y };
              homes.set(mesh, fresh);
              return fresh;
            };
            const wanted = new Map(placements.map((p) => [p.key, p]));
            for (const mesh of moved) {
              if (wanted.has(keyOfCopy.get(`${mesh.userData.oi}:${mesh.userData.copy}`) ?? "")) continue;
              const was = homes.get(mesh);
              if (!was) continue;
              mesh.position.set(was.x, was.y, was.z);
              mesh.rotation.y = was.rotY;
            }
            moved.clear();
            for (const key of skins.keys()) placeSkin(key);
            drawPick();
            if (placements.length === 0) return;
            for (const p of placements) {
              const el = stageEls.find((x) => x.key === p.key);
              if (!el) continue;
              const about = { x: (el.min[0] + el.max[0]) / 2, z: (el.min[2] + el.max[2]) / 2 };
              const shift = { x: p.x - about.x, z: p.z - about.z };
              for (const [oi, copy] of el.members) {
                const mesh = meshOfCopy.get(`${oi}:${copy}`);
                if (!mesh) continue;
                const was = home(mesh);
                const turned = turnAbout({ x: was.x, z: was.z }, about, p.turnDeg);
                mesh.position.set(turned.x + shift.x, was.y, turned.z + shift.z);
                mesh.rotation.y = was.rotY + p.turnDeg * (Math.PI / 180);
                moved.add(mesh);
              }
            }
            drawPick();
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
            if (thumb) saveSetThumbnail(setId, thumb).catch((err) => void leftBehind(err));
          });
        }

        cleanup = () => {
          cancelAnimationFrame(raf);
          if (figureTapTimer) clearTimeout(figureTapTimer);
          clearOverlay();
          labelLayer.domElement.remove();
          clearBadges();
          clearPick();
          canvas.removeEventListener("pointerdown", onDown);
          canvas.removeEventListener("pointermove", onMove);
          canvas.removeEventListener("pointerup", onUp);
          canvas.removeEventListener("pointercancel", onUp);
          canvas.removeEventListener("dblclick", onDoubleClick);
          controls.dispose();
          composer?.dispose();
          viewOverride?.dispose();
          bokeh?.dispose();
          disposeLive();
          standIn.dispose();
          textures?.dispose();
          pmrem?.dispose();
          sketchGrey.dispose();
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
      // Best-effort: the next move that settles saves again.
      saveSetLayout(setId, { ...layoutRef.current, camera: api.pose() }).catch((err) => void leftBehind(err));
    }, 1500);
  }, [setId, leftBehind]);

  useEffect(() => {
    settledRef.current = scheduleSave;
  }, [scheduleSave]);

  // Kept current each render: keepStage and stepStage read the page's state.
  // The Turn tool turns the figure where it stands: the frame keeps its third.
  useEffect(() => {
    stageTouchRef.current = () => keepStage(true, stageToolRef.current !== "turn");
    stageHoldRef.current = () => keepStage(true, false);
    stageStepRef.current = {
      undo: () => stepStage(stageUndoRef, stageRedoRef),
      redo: () => stepStage(stageRedoRef, stageUndoRef),
    };
  });

  // ⌘Z / Ctrl+Z steps the stage back, with Shift forward, when no field holds the keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.key.toLowerCase() !== "z") return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.isContentEditable)) return;
      e.preventDefault();
      if (e.shiftKey) stageStepRef.current?.redo();
      else stageStepRef.current?.undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // The studio's keys (cut 4, then the frame's rail in cut A): F frames
  // the figure, ⌘K opens the commands, and the rail's own keys (studio.ts
  // railToolForKey) — V G R pick Select, Move, Turn; C and L open the
  // dock's Camera and Light; M the marks — when no field holds the
  // keyboard. Kept current each render, so each key does what the page
  // would do now.
  const studioKeysRef = useRef<{ frame(): void; palette(): void; tool(id: RailTool): void; escape(): void; view(mode: ViewMode): void }>({
    frame() {},
    palette() {},
    tool() {},
    escape() {},
    view() {},
  });
  useEffect(() => {
    studioKeysRef.current = {
      frame: () => {
        if (ready) frameFigure();
      },
      palette: () => setPaletteOpen((v) => !v),
      view: (m) => setViewMode(m),
      escape: () => {
        setMeasurePts([]);
        setLaying(null);
      },
      tool: (id) => {
        if (id === "select" || id === "move" || id === "turn" || id === "measure") setStageTool(id);
        else if (id === "camera" || id === "light") {
          if (wide) setDockTab(id);
          else setRigOpen(true);
        } else if (id === "mark") setMenu((m) => (m === "figure" ? null : "figure"));
      },
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable)) return;
      const k = e.key.toLowerCase();
      if ((e.metaKey || e.ctrlKey) && k === "k") {
        e.preventDefault();
        studioKeysRef.current.palette();
        return;
      }
      if (e.key === "Escape") {
        studioKeysRef.current.escape();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      if (k === "f") {
        e.preventDefault();
        studioKeysRef.current.frame();
        return;
      }
      if (k >= "1" && k <= "4") {
        e.preventDefault();
        studioKeysRef.current.view(VIEW_MODES[Number(k) - 1]);
        return;
      }
      const tool = railToolForKey("shoot", k);
      if (tool) {
        e.preventDefault();
        studioKeysRef.current.tool(tool);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    apiRef.current?.setViewMode(viewMode);
  }, [viewMode, ready]);

  // The viewport's furniture (cut C): the elements and their words, handed to the loop.
  const names = sceneNames(spec, s);
  useEffect(() => {
    if (!ready) return;
    apiRef.current?.setFurniture({
      sun: sunRef.current,
      sunWords: (hour, el) =>
        hour === null
          ? formatMsg(s.studio.sun, { h: s.filmHourAsBuilt, el })
          : sunAt(hour).night
            ? formatMsg(s.studio.moon, { h: timeLabel(hour) })
            : formatMsg(s.studio.sun, { h: timeLabel(hour), el }),
      bracket: bracketRef.current,
      gizmo: gizmoRef.current,
      scale: scaleRef.current,
      scaleWords: (m) => formatMsg(s.studio.scale, { m }),
      measure: measureRef.current,
      measureWords: (m) => formatMsg(s.studio.measure, { m }),
      points: measurePts,
      eyeline: eyelineRef.current,
      gazeTarget:
        gaze === null
          ? null
          : gaze.at === "camera"
            ? "camera"
            : gaze.at === "object"
              ? (() => {
                  const o = spec.objects[gaze.index];
                  return o ? { x: o.position[0], y: o.position[1], z: o.position[2] } : null;
                })()
              : { x: gaze.x, y: 0.02, z: gaze.z },
      gazeText:
        gaze === null
          ? ""
          : gaze.at === "camera"
            ? s.studio.lookAtCamera
            : gaze.at === "object"
              ? formatMsg(s.studio.lookAtThing, { thing: spec.objects[gaze.index] ? names.objectName(spec.objects[gaze.index]) : "" })
              : s.studio.lookAtPoint,
      pathSvg: pathRef.current,
      pathFrom:
        filmOpen && filmSel !== null && film.beats[filmSel]?.figure
          ? filmSel > 0
            ? filmStages(film.beats, { mark, pose, time: rig.time })[filmSel - 1].figure
            : { x: mark.x, z: mark.z }
          : null,
      pathPoints: filmOpen && filmSel !== null ? (film.beats[filmSel]?.path ?? []) : [],
      pathTo: filmOpen && filmSel !== null && film.beats[filmSel]?.figure ? film.beats[filmSel].figure : null,
    });
    return () => apiRef.current?.setFurniture(null);
  }, [ready, s, measurePts, gaze, spec, names, filmOpen, filmSel, film, mark, pose, rig.time]);

  // What a laid point becomes (cut D): the gaze's point, the next point of
  // the beat's path, or — for the thing whose card is open — where it
  // drives to in this beat and the way it goes (movers.ts).
  useEffect(() => {
    layAddRef.current = (kind, p) => {
      if (kind === "gaze") {
        setGaze({ at: "point", x: p.x, z: p.z });
        setLaying(null);
        return;
      }
      const at = filmSel;
      if (at === null) return;
      if (kind === "mover" || kind === "mover-way") {
        const key = elementCard?.key;
        if (!key || key === FIGURE_KEY) return;
        if (kind === "mover") {
          editMover(key, (was) => ({ key, x: p.x, z: p.z, turnDeg: was?.turnDeg ?? 0, path: was?.path ?? [] }));
          setLaying(null);
        } else {
          editMover(key, (was) => (was && was.path.length < PATH_MAX_POINTS ? { ...was, path: [...was.path, p] } : was));
        }
        return;
      }
      editFilm((f) => ({
        ...f,
        beats: f.beats.map((bb, j) => (j === at && bb.path.length < PATH_MAX_POINTS ? { ...bb, path: [...bb.path, p] } : bb)),
      }));
    };
  });

  useEffect(() => {
    layoutRef.current = { ...layoutRef.current, markId, mark };
    apiRef.current?.placeMark(mark);
    const key = JSON.stringify({ markId, mark });
    if (key === savedMarkRef.current) return;
    savedMarkRef.current = key;
    scheduleSave();
  }, [markId, mark, scheduleSave]);
  // The pose follows its chip: drawn now, saved with the arrangement.
  useEffect(() => {
    layoutRef.current = { ...layoutRef.current, pose };
    if (!ready) return;
    apiRef.current?.setPose(pose);
    scheduleSave();
    // scheduleSave is stable across renders (useCallback on setId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pose]);

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
  // Since the frame (cut A) the dock is a column beside the stage, not a
  // panel over it, and the setup chips wrap into as many rows as the width
  // makes them: the insets are measured from the chips and the strip
  // themselves, not assumed. Before this the lines sat under the chips and
  // shrank for a chat panel that was no longer there ("This is a mess",
  // 2026-09-17).
  const chipsRef = useRef<HTMLDivElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const measure = () => {
      const wideNow = typeof window !== "undefined" && window.matchMedia?.("(min-width: 768px)").matches;
      const chips = chipsRef.current;
      const strip = stripRef.current;
      // The chips' last row, plus the readout that sits 18 px above the lines.
      const top = chips ? chips.offsetTop + chips.offsetHeight + 26 : 14;
      const hostH = hostRef.current?.clientHeight ?? 0;
      const bottom = strip && hostH ? hostH - strip.offsetTop + 10 : wideNow && (filmOpen || cutOpen) ? 76 : filmOpen ? 196 : 112;
      // Nothing stands over the stage from the left any more: the rig is the
      // dock's, beside the viewport (2026-09-17).
      // The new layout's tools float at the stage's left edge (64 px and a
      // gap): the frame and its readout start clear of them.
      insetsRef.current = { left: simpleOn ? 82 : 14, right: 14, top, bottom };
      apiRef.current?.relayout();
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(measure);
    if (chipsRef.current) ro.observe(chipsRef.current);
    if (stripRef.current) ro.observe(stripRef.current);
    return () => ro.disconnect();
    // `viewing`: the chips leave with a still in view and return with the stage.
  }, [rig.format, rigOpen, filmOpen, cutOpen, ready, viewing, simpleOn, simplePhoneSet]);

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

  // The camera department (cut 2). The exposure is drawn over the lift, so
  // the sketch carries it; the squeeze re-fits the projection; the
  // viewfinder's aids are the live view's only.
  const rigEv = rig.ev;
  const rigIso = rig.iso;
  const rigShutter = rig.shutterDeg;
  useEffect(() => {
    if (ready) apiRef.current?.setExposureGain(exposureGain({ ev: rigEv, iso: rigIso, shutterDeg: rigShutter }));
  }, [ready, rigEv, rigIso, rigShutter]);
  const rigSqueeze = rig.squeeze;
  useEffect(() => {
    if (ready) apiRef.current?.relayout();
  }, [ready, rigSqueeze]);
  const falseColourOn = rig.overlays.falseColour;
  useEffect(() => {
    if (ready) apiRef.current?.setFalseColour(falseColourOn);
  }, [ready, falseColourOn]);
  const histogramOn = rig.overlays.histogram;
  useEffect(() => {
    if (!ready) return;
    apiRef.current?.setHistogram(histogramOn ? histogramRef.current : null);
    return () => apiRef.current?.setHistogram(null);
  }, [ready, histogramOn]);
  const rigStop = rig.stop;
  const rigSensor = rig.sensor;
  const rigFormat = rig.format;
  useEffect(() => {
    if (!ready) return;
    const el = focusHudRef.current;
    if (rigStop === null) {
      apiRef.current?.setFocusHud(el, null);
      return;
    }
    const nf = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    const focal = focalMm(fovDeg, sensorHeightMm(rigSensor, rigFormat));
    const coc = sensorCocMm(rigSensor);
    const words = (d: number) => {
      const { nearM, farM } = depthOfField(focal, rigStop, d, coc);
      return Number.isFinite(farM)
        ? formatMsg(s.rig.hudFocus, { d: nf.format(d), near: nf.format(nearM), far: nf.format(farM) })
        : formatMsg(s.rig.hudFocusDeep, { d: nf.format(d), near: nf.format(nearM) });
    };
    apiRef.current?.setFocusHud(el, words);
    return () => apiRef.current?.setFocusHud(el, null);
  }, [ready, rigStop, rigSensor, rigFormat, fovDeg, locale, s]);
  const meterOn = rig.overlays.meter;
  useEffect(() => {
    if (!ready) return;
    apiRef.current?.setMeter(meterOn ? (pct) => formatMsg(s.rig.hudMeter, { pct }) : null);
    return () => apiRef.current?.setMeter(null);
  }, [ready, meterOn, s]);

  // A light scheme is a plot in the set (light-schemes.ts): the stage draws
  // a lit copy of the working copy round the figure's mark. Only when the
  // light, the set or the mark's place changed — the first ready of a set
  // with no scheme is the stage exactly as built.
  const litRef = useRef<{ spec: SetSpec; key: string }>({ spec: initialSpec, key: JSON.stringify(null) });
  // The hour (time-of-day.ts) draws with the scheme: the plot first, then the hour where it applies.
  const litKey = (light: SetRig["light"], time: SetRig["time"], m: { x: number; z: number }) => JSON.stringify(light || time !== null ? [light, time, m.x, m.z] : null);
  /** Draw `next` on the stage now, lit by the rig's scheme and hour — an Astra edit's thumbnail is shot right after. */
  function drawSet(next: SetSpec) {
    const m = layoutRef.current.mark;
    litRef.current = { spec: next, key: litKey(rigRef.current.light, rigRef.current.time, m) };
    apiRef.current?.rebuild(stagedSpec(next, rigRef.current, m));
  }
  const rigTime = rig.time;
  useEffect(() => {
    if (!ready) return;
    const key = litKey(rig.light, rigTime, mark);
    if (litRef.current.spec === spec && litRef.current.key === key) return;
    // A beat after the last change: dragging the sun round the plot, or the
    // hour along its slider, rebuilds the stage once it rests, not on every step.
    const id = setTimeout(() => {
      litRef.current = { spec, key };
      apiRef.current?.rebuild(stagedSpec(spec, { light: rig.light, time: rigTime }, mark));
    }, 60);
    return () => clearTimeout(id);
    // mark.facingDeg turns the figure only; the lights stay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, spec, rig.light, rigTime, mark.x, mark.z]);

  // The rig autosaves like the film — a beat after the hands stop. The
  // first run is the loaded rig itself, not an edit. A rig that does not
  // save is kept for this tab (unsaved.ts), and once a deploy has left the
  // tab behind nothing more is sent: the reload saves it.
  const rigLoadedRef = useRef(false);
  useEffect(() => {
    if (!rigLoadedRef.current) {
      rigLoadedRef.current = true;
      return;
    }
    const missed = () => keepUnsaved(setId, "rig", rig, rigSavedRef.current);
    if (staleRef.current) {
      missed();
      return;
    }
    const id = setTimeout(() => {
      const sentAt = new Date().getTime();
      saveSetRig(setId, rig).then(
        (r) => {
          setRigError(r.error ?? "");
          if (r.error !== null) {
            missed();
            return;
          }
          rigSavedRef.current = savedRigKey(rig);
          dropUnsaved(setId, "rig", sentAt);
        },
        (err) => {
          missed();
          if (!leftBehind(err)) setRigError(SET_SAVE_FAILED);
        },
      );
    }, 900);
    return () => clearTimeout(id);
  }, [rig, setId, leftBehind]);

  // A rig or a film the last load of this page could not save comes back
  // onto the copy it was made from (unsaved.ts), and the autosaves save it.
  useEffect(() => {
    const id = setTimeout(() => {
      const keptRig = takeUnsaved(setId, "rig", rigSavedRef.current);
      if (keptRig !== null) setRig(normaliseSetRig(keptRig));
      const keptFilm = takeUnsaved(setId, "film", filmSavedRef.current);
      if (keptFilm !== null) setFilm(normaliseSetFilm(keptFilm));
    }, 0);
    return () => clearTimeout(id);
  }, [setId]);

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

  /**
   * The stage as it stands, kept for Undo before a move. A gesture (a drag,
   * a scroll tick, a turn) close on another's heels is part of the same move
   * and is not kept again; nor is a state the same as the last one kept.
   *
   * Every move made by hand — an orbit, a drag, a camera or a mark picked,
   * Frame the figure, a lens, a match — ends a third the chat set: she is
   * no longer where its solve put her (check of the Cut 2 spec, item 6). A
   * turn of the figure moves nothing in the frame and keeps it
   * (`movesFrame` false), as does the chat's own turn, which sets the third
   * itself once its camera has moved.
   */
  function keepStage(gesture = false, movesFrame = true) {
    if (movesFrame) frameXRef.current = frameXAfter(frameXRef.current, { kind: "hand" });
    const api = apiRef.current;
    if (!api) return;
    const now = performance.now();
    const sameMove = gesture && now - stageTouchedAtRef.current < STAGE_GESTURE_GAP_MS;
    if (gesture) stageTouchedAtRef.current = now;
    if (sameMove) return;
    const state: StageState = { pose: api.pose(), cameraId, markId: layoutRef.current.markId, mark: layoutRef.current.mark };
    const kept = stageUndoRef.current;
    if (kept.length > 0 && sameStage(kept[kept.length - 1], state)) return;
    stageUndoRef.current = [...kept, state].slice(-STAGE_UNDO_MAX);
    stageRedoRef.current = [];
    setStageUndoCount(stageUndoRef.current.length);
  }

  /** One step of Undo (or Redo): the stage put back as it stood, and the step kept the other way. */
  function stepStage(from: { current: StageState[] }, to: { current: StageState[] }) {
    const api = apiRef.current;
    // Not under a still, the reel or a flying previz, and not while a shot is taken from the frame.
    if (!api || shooting || previz || viewing !== null || reel !== null) return;
    const here: StageState = { pose: api.pose(), cameraId, markId: layoutRef.current.markId, mark: layoutRef.current.mark };
    let back = from.current.pop();
    // A press that moved nothing (a click on the figure) left a step that changes nothing: skip it.
    while (back && sameStage(back, here)) back = from.current.pop();
    if (back) {
      // ⌘Z is a move by hand: a third the chat set ends with it (check of the Cut 2 spec, item 6).
      frameXRef.current = frameXAfter(frameXRef.current, { kind: "hand" });
      to.current.push(here);
      api.goTo(back.pose);
      setFovDeg(back.pose.fovDeg);
      setPoseNow(back.pose);
      setCameraId(back.cameraId);
      setMarkId(back.markId);
      setMark(back.mark);
      scheduleSave();
    }
    setStageUndoCount(stageUndoRef.current.length);
  }

  function pickCamera(id: string) {
    const cam = spec.cameras.find((c) => c.id === id);
    if (!cam) return;
    keepStage();
    setCameraId(id);
    setFovDeg(cam.fovDeg);
    apiRef.current?.goTo({ position: cam.position, target: cam.target, fovDeg: cam.fovDeg });
    scheduleSave();
  }

  /**
   * A lens on the rig's own body. Read from rigRef, never this render's rig
   * (critic item 11, 2026-09-25): the chat changes the format and asks for a
   * lens in one turn, before the page has drawn the new rig, and ⌘K's lens
   * rows are built from a render that can be one change behind.
   */
  function pickLens(mm: number) {
    keepStage();
    const f = fovForLens(mm, sensorHeightMm(rigRef.current.sensor, rigRef.current.format));
    setFovDeg(f);
    apiRef.current?.setFov(f);
    scheduleSave();
  }

  function pickMark(id: string) {
    const m = spec.marks.find((x) => x.id === id);
    if (!m) return;
    keepStage();
    setMarkId(id);
    setMark({ x: m.x, z: m.z, facingDeg: m.facingDeg });
  }

  function turn(delta: number) {
    keepStage(true, false);
    setMark((m) => ({ ...m, facingDeg: (((m.facingDeg + delta) % 360) + 360) % 360 }));
  }

  function frameFigure() {
    keepStage();
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
    busyRef.current.matching = true;
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
        const stale = staleHere(err);
        setMatchError(stale ? t.generate.refreshNeeded : t.generate.submitFailed);
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
      // The picture a match is compared with is the BAND the still is cut to
      // (frame-cut.ts), not the whole render: Scope keeps 643 of its 1024
      // rows, so a reference matched without it came back with its subject a
      // quarter too large, and a subject near an upright picture's left edge
      // landed outside the frame (2026-09-18).
      const matchFrame = formatFrame(rig.format, rig.squeeze);
      const solved = solveMatchPose(res.match, {
        mark: layoutRef.current.mark,
        current: api.pose(),
        referenceAspect: prepared.width / prepared.height,
        bounds: spec.bounds,
        canvasAspect: api.canvasAspect(),
        frame: { bandAspect: matchFrame.bandAspect, heightShare: matchFrame.heightShare },
      });
      keepStage();
      const moved = api.matchTo(solved.pose);
      setFovDeg(solved.pose.fovDeg);
      setCameraId(null);
      scheduleSave();
      // Said from where the camera actually stands, after any move around
      // something built: a limit it was moved off is not said (matchSummary).
      setMatched({ photo: prepared.dataUri, summary: matchSummary(res.match, solved, api.pose()), moved });
    } finally {
      busyRef.current.matching = false;
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
  const quote = quoteSend(stillQuoteInput());

  // ---- what the frame is, in words ----
  const sensorH = sensorHeightMm(rig.sensor, rig.format);
  const activeLens = nearestLens(fovDeg, sensorH);
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
  // The camera department's readout over the frame lines (cut 2).
  const hudLeft = `${s.rig.formats[rig.format]} · ${s.rig.sensors[rig.sensor]}${rig.squeeze > 1 ? ` · ${rig.squeeze}×` : ""}`;
  const hudRight = [lensLabel, rig.stop !== null ? `f/${rig.stop}` : null, shutterFraction(rig.shutterDeg), `ISO ${rig.iso}`, `EV ${rig.ev > 0 ? "+" : ""}${rig.ev.toFixed(1)}`]
    .filter(Boolean)
    .join(" · ");

  const lookShot = shots.find((shot) => shot.generationId === lookId && canBeLook(shot)) ?? null;
  const latestStill = newestLook(shots);

  function pickLook(generationId: string | null) {
    setLookId(generationId);
    lookPinnedRef.current = true;
    setLookPinned(true);
  }
  /**
   * The look every beat of the film carries (2026-09-21): ONE design for the
   * whole film. Each beat used to borrow from the end still before it, so the
   * car was drawn afresh every beat and drifted. A still picked in the Look
   * menu, else the film's opening still, whose car is the one the film opens
   * on. `key` names a pick for the film's context (film.ts filmContextKey),
   * so changing it renders the film again. A thing's own photos ride as its
   * sheet instead (R1, elements.ts), never as the look.
   */
  const filmLook: { still: string | null; key: string | undefined } =
    lookPinned && lookShot && lookShot.generationId !== film.startId
      ? { still: lookShot.generationId, key: `still:${lookShot.generationId}` }
      : { still: film.startId, key: undefined };
  // The opening still as the film's look, and it has nothing to lend (its
  // person covers every object): said in the Film tab and on the timeline,
  // with the way out.
  const filmStartShot0 = film.startId ? (shots.find((sh) => sh.generationId === film.startId) ?? null) : null;
  const filmLookNone = filmLook.key === undefined && filmStartShot0 !== null && !canBeLook(filmStartShot0);
  /**
   * Who the film is of (2026-09-21): the person in its opening still, since
   * beat 1 opens on that very picture. The first film opened on a still of
   * one character with another picked above, and beat 1 morphed one into
   * the other. A still whose person is not known (shot before the page kept
   * it) leaves the character picked above. `filmPersonOther` names the
   * opening still's person when that is not the one picked above, and
   * `filmPersonGone` says they are no longer one of the characters.
   */
  const filmStartPerson = filmStartShot0?.characterId ?? null;
  const filmPersonGone = filmStartPerson !== null && !characters.some((c) => c.id === filmStartPerson);
  const filmCharacterId = filmStartPerson !== null && !filmPersonGone ? filmStartPerson : characterId;
  const filmPersonOther = filmStartPerson !== null && !filmPersonGone && filmStartPerson !== characterId ? (characters.find((c) => c.id === filmStartPerson)?.name ?? null) : null;

  // ---- the set's things and their photos (R1, elements.ts) ----

  const cast = s.cast;
  /** The set's things, from the set as drawn now; what the stage taps and the shot plans read. */
  const els = useMemo(() => elementsOf(spec), [spec]);
  const vehicles = useMemo(() => findVehicles(spec), [spec]);
  /** Which photos are on which thing now, after any change to the set (moved, changed, gone). */
  const resolved = useMemo(() => resolvePhotos(els, elementPhotos), [els, elementPhotos]);
  const heldOf = useMemo(() => new Map(resolved.held.map((h) => [h.key, h])), [resolved]);
  /** A thing's photos, for its model's paint (blueprint-paint.ts): its drawings are painted onto its sides. */
  const drawingsFor = useCallback((key: string) => (heldOf.get(key)?.photos ?? []).map((p) => p.url), [heldOf]);
  const drawingsKey = useMemo(() => thingModels.map((m) => `${m.key}=${drawingsFor(m.key).join("|")}`).join(","), [thingModels, drawingsFor]);
  function elementName(key: string): string {
    if (key === FIGURE_KEY) return character?.name ?? cast.person;
    const e = els.find((x) => x.key === key);
    if (!e) return "";
    const many = els.filter((x) => x.kind === e.kind).length > 1;
    if (e.kind === "car") return many ? formatMsg(cast.carN, { n: e.ordinal }) : cast.car;
    if (e.kind === "vehicle") return many ? formatMsg(cast.vehicleN, { n: e.ordinal }) : cast.vehicle;
    return many ? formatMsg(cast.objectN, { n: e.ordinal }) : cast.object;
  }
  /** A character whose photos still need the likeness answer (data.ts), and not answered here since. */
  function likenessNeeded(id: string): boolean {
    return characters.find((ch) => ch.id === id)?.likenessNeeded === true && !answeredIds.includes(id);
  }
  /** Keep the answer for the cast character (likeness-actions.ts), from the figure's card. */
  async function saveLikeness() {
    if (!likenessPick || likenessBusy || !characterId) return;
    setLikenessBusy(true);
    setLikenessNote("");
    try {
      const res = await answerLikeness(characterId, likenessPick);
      if (res.error !== null) {
        setLikenessNote(localizeServerText(res.error, t));
        return;
      }
      setAnsweredIds((prev) => [...prev, characterId]);
      setLikenessPick(null);
      setError("");
      setLikenessNote(formatMsg(cast.answerSaved, { name: character?.name ?? "" }));
    } catch (err) {
      setLikenessNote(staleHere(err) ? t.generate.refreshNeeded : t.generate.submitFailed);
    } finally {
      setLikenessBusy(false);
    }
  }
  /**
   * Which sheets a still from this pose would carry, as the shot will plan
   * them (actions.ts shootInSet → elements.ts planShotSheets): the same
   * camera, the same band, as if every sheet were drawn — the page draws
   * them before it shoots.
   */
  const cameraFor = useCallback(
    (pose: Pose | null, m: Mark) => {
      const fr = formatFrame(rig.format, rig.squeeze);
      return pose ? shotCameraOf({ camera: pose, mark: m }, 1, fr.cut ? { render: fr.renderAspect, band: fr.bandAspect, squeeze: fr.squeeze } : null) : null;
    },
    [rig.format, rig.squeeze],
  );
  const planFor = useCallback(
    // `shown` is the set as the frame shows it: the arrangement, or a beat's
    // own set with its movers driven where the beat leaves them (movers.ts).
    // The THINGS are always the arrangement's, so a moved car keeps its key
    // and its photos; only where they stand changes.
    (pose: Pose | null, m: Mark, order: readonly string[] = elementOrder, shown: typeof spec = spec) =>
      planShotSheets({
        els,
        held: resolved.held,
        sheets: resolved.held.map((h) => h.sheetHash),
        order,
        vehicles: shown === spec ? vehicles : findVehicles(shown),
        shotCamera: cameraFor(pose, m),
        poseCamera: pose,
        budget: (SHEET_LANES as readonly string[]).includes(stillEngine) ? ELEMENT_SHEETS_PER_STILL : 0,
        spec: shown,
      }),
    [els, resolved, vehicles, cameraFor, stillEngine, spec, elementOrder],
  );
  /** Each thing with photos as "key=sheetHash", sorted: the film's context (film.ts filmContextKey), so new photos render it again. */
  const elementsKey = useMemo(
    () =>
      resolved.held
        .filter((h) => h.photos.length > 0)
        .map((h) => `${h.key}=${h.sheetHash}`)
        .sort()
        .join(","),
    [resolved],
  );
  /** Where the film's figure stands in each beat (film.ts filmStages): the end frames' marks, and where every moved thing stands. */
  const filmStagesNow = useMemo(() => filmStages(film.beats, { mark, pose, time: rig.time }), [film.beats, mark, pose, rig.time]);
  const elsByKey = useMemo(() => new Map(els.map((e) => [e.key, e])), [els]);
  /**
   * The set each beat's end frame is drawn from (movers.ts): the things that
   * move, where that beat leaves them. Nothing moves in most films, and then
   * every beat is the set itself.
   */
  const filmBeatSpecs = useMemo(
    () => filmStagesNow.map((st) => movedSpec(spec, els, st.movers)),
    [filmStagesNow, spec, els],
  );
  /**
   * Where every moved thing stands a share `e` through beat `bi`: the ones
   * this beat drives are on their way, the ones an earlier beat drove stay
   * where it left them. The previz and the rehearsal hand the stage one of
   * these a frame; at e = 1 it is where the beat's end frame is shot.
   */
  const moversAlong = useCallback(
    (stages: readonly { movers: Placement[] }[], bi: number, e: number): Placement[] => {
      const beat = film.beats[bi];
      const at = stages[bi]?.movers ?? [];
      if (!beat || at.length === 0) return at;
      const driving = new Map(beat.movers.map((m) => [m.key, m]));
      const places = stages.map((st) => st.movers);
      return at.map((p) => {
        const m = driving.get(p.key);
        const el = elsByKey.get(p.key);
        if (!m || !el) return p;
        return moverAlong(placementBefore(places, bi, p.key, { x: el.centre[0], z: el.centre[2] }), m, e);
      });
    },
    [film.beats, elsByKey],
  );
  /**
   * The film's one order for the things' sheets (R1): the person's own
   * order first, then each thing by the most of the frame it fills in any
   * beat, then by key — the same in every beat, so a thing that rides one
   * beat's end frame is not dropped for another in the next, and its design
   * holds from beat to beat.
   */
  const filmOrder = useMemo(() => {
    const most = new Map<string, number>();
    film.beats.forEach((b, i) => {
      const cam = cameraFor(b.end, filmStagesNow[i]?.figure ?? mark);
      if (!cam) return;
      for (const p of elementPlaces(filmBeatSpecs[i] ?? spec, els, cam)) if (p.seen && heldOf.has(p.key)) most.set(p.key, Math.max(most.get(p.key) ?? 0, p.share));
    });
    const rank = (k: string) => (elementOrder.includes(k) ? elementOrder.indexOf(k) : Number.POSITIVE_INFINITY);
    return [...most.entries()].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
  }, [film.beats, filmStagesNow, filmBeatSpecs, cameraFor, spec, els, heldOf, mark, elementOrder]);
  /** Which things' sheets ride each beat's end frame, in that order. */
  const filmBeatRides = useMemo(
    () => film.beats.map((b, i) => planFor(b.end, filmStagesNow[i]?.figure ?? mark, filmOrder, filmBeatSpecs[i]).riding),
    [film.beats, filmStagesNow, filmBeatSpecs, planFor, filmOrder, mark],
  );
  // The opening still has nothing to lend, and no thing's own sheet rides
  // the film either: only then may the car change from beat to beat.
  const filmLookNoneShown = filmLookNone && !filmBeatRides.some((r) => r.length > 0);
  /** The plan for the frame as it stands (the pose last settled). */
  const livePlan = useMemo(() => planFor(poseNow, mark), [planFor, poseNow, mark]);
  /** Each thing with photos: its state, its chip's word and its card's sentence. */
  const elementView = useMemo(() => {
    const out = new Map<string, { state: ElementState; word: string; line: string }>();
    const riding = livePlan.riding.length;
    for (const st of livePlan.statuses) {
      const h = heldOf.get(st.key);
      if (!h) continue;
      const state = pageState(st.status, { drawn: sheetHashes.includes(h.sheetHash), drawing: sheetPrep.includes(st.key), last: sheetLast[h.sheetHash] ?? null });
      const w = elementStatusWords(state, { sheet: st.sheet, count: riding, max: ELEMENT_SHEETS_PER_STILL, like: st.like });
      out.set(st.key, { state, word: cast[w.short], line: formatMsg(cast[w.long], w.params) });
    }
    return out;
  }, [livePlan, heldOf, sheetHashes, sheetPrep, sheetLast, cast]);

  /** The server's listing, as it came back from an action. */
  function applyListing(listing: { photos: ElementPhoto[]; sheets: string[] }) {
    setElementPhotos(listing.photos);
    setSheetHashes(listing.sheets);
  }

  /**
   * Put a thing at a place in the strip's order (the drag, Alt+arrows, the
   * card's Move): the order the chips show, the moved one at `to`, saved
   * with the arrangement a moment later (scheduleSave → saveSetLayout).
   */
  function reorderElement(key: string, to: number) {
    const shown = castChips.filter((c) => c.key !== FIGURE_KEY).map((c) => c.key);
    const from = shown.indexOf(key);
    if (from === -1) return;
    const next = shown.filter((k) => k !== key);
    next.splice(Math.max(0, Math.min(next.length, to)), 0, key);
    if (next.join(",") === shown.join(",")) return;
    layoutRef.current = { ...layoutRef.current, elementOrder: next };
    setElementOrder(next);
    scheduleSave();
  }

  function openElementCard(key: string | null) {
    setPhotoError("");
    setElementCard((prev) => ({ key, prevTab: prev ? prev.prevTab : dockTab }));
    // A card is the dock's Scene tab on a computer; on a phone a sheet, which the rig's own sheet makes room for.
    if (wide) setDockTab("scene");
    else setRigOpen(false);
  }
  function closeElementCard() {
    if (elementCard && wide && elementCard.prevTab && dockTab === "scene") setDockTab(elementCard.prevTab);
    setElementCard(null);
    setPhotoError("");
  }

  /** A photo on a thing: prepared here, checked and stored on the server (element-actions.ts addElementPhoto). */
  async function uploadElementPhoto(key: string, file: File) {
    if (photoPhase !== "idle") return;
    setPhotoError("");
    setPhotoPhase("preparing");
    try {
      let prepared: Awaited<ReturnType<typeof preparePhoto>>;
      try {
        prepared = await preparePhoto(file);
      } catch {
        setPhotoError(SET_PHOTO_UNREADABLE);
        return;
      }
      if (!prepared.ok) {
        setPhotoError(prepared.error);
        return;
      }
      setPhotoPhase("checking");
      let res: Awaited<ReturnType<typeof addElementPhoto>>;
      try {
        res = await addElementPhoto(setId, { photoDataUri: prepared.dataUri, element: key });
      } catch (err) {
        setPhotoError(staleHere(err) ? t.generate.refreshNeeded : t.generate.submitFailed);
        return;
      }
      if (res.error !== null) {
        setPhotoError(res.error);
        return;
      }
      applyListing(res.listing);
    } finally {
      setPhotoPhase("idle");
    }
  }

  /** Take a photo off its thing, at once on the page; put back if the server says no. */
  async function removePhoto(refId: string) {
    const before = elementPhotos;
    setElementPhotos((prev) => prev.filter((p) => p.refId !== refId));
    let res: Awaited<ReturnType<typeof removeElementPhoto>>;
    try {
      res = await removeElementPhoto(setId, refId);
    } catch (err) {
      setElementPhotos(before);
      setError(staleHere(err) ? t.generate.refreshNeeded : t.generate.submitFailed);
      return;
    }
    if (res.error !== null) {
      setElementPhotos(before);
      setError(res.error);
      return;
    }
    applyListing(res.listing);
  }

  /** A photo on nothing put on a thing (element-actions.ts assignElementPhoto). */
  async function putPhotoOn(refId: string, key: string) {
    let res: Awaited<ReturnType<typeof assignElementPhoto>>;
    try {
      res = await assignElementPhoto(setId, refId, key);
    } catch (err) {
      setError(staleHere(err) ? t.generate.refreshNeeded : t.generate.submitFailed);
      return;
    }
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    applyListing(res.listing);
  }

  /**
   * Draw the sheets a still will carry, once each, before it is shot
   * (element-actions.ts prepareElementSheets): about a minute a sheet, then
   * kept until the photos change. One that can't be drawn just doesn't ride
   * a still, and its chip says so; false only when the shot must not go on
   * (the allowance, a dropped connection).
   */
  async function drawSheetsFor(riding: readonly { key: string; hash: string }[], onError: (message: string) => void = setError): Promise<string[] | null> {
    let need = beforeShoot(riding, sheetHashes);
    if (need.length === 0) return [];
    const hashOf = new Map(riding.map((r) => [r.key, r.hash]));
    const missed = new Set<string>();
    setSheetPrep(need);
    try {
      for (let round = 0; round < 3 && need.length > 0; round++) {
        let res: Awaited<ReturnType<typeof prepareElementSheets>>;
        try {
          res = await prepareElementSheets(setId, need);
        } catch (err) {
          onError(staleHere(err) ? t.generate.refreshNeeded : t.generate.submitFailed);
          return null;
        }
        if (res.error !== null) {
          onError(res.error);
          return null;
        }
        const drawnNow = res.sheets.flatMap((x) => (x.status === "ready" || x.status === "drawn" ? [hashOf.get(x.key) ?? ""] : [])).filter(Boolean);
        if (drawnNow.length > 0) setSheetHashes((prev) => [...new Set([...prev, ...drawnNow])]);
        const failed = res.sheets.filter((x) => x.status !== "ready" && x.status !== "drawn" && x.status !== "queued");
        for (const x of failed) missed.add(x.key);
        const why = failed.filter((x) => x.status === "refused" || x.status === "failed" || x.status === "storage" || x.status === "too-fast");
        if (why.length > 0) {
          setSheetLast((prev) => ({ ...prev, ...Object.fromEntries(why.map((x) => [hashOf.get(x.key) ?? "", x.status === "refused" ? "refused" : "failed"])) }));
        }
        need = res.sheets.filter((x) => x.status === "queued").map((x) => x.key);
      }
      // Still queued after three asks: not drawn this time either.
      for (const k of need) missed.add(k);
    } finally {
      setSheetPrep([]);
    }
    return [...missed];
  }

  /** The character form for a new person, which comes back here with them cast (return-to.ts). */
  const newCharacterHref = `/app/character/new?returnTo=${encodeURIComponent(`/app/sets/${setId}`)}`;
  /** The arrangement saved first, so the set is as it was left when the form comes back. */
  async function castNewCharacter() {
    const api = apiRef.current;
    try {
      if (api) await saveSetLayout(setId, { ...layoutRef.current, camera: api.pose() });
    } catch {
      // The form still opens: the arrangement saved a moment ago stands.
    }
    router.push(newCharacterHref);
  }

  /** Frame a thing that is out of the frame, from the side the camera is on; Undo takes it back. */
  function showElement(key: string) {
    const api = apiRef.current;
    const e = els.find((x) => x.key === key);
    if (!api || !e) return;
    keepStage();
    const pose = api.pose();
    const size = Math.max(e.max[0] - e.min[0], e.max[1] - e.min[1], e.max[2] - e.min[2]);
    let dx = pose.position[0] - e.centre[0];
    let dz = pose.position[2] - e.centre[2];
    const len = Math.hypot(dx, dz) || 1;
    dx /= len;
    dz /= len;
    const dist = Math.max(2.5, (size / (2 * Math.tan((pose.fovDeg * Math.PI) / 360))) * 1.6);
    api.goTo({ position: [e.centre[0] + dx * dist, Math.max(1.2, e.centre[1] + size * 0.4), e.centre[2] + dz * dist], target: e.centre, fovDeg: pose.fovDeg });
    setCameraId(null);
    scheduleSave();
  }

  // The beat being written is shown as its end frame will be shot
  // (movers.ts): a thing is driven where this beat leaves it the moment its
  // destination is laid, so the stage answers the tap. Not while something
  // is playing or rendering — those drive the things themselves.
  useEffect(() => {
    if (!ready || previz || recording || filmBusy) return;
    if (!(filmOpen || cutOpen) || filmSel === null) return;
    apiRef.current?.placeThings(filmStagesNow[filmSel]?.movers ?? []);
  }, [ready, previz, recording, filmBusy, filmOpen, cutOpen, filmSel, filmStagesNow]);
  // The stage draws the things' models (thing-model.ts); each card hears
  // whether its file loaded.
  useEffect(() => {
    const api = apiRef.current;
    if (!ready || !api) return;
    let live = true;
    void api.setThingModels(thingModels.map(({ key, url, flip }) => ({ key, url, flip, drawings: drawingsFor(key) }))).then((res) => {
      if (!live) return;
      setThingModelState(Object.fromEntries(res.map((r) => [r.key, r.ok ? "ready" : "failed"])));
      setThingPainted(Object.fromEntries(res.map((r) => [r.key, r.painted ?? 0])));
    });
    return () => {
      live = false;
    };
    // drawingsKey stands for drawingsFor: the photos on the things with models.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, thingModels, drawingsKey]);
  // The set stands as it is arranged whenever the film is put away
  // (movers.ts, 2026-09-23): a beat's movers belong to the film, never to
  // the set, so Shoot is never handed a van parked where a beat left it.
  useEffect(() => {
    if (ready && !filmOpen && !cutOpen) apiRef.current?.placeThings([]);
  }, [ready, filmOpen, cutOpen]);
  // The stage knows the things, floats their thumbnails and boxes the one
  // whose card is open (StageApi, R1). No thumbnails over a still being
  // viewed or the cut's clips.
  useEffect(() => {
    if (ready) apiRef.current?.setElements(els);
  }, [els, ready]);
  const badges = useMemo(() => {
    const out: ElementBadge[] = [];
    for (const h of resolved.held) {
      if (h.photos.length === 0) continue;
      const v = elementView.get(h.key);
      out.push({ key: h.key, url: thumbUrl(h.photos[0].url, 320) ?? h.photos[0].url, count: h.photos.length + h.extra.length, state: v && ridesState(v.state) ? "rides" : "idle" });
    }
    // Who plays the figure, over its head.
    if (character?.thumbUrl) out.push({ key: FIGURE_KEY, url: character.thumbUrl, count: 1, state: "rides", round: true });
    return out;
  }, [resolved, elementView, character]);
  useEffect(() => {
    if (ready) apiRef.current?.setElementBadges(viewing !== null || cutOpen ? [] : badges);
  }, [badges, ready, viewing, cutOpen]);
  const pickedKey = elementCard && elementCard.key !== null && elementCard.key !== FIGURE_KEY && (!wide || dockTab === "scene") ? elementCard.key : null;
  useEffect(() => {
    if (ready) apiRef.current?.setElementPicked(pickedKey);
  }, [pickedKey, ready]);
  // A tap on the stage opens a thing's card; one on the ground closes it,
  // and so does one on the set itself while a card is open — the floor of a
  // set is often the set (a track, a stage), and a tap away is a dismissal.
  // With no card open, a tap on the set says why it takes no photos.
  // Kept current each render: the handlers read the page's state.
  const closeCardRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    elementTapRef.current =
      cutOpen || viewing !== null
        ? null
        : (hit) => {
            if (!hit || (hit.kind === "structure" && elementCard)) closeElementCard();
            else openElementCard(hit.kind === "structure" ? null : hit.key);
          };
    closeCardRef.current = elementCard ? closeElementCard : null;
  });
  // Photos that followed their thing through a change to the set are saved
  // on it (settleElementPhotos), once per set drawn; their card says so.
  const settledSetRef = useRef("");
  useEffect(() => {
    if (!ready || settledSetRef.current === setKey) return;
    const moving = resolved.held.filter((h) => h.how !== "exact").map((h) => h.key);
    if (moving.length === 0) return;
    settledSetRef.current = setKey;
    void (async () => {
      try {
        const res = await settleElementPhotos(setId);
        if (res.error !== null) return;
        setFollowedKeys((prev) => [...new Set([...prev, ...moving])]);
        setElementPhotos(res.listing.photos);
        setSheetHashes(res.listing.sheets);
      } catch {
        // The photos stay on their things in the page's memory; the next visit settles them.
      }
    })();
  }, [ready, setKey, resolved, setId]);

  /** The card for a key: a thing, the figure, or (null) a part of the set itself. */
  function cardElementOf(key: string | null): CardElement {
    if (key === FIGURE_KEY) return { kind: "figure", key, name: elementName(key) };
    const e = key === null ? undefined : els.find((x) => x.key === key);
    return e ? { kind: e.kind, key: e.key, name: elementName(e.key), tyres: e.tyres } : { kind: "structure", key: null, name: cast.structureTitle };
  }
  function elementCardView(variant: "dock" | "sheet") {
    if (!elementCard) return null;
    const el = cardElementOf(elementCard.key);
    const thingKey = el.kind === "car" || el.kind === "vehicle" || el.kind === "object" ? el.key : null;
    const h = thingKey ? heldOf.get(thingKey) : undefined;
    const st = thingKey ? livePlan.statuses.find((x) => x.key === thingKey) : undefined;
    const kindWord = el.kind === "car" ? cast.car : el.kind === "vehicle" ? cast.vehicle : cast.object;
    // What this beat does with the thing (movers.ts): whether the set can
    // move it at all, and its move in words.
    const driveNow = (() => {
      const own = thingKey ? elsByKey.get(thingKey) : undefined;
      if (!own || filmSel === null) return { can: false, words: null as string | null };
      if (!canMove(own, spec)) return { can: false, words: null };
      const mover = film.beats[filmSel]?.movers.find((m) => m.key === thingKey) ?? null;
      if (!mover) return { can: true, words: null };
      const from = placementBefore(filmStagesNow.map((st) => st.movers), filmSel, mover.key, { x: own.centre[0], z: own.centre[2] });
      const d = pathLength({ x: from.x, z: from.z }, mover.path, { x: mover.x, z: mover.z });
      const turned = ((mover.turnDeg - from.turnDeg + 540) % 360) - 180;
      return {
        can: true,
        words: [
          formatMsg(cast.driveMoves, { d }),
          turned ? formatMsg(cast.driveTurned, { deg: Math.abs(Math.round(turned)) }) : null,
          mover.path.length ? formatMsg(cast.driveWayN, { n: mover.path.length }) : null,
        ]
          .filter(Boolean)
          .join(" · "),
      };
    })();
    const ordered = castChips.filter((c) => c.key !== FIGURE_KEY).map((c) => c.key);
    const orderIndex = thingKey ? ordered.indexOf(thingKey) : -1;
    const orderCount = ordered.length;
    return (
      <ElementCard
        element={el}
        photos={h?.photos ?? []}
        extra={h?.extra ?? []}
        status={thingKey ? (elementView.get(thingKey)?.line ?? null) : null}
        followed={thingKey && followedKeys.includes(thingKey) ? formatMsg(cast.followed, { name: kindWord.toLowerCase() }) : null}
        person={el.kind === "figure" && character ? { name: character.name, thumbUrl: character.thumbUrl } : null}
        phase={photoPhase}
        error={photoError ? localizeServerText(photoError, t) : null}
        onAdd={(file) => {
          if (thingKey) void uploadElementPhoto(thingKey, file);
        }}
        onRemove={(refId) => void removePhoto(refId)}
        onClose={closeElementCard}
        onShowIt={thingKey && (st?.status === "out" || st?.status === "behind") ? () => showElement(thingKey) : null}
        casting={
          el.kind === "figure"
            ? {
                options: characters.map((ch) => ({ id: ch.id, name: ch.name, thumbUrl: ch.thumbUrl, note: likenessNeeded(ch.id) ? cast.needsAnswer : null })),
                extra:
                  characterId && likenessNeeded(characterId) ? (
                    <div className="flex flex-col gap-1.5 rounded-[10px] bg-[rgba(224,164,104,0.08)] p-2.5" data-el-likeness>
                      <p className="text-[12px] font-medium text-[#f0cda6]">{formatMsg(cast.answerTitle, { name: character?.name ?? "" })}</p>
                      {LIKENESS_ANSWERS.map((a) => (
                        <label key={a} className="flex cursor-pointer items-center gap-2 text-[12px] text-[#d6d9e0]">
                          <input type="radio" name="el-likeness" value={a} checked={likenessPick === a} onChange={() => setLikenessPick(a)} data-el-likeness-answer={a} />
                          {a === "me" ? t.character.likenessMe : a === "permission" ? t.character.likenessPermission : t.character.likenessNone}
                        </label>
                      ))}
                      <p className="text-[11px] leading-snug text-[#9aa0ad]">
                        {(() => {
                          const [before, after] = t.character.likenessPolicyLine.split("{policy}");
                          return (
                            <>
                              {before}
                              <Link href="/content-policy" className="underline underline-offset-2 hover:text-[#ecedf1]">
                                {t.character.likenessPolicy}
                              </Link>
                              {after}
                            </>
                          );
                        })()}
                      </p>
                      <button
                        type="button"
                        onClick={() => void saveLikeness()}
                        disabled={!likenessPick || likenessBusy}
                        className="h-7 self-start cursor-pointer rounded-full bg-[#e0a468] px-3 text-[12px] font-semibold text-[#1b1c20] disabled:cursor-default disabled:bg-[#3a3b42] disabled:text-[#9aa0ad]"
                      >
                        {cast.answerSave}
                      </button>
                      {likenessNote && <p className="text-[11px] leading-snug text-[#c6c9d1]">{likenessNote}</p>}
                    </div>
                  ) : likenessNote ? (
                    <p className="text-[11px] leading-snug text-[#c6c9d1]">{likenessNote}</p>
                  ) : null,
                current: characterId,
                onPick: (id) => setCharacterId(id),
                onNew: () => void castNewCharacter(),
                newHref: newCharacterHref,
                editHref: characterId ? `/app/character/${characterId}?returnTo=${encodeURIComponent(`/app/sets/${setId}`)}` : null,
                // A film stays the opening still's person (filmCharacterId).
                filmNote: filmOpen && filmStartPerson !== null && !filmPersonGone ? formatMsg(cast.filmPerson, { name: characters.find((ch) => ch.id === filmStartPerson)?.name ?? "" }) : null,
              }
            : null
        }
        move={
          thingKey && orderIndex >= 0
            ? {
                earlier: orderIndex > 0 ? () => reorderElement(thingKey, orderIndex - 1) : null,
                later: orderIndex < orderCount - 1 ? () => reorderElement(thingKey, orderIndex + 1) : null,
              }
            : null
        }
        model={
          modelsOn && thingKey
            ? {
                name: thingModels.find((m) => m.key === thingKey)?.name ?? null,
                state: thingModelState[thingKey] ?? null,
                painted: thingPainted[thingKey] ?? 0,
                flipped: thingModels.find((m) => m.key === thingKey)?.flip ?? false,
                kept: thingModels.find((m) => m.key === thingKey)?.kept ?? null,
                note: thingModels.find((m) => m.key === thingKey)?.note ?? (buildNote && buildNote.key === thingKey ? buildNote.text : null),
                onFile: (file) => void loadThingModel(thingKey, file),
                onFlip: () => void turnModel(thingKey),
                onRemove: () => void dropModel(thingKey),
                build: {
                  can: (h?.photos.length ?? 0) > 0,
                  building: buildingModel === thingKey,
                  onBuild: () => void buildModel(thingKey),
                },
              }
            : null
        }
        rebuild={
          thingKey && (THING_REBUILD_OPEN_TO_ALL || modelsOn) && !filmOpen && !cutOpen
            ? {
                photos: h?.photos.length ?? 0,
                working: rebuilding === thingKey,
                held: rebuilding !== null || editingSet || reading || shooting || !ready,
                note: rebuildNote && rebuildNote.key === thingKey ? { text: rebuildNote.text, ok: rebuildNote.ok } : null,
                onUndo:
                  rebuildNote && rebuildNote.key === thingKey && rebuildNote.ok && rebuildNote.from && setChanged !== null
                    ? () => void undoRebuild(thingKey, rebuildNote.from!)
                    : null,
                onRebuild: () => void rebuildThing(thingKey),
              }
            : null
        }
        drive={
          thingKey && filmOpen && filmSel !== null && !filmBusy && !previz
            ? {
                beat: filmSel + 1,
                can: driveNow.can,
                words: driveNow.words,
                laying: laying === "mover" ? "where" : laying === "mover-way" ? "way" : null,
                onLay: () => setLaying((l) => (l === "mover" ? null : "mover")),
                onWay: () => setLaying((l) => (l === "mover-way" ? null : "mover-way")),
                // A quarter of a turn a tap, round and back to where it started.
                onTurn: () => editMover(thingKey, (was) => (was ? { ...was, turnDeg: (was.turnDeg + 90) % 360 } : was)),
                onClear: () => editMover(thingKey, () => null),
              }
            : null
        }
        c={cast}
        variant={variant}
      />
    );
  }
  /**
   * Record the rehearsal, and the clip once it is made (rehearsal.ts). The
   * player comes with it on a computer; a phone's film dock is full, so
   * there it is the row alone and the clip is saved from the Save link.
   */
  function rehearsalControls(className: string, withPlayer = true) {
    const ext = rehearsal?.mime.startsWith("video/mp4") ? "mp4" : "webm";
    return (
      <div className={className} data-rehearsal>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void recordRehearsal()}
            disabled={!ready || previz || recording || Boolean(filmBusy) || film.beats.length === 0}
            className={chip(false)}
            data-rehearsal-record
          >
            ● {recording ? s.filmRecording : s.filmRecord}
          </button>
          {rehearsal && (
            <>
              <span className="whitespace-nowrap text-[11px] tabular-nums text-[#c6c9d1]">
                {formatMsg(s.filmRehearsalReady, { s: rehearsal.seconds, size: clipSize(rehearsal.bytes) })}
              </span>
              <a href={rehearsal.url} download={`${title || "rehearsal"}.${ext}`} className={chip(false)} data-rehearsal-save>
                {s.filmRehearsalSave}
              </a>
            </>
          )}
        </div>
        {rehearsal && withPlayer && (
          <>
            <video src={rehearsal.url} controls playsInline className="mt-2 w-full rounded-[10px] border border-[rgba(255,255,255,0.08)] bg-black" />
            <p className="mt-1 text-[11px] leading-snug text-[#9aa0ad]">{s.filmRehearsalNote}</p>
          </>
        )}
      </div>
    );
  }
  /** The strip shows once the set has things to put photos on, or photos on nothing to put back. */
  const castShown = !cutOpen && !compareOpen && (els.length > 0 || resolved.loose.length > 0);
  function castStrip(className: string) {
    return (
      <CastStrip
        className={className}
        onReorder={reorderElement}
        chips={castChips}
        loose={resolved.loose.map((l) => l.photo)}
        targets={els.map((e) => ({ key: e.key, name: elementName(e.key) }))}
        hint={resolved.held.length === 0}
        onOpen={(key) => openElementCard(key)}
        onPutOn={(refId, key) => void putPhotoOn(refId, key)}
        onRemoveLoose={(refId) => void removePhoto(refId)}
        c={cast}
      />
    );
  }
  /**
   * A thing in a still's frame whose photos came after the still (R1): a
   * clip from that still to an end frame carrying the photos would change
   * its design mid-clip. Its key, or null.
   */
  function newerPhotosIn(shot: SetShot | null | undefined): string | null {
    if (!shot?.pose) return null;
    const cam = cameraFor(shot.pose, mark);
    const shotAt = Date.parse(shot.createdAt);
    if (!cam || !Number.isFinite(shotAt)) return null;
    for (const place of elementPlaces(spec, els, cam)) {
      if (place.seen && heldOf.get(place.key)?.photos.some((ph) => ph.at > shotAt)) return place.key;
    }
    return null;
  }
  const filmOpeningOldKey = newerPhotosIn(filmStartShot0);
  const takeStartOldKey = takeStart ? newerPhotosIn(shots.find((sh) => sh.generationId === takeStart.id)) : null;
  /** The strip's chips: the person, the things whose sheets ride in sheet order, then the others. */
  const castChips: CastChip[] = [
    ...(character
      ? [
          {
            key: FIGURE_KEY,
            name: character.name,
            thumb: character.thumbUrl,
            word: likenessNeeded(character.id) ? cast.needsAnswer : "",
            title: likenessNeeded(character.id) ? formatMsg(cast.answerTitle, { name: character.name }) : formatMsg(cast.personLine, { name: character.name }),
            state: "person" as const,
            round: true,
          },
        ]
      : []),
    // Riding ones by sheet; the rest in the person's order, then as planned —
    // so a thing moved up the list is shown where it was moved.
    ...livePlan.statuses
      .map((st, i) => ({ st, i, rank: elementOrder.includes(st.key) ? elementOrder.indexOf(st.key) : 1e6 }))
      .sort((a, b) => (a.st.status === "rode" ? (a.st.sheet ?? 0) : 99) - (b.st.status === "rode" ? (b.st.sheet ?? 0) : 99) || a.rank - b.rank || a.i - b.i)
      .map(({ st }) => st)
      .flatMap((st): CastChip[] => {
        const h = heldOf.get(st.key);
        const v = elementView.get(st.key);
        if (!h || !v || h.photos.length === 0) return [];
        return [{ key: st.key, name: elementName(st.key), thumb: thumbUrl(h.photos[0].url, 320) ?? h.photos[0].url, word: v.word, title: v.line, state: ridesState(v.state) ? "rides" : "idle" }];
      }),
  ];

  // ---- revisions: every frame set this visit, to step back to ----

  /** The frame as it stands, kept unless it is the one already kept last. */
  function keepRevision(directionNow: string, cameraNow: string | null) {
    const api = apiRef.current;
    if (!api) return;
    const pose = api.pose();
    const { markId: mId, mark: m } = layoutRef.current;
    const label = `${labelOfCamera(cameraNow)} · ${formatMsg(s.lensMm, { mm: nearestLens(pose.fovDeg, sensorHeightMm(rigRef.current.sensor, rigRef.current.format)) })}`;
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
    keepStage();
    api.goTo(r.pose);
    setFovDeg(r.pose.fovDeg);
    setCameraId(r.cameraId);
    setMarkId(r.markId);
    setMark(r.mark);
    setDirection(r.direction);
    setViewing(null);
    scheduleSave();
  }

  // ---- a paid press whose answer was lost (press-follow.ts, 2026-09-25) ----

  /** What a follow says when the answer does not come: nothing started, still going, not known, or History. */
  const lostWords: LostWords = { neverStarted: s.pressNeverStarted, stillGoing: s.pressStillGoing, unchecked: s.pressUnchecked, inHistory: s.pressInHistory };
  /**
   * Follows a press from its send until its answer is there, while the page
   * is here. `onRunning` is told when a read first shows the press reached
   * the server, so the page stops saying it is checking.
   */
  function followLost<T>(sentAt: number, read: () => Promise<PressRead<T> | null>, onRunning?: () => void) {
    return followPress<T>({ sentAt, read, alive: () => aliveRef.current, onRunning });
  }
  /**
   * What a press whose answer was lost left, put on the set as History has
   * it (press-actions.ts readSetPress, review 2026-09-25): its still when it
   * finished, and its clip unless it failed — followed in place like any take
   * still rendering. Rows the strip already shows are left as they are. Says
   * which ids it kept, for a film to keep and a take to offer its clip again.
   */
  function keepLeftRows(
    rows: PressRows,
    at: { format: SetShot["format"]; squeeze: number; pose: SetShot["pose"]; words: string | null; characterId: string | null; engine: SetTakeEngine; takeFrom: TakeSource | null },
  ): { still: string | null; take: string | null } {
    const still = rows.still?.status === "succeeded" ? rows.still : null;
    const clip = rows.take && rows.take.status !== "failed" ? rows.take : null;
    const createdAt = new Date().toISOString();
    const add: SetShot[] = [];
    if (clip) {
      add.push({
        generationId: clip.id,
        status: clip.status,
        resultUrl: clip.resultUrl,
        viewUrl: null,
        posterUrl: clip.posterUrl,
        kind: "take",
        seconds: SET_TAKE_ENGINES[at.engine].seconds,
        score: null,
        createdAt,
        hasLookObjects: false,
        words: at.words,
        format: at.format,
        squeeze: at.squeeze,
        rigAsked: [],
        rigCheck: null,
        pose: null,
        takeFrom: at.takeFrom,
      });
    }
    if (still) {
      add.push({
        generationId: still.id,
        status: "succeeded",
        resultUrl: still.resultUrl,
        viewUrl: still.viewUrl,
        posterUrl: null,
        kind: "still",
        seconds: null,
        score: null,
        createdAt,
        hasLookObjects: false,
        words: at.words,
        format: at.format,
        squeeze: at.squeeze,
        rigAsked: [],
        rigCheck: null,
        pose: at.pose,
        takeFrom: null,
        characterId: at.characterId,
      });
    }
    if (add.length > 0) setShots((prev) => [...add.filter((a) => !prev.some((p) => p.generationId === a.generationId)), ...prev]);
    return { still: still?.id ?? null, take: clip?.id ?? null };
  }
  /**
   * One read of a shot's press (press-actions.ts readSetPress). A read that
   * throws is asked again, unless a deploy left the tab behind: then the
   * reload is on its way and the page says so.
   */
  function shotPressRead(pressId: string) {
    return async (): Promise<PressRead<ShootAnswer> | null> => {
      try {
        const r = await readSetPress(setId, { pressId });
        return pressReadOf(r, "shot");
      } catch (err) {
        return staleHere(err) ? { state: "error", error: t.generate.refreshNeeded } : null;
      }
    };
  }
  /** The same for a take's press, or a film beat's: the Render's id and the beat's number. */
  function takePressRead(pressId: string, filmBeat?: number) {
    return async (): Promise<PressRead<TakeAnswer> | null> => {
      try {
        const r = await readSetPress(setId, filmBeat === undefined ? { pressId } : { pressId, filmBeat });
        return pressReadOf(r, "take");
      } catch (err) {
        return staleHere(err) ? { state: "error", error: t.generate.refreshNeeded } : null;
      }
    };
  }

  /**
   * The still: shot from the frame as it is, with what happens
   * (`directionNow` when send() knows it before state does), and every
   * message since the last still kept with it, as one.
   *
   * Answers whether a press was sent (Helios Cut 2, 2026-09-25): a turn
   * the chat decided to shoot says so when it could not start, and offers
   * Shoot as it is. `opts.pressId` is the one id that decision minted
   * (the shootDue effect); without it this press mints its own, as every
   * button does. An id already sent is never sent again (spec §3.8 rule 8).
   * `opts.outfit` false, or the chat's words saying what they wear, sets
   * the character's saved outfit photo aside for this still (step 9).
   */
  async function shoot(directionNow?: string, push: RigCheckItem[] = [], opts?: { pressId?: string; outfit?: false }): Promise<boolean> {
    // Not during a match (pickReference says why): the frame would be taken
    // now, from a camera the match is about to move. Read from the ref, not
    // from this render's state, so a shot that follows an await cannot land
    // on top of one already in flight.
    const busy = busyRef.current;
    if (busy.shooting || busy.taking || busy.editing || busy.matching || !characterId || !ready) return false;
    // Who is in the photos is asked on the figure's card before any shot (R1.12).
    if (likenessNeeded(characterId)) {
      setError(SET_LIKENESS_NEEDED);
      openElementCard(FIGURE_KEY);
      return false;
    }
    setError("");
    setTakeRetry(null);
    setLastMiss(null);
    setLookDropped(false);
    setLookAside(false);
    setShotElements(null);
    setViewing(null);
    setMenu(null);
    // The things whose own sheets ride are drawn grey: their sheets carry their colour.
    const grey = livePlan.riding.map((r) => r.key);
    const frame = apiRef.current?.frame({ grey });
    if (!frame) {
      setError(s.loadFailed);
      return false;
    }
    // This press's own id (press-follow.ts): a browser's resend of it is
    // followed on the server, never shot again. The chat's decision hands
    // in the one it minted; every other Shoot mints a fresh one here.
    const pressId = opts?.pressId ?? newPressId();
    if (sentPressIdsRef.current.has(pressId)) return false;
    sentPressIdsRef.current.add(pressId);
    // The outfit sits out when the words said what they wear: this still only.
    const outfit = opts?.outfit === false || outfitOffRef.current ? false : undefined;
    outfitOffRef.current = false;
    busy.shooting = true;
    setPressEngine(stillEngine);
    setShooting(true);
    const startedAt = new Date().getTime();
    // The rig it is shot with, for a still whose answer is lost (keepLeftRows).
    const shotRig = normaliseSetRig(rigRef.current);
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
    let sentAt: number | null = null;
    // The rows a press whose answer was lost left, when that is how its follow ended.
    let left: PressRows | null = null;
    try {
      // The things' sheets this frame carries are drawn first, once each (R1).
      if ((await drawSheetsFor(planFor(pose, layoutRef.current.mark).riding)) === null) return false;
      sentAt = new Date().getTime();
      result = await shootInSet(setId, {
        pressId,
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
        stillEngine,
        greyed: grey,
        ...(outfit === false ? { outfit } : {}),
      });
      // A resend of this press found the first delivery still rendering
      // (press.ts, repeat-send.ts): that one is followed, never pressed again.
      if (stillGoingAnswer(result.error)) {
        setFollowing("rendering");
        const followed = await followLost(sentAt, shotPressRead(pressId));
        left = followed.kind === "rows" ? followed.rows : null;
        result = lostAnswer(followed, lostWords);
      }
    } catch (err) {
      // The answer was lost, not the still (operator, 2026-09-25, Cut 1). A
      // dropped connection does not stop the render, which is charged on the
      // server all the same, so "try again" here paid twice. It is followed
      // by its press id, Shoot is held meanwhile, and what lands is shown as
      // if the answer had come. A deploy is refused at once; a later throw
      // is a render stopped mid-way (a crash, the platform's cut-off), never
      // a deploy (press-follow.ts lateThrow).
      if (!lateThrow(sentAt, new Date().getTime())) {
        const stale = staleHere(err);
        if (stale) {
          setError(t.generate.refreshNeeded);
          return sentAt !== null;
        }
      }
      if (sentAt === null) {
        setError(t.generate.submitFailed);
        return false;
      }
      setFollowing("checking");
      const followed = await followLost(sentAt, shotPressRead(pressId), () => setFollowing("rendering"));
      left = followed.kind === "rows" ? followed.rows : null;
      result = lostAnswer(followed, lostWords);
    } finally {
      busyRef.current.shooting = false;
      setShooting(false);
      setFollowing(null);
    }
    if (result.error !== null) {
      setError(result.error);
      // What a lost answer left in History joins the strip (review, 2026-09-25).
      if (left) keepLeftRows(left, { format: shotRig.format, squeeze: shotRig.squeeze, pose, words: asked ?? null, characterId, engine: takeEngine, takeFrom: null });
      return true;
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
      squeeze: result.squeeze,
      rigAsked: result.checks,
      rigCheck: null,
      pose,
      takeFrom: null,
      characterId,
    };
    setShots((prev) => [shot, ...prev]);
    setShotFacts((prev) => ({ ...prev, [shot.generationId]: { seconds: Math.round((new Date().getTime() - startedAt) / 1000), frame: frameLabel } }));
    // The words now live with the still, above it.
    pendingRef.current = [];
    setPendingAsks([]);
    setNote(null);
    setLookDropped(result.lookDropped);
    setLookAside(result.lookAside);
    setShotElements(result.elements);
    if (!result.succeeded) {
      setLastMiss(result.generationId);
      // The render's own reason, where the person is looking (2026-09-21):
      // a brand rule names its words and a fix, instead of only History knowing.
      if (result.failure) setError(`${s.stillFailedWhy} ${result.failure}`);
    }
    else if (canBeLook(shot) && !lookPinnedRef.current) setLookId(result.generationId);
    // The still takes the stage's place until the person goes back to the frame.
    if (result.succeeded) setViewing(result.generationId);
    // The rig check reads it back against what the rig asked for in words.
    if (result.succeeded && result.checks.length > 0) void runRigCheck(result.generationId);
    return true;
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
   *
   * As shoot() (Helios Cut 2, 2026-09-25): answers whether a press was
   * sent; takes the one id a decision minted, or mints its own; never sends
   * an id twice. The move and textures ride from `opts`, else from what the
   * chat kept for this take (takeMoveRef), and go with it.
   */
  async function take(directionNow?: string, opts?: { pressId?: string; move?: FilmMove | null; textures?: FilmTexture[]; outfit?: false }): Promise<boolean> {
    const busy = busyRef.current;
    if (!takeStart || busy.shooting || busy.taking || busy.editing || busy.matching || !characterId || !ready) return false;
    if (!takesOn) {
      setError(SET_TAKE_NEEDS_PLAN);
      return false;
    }
    if (likenessNeeded(characterId)) {
      setError(SET_LIKENESS_NEEDED);
      openElementCard(FIGURE_KEY);
      return false;
    }
    setError("");
    setTakeRetry(null);
    setLastMiss(null);
    setShotElements(null);
    setViewing(null);
    setMenu(null);
    const grey = livePlan.riding.map((r) => r.key);
    const frame = apiRef.current?.frame({ grey });
    if (!frame) {
      setError(s.loadFailed);
      return false;
    }
    // This press's own id (press-follow.ts): the decision's, or fresh for every Take.
    const pressId = opts?.pressId ?? newPressId();
    if (sentPressIdsRef.current.has(pressId)) return false;
    sentPressIdsRef.current.add(pressId);
    const outfit = opts?.outfit === false || outfitOffRef.current ? false : undefined;
    outfitOffRef.current = false;
    // The moving shot the chat set up for this take (moves.ts): its move and textures.
    const chatMove = takeMoveRef.current;
    const move = opts?.move !== undefined ? opts.move : (chatMove?.move ?? null);
    const textures = opts?.textures ?? chatMove?.textures ?? [];
    busy.taking = true;
    setPressEngine(stillEngine);
    setShooting(true);
    const startedAt = new Date().getTime();
    // The rig its end still is shot with, for a take whose answer is lost (keepLeftRows).
    const shotRig = normaliseSetRig(rigRef.current);
    const startId = takeStart.id;
    const pose = apiRef.current?.pose() ?? null;
    const canvasAspect = apiRef.current?.canvasAspect();
    const asked = pendingRef.current.length > 0 ? pendingRef.current.join("\n") : undefined;
    const said = directionNow ?? direction;
    const frameLabel = `${cameraLabel} · ${lensLabel} · ${markLabel}`;
    keepRevision(said, cameraId);
    let result: Awaited<ReturnType<typeof takeInSet>>;
    let sentAt: number | null = null;
    // The rows a press whose answer was lost left, when that is how its follow ended.
    let left: PressRows | null = null;
    try {
      // The end still carries the things' sheets like any still (R1).
      if ((await drawSheetsFor(planFor(pose, layoutRef.current.mark).riding)) === null) return false;
      sentAt = new Date().getTime();
      result = await takeInSet(setId, {
        pressId,
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
        stillEngine,
        greyed: grey,
        ...(move ? { move } : {}),
        ...(textures.length > 0 ? { textures } : {}),
        ...(outfit === false ? { outfit } : {}),
      });
      // A resend found the first delivery still rendering: followed, never pressed again.
      if (stillGoingAnswer(result.error)) {
        setFollowing("rendering");
        const followed = await followLost(sentAt, takePressRead(pressId));
        left = followed.kind === "rows" ? followed.rows : null;
        result = lostAnswer(followed, lostWords);
      }
    } catch (err) {
      // The answer was lost, not the take (Cut 1, as shoot's): the end still
      // and the clip go on rendering and are charged all the same. Followed
      // by its press id with the Take held, and shown as if it had answered.
      if (!lateThrow(sentAt, new Date().getTime())) {
        const stale = staleHere(err);
        if (stale) {
          setError(t.generate.refreshNeeded);
          return sentAt !== null;
        }
      }
      if (sentAt === null) {
        setError(t.generate.submitFailed);
        return false;
      }
      setFollowing("checking");
      const followed = await followLost(sentAt, takePressRead(pressId), () => setFollowing("rendering"));
      left = followed.kind === "rows" ? followed.rows : null;
      result = lostAnswer(followed, lostWords);
    } finally {
      busyRef.current.taking = false;
      setShooting(false);
      setFollowing(null);
    }
    if (result.error !== null) {
      setError(result.error);
      if (left) {
        // What a lost answer left joins the strip, the clip followed in place
        // (review, 2026-09-25). Its end still in and no clip reserved: the
        // request is over (the follow ended on it), so the clip alone is
        // offered again, never the whole take.
        // A take's end still's row id is its press's own (press.ts).
        const frames: TakeFrames = { start: startId, end: left.still?.id ?? pressId, characterId, direction: said, engine: takeEngine, words: asked };
        const kept = keepLeftRows(left, {
          format: shotRig.format,
          squeeze: shotRig.squeeze,
          pose,
          words: asked ?? null,
          characterId,
          engine: takeEngine,
          takeFrom: sourceOf(frames),
        });
        if (kept.still && !kept.take) setTakeRetry({ ...frames, end: kept.still });
      }
      return true;
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
      squeeze: result.still.squeeze,
      rigAsked: result.still.checks,
      rigCheck: null,
      pose,
      takeFrom: null,
      characterId,
    };
    const frames: TakeFrames = { start: takeStart.id, end: result.still.generationId, characterId, direction: said, engine: takeEngine, words: asked };
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
        squeeze: result.still.squeeze,
            rigAsked: [],
            rigCheck: null,
            pose: null,
            takeFrom: sourceOf(frames),
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
    setShotElements(result.still.elements);
    setLookAside(result.still.lookAside);
    // Never while another delivery's clip of this press may still land
    // (repeat-send.ts): a clip tried again is a new press, charged again.
    if (!result.takeGenerationId && result.still.succeeded && !stillGoingAnswer(result.takeError)) setTakeRetry(frames);
    if (!result.still.succeeded) setError(`${s.takeEndFailed}${result.still.failure ? ` ${result.still.failure}` : ""}`);
    else if (result.takeError) setError(result.takeError);
    if (result.still.succeeded) setViewing(result.takeGenerationId ?? result.still.generationId);
    if (result.still.succeeded && result.still.checks.length > 0) void runRigCheck(result.still.generationId);
    return true;
  }

  // ---- a shot the chat decided (Helios Cut 2, spec §3.3, 2026-09-25) ----
  /**
   * The one shot a turn of the chat decided — or a priced button that runs a
   * turn first ("Do it and shoot", "Change it, then shoot") — with the one
   * press id minted for it at the decision. Nothing shoots from inside a
   * turn: a turn's changes are state, drawn on the NEXT render, so a shot
   * taken inside the turn read the person, the words and the pose from
   * before it. This fires from that next render instead, once per id: the
   * id is recorded and the due shot cleared BEFORE the call, so a second
   * run of the effect (React's double mount, a render inside the wait)
   * fires nothing, and shoot() and take() refuse an id already sent.
   */
  const [shootDue, setShootDue] = useState<ShootDue | null>(null);
  const firedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!shootDue) return;
    const due = shootDue;
    // A timeout, not a frame: a hidden tab stops frames. The wait covers the
    // light's 60 ms rebuild, so the sketch sent is the frame the turn lit.
    const timer = setTimeout(() => {
      if (firedRef.current.has(due.pressId)) return;
      firedRef.current.add(due.pressId);
      setShootDue(null);
      const opts = { pressId: due.pressId };
      void (due.kind === "take" ? take(undefined, opts) : shoot(undefined, [], opts)).then((sent) => {
        // It could not start (busy, the likeness, no one on the chip): the turn says so, with Shoot as it is.
        if (!sent) dueNotStarted(due);
      });
    }, SHOOT_DUE_MS);
    return () => clearTimeout(timer);
    // Only the due shot starts it: its closure is the render that holds the
    // turn's changes, whose shoot() and take() read the new frame.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shootDue]);

  // ---- the film's hands ----

  /** The view on the stage now becomes the next beat's end. */
  function filmAddKeyframe() {
    const pose = apiRef.current?.pose();
    if (!pose) return;
    editFilm((f) =>
      f.beats.length >= FILM_MAX_BEATS ? f : { ...f, beats: [...f.beats, { words: "", end: pose, move: null, textures: [], figure: null, time: null, rack: null, gaze: null, path: [], movers: [] }] },
    );
    setFilmSel((n) => n ?? null);
  }

  /**
   * The view on the stage becomes this beat's end — a keyframe adjusted by
   * hand, the way Build's camera takes "Set to this view". The beat's move
   * is dropped: its words said a path to an end that is no longer there.
   * The clips from this beat on go with it (filmAfterEdit). The view the
   * beat already ends on changes nothing and keeps the move: pressed on a
   * beat whose move had just landed, this used to wipe the move and send
   * the take without its words (2026-09-21: the first real film's dolly
   * zoom went as no move at all).
   */
  function filmSetBeatEnd(i: number) {
    stopMovePreview();
    const pose = apiRef.current?.pose();
    if (!pose || previz) return;
    editFilm((f) => ({
      ...f,
      beats: f.beats.map((b, j) => (j === i && !samePose(pose, b.end) ? { ...b, end: pose, move: null } : b)),
    }));
    setFilmSel(i);
  }

  /**
   * Where a move from the rig's library goes (moves.ts): onto the selected
   * beat, or a new one while there is room, its end laid round the figure
   * from where that beat starts — the keyframe before it, or for the first
   * the start still's own camera when it was recorded, else `here`, the
   * stage as it stands. Null when no beat can take a move.
   */
  function layFilmMove(api: StageApi, move: FilmMove, here: Pose): { at: number; from: Pose; end: Pose } | null {
    const at = filmSel !== null && film.beats[filmSel] ? filmSel : film.beats.length < FILM_MAX_BEATS ? film.beats.length : null;
    if (at === null) return null;
    // Beat 1 starts where the film starts: the start still's own camera,
    // when it was recorded — never wherever the stage happens to be.
    const startPose = shots.find((sh) => sh.generationId === film.startId)?.pose ?? null;
    const from = at > 0 ? film.beats[at - 1].end : (startPose ?? here);
    // Clear of what the set built, and a dolly zoom stopped short by a wall
    // re-solving its lens so she keeps her size (moves.ts layBeatMove): the
    // same laying relayMoves does when the beat's start changes.
    const end = layBeatMove(move, from, layoutRef.current.mark, spec.bounds, (p) => api.roomFor(p));
    return { at, from, end };
  }

  /**
   * A move from the rig's library, picked: laid on its beat (layFilmMove),
   * and the stage flies it at once, free. With no beat selected, the move
   * becomes a new beat.
   */
  function filmMove(move: FilmMove) {
    const api = apiRef.current;
    // Not while the film renders: the move could not be kept.
    if (!api || filmBusyRef.current) return;
    // A flight still in the air — the last pick, or Play — stops where it
    // is and this pick takes over (2026-09-21, "the buttons do not work":
    // a pick inside the last one's 1.4 s flight used to be ignored, saying
    // nothing). A pick's flight hands over the pose it flew from, so the
    // new move is laid from there and never from mid-air.
    const flyingFrom = pickFlightRef.current?.run === previzRunRef.current ? pickFlightRef.current.from : null;
    if (previz) stopPlayback();
    // A hover's flight lands first, the stage back where it stood.
    stopMovePreview();
    const laid = layFilmMove(api, move, flyingFrom ?? api.pose());
    if (!laid) return;
    const { at, from, end } = laid;
    keepStage();
    editFilm((f) => {
      const beats = [...f.beats];
      beats[at] = beats[at] ? { ...beats[at], end, move } : { words: "", end, move, textures: [], figure: null, time: null, rack: null, gaze: null, path: [], movers: [] };
      return { ...f, beats };
    });
    setFilmSel(at);
    setPreviz(true);
    const run = ++previzRunRef.current;
    pickFlightRef.current = { run, from };
    const alive = () => previzRunRef.current === run;
    void tweenPose(api, from, end, MOVE_FLIGHT_MS, move, alive).then(() => {
      // Taken over by a later pick or a Stop: that one owns the stage now.
      if (!alive()) return;
      pickFlightRef.current = null;
      setPreviz(false);
      // The lens and the frame's words follow the stage to the beat's end.
      setFovDeg(end.fovDeg);
      setPoseNow(end);
    });
  }

  /**
   * A move under the pointer in the rig (null: the pointer has left the
   * moves). After a moment's rest the stage flies it from its beat's start,
   * over and over, and is put back when the pointer leaves. Free, and
   * nothing is kept. With reduced motion, the stage shows the move's end.
   */
  function previewFilmMove(move: FilmMove | null) {
    if (move === null) {
      stopMovePreview();
      return;
    }
    const api = apiRef.current;
    const p = movePreviewRef.current;
    if (!api || !ready || previz || filmBusyRef.current) return;
    const home = p.home ?? api.pose();
    const laid = layFilmMove(api, move, home);
    if (!laid) return;
    p.token += 1;
    const token = p.token;
    const alive = () => movePreviewRef.current.token === token;
    if (p.timer) clearTimeout(p.timer);
    p.timer = setTimeout(() => {
      p.timer = null;
      if (!alive()) return;
      p.home = home;
      api.holdFilmOverlay("hover", true);
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        api.goTo(laid.end);
        return;
      }
      void (async () => {
        while (alive()) {
          api.goTo(laid.from);
          await tweenPose(api, laid.from, laid.end, MOVE_FLIGHT_MS, move, alive);
          await new Promise((resolve) => setTimeout(resolve, MOVE_PREVIEW_HOLD_MS));
        }
      })();
    }, MOVE_PREVIEW_REST_MS);
  }

  /** Change one thing's model as the page holds it. */
  function patchModel(key: string, patch: Partial<ThingOnStage>) {
    setThingModels((prev) => prev.map((m) => (m.key === key ? { ...m, ...patch } : m)));
  }

  /**
   * A model file put on a thing (thing-model.ts): on the stage at once from
   * the file itself, then kept with the set (model-actions.ts) — the file
   * goes straight to storage at an address made for it, never through our
   * own server — and drawn from where it is kept. A file that cannot be
   * kept stays on this page, and the card says so.
   */
  async function loadThingModel(key: string, file: File) {
    const was = thingModelsRef.current.find((m) => m.key === key);
    if (was?.url.startsWith("blob:")) URL.revokeObjectURL(was.url);
    const local = URL.createObjectURL(file);
    setThingModelState((prev) => ({ ...prev, [key]: "loading" }));
    setThingModels((prev) => [
      ...prev.filter((m) => m.key !== key),
      { key, url: local, flip: false, name: file.name, storedKey: null, kept: "saving", note: null },
    ]);
    const unsaved = (note: string) => patchModel(key, { kept: "unsaved", note: localizeServerText(note, t) });
    try {
      const place = await reserveThingModel(setId, { key, size: file.size });
      if (place.error !== null) return unsaved(place.error);
      const { error: upError } = await createBrowserClient()
        .storage.from(THING_MODEL_BUCKET)
        .uploadToSignedUrl(place.path, place.token, file, { contentType: "model/gltf-binary" });
      if (upError) return unsaved(THING_MODEL_SAVE_FAILED);
      const kept = await keepThingModel(setId, { path: place.path });
      if (kept.error !== null) return unsaved(kept.error);
      // Still the file this card was given (a newer one may have replaced it).
      if (thingModelsRef.current.find((m) => m.key === key)?.url !== local) return;
      URL.revokeObjectURL(local);
      patchModel(key, { url: kept.model.url, storedKey: kept.model.key, kept: "saved", note: null });
    } catch (err) {
      unsaved(staleHere(err) ? t.generate.refreshNeeded : THING_MODEL_SAVE_FAILED);
    }
  }

  /**
   * A thing's 3D model built here from its front photo (model-actions.ts
   * startThingBuild, 2026-09-24, "Everything should be done under one
   * roof"): started, asked after every few seconds, and once built drawn on
   * the stage and kept with the set, as a loaded file is.
   */
  async function buildModel(key: string) {
    if (buildingModel) return;
    setBuildingModel(key);
    setBuildNote(null);
    const fail = (text: string) => setBuildNote({ key, text: localizeServerText(text, t) });
    try {
      const started = await startThingBuild(setId, key);
      if (started.error !== null) return fail(started.error);
      const deadline = new Date().getTime() + THING_BUILD_WAIT_MS;
      while (aliveRef.current && new Date().getTime() < deadline) {
        await new Promise((r) => setTimeout(r, THING_BUILD_POLL_MS));
        const res = await pollThingBuild(setId, { key: started.key, handle: started.handle });
        if (res.error !== null) return fail(res.error);
        if (res.state === "done") {
          const at = res.model.key;
          const was = thingModelsRef.current.find((m) => m.key === at);
          if (was?.url.startsWith("blob:")) URL.revokeObjectURL(was.url);
          setThingModelState((prev) => ({ ...prev, [at]: "loading" }));
          setThingModels((prev) => [
            ...prev.filter((m) => m.key !== at),
            { key: at, url: res.model.url, flip: false, name: cast.modelBuilt, storedKey: at, kept: "saved", note: null },
          ]);
          return;
        }
      }
      if (aliveRef.current) fail(THING_BUILD_FAILED);
    } catch (err) {
      if (!leftBehind(err)) fail(staleHere(err) ? t.generate.refreshNeeded : THING_BUILD_FAILED);
    } finally {
      setBuildingModel(null);
    }
  }

  /** Turned round on the stage at once, and kept turned round with the set. */
  async function turnModel(key: string) {
    const m = thingModelsRef.current.find((x) => x.key === key);
    if (!m) return;
    const flip = !m.flip;
    setThingModelState((prev) => ({ ...prev, [key]: "loading" }));
    patchModel(key, { flip });
    if (!m.storedKey || m.kept !== "saved") return;
    try {
      const res = await turnThingModel(setId, { key: m.storedKey, flip });
      if (res.error !== null) patchModel(key, { note: localizeServerText(res.error, t) });
      else patchModel(key, { url: res.model.url });
    } catch {
      patchModel(key, { note: localizeServerText(THING_MODEL_SAVE_FAILED, t) });
    }
  }

  /** Back to blocks, here and in what the set keeps. */
  async function dropModel(key: string) {
    const m = thingModelsRef.current.find((x) => x.key === key);
    if (!m) return;
    if (m.url.startsWith("blob:")) URL.revokeObjectURL(m.url);
    setThingModels((prev) => prev.filter((x) => x.key !== key));
    if (m.storedKey) {
      try {
        await removeThingModel(setId, { key: m.storedKey });
      } catch {
        // Gone from the stage either way; a file left behind comes back on the next visit and can be removed again.
      }
    }
  }

  /**
   * Write one thing's mover into the beat being written (movers.ts): `fn`
   * is handed what the beat says about it now (null when it says nothing)
   * and gives back what it should say, or null to leave it standing still.
   * Past the beat's ceiling, a new thing is not taken.
   */
  function editMover(key: string, fn: (was: Mover | null) => Mover | null) {
    const at = filmSel;
    if (at === null) return;
    editFilm((f) => ({
      ...f,
      beats: f.beats.map((bb, j) => {
        if (j !== at) return bb;
        const was = bb.movers.find((m) => m.key === key) ?? null;
        const next = fn(was);
        if (!next) return was ? { ...bb, movers: bb.movers.filter((m) => m.key !== key) } : bb;
        if (!was && bb.movers.length >= MOVERS_PER_BEAT) return bb;
        return { ...bb, movers: was ? bb.movers.map((m) => (m.key === key ? next : m)) : [...bb.movers, next] };
      }),
    }));
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
    stopMovePreview();
    setLaying(null);
    const b = film.beats[i];
    if (b) {
      keepStage();
      const api = apiRef.current;
      api?.goTo(b.end);
      // The beat's figure, pose and hour (cut 5), as its end frame will be
      // shot: the film's own rule, so going to a beat shows what the render
      // takes (filmStages, 2026-09-17).
      const staged = filmStages(film.beats, { mark: layoutRef.current.mark, pose: layoutRef.current.pose, time: rigRef.current.time })[i];
      if (api && staged) {
        api.rebuild(stagedSpec(spec, { light: rigRef.current.light, time: staged.time }, staged.figure));
        api.placeMark(staged.figure);
        api.setPose(staged.pose);
        // And the things this beat has moved, where it leaves them (movers.ts).
        api.placeThings(staged.movers);
      }
      setFovDeg(b.end.fovDeg);
      setPoseNow(b.end);
    }
    setPlayhead(timeOf(beatSpans(film), i, 1));
    setFilmSel(i);
  }

  /** Fly the camera through the move — the previz, before a credit is spent. */
  async function playMove() {
    const api = apiRef.current;
    if (!api || previz || film.beats.length === 0) return;
    stopMovePreview();
    // The previz leaves the camera on the last beat's end: Undo brings it back.
    keepStage();
    setPreviz(true);
    const run = ++previzRunRef.current;
    const alive = () => previzRunRef.current === run;
    const spans = beatSpans(film);
    // The move flies from the start still's camera when it was recorded.
    const start = shots.find((sh) => sh.generationId === film.startId)?.pose ?? null;
    let from = start ?? api.pose();
    if (start) api.goTo(start);
    // The people and sun tracks (cut 5): the figure walks from where it
    // stands to each beat's figure as the camera flies, and the hour steps
    // at each beat's end. The stage goes back to the arrangement after.
    const stages = filmStages(film.beats, { mark: layoutRef.current.mark, pose: layoutRef.current.pose, time: rigRef.current.time });
    /** Anything moves in this film: the stage is only asked to drive things when something does. */
    const movingFilm = film.beats.some((b) => b.movers.length > 0);
    let figureFrom: Mark = { ...layoutRef.current.mark };
    let hourNow: number | null = rigRef.current.time;
    for (const [bi, beat] of film.beats.entries()) {
      if (!alive()) break;
      const to = beat.figure;
      const staged = stages[bi];
      const walkFrom = figureFrom;
      await tweenPose(api, from, beat.end, MOVE_FLIGHT_MS, beat.move, alive, (e) => {
        setPlayhead(timeOf(spans, bi, e));
        if (to) {
          // Along the beat's path (people.ts), facing the way it walks, then the way it ends.
          const at = alongPath(walkFrom, beat.path, to, e);
          api.placeMark({ x: at.x, z: at.z, facingDeg: e >= 0.97 || at.facingDeg === null ? to.facingDeg : at.facingDeg });
        }
        // The things that move, on their way (movers.ts).
        if (movingFilm) api.placeThings(moversAlong(stages, bi, e));
      });
      if (to) {
        figureFrom = { x: to.x, z: to.z, facingDeg: to.facingDeg };
        api.setPose(to.pose);
      }
      // The beat's hour, or the rig's where the beat sets none — as the
      // render draws it, not whatever the beat before it left (2026-09-17).
      if (staged.time !== hourNow) {
        hourNow = staged.time;
        api.rebuild(stagedSpec(spec, { light: rigRef.current.light, time: staged.time }, figureFrom));
        api.placeMark(figureFrom);
      }
      // The beat's end: every moved thing exactly where its end frame is shot.
      if (movingFilm) api.placeThings(staged.movers);
      from = beat.end;
    }
    if (hourNow !== rigRef.current.time) api.rebuild(stagedSpec(spec, rigRef.current, layoutRef.current.mark));
    api.placeMark(layoutRef.current.mark);
    api.setPose(layoutRef.current.pose);
    // The set back as it is arranged: a previz moves nothing for good.
    if (movingFilm) api.placeThings([]);
    if (alive()) setPreviz(false);
  }

  /**
   * Record the rehearsal (rehearsal.ts): the same flight Play flies, stepped
   * by the clock rather than by the browser's animation frames, every frame
   * drawn as the sketch a still is taken from (drawSketch) and handed to the
   * recorder. Each beat gets the seconds its clip will be, so the clip runs
   * the film's own length. Free: nothing is sent and nothing is charged.
   */
  async function recordRehearsal() {
    const api = apiRef.current;
    if (!api || recording || previz || filmBusyRef.current || !ready) return;
    if (film.beats.length === 0) {
      setFilmError(s.filmWhyBeats);
      return;
    }
    const perBeat = SET_TAKE_ENGINES[film.engine].seconds;
    const seconds = rehearsalSeconds(film.beats.length, perBeat);
    if (!rehearsalFits(seconds)) {
      setFilmError(formatMsg(s.filmRecordTooLong, { s: seconds, max: REHEARSAL_MAX_SECONDS }));
      return;
    }
    const opened = api.recordStart();
    if (!opened) {
      setFilmError(s.filmRecordUnsupported);
      return;
    }
    setFilmError("");
    setRecording(true);
    // The overlay, the thumbnails and the picked box step aside, as they do
    // for the previz: the engine must be given the set, not our furniture.
    api.holdFilmOverlay("previz", true);
    const stages = filmStages(film.beats, { mark: layoutRef.current.mark, pose: layoutRef.current.pose, time: rigRef.current.time });
    /** Anything moves in this film (movers.ts): the clip is the set in motion, not only the camera. */
    const movingFilm = film.beats.some((b) => b.movers.length > 0);
    const startPose = shots.find((sh) => sh.generationId === film.startId)?.pose ?? api.pose();
    const steps = flightSteps(film.beats.length, perBeat, REHEARSAL_FPS);
    let drawnTime = rigRef.current.time;
    let figureFrom: Mark = { ...layoutRef.current.mark };
    // Every frame gives the browser the thread back before the next one is
    // drawn: the recorder's own work — opening, and handing over a slice of
    // the clip every quarter second — runs here too, and a loop that never
    // lets go records nothing at all (2026-09-23: 142 frames, no bytes, the
    // recorder still opening as it was told to stop). A hidden tab clamps a
    // timer to a second, so a short wait is a message, which nothing
    // throttles.
    const tick = () =>
      new Promise<void>((r) => {
        const ch = new MessageChannel();
        ch.port1.onmessage = () => r();
        ch.port2.postMessage(0);
      });
    const waitUntil = async (due: number) => {
      for (;;) {
        const left = due - performance.now();
        if (left <= 0) return;
        if (left > 8 && !document.hidden) await new Promise((r) => setTimeout(r, left - 4));
        else await tick();
      }
    };
    const t0 = performance.now();
    try {
      for (const step of steps) {
        const beat = film.beats[step.beat];
        if (!beat) break;
        // The clip keeps its length on any machine: a frame whose moment has
        // passed is dropped rather than drawn late, and the last frame of a
        // beat is always drawn so the beat lands where it is meant to.
        const due = t0 + step.t * 1000;
        const now = performance.now();
        if (now > due + 1000 / REHEARSAL_FPS && !step.closes) {
          await tick();
          continue;
        }
        await waitUntil(due);
        const staged = stages[step.beat];
        if (step.opens) {
          const fig = { x: figureFrom.x, z: figureFrom.z };
          if (staged && staged.time !== drawnTime) {
            api.rebuild(stagedSpec(spec, { light: rigRef.current.light, time: staged.time }, fig));
            drawnTime = staged.time;
            api.placeMark(figureFrom);
          }
        }
        const from = step.beat === 0 ? startPose : film.beats[step.beat - 1].end;
        const pose = poseAlong(beat.move, from, beat.end, step.e);
        const to = beat.figure;
        if (to) {
          const at = alongPath(figureFrom, beat.path, to, step.e);
          api.placeMark({ x: at.x, z: at.z, facingDeg: step.e >= 0.97 || at.facingDeg === null ? to.facingDeg : at.facingDeg });
        }
        // The things that move, on their way (movers.ts): this is the half
        // of a blockout the camera cannot do.
        if (movingFilm) api.placeThings(moversAlong(stages, step.beat, step.e));
        api.recordFrame(pose);
        if (step.closes && to) {
          figureFrom = { x: to.x, z: to.z, facingDeg: to.facingDeg };
          api.setPose(to.pose);
        }
      }
    } finally {
      const made = await api.recordStop();
      api.holdFilmOverlay("previz", false);
      // The stage goes back to the arrangement, as the previz leaves it.
      if (drawnTime !== rigRef.current.time) api.rebuild(stagedSpec(spec, rigRef.current, layoutRef.current.mark));
      if (movingFilm) api.placeThings([]);
      api.placeMark(layoutRef.current.mark);
      api.setPose(layoutRef.current.pose);
      setRecording(false);
      if (made) {
        if (rehearsal) URL.revokeObjectURL(rehearsal.url);
        rehearsalBlobRef.current = made.blob;
        setRehearsal({ url: URL.createObjectURL(made.blob), mime: made.mime, seconds, frames: made.frames, bytes: made.blob.size });
      } else {
        setFilmError(s.filmRecordFailed);
      }
    }
  }

  /** The sequencer's Stop (cut B): the previz lands where it is, the reel goes quiet. */
  function stopPlayback() {
    previzRunRef.current += 1;
    setPreviz(false);
    setReel(null);
  }

  /**
   * Scrub the film (cut B): the camera goes to that share of that beat's
   * move — along the move itself (moves.ts poseAlong), from the frame the
   * beat opens on — for free, the way Play flies it. The beat comes into
   * hand for the dock's Film tab.
   */
  function filmSeek(t: number) {
    const api = apiRef.current;
    if (!api || previz) return;
    const spans = beatSpans(film);
    const at = beatAtTime(spans, t);
    if (!at) return;
    const beat = film.beats[at.index];
    const startPose = shots.find((sh) => sh.generationId === film.startId)?.pose ?? null;
    const from = at.index > 0 ? film.beats[at.index - 1].end : (startPose ?? beat.end);
    stopMovePreview();
    keepStage();
    const p = poseAlong(beat.move, from, beat.end, at.u);
    api.goTo(p);
    setFovDeg(p.fovDeg);
    setPoseNow(p);
    setPlayhead(t);
    setFilmSel(at.index);
  }

  /** To the start: the start still's camera, where the film opens. */
  function filmToStart() {
    const api = apiRef.current;
    if (!api) return;
    stopPlayback();
    const startPose = shots.find((sh) => sh.generationId === film.startId)?.pose ?? null;
    if (startPose) {
      keepStage();
      api.goTo(startPose);
      setFovDeg(startPose.fovDeg);
      setPoseNow(startPose);
    }
    setPlayhead(0);
  }

  /** To the end: the last beat's keyframe. */
  function filmToEnd() {
    stopPlayback();
    if (film.beats.length) filmGoTo(film.beats.length - 1);
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
    const context = filmContextKey({ characterId: filmCharacterId, rig, mark, setKey, pose, look: filmLook.key, elements: elementsKey || undefined });
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
    // Already rendering: the button says so itself.
    if (filmBusy || filmBusyRef.current) return;
    // Anything else that stops it is said, never swallowed (filmRenderWhy).
    if (filmRenderWhy !== null || !api) {
      setFilmError(filmRenderWhy ?? s.filmWhyLoading);
      return;
    }
    setFilmError("");
    const plan = filmPlanNow();
    filmBusyRef.current = true;
    // The whole render is paid for, or none of it is started: asked of the
    // person's balance at the Render button's price before the first beat
    // (each take still asks for its own). The film is not touched until the
    // answer is yes; the button says the render has begun meanwhile, as it
    // has, and is not pressed twice.
    const first = plan.jobs[0];
    if (first) setFilmBusy({ beat: first.beat, clipOnly: first.end !== null });
    let refused: string | null;
    try {
      refused = (await checkFilmCredits(setId, film.engine, filmJobCount(plan.jobs))).error;
    } catch (err) {
      const stale = staleHere(err);
      refused = stale ? t.generate.refreshNeeded : t.generate.submitFailed;
    }
    if (refused) {
      filmBusyRef.current = false;
      setFilmBusy(null);
      setFilmError(refused);
      return;
    }
    // The things' sheets every end frame shot will carry (R1), drawn once
    // each, after the credits are known to be there and before any of the
    // film is touched: a sheet that can't be drawn stops the render here,
    // free, rather than a beat changing a thing's design mid-film.
    const sheetsNeeded = plan.jobs.filter((j) => j.end === null).flatMap((j) => filmBeatRides[j.beat] ?? []);
    const unsheeted = await drawSheetsFor(sheetsNeeded, setFilmError);
    if (unsheeted === null || unsheeted.length > 0) {
      filmBusyRef.current = false;
      setFilmBusy(null);
      if (unsheeted) setFilmError(formatMsg(cast.filmSheetBlocked, { name: elementName(unsheeted[0]) }));
      return;
    }
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
      saveFilm(next);
    };
    keep(kept);
    setReel(null);
    setViewing(null);
    // What the stage is drawing right now — the arrangement until a beat
    // moves it. A beat is redrawn when its hour or its figure differ from
    // this, never from the rig (2026-09-17): the light plot and the sun
    // stand round the figure, so both move the light.
    let drawn = { time: rigRef.current.time, figure: layoutRef.current.mark as { x: number; z: number; facingDeg: number }, movers: "[]" };
    const stages = filmStages(film.beats, { mark: layoutRef.current.mark, pose: layoutRef.current.pose, time: rigRef.current.time });
    let stagedAway = false;
    // This Render's own id (press-follow.ts), one for all its beats: each
    // beat says which it is (filmBeat), so the server tells a browser's
    // resend of a beat from the next beat and counts the Render once
    // (press.ts filmBeatPressId, renderPaidBefore). Render pressed again is
    // a new id.
    const pressId = newPressId();
    // Whatever stops the chain — a refusal, a lost stage, anything thrown —
    // the film is let go, or it would stay locked as rendering, and a throw
    // is said in the dock rather than left to the console.
    try {
      for (const job of plan.jobs) {
        // Left the page: the beat just rendered is kept and paid for, and the
        // chain ends here rather than spending on beats nobody is watching.
        if (!aliveRef.current) break;
        const i = job.beat;
        const beat = film.beats[i];
        // A beat opens on the frame the one before it closed on, as this render left it.
        const startId = i === 0 ? film.startId : kept.ends[i - 1];
        if (!beat || !startId) break;
        setFilmBusy({ beat: i, clipOnly: job.end !== null });
        // The people and sun tracks (cut 5): the end frame is shot with the
        // figure where, and how, the beat says, at the beat's hour.
        const staged = stages[i];
        if (!job.end) {
          const figure = staged.figure;
          // The set this beat shows: its hour, and the things it has moved
          // where it leaves them (movers.ts). A beat that moves something is
          // always redrawn — what moved is in the blocks themselves, so the
          // sketch, which things are in the frame and the words about them
          // are the one moment.
          const movedHere = JSON.stringify(staged.movers);
          if (staged.time !== drawn.time || figure.x !== drawn.figure.x || figure.z !== drawn.figure.z || movedHere !== drawn.movers) {
            api.rebuild(movedSpec(stagedSpec(spec, { light: rigRef.current.light, time: staged.time }, figure), els, staged.movers));
            drawn = { time: staged.time, figure, movers: movedHere };
            stagedAway = true;
          }
          api.placeMark(figure);
          api.setPose(staged.pose);
        }
        // Only a beat rendered whole shoots a frame; a clip alone ends on its own.
        // The things whose own sheets ride this end frame are drawn grey, as a still's are.
        const grey = job.end ? [] : planFor(beat.end, staged.figure, filmOrder, movedSpec(spec, els, staged.movers)).riding.map((r) => r.key);
        const frame = job.end ? "" : api.frame({ from: beat.end, grey });
        if (frame === null) {
          setFilmError(s.loadFailed);
          break;
        }
        const sentAt = new Date().getTime();
        const beatWords: LostWords = {
          neverStarted: formatMsg(s.filmBeatNeverStarted, { n: i + 1 }),
          stillGoing: formatMsg(s.filmBeatStillGoing, { n: i + 1 }),
          unchecked: formatMsg(s.filmBeatUnchecked, { n: i + 1 }),
          inHistory: formatMsg(s.filmBeatKept, { n: i + 1 }),
        };
        // What a lost answer left, when that is how the beat's follow ended.
        const left: { rows: PressRows | null } = { rows: null };
        // A beat whose answer was lost, followed by its press with the Render
        // still held (filmBusyRef), and handed on as if the answer had come.
        // "checking" until a read shows it reached the server.
        const followBeat = async (seen: "checking" | "rendering"): Promise<TakeAnswer> => {
          setFilmBusy({ beat: i, clipOnly: job.end !== null, following: seen });
          const followed = await followLost(sentAt, takePressRead(pressId, i), () => setFilmBusy({ beat: i, clipOnly: job.end !== null, following: "rendering" }));
          setFilmBusy({ beat: i, clipOnly: job.end !== null });
          if (followed.kind === "rows") left.rows = followed.rows;
          return lostAnswer(followed, beatWords);
        };
        let result: Awaited<ReturnType<typeof takeInSet>>;
        try {
          result = await takeInSet(setId, {
            pressId,
            filmBeat: i,
            startGenerationId: startId,
            endGenerationId: job.end,
            // The film's one look, the same for every beat (filmLook).
            lookGenerationId: filmLook.still,
            lookPicked: filmLook.key !== undefined,
            // The film's one order for the things' sheets, the same every beat (filmOrder).
            elementOrder: filmOrder,
            stillEngine,
            greyed: grey,
            // Where this beat leaves the things that move (movers.ts): the
            // sketch above was drawn with them there, and the words the
            // server writes about the frame are written about the same set.
            movers: staged.movers,
            frameDataUri: frame,
            // The person in the opening still (filmCharacterId), not the one picked above.
            characterId: filmCharacterId,
            direction: beat.words,
            layout: { ...layoutRef.current, camera: beat.end, mark: staged.figure, pose: staged.pose, gaze: staged.gaze },
            engine: film.engine,
            lifted: api.lifted === true,
            canvasAspect: api.canvasAspect(),
            // The beat's own hour, which is what the stage was rebuilt at
            // (filmStages above) and now what the beat's words say too
            // (time-of-day.ts hourWords, 2026-09-18). The film's context key
            // is worked out apart from this, so no cached clip moves.
            rig: { ...rigRef.current, time: staged.time },
            move: beat.move,
            textures: beat.textures,
            rack: beat.rack,
            gaze: beat.gaze,
            film: true,
          });
          // A resend of this beat found the first delivery still rendering.
          if (stillGoingAnswer(result.error)) result = await followBeat("rendering");
        } catch (err) {
          // Before, the film forgot this beat's paid end still and clip, and
          // the next Render shot and charged it again (audit F2, Cut 1). A
          // deploy is refused at once; anything later is followed by the
          // beat's press and kept on the film as if the answer had come.
          if (!lateThrow(sentAt, new Date().getTime())) {
            const stale = staleHere(err);
            if (stale) {
              setFilmError(t.generate.refreshNeeded);
              break;
            }
          }
          result = await followBeat("checking");
        }
        if (result.error !== null && left.rows) {
          // No answer, but what the beat reserved (review, 2026-09-25): its
          // end still when it finished and its clip unless it failed are
          // kept on the film and the strip, so the next Render renders only
          // what is missing instead of shooting and charging the beat again.
          const made = keepLeftRows(left.rows, {
            format: normaliseSetRig(rigRef.current).format,
            squeeze: normaliseSetRig(rigRef.current).squeeze,
            pose: beat.end,
            words: beat.words || null,
            characterId: filmCharacterId,
            engine: film.engine,
            takeFrom: null,
          });
          if (job.end === null && made.still) {
            keep({ ...kept, clips: [...upTo(kept.clips, i), made.take], ends: [...upTo(kept.ends, i), made.still] });
          } else if (job.end !== null && made.take) {
            const clips = upTo(kept.clips, Math.max(kept.clips.length, i + 1));
            clips[i] = made.take;
            keep({ ...kept, clips });
          }
          const keptSome = (job.end === null && made.still !== null) || (job.end !== null && made.take !== null);
          // Nothing to keep: its end frame did not pass, or its clip failed.
          setFilmError(keptSome ? result.error : job.end === null ? formatMsg(s.filmEndFailed, { n: i + 1 }) : s.filmBeatFailed);
          break;
        }
        if (result.error !== null) {
          setFilmError(result.error);
          // The end frame it would have ended on is gone, or shows someone
          // else (review, 2026-09-25): the next render shoots the beat whole.
          if (job.end && (result.error === SET_TAKE_BAD_END || result.error === SET_TAKE_END_OTHER_PERSON)) {
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
        squeeze: result.still.squeeze,
              rigAsked: [],
              rigCheck: null,
              pose: null,
              takeFrom: null,
            }
          : null;
        if (result.reusedEnd) {
          // The clip alone: its end frame is the beat's own, already in the set.
          if (takeRow) setShots((prev) => [takeRow, ...prev]);
          const clips = upTo(kept.clips, Math.max(kept.clips.length, i + 1));
          clips[i] = result.takeGenerationId;
          // An end frame under the identity bar is not the beat's end any
          // more: the next render shoots the beat whole (2026-09-21).
          const ends = [...kept.ends];
          if (result.stopped) ends[i] = null;
          keep({ ...kept, clips, ends });
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
        squeeze: result.still.squeeze,
            rigAsked: result.still.checks,
            rigCheck: null,
            pose: beat.end,
            takeFrom: null,
            characterId: filmCharacterId,
          };
          setShots((prev) => [...(takeRow ? [takeRow] : []), endStill, ...prev]);
          // Kept on the film, so the reel is still there after the page closes
          // and a later render can open on this beat's end.
          keep({
            ...kept,
            clips: [...upTo(kept.clips, i), result.takeGenerationId],
            // A frame the film stopped on (under the identity bar) is never kept as the beat's end.
            ends: [...upTo(kept.ends, i), result.still.succeeded && !result.stopped ? result.still.generationId : null],
          });
        }
        if (!result.still.succeeded) {
          // The end frame itself failed — a brand rule, a refusal, a miss —
          // and the render's own reason says which (2026-09-21: this used to
          // read "the end frame is in", which it was not).
          setFilmError(`${formatMsg(s.filmEndFailed, { n: i + 1 })}${result.still.failure ? ` ${result.still.failure}` : ""}`);
          break;
        }
        if (result.takeGenerationId === null) {
          setFilmError(result.takeError ?? s.filmBeatFailed);
          break;
        }
      }
    } catch (err) {
      // The take calls catch their own (the connection, a stale deploy): what
      // reaches here is the page's own — a lost stage — and a reload mends it.
      console.error("renderFilm stopped:", err);
      setFilmError(s.loadFailed);
    } finally {
      filmBusyRef.current = false;
      // The stage as arranged, whatever the beats did to it — only while
      // there is a stage: a page that has gone has disposed it.
      if (aliveRef.current && apiRef.current) {
        if (stagedAway) api.rebuild(stagedSpec(spec, rigRef.current, layoutRef.current.mark));
        api.placeMark(layoutRef.current.mark);
        api.setPose(layoutRef.current.pose);
      }
      setFilmBusy(null);
    }
  }

  /** Whether a press's lost answer left a clip that may still land (not one that failed): its frames are not offered again meanwhile. */
  const clipMayLand = (rows: PressRows) => rows.take !== null && rows.take.status !== "failed";

  /**
   * The clip of a take rendered again between the same two frames — the
   * end still reused (takeInSet endGenerationId), so nothing is shot and
   * only the clip is paid for. The failed take stays where it is.
   */
  async function retryClip(f: TakeFrames) {
    const busy = busyRef.current;
    if (busy.shooting || busy.taking || busy.editing || busy.matching || !ready || !takesOn) return;
    busy.taking = true;
    setError("");
    setTakeRetry(null);
    setShooting(true);
    // This press's own id, fresh for every Try the clip again (press-follow.ts).
    const pressId = newPressId();
    const sentAt = new Date().getTime();
    // Whether the frames are offered for the clip again: never while a clip
    // of this press may still land, which a second press would pay for twice.
    let offerAgain = true;
    // The rows a press whose answer was lost left, when that is how its follow ended.
    let left: PressRows | null = null;
    // The frame's shape, for a clip whose answer is lost (keepLeftRows).
    const endShot = shots.find((sh) => sh.generationId === f.end) ?? null;
    let result: Awaited<ReturnType<typeof takeInSet>>;
    try {
      result = await takeInSet(setId, {
        pressId,
        startGenerationId: f.start,
        endGenerationId: f.end,
        frameDataUri: "",
        characterId: f.characterId,
        direction: f.direction,
        layout: { ...layoutRef.current, camera: apiRef.current?.pose() ?? null },
        engine: f.engine,
        lifted: apiRef.current?.lifted === true,
        canvasAspect: apiRef.current?.canvasAspect(),
        words: f.words,
        rig: rigRef.current,
      });
      // A resend found the first delivery still rendering: followed, never pressed again.
      if (stillGoingAnswer(result.error)) {
        setFollowing("rendering");
        const followed = await followLost(sentAt, takePressRead(pressId));
        // Offered again only when this press's clip can no longer land:
        // what it said, nothing started, or a request over with no clip.
        offerAgain = followed.kind === "landed" || followed.kind === "never-started" || (followed.kind === "rows" && !clipMayLand(followed.rows));
        left = followed.kind === "rows" ? followed.rows : null;
        result = lostAnswer(followed, lostWords);
      }
    } catch (err) {
      // The answer was lost, not the clip (Cut 1, as shoot's): it goes on
      // rendering and is charged all the same. A deploy is refused at once,
      // so the frames stay on offer for it; anything else is followed.
      if (!lateThrow(sentAt, new Date().getTime())) {
        const stale = staleHere(err);
        if (stale) {
          setError(t.generate.refreshNeeded);
          setTakeRetry(f);
          return;
        }
      }
      setFollowing("checking");
      const followed = await followLost(sentAt, takePressRead(pressId), () => setFollowing("rendering"));
      offerAgain = followed.kind === "landed" || followed.kind === "never-started" || (followed.kind === "rows" && !clipMayLand(followed.rows));
      left = followed.kind === "rows" ? followed.rows : null;
      result = lostAnswer(followed, lostWords);
    } finally {
      busyRef.current.taking = false;
      setShooting(false);
      setFollowing(null);
    }
    if (result.error !== null) {
      setError(result.error);
      // A clip that a lost answer left joins the strip, followed in place (review, 2026-09-25).
      if (left) keepLeftRows({ still: null, take: left.take }, { format: endShot?.format ?? "square", squeeze: endShot?.squeeze ?? 1, pose: null, words: f.words ?? null, characterId: f.characterId, engine: f.engine, takeFrom: sourceOf(f) });
      // A refusal pressing again cannot pass is not offered again: who a
      // clip tried again is of cannot be changed here (review, 2026-09-25).
      const cannotPass = result.error === SET_TAKE_START_OTHER_PERSON || result.error === SET_TAKE_RETRY_END_OTHER_PERSON || result.error === SET_PICK_CHARACTER;
      if (offerAgain && !cannotPass) setTakeRetry(f);
      return;
    }
    const id = result.takeGenerationId;
    if (!id) {
      setError(result.takeError ?? t.generate.submitFailed);
      setTakeRetry(f);
      return;
    }
    setShots((prev) => [
      {
        generationId: id,
        status: "generating",
        resultUrl: null,
        viewUrl: null,
        posterUrl: null,
        kind: "take",
        seconds: SET_TAKE_ENGINES[f.engine].seconds,
        score: null,
        createdAt: new Date().toISOString(),
        hasLookObjects: false,
        words: f.words ?? null,
        format: result.still.format,
        squeeze: result.still.squeeze,
        rigAsked: [],
        rigCheck: null,
        pose: null,
        takeFrom: sourceOf(f),
      },
      ...prev,
    ]);
    setViewing(id);
  }

  /** "Try the clip again · n credits": the clip's own price, as the server charges it. */
  const retryLabel = (f: TakeSource) => formatMsg(s.takeRetryClip, { n: takesCredits(f.engine, { clips: 1, stills: 0 }) });
  // The failed takes whose clip may be rendered again (take.ts): not one
  // that has been tried again already, which would be paid for twice.
  const retryable = takesOn ? retryableTakes(shots) : new Set<string>();

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
    keepStage();
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
      const wordFrame = formatFrame(rigRef.current.format, rigRef.current.squeeze);
      const { match, from } = wordsToMatch(words, {
        mark: m,
        current: api.pose(),
        sensorHeightMm: sensorHeightMm(rigRef.current.sensor, rigRef.current.format),
        // A size word is how large the person stands in the PICTURE, which is
        // the band, so the camera stands back by its share (2026-09-18).
        frame: { heightShare: wordFrame.heightShare },
      });
      const solved = solveMatchPose(match, {
        mark: m,
        current: from,
        // The frame is the square: its shorter side is its whole side.
        referenceAspect: 1,
        bounds: spec.bounds,
        canvasAspect: api.canvasAspect(),
        // No `frame` here on purpose: what wordsToMatch hands over is already
        // the RENDER's field of view — the lens said in words, on the rig's
        // own sensor — so widening it again would make "50 mm" another lens,
        // and the figure is centred, so the band's width cannot move it.
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
    layoutRef.current = { ...layoutRef.current, markId: mId, mark: m };
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
      if (thumb) saveSetThumbnail(setId, thumb).catch((err) => void leftBehind(err));
    });
  }

  /**
   * Words about the place itself — "make the barriers brick red" — handed
   * to Astra, which edits the set's data server-side (editor-actions.ts,
   * gated like a build) and hands the revised set back. The stage rebuilds
   * under the camera; the line under the frame says how many pieces
   * changed, with Undo beside it. The Build editor's tools and Astra's
   * original stay one press away for anything by hand.
   *
   * Called ONLY from the Astra card's button (Helios Cut 2, step 1,
   * 2026-09-25): one of the month's changes, and Picacho's cost, is spent
   * on a press that said so — never straight from a message, in any mode.
   *
   * `change.said` is the person's own words, the request Astra reads;
   * `change.gloss` is what the chat read them to mean, sent labelled as the
   * page's reading and judged as the reader's (step 10); `frame` is where
   * the person and the camera stand, so Astra never builds over them. v1's
   * card sends neither, and its request is exactly as before. `then` is
   * "Change it, then shoot": the still's own id, minted at the click, and
   * the still is taken only once the change is saved (spec §3.3). Answers
   * whether the change landed, and the seal its Undo needs.
   */
  async function editSet(
    change: { said: string; gloss?: string | null; seal?: string | null },
    frame: EditFrame | null,
    then?: { pressId: string; turnId: number },
  ): Promise<{ landed: boolean; before: SetSpec; undo: EditUndo | null }> {
    const busy = busyRef.current;
    const none = { landed: false, before: spec, undo: null };
    if (busy.editing || busy.shooting || busy.taking || busy.matching) return none;
    busyRef.current.editing = true;
    setEditingSet(true);
    const before = spec;
    // One id per press (astra-press.ts, 2026-09-25): a browser's silent
    // resend of this call is answered at once and never runs Astra twice.
    // newPressId, never crypto.randomUUID alone: that throws outside a
    // secure context or on an old WebView, with the editor already held
    // (review, 2026-09-25).
    const pressId = newPressId();
    let res: Awaited<ReturnType<typeof editSetWithAstra>> | null = null;
    let followed: FollowedEdit | null = null;
    try {
      try {
        // What the chat read, and where things stand, ride only when there are
        // any; the gloss with the server's own seal on it, or the server drops it (review of Cut 2, R1).
        const more =
          change.gloss || frame ? { ...(change.gloss ? { meaning: change.gloss, meaningSeal: change.seal ?? null } : {}), ...(frame ? { frame } : {}) } : undefined;
        res = more ? await editSetWithAstra(setId, change.said, pressId, more) : await editSetWithAstra(setId, change.said, pressId);
      } catch (err) {
        // A stale deploy lets the conversation go and says so. A dropped
        // connection may still have saved (Astra usually finishes on the
        // server), so the set is read back below instead of saying "try
        // again" — which spent a second change for one that had landed.
        if (leftBehind(err)) return none;
      }
      if (res === null || (res.error !== null && res.pending)) followed = await followAstraEdit(() => readAstraEdit(setId, pressId).catch((thrown: unknown) => ({ thrown })), { before, stop: leftBehind });
    } finally {
      busyRef.current.editing = false;
      setEditingSet(false);
    }
    // A read-back carries no seal: its Undo keeps the server's words, and says so.
    const apply = (next: SetSpec, changed: number, undo: EditUndo | null = null) => {
      specBeforeEditRef.current = before;
      lastEditUndoRef.current = { before, kind: "edit", undo };
      setUndoNote(null);
      setSpec(next);
      drawSet(next);
      setSetChanged(changed);
      refreshThumbnail(next);
      // "Change it, then shoot": the still once the change is saved, with the id the click minted.
      if (then) setShootDue({ pressId: then.pressId, kind: "still", turnId: then.turnId });
      return { landed: true, before, undo };
    };
    if (followed) {
      // A press that has ended says how many are left; the others keep the last count.
      if (followed.kind === "saved" || followed.kind === "unsaved") keepEditsLeft(followed.editsLeft, followed.kind === "saved");
      if (followed.kind === "saved") return apply(followed.spec, followed.changed);
      // Only when nothing reached the server is it worth trying again.
      else if (followed.kind === "none") setError(t.generate.submitFailed);
      else if (followed.kind !== "left") setError(followed.error);
      return { ...none, before };
    }
    if (!res) return { ...none, before };
    // Every answer from the month's count on carries one, saved or not.
    keepEditsLeft(res.editsLeft, res.error === null);
    if (res.error !== null) {
      setError(res.error);
      return { ...none, before };
    }
    return apply(res.spec, res.changed, res.undo);
  }

  /**
   * A thing's blocks rebuilt by Astra from its photos (editor-actions.ts
   * rebuildThingFromPhotos): the set comes back with the new blocks where
   * the old ones stood, under a new key — the card, the list's order and a
   * model on it follow — and the changed line's Undo brings the old ones
   * back, as after any Astra edit.
   */
  async function rebuildThing(key: string) {
    if (busyRef.current.editing || editingSet || reading || shooting) return;
    busyRef.current.editing = true;
    setEditingSet(true);
    setRebuilding(key);
    setRebuildNote(null);
    const before = spec;
    // One id per press, as editSet's (astra-press.ts, 2026-09-25).
    const pressId = newPressId();
    let res: Awaited<ReturnType<typeof rebuildThingFromPhotos>> | null = null;
    let followed: FollowedEdit | null = null;
    try {
      try {
        res = await rebuildThingFromPhotos(setId, key, pressId);
      } catch (err) {
        // As editSet: a stale deploy lets go, a dropped connection is read back.
        if (leftBehind(err)) return;
      }
      if (res === null || (res.error !== null && res.pending)) followed = await followAstraEdit(() => readAstraEdit(setId, pressId).catch((thrown: unknown) => ({ thrown })), { before, stop: leftBehind });
    } finally {
      busyRef.current.editing = false;
      setEditingSet(false);
      setRebuilding(null);
    }
    // The set as saved, and the card on the thing's new key: `to` is null when
    // a read-back finds no thing where this one stood (edited meanwhile).
    const apply = (next: SetSpec, changed: number, to: { key: string; blocks: number } | null) => {
      specBeforeEditRef.current = before;
      // A rebuild never changes the set's words (holdEditedText): nothing to seal.
      lastEditUndoRef.current = { before, kind: "rebuild", undo: null };
      setUndoNote(null);
      setSpec(next);
      drawSet(next);
      setSetChanged(changed);
      refreshThumbnail(next);
      if (!to) {
        setRebuildNote(null);
        return;
      }
      moveThingKey(key, to.key);
      setRebuildNote({ key: to.key, text: formatMsg(cast.rebuildDone, { n: to.blocks }), ok: true, from: key });
    };
    if (followed) {
      if (followed.kind === "saved" || followed.kind === "unsaved") keepEditsLeft(followed.editsLeft, followed.kind === "saved");
      // Read back rather than answered: the thing is found the way its photos find it.
      if (followed.kind === "saved") apply(followed.spec, followed.changed, rebuiltThingIn(followed.spec, key));
      else if (followed.kind === "none") setRebuildNote({ key, text: t.generate.submitFailed, ok: false });
      else if (followed.kind !== "left") setRebuildNote({ key, text: localizeServerText(followed.error, t), ok: false });
      return;
    }
    if (!res) return;
    keepEditsLeft(res.editsLeft, res.error === null);
    if (res.error !== null) {
      setRebuildNote({ key, text: localizeServerText(res.error, t), ok: false });
      return;
    }
    apply(res.spec, res.changed, { key: res.key, blocks: res.blocks });
  }

  /** The card, the list's order and a model on the thing follow it to the key its new blocks gave it. */
  function moveThingKey(from: string, to: string) {
    setElementCard((c) => (c && c.key === from ? { ...c, key: to } : c));
    setThingModels((prev) => prev.map((m) => (m.key === from ? { ...m, key: to } : m)));
    if (elementOrder.includes(from)) {
      const order = elementOrder.map((k) => (k === from ? to : k));
      layoutRef.current = { ...layoutRef.current, elementOrder: order };
      setElementOrder(order);
      scheduleSave();
    }
  }

  /** The card's Undo of a rebuild: the changed line's Undo, and the card goes back to the thing's old key. */
  async function undoRebuild(to: string, from: string) {
    await undoSetEdit();
    if (specBeforeEditRef.current !== null) return;
    moveThingKey(to, from);
    setRebuildNote(null);
  }

  /**
   * The changed line's Undo: the set as it stood before the last Astra
   * edit, saved back. The page shows it once it is saved: an Undo that
   * does not save leaves the set as the server has it, Undo still offered,
   * and says why.
   *
   * With the edit's seal, its words come back too — the title and the
   * description every later still reads (undoAstraEdit, Helios Cut 2, step
   * 2, 2026-09-25); without one the pieces come back and the page says the
   * description still mentions the change. Never Astra, never a refund: the
   * change still counts this month, and the page says that as well.
   */
  async function undoSetEdit(inTurn = false): Promise<"undone" | "textKept" | null> {
    const before = specBeforeEditRef.current;
    if (!before || undoingRef.current) return null;
    undoingRef.current = true;
    // The seal and kind of THIS change: a later change replaces both.
    const last = lastEditUndoRef.current?.before === before ? lastEditUndoRef.current : null;
    let failed: string | null;
    let saved: { spec: SetSpec; textRestored: boolean } | null = null;
    try {
      const res = await undoAstraEdit(setId, before, last?.undo ?? null);
      failed = res.error;
      if (res.error === null) saved = res;
    } catch (err) {
      failed = leftBehind(err) ? null : t.generate.submitFailed;
      if (failed === null) return null;
    } finally {
      undoingRef.current = false;
    }
    if (failed !== null || !saved) {
      if (failed !== null) setError(failed);
      return null;
    }
    // Another edit landed meanwhile: that one is the set now.
    if (specBeforeEditRef.current !== before) return null;
    specBeforeEditRef.current = null;
    lastEditUndoRef.current = null;
    setSetChanged(null);
    const said = last?.kind !== "rebuild" && !saved.textRestored ? "textKept" : "undone";
    // A turn's Undo says it in its own reply (Helios Cut 2, step 11a); the changed line's where the line stood.
    if (!inTurn) setUndoNote(said);
    // The copy as saved: the pieces as they were, and the words the server kept.
    setSpec(saved.spec);
    drawSet(saved.spec);
    refreshThumbnail(saved.spec);
    return said;
  }

  /** A change to the set itself, asked for: onto the Astra card, with the conversation open to show it. */
  function askAstraCard(words: string) {
    setAstraAsk({ words });
    if (wide) setDockTab("astra");
    else setChatOpen(true);
  }

  /**
   * "Use my words as what happens", after a reading that failed: the
   * message becomes what happens, by the person's own press — and nothing
   * is shot (Helios Cut 2, step 1, 2026-09-25).
   */
  function wordsAsHappens(message: string) {
    setDirection(message);
    keepRevision(message, cameraId);
    setNote(null);
  }

  /**
   * A message from the composer, or the one carried from the Sets home: read
   * into a frame (readShotWords), done to the stage, and shot at once when
   * the words say so or Astra is not asked to wait. `origin: "build"` is
   * passed by the Sets home's message alone (the initialAsk effect below),
   * never by the composer. So is `home`: the Sets home's message runs on
   * arrival, with no press on this page, so it shoots only when the person
   * chose "Shoot without asking" there — never because its words say shoot
   * (Helios Cut 3, money fix, 2026-09-26).
   */
  async function send(text: string, opts?: { origin?: "build"; home?: boolean }) {
    const message = text.trim();
    if (!message || reading || shooting || editingSet || !ready) return;
    // A folded phone chat unfolds to show the answer (Helios Cut 3, step 2).
    if (!wide) setChatOpen(true);
    // Reader v2 runs the message as one turn (Helios Cut 2, step 11a):
    // admins, until the phrase check passes. Everyone else keeps v1 below.
    if (readerV2 && !readerOffRef.current) return sendTurn(message, opts);
    setError("");
    setDraft("");
    setMentionForced(false);
    setViewing(null);
    setSetChanged(null);
    setUndoNote(null);
    setAstraAsk(null);
    pendingRef.current = [...pendingRef.current, message];
    setPendingAsks(pendingRef.current);
    setNote(null);
    setReading(true);
    let words: ShotWords | null = null;
    let refused = false;
    try {
      const res = await readShotWords(setId, { text: message });
      if (res.error !== null) {
        setError(res.error);
        refused = true;
      } else words = res.words;
    } catch (err) {
      const stale = staleHere(err);
      if (stale) {
        setError(t.generate.refreshNeeded);
        setReading(false);
        return;
      }
      // The reader is down: said below, and nothing changes.
    } finally {
      setReading(false);
    }
    // A reading that failed — the reader down, too many readings in ten
    // minutes (readShotWords answers null), an answer not the shape —
    // changes nothing and shoots nothing, in every mode (the owner's
    // decision 2; Helios Cut 2, step 1, 2026-09-25). Until then the whole
    // message became what happens, and "Shoot without asking" shot it: a
    // paid still of words nobody had read. The words stay one press away.
    if (!words) {
      if (!refused) setNote({ down: message, talk: false, moved: null });
      return;
    }
    // Just talking (3D Jutsu's ask-only mode): the words are read and
    // answered, but nothing moves and nothing is spent.
    if (justTalk) {
      setNote({ talk: words.intent === "talk", moved: null, planned: true });
      return;
    }
    // The message the Sets home just built this set from: what it says
    // about the place is built already, so it is framed, never sent to
    // Astra again (a second paid rewrite of what the build just made).
    const built = opts?.origin === "build" && words.intent === "edit";
    // Words about the place itself are Astra's: a card that says what it
    // uses of the month, and waits for its press — never Astra at once
    // (the owner's decision 1).
    if (words.intent === "edit" && !built) {
      askAstraCard(message);
      return;
    }
    if (!built && words.intent === "talk" && !words.direction && !hasCameraWords(words) && !words.markId && !words.facing) {
      setNote({ talk: true, moved: null });
      return;
    }
    const moved = applyWords(words);
    // The Sets home's message arrived and ran with no press on this page:
    // in "Ask before shooting" it never shoots, even when its words say
    // shoot — the frame card's Shoot, priced, takes it from here (Helios
    // Cut 3, money fix). "Shoot without asking", chosen there, shoots.
    const held = opts?.home === true && askFirst && words.intent === "shoot";
    setNote({ built, talk: false, moved: moved && moved !== "none" ? moved : null, held });
    // The direction is what the card shows: the reader's own words when it
    // read any ("she leans on the counter"), otherwise the direction already
    // framed. The raw message would put "go" in the picture's words
    // (found reviewing Helios, 2026-09-17).
    if (opts?.home === true ? !askFirst : words.intent === "shoot" || !askFirst) await pressShoot(words.direction || direction);
  }

  // The message from the Sets home, once the stage can act on it — then the
  // address forgets it, so a reload does not ask again. `from` goes with it
  // (check of the Cut 2 spec, item 4): left behind, a reload would make the
  // person's own next message the "build" turn, and their Astra change
  // would be dropped as already built. The build turn is this call's alone.
  // It is sent as the home's (`home`): it shoots on arrival only in "Shoot
  // without asking" (Helios Cut 3, money fix).
  useEffect(() => {
    if (!ready || !initialAsk || askedRef.current) return;
    askedRef.current = true;
    const url = new URL(window.location.href);
    for (const key of ["ask", "character", "askFirst", "from"]) url.searchParams.delete(key);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
    void send(initialAsk, initialAskBuilt ? { origin: "build", home: true } : { home: true });
    // send reads the latest state through closures; it is not a dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, initialAsk]);

  // ---- the chat's turns (Helios Cut 2, reader v2, step 11a, 2026-09-25) ----
  //
  // One message is read once (readShotTurn) into one plan (turn-plan.ts
  // planTurn), and the page runs the plan's steps with the handlers it
  // already has, in the plan's order: who, the frame's shape, where she
  // stands, the pose, the camera, the facing, the eye-line, then the light
  // aimed from where the camera ENDED, what happens, a moving shot. Each
  // step says what it reached (the side the camera got to, not the side
  // asked), and the reply is said from that (turn-reply.ts composeReply).
  // Everything a turn does is free. What costs waits for a press priced on
  // its button, and the one shot a message may take — when it asked for
  // one, or in "Shoot without asking", past nothing that holds it — is
  // decided by shootDecision and fired by the shootDue effect with one press
  // id: nothing below calls shoot() or take() (spec §3.8, pin #9).

  /** The page as a turn changes it: its state now, in the plan's terms (turn-plan.ts TurnState). */
  function turnStateNow(): TurnState {
    const pose = apiRef.current?.pose() ?? poseNow;
    return {
      characterId: characterId || null,
      markId: layoutRef.current.markId,
      mark: layoutRef.current.mark,
      pose: layoutRef.current.pose,
      gaze: layoutRef.current.gaze,
      cameraId,
      camera: pose,
      rig: rigRef.current,
      direction,
      frameX: frameXRef.current,
      takeStart,
      takeMove: takeMoveRef.current,
      takeEngine,
      outfitOff: outfitOffRef.current,
      look: lookPinnedRef.current ? { pinned: true, id: lookId } : { pinned: false },
    };
  }

  /** The mark she stands on, or null once she stands on a spot of her own (dragged, placed by a thing). */
  function markOn(id: string | null, m: Mark): string | null {
    return id !== null && spec.marks.some((x) => x.id === id && Math.hypot(x.x - m.x, x.z - m.z) < 0.05) ? id : null;
  }

  /** Which way she faces as the camera sees her (the frame card's rule, facingLabel). */
  function facingSeen(m: Mark, camera: Pose): FigureFacing {
    const bearing = Math.atan2(camera.position[0] - m.x, camera.position[2] - m.z) / DEG;
    const d = ((((m.facingDeg - bearing) % 360) + 540) % 360) - 180;
    if (Math.abs(d) <= 45) return "camera";
    if (Math.abs(d) >= 135) return "away";
    return d > 0 ? "right" : "left";
  }

  /** The person's characters as the plan reads them: those with a photo can be cast (R1), and the ones without are named. */
  const planCharacters: PlanCharacter[] = [
    ...characters.map((c) => ({ id: c.id, name: c.name, hasPhoto: true, hasOutfit: c.hasOutfit === true })),
    ...unshootable.map((u) => ({ id: u.id, name: u.name, hasPhoto: false })),
  ];

  /** What the plan reads of the page (turn-plan.ts PageState). */
  function planStateOf(ctx: TurnContext, st: TurnState): PageState {
    return {
      mode: justTalk ? "talk" : askFirst ? "ask" : "auto",
      source: ctx.source,
      origin: ctx.origin,
      why: ctx.why,
      dropped: ctx.dropped,
      messageCut: ctx.messageCut,
      characterId: st.characterId,
      characters: planCharacters,
      markId: markOn(st.markId, st.mark),
      pose: st.pose,
      cameraId: st.cameraId,
      frameX: st.frameX,
      rig: st.rig,
      cameraBearingDeg: bearingDeg(st.mark, { x: st.camera.position[0], z: st.camera.position[2] }),
      direction: st.direction,
      takeStart: st.takeStart,
      takeMove: st.takeMove,
      takeEngine: st.takeEngine,
      shots: shots.map((sh) => ({ generationId: sh.generationId, kind: sh.kind, status: sh.status, format: sh.format, characterId: sh.characterId ?? null })),
      filmOpen,
      editsLeft,
      editsCap: astraEditsCap,
      tooBig: astraTooBig(spec),
      credits: pageCredits,
    };
  }

  /** What the reply reads of the page after a turn, and the shot it decided (turn-reply.ts ReplyFacts). */
  function replyFactsOf(st: TurnState, shot: ShootDecision | null): ReplyFacts {
    const sensorMm = sensorHeightMm(st.rig.sensor, st.rig.format);
    const stills = shots.filter((sh) => sh.kind === "still");
    const newest = stills[0] ?? null;
    const lookNow = newestLook(shots);
    const lookShotNow = lookNow ? (shots.find((sh) => sh.generationId === lookNow) ?? null) : null;
    const planShots = planStateOf(TURN_BUTTON, st).shots;
    return {
      locale,
      mode: justTalk ? "talk" : askFirst ? "ask" : "auto",
      characters: [...characters.map((c) => ({ id: c.id, name: c.name })), ...unshootable],
      characterId: st.characterId,
      marks: spec.marks.map((m) => ({ id: m.id, label: labelOfMark(m.id) })),
      cameras: spec.cameras.map((c) => ({ id: c.id, label: labelOfCamera(c.id) })),
      things: replyThingsOf(spec, st.mark, replyWords),
      markId: markOn(st.markId, st.mark),
      pose: st.pose,
      facing: facingSeen(st.mark, st.camera),
      cameraId: st.cameraId,
      frameX: st.frameX,
      rig: st.rig,
      direction: st.direction,
      lensMm: nearestLens(st.camera.fovDeg, sensorMm),
      distanceM: Math.hypot(st.camera.position[0] - st.mark.x, st.camera.position[2] - st.mark.z),
      spot: { spot: cameraSpotOf(st.camera, st.mark), facingDeg: st.mark.facingDeg, sensorHeightMm: sensorMm },
      credits: pageCredits,
      takeEngine: st.takeEngine,
      takeArmedBy: st.takeStart?.armedBy ?? null,
      takeFrom: st.takeStart?.n ?? pickTakeStart(planShots, st.characterId, st.rig.format)?.n ?? null,
      newestStill: lookShotNow ? stillNumber(lookShotNow) : null,
      lastStill: newest
        ? { n: stillNumber(newest), status: newest.status === "succeeded" || newest.status === "failed" ? newest.status : "generating", score: newest.score }
        : null,
      editsLeft,
      editsCap: astraEditsCap,
      tooBig: astraTooBig(spec),
      producerOn,
      shot,
    };
  }

  /** A turn joins the thread; the ones before it are answered, so only the newest keeps its buttons. */
  function addTurn(turn: ChatTurn) {
    setTurns((prev) => [...prev.map((x) => (x.settled ? x : { ...x, settled: true })), turn].slice(-TURNS_KEPT));
  }
  /** A press on a turn's card or button was made: its other buttons go (Undo stays while it is the newest). */
  function settleTurn(id: number) {
    setTurns((prev) => prev.map((x) => (x.id === id && !x.settled ? { ...x, settled: true } : x)));
  }

  /**
   * A message, read against the set as it stands (readShotTurn), then run
   * as one turn. Nothing is sent while anything else is: a read, a shot, an
   * Astra change, or a press whose answer is being followed (Cut 1). The
   * page sends what it knows of the frame (NOW) and its last three turns;
   * the server checks every value and writes the reader's context itself.
   * "Try again" reads the same words again as a message turn that never
   * shoots (source "retry", check of the spec, item 1).
   */
  async function sendTurn(message: string, opts?: { origin?: "build"; source?: "message" | "retry"; home?: boolean }) {
    const api = apiRef.current;
    if (reading || shooting || editingSet || following !== null || shootDue !== null || !ready || !api) return;
    const source = opts?.source ?? "message";
    setError("");
    if (source === "message") setDraft("");
    setMentionForced(false);
    setViewing(null);
    setSetChanged(null);
    setUndoNote(null);
    setAstraAsk(null);
    // The message is kept with the still it leads to, as in v1: a retry's is already there.
    if (source === "message") {
      pendingRef.current = [...pendingRef.current, message];
      setPendingAsks(pendingRef.current);
    }
    setNote(null);
    setReading(true);
    const now: ReaderNow = {
      who: characterId || null,
      markId: markOn(layoutRef.current.markId, layoutRef.current.mark),
      mark: layoutRef.current.mark,
      pose: layoutRef.current.pose,
      gaze: layoutRef.current.gaze,
      // Null once the view has left the set's camera, so "camera 2" is never "already so" when it isn't.
      cameraId,
      camera: api.pose(),
      frameX: frameXRef.current,
      rig: rigRef.current,
      direction,
    };
    // What the last turns asked and did, in the page's own words (turn-reply.ts turnDid) — a button
    // pressed (a which-one, Do it) as its label, so "the other one" after a tap knows which was tapped (review of Cut 2, U1).
    const lastTurns = turns
      .filter((x) => x.asked !== null || x.pressed !== null)
      .slice(-READER_CONTEXT_MAX.turns)
      .map((x) => ({ said: x.asked ?? `(pressed) ${x.pressed ?? ""}`, did: x.did }));
    let res: Awaited<ReturnType<typeof readShotTurn>> | null = null;
    try {
      res = await readShotTurn(setId, { text: message, now, turns: lastTurns, ...(opts?.origin ? { origin: opts.origin } : {}) });
    } catch (err) {
      if (staleHere(err)) {
        setError(t.generate.refreshNeeded);
        return;
      }
      // The reader could not be reached: said as a reading that failed, and nothing changes.
    } finally {
      setReading(false);
    }
    if (res && res.error !== null) {
      setError(res.error);
      return;
    }
    if (res?.why === "off") {
      // Reader v2 is not this account's after all (the switch moved since
      // the page was drawn): v1 reads the words, with its own guards.
      readerOffRef.current = true;
      setReaderOff(true);
      if (source === "message") {
        pendingRef.current = pendingRef.current.slice(0, -1);
        setPendingAsks(pendingRef.current);
      }
      if (source === "message") void send(message, opts);
      return;
    }
    // The newest render's runTurn: it reads the page as it is now, after the read.
    const said = runTurnRef.current?.(res?.reading ?? null, {
      source,
      why: res ? res.why : "down",
      dropped: res?.dropped ?? [],
      messageCut: res?.cut ?? false,
      origin: opts?.origin ?? null,
      home: opts?.home === true,
      aliases: res?.aliases ?? NO_ALIASES,
      asked: message,
      pressed: null,
    });
    // No words were left once cleaned: nothing to keep with a still.
    if (said === null && source === "message") {
      pendingRef.current = pendingRef.current.slice(0, -1);
      setPendingAsks(pendingRef.current);
    }
  }

  /**
   * One turn: the plan, a snapshot for Undo, the steps, what they reached,
   * the reply, and whether a picture is taken. `source` "button" is Do it,
   * a which-one choice or Use the hour: a stored reading, never read again
   * and never shot (spec §3.6). Answers the turn's id (null when nothing
   * was said).
   */
  function runTurn(reading: ShotReading | null, ctx: TurnContext & Partial<PaidRow>): number | null {
    const api = apiRef.current;
    const before = turnStateNow();
    const state = planStateOf(ctx, before);
    const plan = planTurn(reading, state);
    const id = (turnIdRef.current += 1);
    if (plan.kind === "nothing") return null;
    if (plan.kind === "undo") {
      void undoTurn(ctx, plan);
      return id;
    }
    const base = { id, asked: ctx.asked, origin: ctx.origin, aliases: ctx.aliases, pressed: ctx.pressed, shotsAt: shots.length, settled: false };
    if (plan.kind !== "run" || !api) {
      // A reading that failed, or Just talking's "here's what I'd do": nothing runs.
      const facts = replyFactsOf(before, null);
      addTurn({ ...base, plan, outcomes: null, facts, reply: composeReply(plan, null, facts, replyWords), did: turnDid(plan, { chips: [], notes: [] }, ctx.aliases) });
      return id;
    }

    // The steps, in the plan's order, each writing what it reached into `now`.
    const now: TurnState = { ...before };
    const chips: Outcome[] = [];
    const pageNotes: PageNote[] = [];
    const extraCant: CantCode[] = [];
    const extraDropped: string[] = [];
    let movedRound = false;
    if (plan.steps.length > 0) keepStage(false, false);
    const sensorNow = () => sensorHeightMm(now.rig.sensor, now.rig.format);
    const camXz = (): [number, number] => [now.camera.position[0], now.camera.position[2]];
    const rigNow = (patch: Partial<SetRig>) => {
      // Written at once: the size solve, the thirds and a lens read the band of the rig this turn set.
      rigRef.current = { ...rigRef.current, ...patch };
      now.rig = rigRef.current;
      setRig((r) => ({ ...r, ...patch }));
    };
    const placeFigure = (m: Mark, pickedMarkId?: string) => {
      // The stage first: the camera's solve and matchTo read where the figure stands.
      now.mark = m;
      if (pickedMarkId !== undefined) now.markId = pickedMarkId;
      api.placeMark(m);
      layoutRef.current = { ...layoutRef.current, markId: now.markId ?? layoutRef.current.markId, mark: m };
      if (pickedMarkId !== undefined) setMarkId(pickedMarkId);
      setMark(m);
    };
    const cameraAt = (moved: CameraMove | null, named: string | null) => {
      const pose = api.pose();
      now.camera = pose;
      now.cameraId = named;
      setCameraId(named);
      setFovDeg(pose.fovDeg);
      if (moved === "around" || moved === "blocked") movedRound = true;
    };
    /** A word solve (shot-words.ts wordsToMatch's shape), with her on the third the turn keeps. */
    const solveAt = (match: ShotMatch, from: Pose, frameX: FrameX) => {
      const band = formatFrame(now.rig.format, now.rig.squeeze);
      const framed = framedMatch(match, frameX, { bandAspect: band.bandAspect, heightShare: band.heightShare });
      const solved = solveMatchPose(framed.match, {
        mark: now.mark,
        current: from,
        // The words path's own frame: what it hands over is the render's lens, so centred it passes no band (applyWords).
        referenceAspect: 1,
        bounds: spec.bounds,
        canvasAspect: api.canvasAspect(),
        ...(framed.frame ? { frame: framed.frame } : {}),
      });
      cameraAt(api.matchTo(solved.pose), null);
    };

    // A moving shot that lays its end frame moves the camera AFTER the look
    // step, so the look runs last then: a plot set in the same words is aimed
    // from where the take ends, as §3.1 step 11 asks (review of Cut 2,
    // understanding N5).
    const laysEnd = plan.steps.some((st) => st.kind === "motion" && st.layEnd);
    const order = laysEnd ? [...plan.steps.filter((st) => st.kind !== "look"), ...plan.steps.filter((st) => st.kind === "look")] : plan.steps;
    for (const step of order) {
      switch (step.kind) {
        case "who":
          setCharacterId(step.characterId);
          now.characterId = step.characterId;
          chips.push({ kind: "who", characterId: step.characterId, was: step.was });
          break;
        case "takeCancel":
          // The take started on someone else, or in another shape (Cut 1's person check, check item 7).
          setTakeStart(null);
          takeMoveRef.current = null;
          now.takeStart = null;
          now.takeMove = null;
          break;
        case "frame": {
          const patch: Partial<SetRig> = {};
          const bearing = bearingDeg(now.mark, { x: camXz()[0], z: camXz()[1] });
          for (const rid of step.ids) Object.assign(patch, rigPatchFor(rid, { cameraBearingDeg: bearing }) ?? {});
          rigNow(patch);
          for (const rid of step.ids) chips.push({ kind: "rig", id: rid });
          break;
        }
        case "place": {
          const from = { x: now.mark.x, z: now.mark.z };
          let m: Mark = now.mark;
          let picked: string | undefined;
          if (step.markId !== undefined) {
            const mk = spec.marks.find((x) => x.id === step.markId);
            if (mk) {
              m = { x: mk.x, z: mk.z, facingDeg: mk.facingDeg };
              picked = mk.id;
              chips.push({ kind: "mark", markId: mk.id });
            }
          } else if (step.near) {
            const near = step.near;
            const el = els.find((e) => e.key === near.key);
            if (el) {
              const p = pointBeside(el, near.side, { camera: now.camera, mark: now.mark, bounds: spec.bounds }, vehicleOf(el, vehicles));
              // Clear of anything built, stepped toward the camera, as a figure dropped by hand is (marks.ts).
              const open = clearMarks([{ ...p, facingDeg: m.facingDeg }], spec.objects, spec.bounds, camXz());
              m = open.marks[0];
              if (open.moved > 0) pageNotes.push({ kind: "stepped", key: el.key });
              chips.push({ kind: "near", key: el.key, side: near.side });
            } else extraDropped.push("near.thing");
          }
          if (step.nudge) {
            const open = clearMarks([nudgeMark(m, now.camera, step.nudge.right, step.nudge.toward)], spec.objects, spec.bounds, camXz());
            m = open.marks[0];
            chips.push({ kind: "nudge", right: step.nudge.right, toward: step.nudge.toward });
          }
          placeFigure(m, picked);
          // No camera words: the camera moves with her, so she stays framed.
          if (step.cameraFollows && Math.hypot(m.x - from.x, m.z - from.z) > 1e-3) {
            cameraAt(api.matchTo(shiftPose(now.camera, from, m)), null);
            pageNotes.push({ kind: "cameraFollowed" });
          }
          break;
        }
        case "pose":
          // Drawn at once too: a sitting figure's eyes are lower, and the camera's solve reads them.
          api.setPose(step.pose);
          setPose(step.pose);
          now.pose = step.pose;
          layoutRef.current = { ...layoutRef.current, pose: step.pose };
          chips.push({ kind: "pose", pose: step.pose });
          break;
        case "camera": {
          const prevFrameX = now.frameX;
          const frameX = frameXAfter(prevFrameX, step.cameraId !== undefined ? { kind: "camera", frameX: step.frameX } : { kind: "words", frameX: step.frameX });
          if (step.cameraId !== undefined) {
            const c = spec.cameras.find((x) => x.id === step.cameraId);
            if (c) {
              api.goTo({ position: c.position, target: c.target, fovDeg: c.fovDeg });
              cameraAt(null, c.id);
              chips.push({ kind: "camera", cameraId: c.id });
            }
          }
          const words = step.side !== undefined || step.size !== undefined || step.height !== undefined || step.tiltDeg !== undefined;
          const steps = step.steps ?? [];
          if (words) {
            // Solved FROM the camera the turn is at (a named one, if it named one).
            const band = formatFrame(now.rig.format, now.rig.squeeze);
            const w = wordsToMatch(
              { side: step.side ?? null, size: step.size ?? null, height: step.height ?? null, tiltDeg: step.tiltDeg ?? null, lensMm: step.lensMm ?? null },
              { mark: now.mark, current: now.camera, sensorHeightMm: sensorNow(), frame: { heightShare: band.heightShare } },
            );
            solveAt(w.match, w.from, frameX);
          } else if (step.frameX !== undefined || (step.lensMm !== undefined && frameX !== "centre" && steps.length === 0)) {
            // Her place across the frame, from where the camera stands: the lens stays unless asked.
            const spot = cameraSpotOf(now.camera, now.mark);
            const at = spotToMatch(step.lensMm !== undefined ? { ...spot, fovDeg: fovForLens(step.lensMm, sensorNow()) } : spot, now.mark);
            solveAt(at.match, at.from, frameX);
          } else if (step.lensMm !== undefined && steps.length === 0) {
            // A lens alone: the camera stays where it is, as the lens ring does.
            const f = fovForLens(step.lensMm, sensorNow());
            api.setFov(f);
            cameraAt(null, now.cameraId);
          }
          const afterWords = cameraSpotOf(now.camera, now.mark);
          const sideAfterWords = cameraSideOf(now.mark, now.camera);
          // The word steps, each from the last (turn-plan.ts cameraStep), solved once.
          const walked: { spot: CameraSpot; clamp: StepClamp | null }[] = [];
          if (steps.length > 0) {
            let spot = step.lensMm !== undefined && !words ? { ...afterWords, fovDeg: fovForLens(step.lensMm, sensorNow()) } : afterWords;
            for (const st of steps) {
              // What the camera aims at on her is kept, her eyes inside the band, in this pose (review of Cut 2, U3).
              const r = cameraStep(st, spot, now.mark, sensorNow(), STAND_IN_EYE_M[now.pose], formatFrame(now.rig.format, now.rig.squeeze).heightShare);
              spot = r.spot;
              if (r.cant) extraCant.push(r.cant);
              walked.push({ spot, clamp: r.clamp });
            }
            const at = spotToMatch(spot, now.mark);
            solveAt(at.match, at.from, frameX);
          }
          now.frameX = frameX;
          frameXRef.current = frameX;
          // What the camera REACHED, read off the stage after the solve.
          const reached = cameraSpotOf(now.camera, now.mark);
          if (step.size !== undefined) chips.push({ kind: "size", size: step.size });
          if (step.height !== undefined) chips.push({ kind: "height", height: step.height, m: afterWords.heightM });
          if (step.side !== undefined) chips.push({ kind: "side", side: sideAfterWords });
          if (step.tiltDeg !== undefined) chips.push({ kind: "tilt", deg: afterWords.pitchDeg });
          if (step.lensMm !== undefined) chips.push({ kind: "lens", mm: step.lensMm });
          if (step.frameX !== undefined) chips.push({ kind: "frameX", frameX: step.frameX });
          steps.forEach((st, i) => {
            chips.push({ kind: "step", step: st });
            const dim = STEP_DIMENSION[st];
            // The last step of its kind says where the camera got to; earlier ones where the words took it.
            const last = !steps.some((x, j) => j > i && STEP_DIMENSION[x] === dim);
            const spot = last ? reached : walked[i].spot;
            const clamp = walked[i].clamp;
            if (dim === "distance") chips.push({ kind: "distance", m: spot.distanceM, clamp });
            else if (dim === "height") chips.push({ kind: "height", height: null, m: spot.heightM, clamp });
            else if (dim === "side") chips.push({ kind: "side", side: last ? cameraSideOf(now.mark, now.camera) : cameraSideOf(now.mark, spotToMatch(spot, now.mark).from) });
            else if (dim === "tilt") chips.push({ kind: "tilt", deg: spot.pitchDeg, clamp });
            else chips.push({ kind: "lens", mm: nearestLens(spot.fovDeg, sensorNow()), clamp });
          });
          break;
        }
        case "facing": {
          let deg = now.mark.facingDeg;
          if (step.facing !== undefined) {
            if (typeof step.facing === "string") deg = facingFor(step.facing, now.mark, now.camera);
            else {
              const key = step.facing.key;
              const el = els.find((e) => e.key === key);
              if (el) deg = facingToward(now.mark, { x: el.centre[0], z: el.centre[2] });
            }
            chips.push({ kind: "facing", facing: step.facing });
          }
          // Her own left or right, as a director says it (turn-plan.ts turnedFacing).
          if (step.turn !== undefined) {
            deg = turnedFacing(deg, step.turn);
            chips.push({ kind: "turn", turn: step.turn });
          }
          placeFigure({ ...now.mark, facingDeg: deg });
          break;
        }
        case "gaze": {
          const g = step.gaze;
          let gaze: Gaze | null = now.gaze;
          let set = true;
          if (g === "camera" || g === "none") gaze = gazeFor(g, now.mark);
          else if ("side" in g) gaze = gazeFor({ side: g.side }, now.mark);
          else {
            const el = els.find((e) => e.key === g.key);
            const oi = el ? largestObjectOf(el, spec.objects) : null;
            if (oi !== null) gaze = gazeFor({ objectIndex: oi }, now.mark);
            else {
              extraDropped.push("gaze.thing");
              set = false;
            }
          }
          // Said as done only when it was: a thing not found is said under "didn't match", never both (review of Cut 2, understanding N4).
          if (!set) break;
          setGaze(gaze);
          now.gaze = gaze;
          layoutRef.current = { ...layoutRef.current, gaze };
          chips.push({ kind: "gaze", gaze: g });
          break;
        }
        case "look": {
          // The light is aimed from where the camera ENDED this turn (light-schemes.ts schemeDefaults).
          const { patch } = lookPatch(step, now.rig, bearingDeg(now.mark, { x: camXz()[0], z: camXz()[1] }));
          if (Object.keys(patch).length > 0) rigNow(patch);
          for (const rid of step.ids) chips.push({ kind: "rig", id: rid });
          if (step.hour !== undefined) chips.push({ kind: "hour", hour: step.hour });
          if (step.evThirds !== undefined) chips.push({ kind: "ev", ev: now.rig.ev });
          if (step.look === "off") {
            pickLook(null);
            now.look = { pinned: true, id: null };
            chips.push({ kind: "look", look: "off" });
          } else if (step.look !== undefined) {
            // "newest", or a still by its number: one this set has, that can be a look (look.ts).
            const n = step.look;
            const shot = n === "newest" ? shots.find(canBeLook) : shots.find((sh) => sh.kind === "still" && stillNumber(sh) === n);
            if (shot && canBeLook(shot)) {
              pickLook(shot.generationId);
              now.look = { pinned: true, id: shot.generationId };
              chips.push({ kind: "look", look: stillNumber(shot) });
            } else extraDropped.push("look");
          }
          break;
        }
        case "words":
          if (step.happens) {
            setDirection(step.happens.text);
            now.direction = step.happens.text;
            chips.push({ kind: "happens", text: step.happens.text });
          }
          // Their words say what they wear: the saved outfit photo sits the next still or take out (step 9).
          if (step.outfitOff) {
            outfitOffRef.current = true;
            now.outfitOff = true;
          }
          break;
        case "takeArm": {
          // Set up for free; rendered only by its own priced press (money rule 3).
          // A plan without takes is told, as "Take it somewhere" tells it.
          if (!takesOn) {
            setError(SET_TAKE_NEEDS_PLAN);
            break;
          }
          const start: TakeStart = { id: step.still.id, n: step.still.n, armedBy: "chat" };
          setTakeStart(start);
          now.takeStart = start;
          chips.push({ kind: "takeFrom", still: step.still.n });
          break;
        }
        case "motion": {
          if (!takesOn) break;
          if (step.move !== undefined || step.textures !== undefined) {
            const kept: TakeMove = { move: step.move ?? now.takeMove?.move ?? null, textures: step.textures ?? now.takeMove?.textures ?? [] };
            takeMoveRef.current = kept;
            now.takeMove = kept;
          }
          if (step.move !== undefined) chips.push({ kind: "move", move: step.move });
          for (const tx of step.textures ?? []) chips.push({ kind: "texture", texture: tx });
          if (step.engine !== undefined) {
            setTakeEngine(step.engine);
            now.takeEngine = step.engine;
            chips.push({ kind: "engine", engine: step.engine });
          }
          // The end frame laid the Film tab's way (moves.ts), from the take's start still's own camera.
          if (step.layEnd && step.move !== undefined && now.takeStart) {
            const startId = now.takeStart.id;
            const from = shots.find((sh) => sh.generationId === startId)?.pose ?? now.camera;
            api.goTo(layBeatMove(step.move, from, now.mark, spec.bounds, (p) => api.roomFor(p)));
            cameraAt(null, null);
            now.frameX = frameXAfter(now.frameX, { kind: "match" });
            frameXRef.current = now.frameX;
          }
          break;
        }
      }
    }
    if (movedRound) pageNotes.push({ kind: "frameLineMoved" });
    if (plan.steps.length > 0) {
      setViewing(null);
      setPoseNow(now.camera);
      scheduleSave();
      keepRevision(now.direction, now.cameraId);
    }

    // What the stage found as it ran joins the plan: a raise past what words
    // do, a thing or a still that wasn't there, a take this plan can't render.
    const shown: TurnPlan = {
      ...plan,
      cant: [...plan.cant, ...extraCant.filter((c, i, all) => all.indexOf(c) === i && !plan.cant.some((x) => x.code === c)).map((code) => ({ code, said: null }))],
      dropped: [...plan.dropped, ...extraDropped.filter((d) => !plan.dropped.includes(d))],
      ...(takesOn ? {} : { needs: plan.needs.filter((n) => n.kind !== "take"), notes: plan.notes.filter((n) => n.kind !== "takeArmed"), takeAfter: now.takeStart }),
    };
    // Whether the picture changed: a take set up or its move is not a new frame.
    const changed = snapshotDiff(before, now).some((k) => k !== "takeStart" && k !== "takeMove" && k !== "takeEngine");
    // A priced row shoots what it paid for, unless what it ran into holds it (paidDecision); a message as the matrix says.
    const shot = ctx.paid
      ? paidDecision(shown, ctx.paid)
      : shootDecision(shown, { mode: state.mode, source: ctx.source }, { changed, cant: extraCant.length > 0, home: ctx.home === true });
    // The one press id for this turn's shot, minted here, fired from the next render (shootDue).
    if (shot.kind !== "none") setShootDue({ pressId: newPressId(), kind: shot.kind, turnId: id });
    if (plan.steps.length > 0) {
      turnUndoRef.current = [...turnUndoRef.current, { turnId: id, before, after: { ...now }, stillShot: shot.kind !== "none" }].slice(-TURN_UNDO_MAX);
    }
    const outcomes: TurnOutcomes = { chips, notes: pageNotes };
    const facts = replyFactsOf(now, shot);
    addTurn({ ...base, plan: shown, outcomes, facts, reply: composeReply(shown, outcomes, facts, replyWords), did: turnDid(shown, outcomes, ctx.aliases) });
    return id;
  }
  const runTurnRef = useRef<typeof runTurn | null>(null);
  useEffect(() => {
    runTurnRef.current = runTurn;
  });

  /** The page put back as a turn found it: every setter, the stage at once, and the arrangement saved (spec §3.5). */
  function restoreTurnState(st: TurnState) {
    const api = apiRef.current;
    if (!api) return;
    keepStage(false, false);
    setCharacterId(st.characterId ?? "");
    api.placeMark(st.mark);
    layoutRef.current = { ...layoutRef.current, markId: st.markId ?? layoutRef.current.markId, mark: st.mark, pose: st.pose, gaze: st.gaze };
    if (st.markId !== null) setMarkId(st.markId);
    setMark(st.mark);
    setPose(st.pose);
    setGaze(st.gaze);
    api.goTo(st.camera);
    setFovDeg(st.camera.fovDeg);
    setPoseNow(st.camera);
    setCameraId(st.cameraId);
    rigRef.current = st.rig;
    setRig(st.rig);
    setDirection(st.direction);
    frameXRef.current = st.frameX;
    setTakeStart(st.takeStart);
    takeMoveRef.current = st.takeMove;
    setTakeEngine(st.takeEngine);
    outfitOffRef.current = st.outfitOff;
    // The look as the turn found it: the still it was picked on, or back to following the newest (review of Cut 2, U6).
    if (st.look.pinned) pickLook(st.look.id);
    else {
      lookPinnedRef.current = false;
      setLookPinned(false);
      setLookId(newestLook(shots));
    }
    scheduleSave();
  }

  /** What an Undo put back, as chips: only what differs from the page it found. */
  function restoredChips(from: TurnState, to: TurnState): Outcome[] {
    const out: Outcome[] = [];
    if (to.characterId !== from.characterId && to.characterId) out.push({ kind: "who", characterId: to.characterId, was: from.characterId });
    if (Math.hypot(to.mark.x - from.mark.x, to.mark.z - from.mark.z) > 1e-3) {
      const on = markOn(to.markId, to.mark);
      out.push(on ? { kind: "mark", markId: on } : { kind: "ownSpot" });
    } else if (Math.abs(to.mark.facingDeg - from.mark.facingDeg) > 0.5) out.push({ kind: "facing", facing: facingSeen(to.mark, to.camera) });
    if (to.pose !== from.pose) out.push({ kind: "pose", pose: to.pose });
    const cam = (p: Pose) => p.position.concat(p.target).map((n) => Math.round(n * 100));
    if (cam(to.camera).join() !== cam(from.camera).join() || to.cameraId !== from.cameraId) {
      if (to.cameraId) out.push({ kind: "camera", cameraId: to.cameraId });
      out.push({ kind: "height", height: null, m: to.camera.position[1] });
      out.push({ kind: "side", side: cameraSideOf(to.mark, to.camera) });
    }
    if (Math.abs(to.camera.fovDeg - from.camera.fovDeg) > 0.05) out.push({ kind: "lens", mm: nearestLens(to.camera.fovDeg, sensorHeightMm(to.rig.sensor, to.rig.format)) });
    if (to.frameX !== from.frameX) out.push({ kind: "frameX", frameX: to.frameX });
    if (JSON.stringify(to.gaze) !== JSON.stringify(from.gaze)) {
      const g = to.gaze;
      const key = g?.at === "object" ? els.find((e) => e.members.some(([o]) => o === g.index))?.key : undefined;
      if (!g) out.push({ kind: "gaze", gaze: "none" });
      else if (g.at === "camera") out.push({ kind: "gaze", gaze: "camera" });
      else if (key) out.push({ kind: "gaze", gaze: { key } });
    }
    out.push(...rigRestoredChips(from.rig, to.rig));
    if (to.direction !== from.direction) out.push({ kind: "happens", text: to.direction });
    if (to.takeStart?.id !== from.takeStart?.id && to.takeStart) out.push({ kind: "takeFrom", still: to.takeStart.n });
    if (to.takeEngine !== from.takeEngine) out.push({ kind: "engine", engine: to.takeEngine });
    if (JSON.stringify(to.look) !== JSON.stringify(from.look)) {
      const id = to.look.pinned ? to.look.id : newestLook(shots);
      const shot = id ? shots.find((sh) => sh.generationId === id) : null;
      out.push({ kind: "look", look: shot ? stillNumber(shot) : "off" });
    }
    return out;
  }

  /**
   * Undo, one turn back (spec §3.5): the page as that turn found it, with
   * the person's own moves since then undone too and said so; the Astra
   * change it pressed brought back through undoAstraEdit — never Astra,
   * never a refund; stills it shot stay. Nothing is read again. From a
   * message ("undo that") the rest of the message is offered with Do it.
   */
  async function undoTurn(ctx: TurnContext, plan: TurnPlan | null) {
    const current = turnStateNow();
    const stack = turnUndoRef.current;
    const top = stack[stack.length - 1];
    const u = undoPlan(stack, current, top?.astra ? specBeforeEditRef.current === top.astra.before : false);
    const id = plan ? turnIdRef.current : (turnIdRef.current += 1);
    const chips: Outcome[] = [];
    const pageNotes: PageNote[] = [];
    let restored = current;
    if (u.kind === "none") pageNotes.push({ kind: "undoNone" });
    else {
      turnUndoRef.current = stack.slice(0, -1);
      // The turn's `before`, with the take as it is now once it has rendered or moved on (undoneTake).
      restored = u.restore;
      restoreTurnState(restored);
      chips.push(...restoredChips(current, restored));
      if (u.handMoves) pageNotes.push({ kind: "undoHand" });
      if (u.astra) {
        const back = await undoSetEdit(true);
        if (back === "textKept") pageNotes.push({ kind: "undoAstraText" });
        else if (back === "undone") pageNotes.push({ kind: "undoAstra" });
        else {
          // The set change is still there (the undo refused, or never came
          // back): said so, and kept to undo again — from the stage as it
          // stands now, so trying again moves nothing else (review of Cut 2, W7).
          pageNotes.push({ kind: "undoAstraFailed" });
          if (top) turnUndoRef.current = [...turnUndoRef.current, { ...top, before: restored, after: restored }].slice(-TURN_UNDO_MAX);
        }
      }
      if (u.stillsStay) pageNotes.push({ kind: "stillsStay" });
    }
    const shown = plan ?? planTurn({ undo: true }, planStateOf(ctx, current));
    const outcomes: TurnOutcomes = { chips, notes: pageNotes };
    const facts = replyFactsOf(restored, null);
    addTurn({
      id,
      asked: ctx.asked,
      origin: ctx.origin,
      aliases: ctx.aliases,
      pressed: ctx.pressed,
      shotsAt: shots.length,
      settled: false,
      plan: shown,
      outcomes,
      facts,
      reply: composeReply(shown, outcomes, facts, replyWords),
      did: turnDid(shown, outcomes, ctx.aliases),
    });
  }

  /**
   * A stored reading a button runs: a preview, an undo's rest, or a
   * suggestion row — without its questions, idea, options or "not yet"
   * again. A Just-talking preview keeps its undo: Do it on "undo that"
   * steps back, as the message would have (review of Cut 2, U4).
   */
  function readingOf(turn: ChatTurn, row: number | "plan" | "rest"): ShotReading | null {
    const r = row === "plan" ? turn.plan.reading : row === "rest" ? turn.plan.proposal : (turn.plan.suggestions[row]?.act ?? null);
    if (!r) return null;
    const act: ShotReading = { ...r };
    delete act.ask;
    delete act.idea;
    delete act.suggest;
    delete act.cant;
    delete act.shoot;
    if (row !== "plan") delete act.undo;
    return act;
  }

  /**
   * A turn's reply said again at today's prices, when a press finds its
   * button's price no longer true (the take's engine changed since): the
   * press spends nothing, and the button shows what it would cost now
   * (spec §3.8 rule 7).
   */
  function repriceTurn(turn: ChatTurn) {
    const facts: ReplyFacts = { ...turn.facts, credits: pageCredits, takeEngine };
    const plan: TurnPlan = {
      ...turn.plan,
      needs: turn.plan.needs.map((n) => (n.kind === "take" ? { ...n, engine: takeEngine, credits: pageCredits.take[takeEngine] } : n)),
      suggestions: turn.plan.suggestions.map((sg, i) => ({ ...sg, second: secondNow(turn, i) })),
    };
    // Said, not silent: the press spent nothing, and why (review of Cut 2, W16).
    const said = (x: ChatTurn): ReplyModel => {
      const model = composeReply(plan, x.outcomes, facts, replyWords);
      return { ...model, lines: [{ kind: "note", text: replyWords.reply.replyRepriced, buttons: [] }, ...model.lines] };
    };
    setTurns((prev) => prev.map((x) => (x.id === turn.id ? { ...x, plan, facts, reply: said(x) } : x)));
  }

  /**
   * A row's second button as it would be said NOW (turn-plan.ts
   * secondButton), from its own plan against the page as it stands: the
   * price check of "Do it and shoot/take" and the reprice use this one
   * answer, so a label and its check can never disagree (review of Cut 2, S3).
   */
  function secondNow(turn: ChatTurn, row: number | "plan" | "rest"): SecondButton | null {
    const st = planStateOf(TURN_BUTTON, turnStateNow());
    if (row === "plan") return secondButton(turn.plan, st);
    const r = readingOf(turn, row);
    return r ? secondButton(planTurn(r, st), st) : null;
  }

  /**
   * A press on a reply's button. Only the newest turn's buttons act, and
   * nothing while a read, a shot or an Astra change is out. Do it, a
   * which-one, Use the hour and Undo run as their own turn and never shoot;
   * every paid button spends exactly what its label says, with its own id
   * minted at the click, or nothing when its price has moved (rule 7).
   */
  function replyAction(turn: ChatTurn, action: ReplyAction) {
    // A shot a turn decided and not yet fired counts as busy: a press inside its wait would replace it, and "Shooting · n" would not be true (review of Cut 2, N1).
    if (reading || shooting || editingSet || matching || following !== null || shootDue !== null || !ready) return;
    const newest = turns[turns.length - 1];
    if (!newest || newest.id !== turn.id || (turn.settled && action.kind !== "undo")) return;
    // A button's turn runs in the names its turn was said in, and is told to the reader as what was pressed (review of Cut 2, U1).
    const pressedLabel = (action as Partial<ReplyButton>).label ?? null;
    const button: TurnContext = { ...TURN_BUTTON, aliases: turn.aliases, pressed: pressedLabel };
    switch (action.kind) {
      case "undo":
        void undoTurn(button, null);
        return;
      case "doIt": {
        const r = readingOf(turn, action.row);
        if (r) runTurn(r, button);
        return;
      }
      case "doItShoot":
      case "doItTake": {
        const r = readingOf(turn, action.row);
        const kind = action.kind === "doItTake" ? "take" : "still";
        if (!r) return;
        // The price the row's button would say NOW, from its own plan (the
        // engine a take the chat sets up starts on included): one that moved,
        // or a row that can no longer be shot as it is, is said again.
        const now = secondNow(turn, action.row);
        if (!now || now.kind !== (kind === "take" ? "take" : "shoot") || now.credits !== action.credits) {
          repriceTurn(turn);
          return;
        }
        // The row runs as a button turn; its priced shot is decided on what
        // the row ran into and fires from the render that holds it, with one
        // id minted there — or is held, with Shoot as it is (review of Cut 2, S1).
        runTurn(r, { ...button, paid: kind });
        return;
      }
      case "which": {
        const need = turn.plan.needs.find((n): n is Extract<Need, { kind: "which" }> => n.kind === "which" && n.slot === action.slot);
        if (need && turn.plan.reading) runTurn(resolveWhich(turn.plan.reading, need, action.key), button);
        return;
      }
      case "useHour":
        runTurn(USE_HOUR_READING, button);
        return;
      case "take":
        // [Take · n]: the take's own priced press, the one that may render a take the chat set up.
        if (!takeStart) return;
        if (pageCredits.take[takeEngine] !== action.credits) {
          repriceTurn(turn);
          return;
        }
        settleTurn(turn.id);
        void take();
        return;
      case "shootAsIs": {
        const price = action.press === "take" ? pageCredits.take[takeEngine] : pageCredits.still;
        if (price !== action.credits || (action.press === "take" && !takeStart)) {
          repriceTurn(turn);
          return;
        }
        settleTurn(turn.id);
        void (action.press === "take" ? take() : shoot());
        return;
      }
      case "astraGo":
      case "astraGoShoot":
        // "Change it, then shoot" says the still's price: a price that moved says it again and spends nothing (Cut 2, step 11b).
        if (action.kind === "astraGoShoot" && action.credits !== pageCredits.still) {
          repriceTurn(turn);
          return;
        }
        goAstra(turn, action.kind === "astraGoShoot");
        return;
      case "notNow":
        settleTurn(turn.id);
        return;
      case "useMyWords":
        if (turn.asked !== null) wordsAsHappens(turn.asked);
        settleTurn(turn.id);
        return;
      case "tryAgain":
        // The same words, read again as what they were: the Sets home's build message stays one (review of Cut 2, S5).
        if (turn.asked !== null) void sendTurn(turn.asked, { source: "retry", ...(turn.origin ? { origin: turn.origin } : {}) });
        return;
      case "openFilm":
        studioModes.film.onClick();
        return;
      case "openCard":
        openElementCard(action.key);
        return;
      case "buildNew":
        router.push("/app/sets");
        return;
      case "at":
        setMentionForced(true);
        draftRef.current?.focus();
        return;
      case "askProducer":
        // The Producer's lamp opens with the words, unsent (Cut 2, step 12).
        askProducer(turn.asked ?? "");
        return;
    }
  }

  /**
   * The Astra card's press from a turn: the person's own words (≤300, what
   * the card quoted), what the chat read them to mean, and where the person
   * and the camera stand. "Change it, then shoot" mints the still's id at
   * the click; the still is taken only once the change saves (spec §3.3).
   * A change that lands becomes part of its turn, so Undo brings the set
   * back — through undoAstraEdit, never Astra.
   */
  function goAstra(turn: ChatTurn, thenShoot: boolean) {
    const need = turn.plan.needs.find((n): n is Extract<Need, { kind: "astra" }> => n.kind === "astra");
    // editSet's own busy rule, read BEFORE the card is settled: a press it would refuse leaves the card where it was (review of Cut 2, N3).
    const b = busyRef.current;
    if (!need || !need.canGo || editingSet || b.editing || b.shooting || b.taking || b.matching) return;
    settleTurn(turn.id);
    const pose = apiRef.current?.pose() ?? null;
    const frame: EditFrame = { mark: layoutRef.current.mark, camera: pose ? { position: pose.position, target: pose.target } : null };
    const then = thenShoot ? { pressId: newPressId(), turnId: turn.id } : undefined;
    void editSet({ said: need.said, gloss: need.gloss, seal: need.seal }, frame, then).then((r) => {
      if (!r.landed) return;
      const astra = { before: r.before, undo: r.undo, kind: "edit" as const, landed: true };
      const stack = turnUndoRef.current;
      const top = stack[stack.length - 1];
      if (top && top.turnId === turn.id) turnUndoRef.current = [...stack.slice(0, -1), { ...top, astra }];
      else {
        const here = turnStateNow();
        turnUndoRef.current = [...stack, { turnId: turn.id, before: here, after: here, astra }].slice(-TURN_UNDO_MAX);
      }
    });
  }

  /** A shot a turn decided that could not start (busy, the likeness, no one to cast): said on the turn, with Shoot as it is (spec §6.3). */
  function dueNotStarted(due: ShootDue) {
    const r = replyWords.reply;
    setTurns((prev) =>
      prev.map((x) => {
        if (x.id !== due.turnId) return x;
        const outcomes: TurnOutcomes = { chips: x.outcomes?.chips ?? [], notes: [...(x.outcomes?.notes ?? []), { kind: "notStarted" }] };
        const facts: ReplyFacts = { ...x.facts, shot: { kind: "none", held: [], offer: null } };
        // Said again with only what is still open: a card or a which-one already answered never comes back.
        const plan: TurnPlan = { ...x.plan, needs: x.plan.needs.filter((n) => n.kind === "take" || n.kind === "takeFormat") };
        const reply = composeReply(plan, x.outcomes ? outcomes : null, facts, replyWords);
        const n = due.kind === "take" ? facts.credits.take[facts.takeEngine] : facts.credits.still;
        const credits = creditsLabel(r, n);
        const label = due.kind === "take" ? fill(r.takeNow, { take: r.takeLabel, credits }) : fill(r.shootAsIs, { credits });
        const lines = x.outcomes ? reply.lines : [...reply.lines, { kind: "note" as const, text: r.noteNotStarted, buttons: [] }];
        return { ...x, plan, settled: false, facts, reply: { ...reply, lines: [...lines, { kind: "needs", text: r.replyNeeds, buttons: [{ kind: "shootAsIs", press: due.kind, credits: n, label }] }] } };
      }),
    );
    turnUndoRef.current = turnUndoRef.current.map((sn) => (sn.turnId === due.turnId ? { ...sn, stillShot: false } : sn));
  }

  // The thread grows downward; the newest turn is what the person is waiting
  // for — and an error is said at its end, under the frame, so one raised
  // with nothing in flight (a take the plan does not include, pressed from a
  // still far up the thread) is brought into view too.
  useEffect(() => {
    if (pendingAsks.length === 0 && !shooting && !error) return;
    threadEndRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [pendingAsks, shooting, shots.length, error]);

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
      if (closeCardRef.current) closeCardRef.current();
      else if (menuRef.current) setMenu(null);
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
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable)) return;
      // The view kept is the stage's own, not a hover's flight.
      stopMovePreview();
      const pose = apiRef.current?.pose();
      if (!pose) return;
      editFilm((f) =>
        f.beats.length >= FILM_MAX_BEATS ? f : { ...f, beats: [...f.beats, { words: "", end: pose, move: null, textures: [], figure: null, time: null, rack: null, gaze: null, path: [], movers: [] }] },
      );
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filmOpen, editFilm, stopMovePreview]);

  // Space plays the move while the film dock is open (canvas page H), when
  // nothing in particular has the focus: a focused control keeps Space for
  // itself, and a field for typing.
  const playMoveRef = useRef<() => void>(() => {});
  useEffect(() => {
    playMoveRef.current = () => void playMove();
  });
  useEffect(() => {
    if (!filmOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== " " || e.repeat || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement;
      if (el && el !== document.body && el.tagName !== "CANVAS") return;
      e.preventDefault();
      playMoveRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [filmOpen]);

  // Film's overlay (canvas pages H and I): the move's path through the set,
  // its keyframes named with their lens and distance, and the selected
  // beat's two lenses, while the film dock is open.
  useEffect(() => {
    const api = apiRef.current;
    if (!api || !ready) return;
    if (!filmOpen) {
      api.setFilmOverlay(null, []);
      return;
    }
    const fr = formatFrame(rig.format, rig.squeeze);
    const plan = planFilmOverlay({
      start: shots.find((sh) => sh.generationId === film.startId)?.pose ?? null,
      beats: film.beats,
      selected: filmSel,
      mark,
      frame: { bandAspect: fr.bandAspect, heightShare: fr.heightShare },
      sensorHeightMm: sensorHeightMm(rig.sensor, rig.format),
    });
    const metres = new Intl.NumberFormat(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    api.setFilmOverlay(
      plan,
      plan.keys.map((k) => formatMsg(s.filmKeyLabel, { n: k.number, lens: formatMsg(s.lensMm, { mm: k.lensMm }), m: metres.format(k.distanceM) })),
    );
  }, [ready, filmOpen, film.beats, film.startId, filmSel, mark, rig.format, rig.sensor, shots, locale, s]);
  useEffect(() => {
    apiRef.current?.holdFilmOverlay("previz", previz);
  }, [ready, previz]);

  // The moves closing, or the page going, ends a hover's flight.
  useEffect(() => {
    if (!filmOpen || !rigOpen) stopMovePreview();
  }, [filmOpen, rigOpen, stopMovePreview]);
  useEffect(() => stopMovePreview, [stopMovePreview]);

  // Leaving mid-film stops the chain after the beat it is on: this page
  // renders the beats one after another (each clip then renders on its
  // own), so it asks first — the browser's own prompt for a reload or a
  // closed tab, a confirm for the app's links (as character-form.tsx does).
  const filmRendering = filmBusy !== null;
  const filmLeaveConfirm = s.filmLeaveConfirm;
  useEffect(() => {
    if (!filmRendering) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const anchor = (e.target as Element | null)?.closest?.("a");
      const href = anchor?.getAttribute("href");
      if (!href || !href.startsWith("/") || href.startsWith("//")) return;
      if (!window.confirm(filmLeaveConfirm)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [filmRendering, filmLeaveConfirm]);

  // The move autosaves like the editor's working copy — a beat after the
  // hands stop. The first run is the loaded film itself, not an edit.
  const filmLoadedRef = useRef(false);
  useEffect(() => {
    if (!filmLoadedRef.current) {
      filmLoadedRef.current = true;
      return;
    }
    if (staleRef.current) {
      saveFilm(film);
      return;
    }
    const id = setTimeout(() => saveFilm(film), 1200);
    return () => clearTimeout(id);
  }, [film, saveFilm]);

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
      readTakes(setId, ids).then(
        (r) => {
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
        },
        // A poll that fails is asked again on the next tick; a tab a deploy
        // left behind would fail every tick, and reloads instead.
        (err) => void leftBehind(err),
      );
    }, 8000);
    return () => clearInterval(timer);
  }, [generatingKey, setId, leftBehind]);

  /**
   * The stage's sketch as a picture on disk — 3D Jutsu's static-frame
   * export, named as the sketch (Cut 1, 2026-09-25): it used to be the only
   * download, and saved this grey frame while a finished still was on
   * screen. Cut to the frame lines, because the frame lines are the picture:
   * the still that comes back is cut there too (frame-cut.ts), so a Scope
   * frame downloads as the 2.39 : 1 band it was composed in and not the 3:2
   * the model draws.
   */
  function downloadFrame() {
    const shot = apiRef.current?.frame({ cut: true });
    if (!shot) return;
    const a = document.createElement("a");
    a.href = shot;
    a.download = `${(title || "set").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-sketch.jpg`;
    a.click();
  }

  /**
   * The finished still or take itself as a file (still-file.ts, Cut 1,
   * 2026-09-25): the untouched original, as History's Download saves it.
   * Mirrors DownloadButton's handler (download-button.tsx): the native
   * share sheet in the Android shell, one download at a time, and the
   * download recorded fire-and-forget, which can never fail it.
   */
  const shotFileBusyRef = useRef(false);
  async function downloadShot(shot: SetShot) {
    const url = shotFileUrl(shot);
    if (!url || shotFileBusyRef.current) return;
    shotFileBusyRef.current = true;
    const name = shotFileName(title, shot.kind, stillNumber(shot), url);
    try {
      if (isNativeAppClient()) {
        const handled = await downloadResultNative(url, name).catch(() => false);
        if (!handled) await downloadResult(url, name);
      } else {
        await downloadResult(url, name);
      }
      void recordDownload(shot.generationId).catch(() => {});
    } finally {
      shotFileBusyRef.current = false;
    }
  }

  /**
   * The film as one file (canvas page H, "Download as one file"): the
   * rendered beats fetched and joined in the browser as they are, with no
   * re-encode (mp4-join.ts), picture only: a film is silent until it is
   * dubbed (2026-09-25). Beats rendered in different formats cannot be
   * joined that way: the dock says so, and they stay in History one by one.
   */
  async function downloadFilm() {
    if (filmFileBusy || !reelReady) return;
    setFilmFileBusy(true);
    setFilmError("");
    try {
      const parts = await Promise.all(
        reelShots.map(async (shot) => {
          const res = await fetch(shot.resultUrl!);
          if (!res.ok) throw new Error(`clip ${res.status}`);
          return new Uint8Array(await res.arrayBuffer());
        }),
      );
      // Films are silent until they are dubbed (operator, 2026-09-23:
      // "silent now, dubbed later"). Clips rendered before 2026-09-25 still
      // carry the engine's voice; leaving every sound track out joins them
      // with the silent ones, with no sound cut at each beat.
      const joined = joinMp4(parts, { sound: false });
      if (!joined.ok) {
        setFilmError(
          joined.reason === "different"
            ? s.filmFileDifferent
            : joined.reason === "short-sound"
              ? s.filmFileShortSound
              : s.filmFileFailed,
        );
        return;
      }
      const href = URL.createObjectURL(new Blob([joined.bytes as Uint8Array<ArrayBuffer>], { type: "video/mp4" }));
      const a = document.createElement("a");
      a.href = href;
      a.download = `${(title || "set").toLowerCase().replace(/[^a-z0-9]+/g, "-")}-film.mp4`;
      a.click();
      // Long enough for the browser to take the file.
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
    } catch {
      setFilmError(s.filmFileFailed);
    } finally {
      setFilmFileBusy(false);
    }
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
    setNote({ talk: false, moved: null });
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
    `flex h-8 cursor-pointer items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors disabled:cursor-default disabled:text-[#9aa0ad] ${
      active
        ? "bg-[rgba(224,164,104,0.15)] text-[#f0cda6] shadow-[inset_0_0_0_1px_rgba(240,196,142,0.5)]"
        : "bg-[rgba(255,255,255,0.06)] text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.1)] hover:text-[#ecedf1]"
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
  // Inside the sentence the own camera is lower-case; a set's named camera keeps its name.
  const placedLine = formatMsg(s.placedLine, { name: characterName, mark: markLabel, facing: facingLabel, camera: cameraId ? cameraLabel : s.yourCameraInline, lens: lensLabel });
  const credits = quote.totalCredits === 1 ? s.creditsOne : formatMsg(s.creditsMany, { n: quote.totalCredits });
  // A take's whole price: the end still plus the clip, as the server charges them.
  const takeCredits = takesCredits(takeEngine, { clips: 1, stills: 1 });
  // Every price the chat's buttons can show (turn-plan.ts PageState credits):
  // a still, and a take on each engine, from the quotes the server charges.
  const pageCredits = { still: quote.totalCredits, take: { omni: takesCredits("omni", { clips: 1, stills: 1 }), veo: takesCredits("veo", { clips: 1, stills: 1 }) } };
  // What Render would render now, and its price: every beat is one take —
  // an end frame and a clip — priced by the same quotes the server charges.
  const filmPlan = filmPlanNow();
  const filmCredits = takesCredits(film.engine, filmJobCount(filmPlan.jobs));
  const filmStartOptions = shots.filter((sh) => sh.kind === "still" && sh.status === "succeeded");
  // Why Render cannot start right now, in words, or null when it can
  // (2026-09-21, "the buttons do not work"): the button used to be disabled
  // for any of these with its price still showing and no reason anywhere.
  // Now it stays pressable, a press says the reason, and the line under
  // the timeline says it before anyone presses.
  const filmRenderWhy: string | null = !takesOn
    ? localizeServerText(SET_TAKE_NEEDS_PLAN, t)
    : !ready
      ? s.filmWhyLoading
      : !filmCharacterId
        ? s.filmWhyWho
        : filmPersonGone
          ? s.filmWhyPersonGone
        : !film.startId
          ? filmStartOptions.length > 0
            ? s.filmWhyStart
            : s.filmPickStill
          : filmOpeningOldKey
            ? formatMsg(cast.filmOpeningOld, { name: elementName(filmOpeningOldKey) })
          : film.beats.length === 0
            ? s.filmWhyBeats
            : filmPlan.again && filmPlan.rendering
              ? s.filmClipsRendering
              : shooting || matching
                ? s.filmWhyShooting
                : null;
  const filmWholeFrom = filmPlan.jobs.every((job) => job.end === null) ? (filmPlan.jobs[0]?.beat ?? 0) : null;
  const filmRenderLabel = filmBusy
    ? formatMsg(
        filmBusy.following === "checking" ? s.filmBeatChecking : filmBusy.following ? s.filmBeatFollowing : filmBusy.clipOnly ? s.filmRenderingClip : s.filmRendering,
        { i: filmBusy.beat + 1, n: film.beats.length },
      )
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
  const scaleWarn = Boolean(sourcePhotoUrl) && !scaleDismissed && ready && oversizedSeating(spec);
  // The engine the stills are drawn with, named wherever Helios names one
  // (2026-09-25: the panel said GPT Image 2.5 over a Nano Banana pick).
  const stillEngineName = getImageModel(stillEngine).name;
  // A press in flight is named by the engine it was sent with (review,
  // 2026-09-25): the pill stays live, and may change meanwhile.
  const pressEngineName = getImageModel(pressEngine).name;
  // A lost answer being followed: checking until a read shows the press at work, then still rendering.
  const followingShort = following === "checking" ? s.pressCheckingShort : s.pressFollowingShort;
  const followingLine = following === "checking" ? s.pressChecking : s.pressFollowing;
  const shootLabel = shooting
    ? (following ? followingShort : s.shooting)
    : quote.totalCredits === 1
      ? s.shootButtonOne
      : formatMsg(s.shootButton, { n: quote.totalCredits });
  const canShootNow = !(shooting || matching || reading || editingSet || !characterId || loadFailed || !ready);
  // What the generic Shoot entry points — ⌘K's Shoot row, the chat's "/"
  // row, the composer's send on an empty message — actually do, and the
  // price they say (check of the Cut 2 spec, item 1, 2026-09-25): the take
  // the PERSON set up, at the take's price, or else a still. A take the
  // chat set up is never rendered by them: it waits for a press priced as a
  // take (the reply's Take, the frame card's Take), so a still's label can
  // never run a take (turn-plan.ts pressFor, one answer for both).
  const genericPress = pressFor("shoot", { takeStart, takeEngine, credits: pageCredits });
  const pressLabel = genericPress.kind === "take" && !shooting ? formatMsg(s.takeButton, { n: genericPress.credits }) : shootLabel;
  /** A generic Shoot, doing what its label says (pressFor "shoot"): the person's own take, else a still. */
  function pressShoot(directionNow?: string): Promise<boolean> {
    return pressFor("shoot", { takeStart, takeEngine, credits: pageCredits }).kind === "take" ? take(directionNow) : shoot(directionNow);
  }
  const shotCount = (() => {
    const stills = shots.filter((sh) => sh.kind === "still").length;
    const takes = shots.length - stills;
    const words: string[] = [];
    if (stills > 0 || takes === 0) words.push(stills === 1 ? s.shotsOne : formatMsg(s.shotsMany, { n: stills }));
    if (takes > 0) words.push(takes === 1 ? s.takesOne : formatMsg(s.takesMany, { n: takes }));
    return words.join(" · ");
  })();
  // v1's lead line over the frame card; on reader v2 each turn's reply says it (astra-reply.tsx, spec §6.3).
  const frameLead = v2On
    ? ""
    : note?.planned
      ? s.justTalkNote
      : note?.talk
        ? s.talkReply
        : [
            note?.built ? s.reply.noteBuiltFromWords : null,
            note?.moved ? formatMsg(s.frameLineMoved, { name: characterName }) : null,
            note?.held ? s.reply.replyHomeHeld : null,
          ]
            .filter(Boolean)
            .join(" ");
  // The frame card's rows the newest turn moved, for their dot (spec §5.1):
  // only while that turn is the thread's last word, before a still folds it.
  const lastTurn = v2On ? turns[turns.length - 1] : undefined;
  const turnRows = new Set<FrameRow>(lastTurn && lastTurn.shotsAt === shots.length ? frameRowsChanged(lastTurn.plan, lastTurn.outcomes) : []);
  /**
   * A frame card row's label, with the dot when the last message changed it.
   * A row with no dot is the plain block label it always was, so a label
   * stays on its row's first line when the value wraps; one with a dot keeps
   * the dot on that line too (review of Cut 2, R2: every account's card had
   * its labels centred on wrapped rows).
   */
  const rowLabel = (label: string, row: FrameRow) =>
    turnRows.has(row) ? (
      <dt className="flex items-start gap-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-[#9aa0ad]" data-row-changed>
        {label}
        <span className="mt-[6px] h-1.5 w-1.5 flex-none rounded-full bg-[#e0a468]" title={s.reply.rowChanged}>
          <span className="sr-only">{s.reply.rowChanged}</span>
        </span>
      </dt>
    ) : (
      <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#9aa0ad]">{label}</dt>
    );
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
        <div className="flex flex-wrap items-center gap-2 rounded-[14px] bg-[rgba(255,255,255,0.05)] px-3.5 py-3 text-xs text-[#c6c9d1] ring-1 ring-[rgba(255,255,255,0.07)]">
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
      <div className="space-y-3 rounded-[14px] bg-[rgba(255,255,255,0.05)] p-3.5 ring-1 ring-[rgba(255,255,255,0.07)]">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-medium uppercase tracking-widest text-[#c6c9d1]">{s.rig.checkTitle}</span>
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
                {v.evidence && <span className="block text-xs leading-[17px] text-[#c6c9d1]">{v.evidence}</span>}
              </span>
            </li>
          ))}
        </ul>
        <p className="flex flex-wrap items-center gap-2 border-t border-[rgba(255,255,255,0.07)] pt-2.5 text-xs text-[#c6c9d1]">
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
              disabled={!canShootNow || Boolean(takeStart)}
              className="inline-flex h-9 cursor-pointer items-center justify-center rounded-[8px] bg-[#e0a468] px-3.5 text-[13px] font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:bg-[#2a2b33] disabled:text-[#c6c9d1] disabled:opacity-100"
            >
              {againLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => setRigCheckDismissed((prev) => ({ ...prev, [shot.generationId]: true }))}
            className="cursor-pointer text-[13px] font-medium text-[#d6d9e0] hover:text-[#ecedf1]"
          >
            {s.rig.checkDismiss}
          </button>
        </div>
        <p className="text-[11px] leading-[15px] text-[#9aa0ad]">{s.rig.checkNote}</p>
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
    shot.kind === "take" && (shot.squeeze > 1 || shot.format === "scope" || shot.format === "flat" || shot.format === "classic")
      ? formatFrame(shot.format, shot.squeeze).bandAspect
      : null;
  // Oldest first: the thread reads down to the frame.
  const thread = [...shots].reverse();
  const viewingAt = viewing ? shots.findIndex((x) => x.generationId === viewing) : -1;
  const viewingShot = viewingAt >= 0 ? shots[viewingAt] : null;
  // The file the shot on screen downloads as (still-file.ts); null for the
  // stage, or a shot not finished, whose download is the sketch.
  const viewingFile = viewingShot ? shotFileUrl(viewingShot) : null;
  const barDownloadLabel = viewingFile ? (viewingShot?.kind === "take" ? s.downloadTake : s.downloadStill) : s.downloadFrame;
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
      active ? "ring-2 ring-[#e0a468]" : "ring-1 ring-[rgba(255,255,255,0.15)] hover:ring-[rgba(255,255,255,0.4)]"
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

  const studioMode: StudioMode = cutOpen ? "cut" : filmOpen ? "film" : "shoot";
  /** The first-visit card, where the stage is being set up: not over a still, a failed stage, Film or Cut, or a phone's rig or card sheet. */
  const tipsShown = tips !== null && ready && !loadFailed && !viewingShot && studioMode === "shoot" && !(!wide && (rigOpen || elementCard));
  /** The tips in order: the grey figure, the blocks, the bright box. */
  const tipWords = [s.standInNote, s.tipBlocks, s.frameHint] as const;
  /** One drawing for its three places: Classic's stage foot, the new layout's stage corner, a phone's conversation. */
  const firstVisitView = (className: string) =>
    tips !== null && (
      <FirstVisit
        tips={tipWords}
        step={tips}
        onNext={() => setTips((i) => (i === null ? i : Math.min(i + 1, tipWords.length - 1)))}
        onClose={closeTips}
        words={{ stepsLabel: t.onboarding.stepsLabel, next: t.common.next, close: t.common.close, dismiss: t.common.dismiss }}
        surface={PANEL_BG}
        className={className}
      />
    );
  /** Whether the rig is showing: the dock's own tabs on a wide screen, the phone's panel below it. */
  const rigShown = wide ? dockTab === "camera" || dockTab === "light" || dockTab === "look" : rigOpen;
  // A phone's Film: the setup chips are one row that swipes, so the film dock
  // below never grows up under them. Wrapped, they took five rows and hid the
  // dock's play, length and engine chips (2026-09-22). In that row a menu
  // hangs from the row, not from its chip: a chip's own box sits inside the
  // scroller, which would cut the menu off. A flex box, so a chip with a face
  // in it stands 32 px like the rest, not 34 on a line's descender.
  const chipsInRow = !wide && filmOpen;
  const chipAnchor = chipsInRow ? "flex" : "relative";
  // The modes the bar switches between, and the palette's own route to
  // each (2026-09-17: the palette knew nothing of Cut, so from Cut its
  // "Film" command set a flag Cut kept overriding and nothing happened).
  const studioModes = {
    build: { label: s.editorBuildTab, href: `/app/sets/${setId}?build=1` },
    shoot: {
      label: s.editorShootTab,
      onClick: () => {
        setFilmOpen(false);
        setCutOpen(false);
        setLaying(null);
        setReel(null);
        window.history.replaceState(null, "", `/app/sets/${setId}`);
      },
    },
    film: {
      label: s.filmTab,
      onClick: () => {
        setFilmOpen(true);
        setCutOpen(false);
        setTakeStart(null);
        setViewing(null);
        window.history.replaceState(null, "", `/app/sets/${setId}?film=1`);
      },
    },
    // The cut (cut C): the film's clips in order; the reel plays in the viewport when every clip is in.
    cut: {
      label: s.studio.cutMode,
      onClick: () => {
        setFilmOpen(false);
        setCutOpen(true);
        setLaying(null);
        setTakeStart(null);
        setViewing(null);
        setDockTab((d) => (dockTabsFor("cut", false).includes(d) ? d : "history"));
        if (reelReady) {
          reelFailedRef.current = new Set();
          setReelWaiting(false);
          setReel(0);
        }
        window.history.replaceState(null, "", `/app/sets/${setId}?cut=1`);
      },
    },
  } as const;

  // What ⌘K and the chat's "/" build their commands from (commands.ts):
  // one context, this render's handlers and words, so the two lists can
  // never say or do different things (Cut 2, spec §6.3) — the Shoot row
  // included, labelled with what it charges and pressed through pressShoot.
  const commandContext = (): ShootCommandContext => ({
    words: {
      modes: { build: s.editorBuildTab, shoot: s.editorShootTab, film: s.filmTab, cut: s.studio.cutMode },
      rigShow: s.palette.rigShow,
      rigHide: s.palette.rigHide,
      chatShow: s.palette.chatShow,
      chatHide: s.chatHide,
      formats: s.rig.formats,
      frame: s.rig.frame,
      squeeze: s.rig.squeeze,
      lensMm: (mm) => formatMsg(s.lensMm, { mm }),
      focus: s.rig.focus,
      stop: s.rig.stop,
      off: s.rig.off,
      light: s.rig.light,
      lights: s.rig.lights,
      asBuilt: s.rig.asBuilt,
      time: s.rig.time,
      timePresets: s.palette.timePresets,
      stock: s.rig.stock,
      stocks: s.rig.stocks,
      lensCharacter: s.rig.lens,
      lenses: s.rig.lenses,
      palette: s.rig.palette,
      palettes: s.rig.palettes,
      era: s.rig.era,
      eras: s.rig.eras,
      genre: s.rig.genre,
      genres: s.rig.genres,
      overlays: {
        thirds: s.rig.overlayThirds,
        golden: s.rig.overlayGolden,
        safe: s.rig.overlaySafe,
        centre: s.rig.overlayCentre,
        falseColour: s.rig.overlayFalseColour,
        histogram: s.rig.overlayHistogram,
        meter: s.rig.overlayMeter,
      },
      frameFigure: s.frameFigure,
      undoStage: s.palette.undoStage,
      downloadFrame: s.downloadFrame,
      camera: (label) => formatMsg(s.palette.camera, { label }),
      mark: (label) => formatMsg(s.palette.mark, { label }),
      shootNow: pressLabel,
    },
    rig,
    setRig: (patch) => setRig((r) => ({ ...r, ...patch })),
    mode: studioMode,
    goToMode: (m) => {
      if (m === "build") window.location.href = studioModes.build.href;
      else studioModes[m].onClick();
    },
    rigOpen: wide ? dockTab === "camera" || dockTab === "light" || dockTab === "look" : rigOpen,
    // In the new layout the camera department is Shoot's and the
    // conversation leads Set (Helios Cut 3, step 13): showing either goes
    // to its step too, so ⌘K never opens something the panel is not drawing.
    setRigOpen: (open) => {
      if (!wide) return setRigOpen(open);
      setDockTab(open ? "camera" : "astra");
      if (simpleOn && open) setSimpleStep("shoot");
    },
    chatOpen: wide ? dockTab === "astra" : chatOpen,
    setChatOpen: (open) => {
      if (!wide) return setChatOpen(open);
      setDockTab(open ? "astra" : "camera");
      if (simpleOn && open) setSimpleStep("set");
    },
    cameraBearingDeg: cameraBearing,
    cameras: spec.cameras.map((c) => ({ id: c.id, label: labelOfCamera(c.id) })),
    pickCamera,
    marks: spec.marks.map((m) => ({ id: m.id, label: labelOfMark(m.id) })),
    pickMark,
    pickLens,
    frameFigure,
    undoStage: () => stepStage(stageUndoRef, stageRedoRef),
    downloadFrame,
    canShoot: canShootNow,
    shoot: () => void pressShoot(),
    // Cut 2's new rig rows are reader v2's until check A (review of Cut 2, R3).
    rigExtras: v2On,
  });
  // The commands the palette lists, built only while it is open.
  const paletteCommands = paletteOpen ? shootCommands(commandContext()) : [];
  // The chat's "/" (reader v2's accounts, Cut 2, step 11b): a draft that
  // starts with it lists the same commands, filtered as ⌘K filters them.
  // Free, and never read: a pick runs the command and clears the draft.
  const slashQuery = v2On && !slashOff && draft.startsWith("/") && !draft.includes("\n") ? draft.slice(1) : null;
  const slashList = slashQuery !== null ? filterCommands(slashQuery, shootCommands(commandContext()), s.palette.groups).slice(0, SLASH_ROWS) : [];
  const slashPick = slashAt >= 0 && slashAt < slashList.length ? slashAt : 0;
  /** The highlighted "/" row spends (⌘K's Shoot): the send arrow never runs it (review of Cut 2, M1). */
  const slashPaid = slashQuery !== null && slashList[slashPick]?.id === "shoot";
  function runSlash(i: number) {
    const c = slashList[i];
    if (!c) return;
    setDraft("");
    setSlashAt(0);
    c.run();
  }

  // ---- the studio's frame (cut A): what the bar, the dock and the status bar show ----
  const dockTabs = dockTabsFor(studioMode, filmOpen);
  const renderingCount = (shooting ? 1 : 0) + (matching ? 1 : 0) + shots.filter((sh) => sh.status === "generating").length;
  const statusWords = (items: readonly StatusItem[]) => items.map((i) => s.studio.status.items[i]);
  const heldItems = statusWords(studioHeld(rig, { move: filmOpen && filmSel !== null && Boolean(film.beats[filmSel]?.move), pose: pose !== "stand" }));
  const checkedItems = statusWords(studioChecked(rig));
  const labItems = statusWords(studioLab(rig));
  /** The dock's Scene tab: a camera or a mark takes the figure there; a thing or a light turns the view to it. */
  const lookAt = (at: Vec3) => {
    const p = apiRef.current?.pose();
    if (!p) return;
    stageTouchRef.current?.();
    apiRef.current?.goTo({ position: p.position, target: at, fovDeg: p.fovDeg });
  };
  const sw = s.simple;
  const simpleShooting = !filmOpen && !cutOpen;
  const simpleSteps = simpleOn || simplePhone
    ? [
        {
          id: "set",
          label: sw.stepSet,
          on: simpleShooting && simpleStep === "set",
          onClick: () => {
            studioModes.shoot.onClick();
            setSimpleStep("set");
          },
        },
        {
          id: "shoot",
          label: sw.stepShoot,
          on: simpleShooting && simpleStep === "shoot",
          onClick: () => {
            studioModes.shoot.onClick();
            setSimpleStep("shoot");
          },
        },
        { id: "film", label: sw.stepFilm, on: !simpleShooting, onClick: () => studioModes.film.onClick() },
      ]
    : null;
  /**
   * The list's rows, for the column on a computer and the strip on a phone.
   * They say what the cast strip says, which this layout never draws (Helios
   * Cut 3, step 14), from the same chips: whether a thing's photos ride the
   * next still or why not, and when the character needs the person's answer.
   */
  const castChipOf = new Map(castChips.map((ch) => [ch.key, ch]));
  const panelPeople: PanelRow[] = [
    character
      ? {
          key: FIGURE_KEY,
          name: character.name,
          thumb: character.thumbUrl,
          round: true,
          state: likenessNeeded(character.id) ? "answer" : "person",
          title: castChipOf.get(FIGURE_KEY)?.title,
        }
      : { key: FIGURE_KEY, name: cast.person, thumb: null, round: true, state: "nobody" },
  ];
  const panelThings: PanelRow[] = els.map((e): PanelRow => {
    const held = heldOf.get(e.key);
    const count = held?.photos.length ?? 0;
    const model = thingModels.find((m) => m.key === e.key);
    const loaded = thingModelState[e.key];
    const state = model && loaded !== "failed" ? (loaded === "ready" ? "model" : "loading") : count > 0 ? "photos" : "blocks";
    const first = held?.photos[0];
    const chip = castChipOf.get(e.key);
    return {
      key: e.key,
      name: elementName(e.key),
      thumb: first ? (thumbUrl(first.url, 320) ?? first.url) : null,
      state,
      photos: count,
      word: chip?.word,
      rides: chip?.state === "rides",
      title: chip?.title,
    };
  });
  /** Photos on nothing, with the strip's own menu: a row of the list, and a chip of the phone's strip. */
  const panelLoose: LooseBundle = {
    loose: resolved.loose.map((l) => l.photo),
    targets: els.map((e) => ({ key: e.key, name: elementName(e.key) })),
    onPutOn: (refId, key) => void putPhotoOn(refId, key),
    onRemoveLoose: (refId) => void removePhoto(refId),
  };
  function toggleLayout() {
    const next = !simple;
    setSimple(next);
    try {
      window.localStorage.setItem("helios.layout", next ? "simple" : "classic");
    } catch {
      // Remembered for this visit only.
    }
  }
  const pickSceneTarget = (t: SceneTarget) => {
    if (t.kind === "camera") pickCamera(spec.cameras[t.index].id);
    else if (t.kind === "mark") pickMark(spec.marks[t.index].id);
    else if (t.kind === "object") lookAt(spec.objects[t.index].position);
    else if (t.kind === "light") lookAt(spec.lights[t.index].position);
  };

  // The start still's menu (the film's frame one), for the sequencer's Start tile and the phone's dock.
  const filmStartMenuItems =
    filmStartOptions.length === 0 ? (
      <span className="block px-3 py-2 text-xs text-[#c6c9d1]">{s.filmPickStill}</span>
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
          className={`flex w-full cursor-pointer items-center gap-2 rounded-[8px] px-3 py-1.5 text-left text-xs hover:bg-[rgba(255,255,255,0.06)] ${
            film.startId === shot.generationId ? "text-[#e0a468]" : "text-[#d6d9e0]"
          }`}
        >
          {formatMsg(s.stillTile, { n: stillNumber(shot) })}
        </button>
      ))
    );

  // ---- the studio's frame (studio.ts, cut A): the rig as the dock's departments, the conversation as its Astra tab ----
  const rigPanel = (docked: RigTab | null) => (
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
                    onPreview: previewFilmMove,
                    onTexture: filmTexture,
                  }
                : null
            }
            onClose={() => setRigOpen(false)}
      docked={docked ? { tab: docked } : null}
    />
  );
  /**
   * The shot's setup as chips: who, the look, the camera, the rig, where the
   * figure stands, how, where they look. Floating on the stage in the classic
   * layout (measured, so the frame lines sit below them); a plain wrapping
   * block in the new layout's Shoot panel, where nothing measures it.
   */
  /**
   * The film's own panel: the rehearsal, then the beat being written — its
   * words, figure, hour, rack, eye-line, path — or, with none picked, how
   * to start and what each beat carries. The dock's Film tab in the classic
   * layout; the Film step's panel in the new one.
   */
  function filmBeatView() {
    return (
      <div className="border-b border-[rgba(255,255,255,0.07)] p-3">
        {/* The rehearsal (rehearsal.ts): the film's own flight as a
            clip, whether or not a beat is being written. */}
        <div className="mb-2 flex flex-col gap-2">{rehearsalControls("")}</div>
        {filmSel !== null && film.beats[filmSel] ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9aa0ad]">
              <span className="whitespace-nowrap text-[#f0cda6]">{formatMsg(s.filmBeatLabel, { n: filmSel + 1 })}</span>
              <span className="whitespace-nowrap normal-case tabular-nums">{formatMsg(s.takeSeconds, { s: SET_TAKE_ENGINES[film.engine].seconds })}</span>
              {filmBusy?.beat === filmSel ? (
                <span className="whitespace-nowrap normal-case text-[#e0a468]">{filmBusy.following === "checking" ? s.filmBeatCheckingShort : filmBusy.following ? s.filmBeatFollowingShort : filmBusy.clipOnly ? s.filmBeatClip : s.filmBeatStill}</span>
              ) : filmClipShots[filmSel] ? (
                <span
                  className={`whitespace-nowrap normal-case ${
                    filmClipShots[filmSel]!.status === "succeeded" ? "text-[#5f9e6e]" : filmClipShots[filmSel]!.status === "failed" ? "text-red-400" : "text-[#e0a468]"
                  }`}
                >
                  {filmClipShots[filmSel]!.status === "succeeded" ? s.filmBeatDone : filmClipShots[filmSel]!.status === "failed" ? s.filmBeatClipFailed : s.filmBeatClip}
                </span>
              ) : null}
              <span className="flex-1" />
              <button
                type="button"
                onClick={() => filmSetBeatEnd(filmSel)}
                disabled={Boolean(filmBusy) || previz || !ready}
                aria-label={formatMsg(s.filmSetEnd, { n: filmSel + 1 })}
                title={formatMsg(s.filmSetEnd, { n: filmSel + 1 })}
                className="flex-shrink-0 cursor-pointer hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#9aa0ad] disabled:opacity-100"
              >
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
                  <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
                  <circle cx="8" cy="8" r="1.4" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  const at = filmSel;
                  editFilm((f) => ({ ...f, beats: f.beats.filter((_, j) => j !== at) }));
                  setFilmSel(null);
                }}
                disabled={Boolean(filmBusy)}
                aria-label={formatMsg(s.filmRemoveBeat, { n: filmSel + 1 })}
                title={formatMsg(s.filmRemoveBeat, { n: filmSel + 1 })}
                className="flex-shrink-0 cursor-pointer hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#9aa0ad] disabled:opacity-100"
              >
                ×
              </button>
            </div>
            {filmJumps[filmSel] && (
              <p data-film-jump className="text-[11px] leading-snug text-[#e0a468]">
                {formatMsg(s.filmBeatJumps, { n: filmSel + 1 })}
              </p>
            )}
            <input
              value={film.beats[filmSel].words}
              onChange={(e) => {
                const at = filmSel;
                editFilm((f) => ({ ...f, beats: f.beats.map((bb, j) => (j === at ? { ...bb, words: e.target.value } : bb)) }));
              }}
              disabled={Boolean(filmBusy)}
              placeholder={s.filmBeatWords}
              className="h-7 rounded-[6px] bg-black/40 px-2 text-xs text-[#ecedf1] ring-1 ring-[rgba(255,255,255,0.08)] placeholder:text-[#565a64] focus:outline-none focus:ring-[#e0a468]/60"
            />
            <div className="flex flex-wrap items-center gap-1">
              <button
                type="button"
                disabled={Boolean(filmBusy)}
                onClick={() => {
                  const at = filmSel;
                  editFilm((f) => ({
                    ...f,
                    beats: f.beats.map((bb, j) => (j === at ? { ...bb, figure: bb.figure ? null : { x: mark.x, z: mark.z, facingDeg: mark.facingDeg, pose } } : bb)),
                  }));
                }}
                title={film.beats[filmSel].figure ? s.filmFigureClear : s.filmFigureHere}
                className={chip(Boolean(film.beats[filmSel].figure))}
              >
                {film.beats[filmSel].figure
                  ? formatMsg(s.filmFigureSet, { pose: s.poses[film.beats[filmSel].figure.pose], x: film.beats[filmSel].figure.x.toFixed(1), z: film.beats[filmSel].figure.z.toFixed(1) })
                  : s.filmFigureHere}
              </button>
              <button
                type="button"
                disabled={Boolean(filmBusy)}
                onClick={() => {
                  const at = filmSel;
                  editFilm((f) => ({ ...f, beats: f.beats.map((bb, j) => (j === at ? { ...bb, time: bb.time !== null ? null : (rig.time ?? 12) } : bb)) }));
                }}
                title={film.beats[filmSel].time !== null ? s.filmHourClear : s.filmHourHere}
                className={chip(film.beats[filmSel].time !== null)}
              >
                {formatMsg(s.filmHourSet, {
                  h: film.beats[filmSel].time !== null ? timeLabel(film.beats[filmSel].time) : rig.time !== null ? timeLabel(rig.time) : s.filmHourAsBuilt,
                })}
              </button>
              {/* The rack of focus (cut C, furniture.ts): where the focus travels during this beat's move. */}
              <select
                value={film.beats[filmSel].rack ? (film.beats[filmSel].rack.to === "figure" ? "figure" : `o${film.beats[filmSel].rack.index}`) : ""}
                onChange={(e) => {
                  const at = filmSel;
                  const v = e.target.value;
                  const rack = v === "" ? null : v === "figure" ? { to: "figure" as const } : { to: "object" as const, index: Number(v.slice(1)) };
                  editFilm((f) => ({ ...f, beats: f.beats.map((bb, j) => (j === at ? { ...bb, rack } : bb)) }));
                }}
                disabled={Boolean(filmBusy)}
                aria-label={s.studio.rack}
                title={s.studio.rack}
                className="h-7 max-w-[170px] cursor-pointer rounded-[6px] bg-black/40 px-2 text-[11px] text-[#d6d9e0] ring-1 ring-[rgba(255,255,255,0.08)] outline-none"
              >
                <option value="">{s.studio.rack} · {s.studio.rackNone}</option>
                <option value="figure">{s.studio.rackFigure}</option>
                {spec.objects.map((o, oi) => (
                  <option key={oi} value={`o${oi}`}>
                    {names.objectName(o)}
                  </option>
                ))}
              </select>
              {/* The eye-line at the beat's end (cut D, people.ts): where the figure looks in the end frame and by the end of the clip. */}
              <select
                value={film.beats[filmSel].gaze ? (film.beats[filmSel].gaze.at === "camera" ? "camera" : film.beats[filmSel].gaze.at === "object" ? `o${film.beats[filmSel].gaze.index}` : "point") : ""}
                onChange={(e) => {
                  const at = filmSel;
                  const v = e.target.value;
                  if (v === "point") return;
                  const g: Gaze | null = v === "" ? null : v === "camera" ? { at: "camera" } : { at: "object", index: Number(v.slice(1)) };
                  editFilm((f) => ({ ...f, beats: f.beats.map((bb, j) => (j === at ? { ...bb, gaze: g } : bb)) }));
                }}
                disabled={Boolean(filmBusy)}
                aria-label={s.studio.eyeline}
                title={s.studio.eyeline}
                className="h-7 max-w-[170px] cursor-pointer rounded-[6px] bg-black/40 px-2 text-[11px] text-[#d6d9e0] ring-1 ring-[rgba(255,255,255,0.08)] outline-none"
              >
                <option value="">{s.studio.eyeline} · {s.studio.gazeNone}</option>
                <option value="camera">{s.studio.gazeCamera}</option>
                {film.beats[filmSel].gaze?.at === "point" && <option value="point">{s.studio.gazePoint}</option>}
                {spec.objects.map((o, oi) => (
                  <option key={oi} value={`o${oi}`}>
                    {formatMsg(s.studio.gazeThing, { thing: names.objectName(o) })}
                  </option>
                ))}
              </select>
            </div>
            {/* The path (cut D): the points the figure walks through to this beat's figure, laid on the ground. */}
            {film.beats[filmSel].figure && (
              <div className="flex flex-wrap items-center gap-1" data-path-row>
                <span className="text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9aa0ad]">{s.studio.path}</span>
                <span className="text-[11px] text-[#c6c9d1]">
                  {film.beats[filmSel].path.length
                    ? formatMsg(s.studio.pathWalks, {
                        d: pathLength(filmSel > 0 && film.beats[filmSel - 1].figure ? film.beats[filmSel - 1].figure! : mark, film.beats[filmSel].path, film.beats[filmSel].figure!),
                        n: film.beats[filmSel].path.length,
                      })
                    : s.studio.pathStraight}
                </span>
                <button type="button" onClick={() => setLaying((l) => (l === "path" ? null : "path"))} disabled={Boolean(filmBusy)} className={chip(laying === "path")}>
                  {laying === "path" ? s.studio.pathLaying : s.studio.pathLay}
                </button>
                {film.beats[filmSel].path.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const at = filmSel;
                      editFilm((f) => ({ ...f, beats: f.beats.map((bb, j) => (j === at ? { ...bb, path: [] } : bb)) }));
                    }}
                    disabled={Boolean(filmBusy)}
                    className={chip(false)}
                  >
                    {s.studio.pathClear}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-[11.5px] leading-snug text-[#c6c9d1]">{film.beats.length === 0 ? s.sequencer.noBeats : s.rig.movePick}</p>
            {filmPersonOther && (
              <p data-film-person className="text-[11px] leading-snug text-[#e0a468]">
                {formatMsg(s.filmPersonOther, { name: filmPersonOther })}
              </p>
            )}
            {filmLookNoneShown && film.beats.length > 0 && (
              <p data-film-look-none className="text-[11px] leading-snug text-[#e0a468]">
                {s.filmLookNone}
              </p>
            )}
            {/* What each beat's end frame carries of the things' photos (R1). */}
            {elementsKey && film.beats.length > 0 && (
              <div data-film-elements className="flex flex-col gap-0.5">
                <p className="text-[11px] leading-snug text-[#9aa0ad]">{cast.filmNote}</p>
                {filmBeatRides.map((rides, i) =>
                  rides.length > 0 ? (
                    <p key={i} className="text-[11px] leading-snug text-[#c6c9d1]">
                      {formatMsg(cast.filmBeat, { n: i + 1, list: rides.map((r) => elementName(r.key)).join(", ") })}
                    </p>
                  ) : null,
                )}
              </div>
            )}
            {filmJumps.map((jumps, i) =>
              jumps ? (
                <p key={i} data-film-jump className="text-[11px] leading-snug text-[#e0a468]">
                  {formatMsg(s.filmBeatJumps, { n: i + 1 })}
                </p>
              ) : null,
            )}
          </div>
        )}
      </div>
    );
  }

  /**
   * The new layout's right-hand panel, one per step: the open card when a
   * thing is picked; otherwise Set's words and Astra's thread (the place is
   * changed by asking), Shoot's setup — who, the look, the camera — with the
   * camera department beneath it when the Rig chip opens it, or Film's own
   * panel: the rehearsal, the beat being written and its move. Astra's
   * composer stays at the foot, as the dock's does.
   */
  function stepPanelView() {
    const rigTab = dockTab === "camera" || dockTab === "light" || dockTab === "look" ? dockTab : null;
    // Shoot and Film carry the conversation under their own controls (Helios
    // Cut 3, step 13), so a reply sent from either shows there. They split
    // the panel: the controls on top, scrolling on their own up to 60% of
    // it, and the thread below in its own scroll. The thread's move to its
    // newest line (threadEndRef) then scrolls the thread alone, and never
    // takes the chips or the beat's controls off the screen. Set and a
    // thing's card keep the one scroll they had.
    const split = !elementCard && (!simpleShooting || simpleStep === "shoot");
    return (
      <aside aria-label={!simpleShooting ? sw.stepFilm : simpleStep === "shoot" ? sw.shotTitle : sw.setTitle} data-step-panel className="flex w-[340px] flex-none flex-col border-l border-[rgba(255,255,255,0.07)] bg-[#15161b]">
        <div className={split ? "flex min-h-0 flex-1 flex-col" : "min-h-0 flex-1 overflow-y-auto"} data-step-split={split ? "" : undefined}>
          {elementCard ? (
            elementCardView("dock")
          ) : !simpleShooting ? (
            <>
              <div className="max-h-[60%] flex-none overflow-y-auto" data-step-film>
                {filmBeatView()}
                {rigPanel("film")}
              </div>
              {chatThread}
            </>
          ) : simpleStep === "shoot" ? (
            <>
              <div className="max-h-[60%] flex-none overflow-y-auto" data-step-shoot-controls>
                <div className="flex flex-col gap-3 border-b border-[rgba(255,255,255,0.07)] p-4" data-step-shoot>
                  <h2 className="text-[15px] font-semibold text-[#ecedf1]">{sw.shotTitle}</h2>
                  <p className="text-[12.5px] leading-snug text-[#c6c9d1]">{sw.shotHint}</p>
                  {!viewingShot && setupChipsView(true)}
                </div>
                {rigTab && rigPanel(rigTab)}
              </div>
              {chatThread}
            </>
          ) : (
            <>
              <div className="flex flex-col gap-2 border-b border-[rgba(255,255,255,0.07)] p-4" data-step-set>
                <h2 className="text-[15px] font-semibold text-[#ecedf1]">{sw.setTitle}</h2>
                {/* Photos or a model where a model can be added (admins, modelsOn); photos alone otherwise. */}
                <p className="text-[12.5px] leading-snug text-[#c6c9d1]">{modelsOn ? sw.setHint : sw.setHintPhotos}</p>
              </div>
              {chatThread}
            </>
          )}
        </div>
        {following && simpleStep === "shoot" && (
          <p className="border-t border-[rgba(255,255,255,0.07)] px-3.5 py-2 text-[12px] text-[#c6c9d1]" aria-live="polite" data-press-following>
            {followingLine}
          </p>
        )}
        {(error || rigError) && <p className="border-t border-[rgba(255,255,255,0.07)] px-3.5 py-2 text-[12px] text-red-400">{localizeServerText(error || rigError, t)}</p>}
        {chatComposer}
      </aside>
    );
  }

  function setupChipsView(inPanel: boolean) {
    return (
    <div ref={inPanel ? undefined : chipsRef} data-setup-chips className={inPanel ? "flex flex-wrap items-center gap-2" : `absolute left-3.5 right-3.5 top-3.5 z-20 ${chipsInRow ? "" : "flex flex-wrap items-center gap-2"}`}>
      <div data-setup-row className={chipsInRow ? "flex items-center gap-2 overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" : "contents"}>
        <div className={chipAnchor}>
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
              <img src={character.thumbUrl} alt="" className="h-6 w-6 rounded-full object-cover ring-1 ring-[rgba(255,255,255,0.25)]" />
            ) : (
              <span className="h-6 w-6 rounded-full bg-[rgba(255,255,255,0.15)]" />
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
        {/* The look (2026-09-11): an earlier still's objects, or — since
            2026-09-21 — a reference photo the person uploads, the thing
            in it drawn four ways round so every shot keeps its design. */}
        <div className={chipAnchor}>
          <button
            type="button"
            onClick={() => toggleMenu("look")}
            aria-haspopup="listbox"
            aria-expanded={menu === "look"}
            title={lookShot ? s.lookOn : latestStill ? s.lookUseLatest : s.lookFirst}
            className={lookShot ? DCHIP_ON : DCHIP}
            data-look-chip
          >
            {s.lookLabel} ·{" "}
            {lookShot ? <LocalDate date={lookShot.createdAt} /> : s.lookOff}
            <Chevron />
          </button>
          {menu === "look" && (
            <div role="listbox" aria-label={s.lookLabel} className={`${DMENU} w-[300px]`} data-look-menu>
              <Option
                active={!lookShot}
                onPick={() => {
                  pickLook(null);
                  setMenu(null);
                }}
              >
                {s.lookOff}
              </Option>
              {latestStill && (
                <Option
                  active={lookShot?.generationId === latestStill}
                  onPick={() => {
                    pickLook(latestStill);
                    setMenu(null);
                  }}
                >
                  {s.lookUseLatest}
                </Option>
              )}
              {lookShot && lookShot.generationId !== latestStill && (
                <Option active onPick={() => setMenu(null)}>
                  <LocalDate date={lookShot.createdAt} />
                </Option>
              )}
              {/* A thing's own photos go on the thing now (R1): tap it on the stage. */}
              <p className="px-2.5 pb-2 pt-2 text-[11px] leading-snug text-[#9aa0ad]" data-look-refs-moved>
                {cast.lookMoved}
              </p>
            </div>
          )}
        </div>
        <div className={chipAnchor}>
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
          onClick={() => (wide ? setDockTab((d) => (d === "camera" ? "astra" : "camera")) : setRigOpen((v) => !v))}
          aria-pressed={rigShown}
          aria-expanded={rigShown}
          disabled={!ready}
          className={rigShown ? DCHIP_ON : DCHIP}
        >
          {rigChipLabel}
          <Chevron />
        </button>
        {spec.marks.length > 1 && (
          <div className={chipAnchor}>
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
        <div className={chipAnchor}>
          <button type="button" onClick={() => toggleMenu("pose")} aria-haspopup="listbox" aria-expanded={menu === "pose"} disabled={!ready} className={DCHIP}>
            {s.poses[pose]}
            <Chevron />
          </button>
          {menu === "pose" && (
            <div role="listbox" aria-label={s.pose} className={DMENU}>
              {STAND_POSES.map((p) => (
                <Option
                  key={p}
                  active={pose === p}
                  onPick={() => {
                    setPose(p);
                    setMenu(null);
                  }}
                >
                  {s.poses[p]}
                </Option>
              ))}
            </div>
          )}
        </div>
        <div className={chipAnchor}>
          <button type="button" onClick={() => toggleMenu("gaze")} aria-haspopup="listbox" aria-expanded={menu === "gaze"} disabled={!ready} className={gaze ? DCHIP_ON : DCHIP} data-gaze-chip>
            {gaze === null
              ? s.studio.gazeNone
              : gaze.at === "camera"
                ? `${s.studio.gaze} · ${s.studio.gazeCamera}`
                : gaze.at === "object"
                  ? `${s.studio.gaze} · ${formatMsg(s.studio.gazeThing, { thing: spec.objects[gaze.index] ? names.objectName(spec.objects[gaze.index]) : "" })}`
                  : `${s.studio.gaze} · ${formatMsg(s.studio.gazePointSet, { x: gaze.x.toFixed(1), z: gaze.z.toFixed(1) })}`}
            <Chevron />
          </button>
          {menu === "gaze" && (
            <div role="listbox" aria-label={s.studio.gaze} className={`${DMENU} max-h-[320px] overflow-y-auto`}>
              <Option
                active={gaze === null}
                onPick={() => {
                  setGaze(null);
                  setMenu(null);
                }}
              >
                {s.studio.gazeNone}
              </Option>
              <Option
                active={gaze?.at === "camera"}
                onPick={() => {
                  setGaze({ at: "camera" });
                  setMenu(null);
                }}
              >
                {s.studio.gazeCamera}
              </Option>
              <Option
                active={gaze?.at === "point"}
                onPick={() => {
                  setLaying("gaze");
                  setMenu(null);
                }}
              >
                {s.studio.gazePoint}
              </Option>
              {spec.objects.map((o, oi) => (
                <Option
                  key={oi}
                  active={gaze?.at === "object" && gaze.index === oi}
                  onPick={() => {
                    setGaze({ at: "object", index: oi });
                    setMenu(null);
                  }}
                >
                  {formatMsg(s.studio.gazeThing, { thing: names.objectName(o) })}
                </Option>
              ))}
            </div>
          )}
        </div>
        <button type="button" onClick={() => turn(-TURN_STEP)} disabled={!ready} aria-label={s.turnLeft} title={s.turnLeft} className={`${DCHIP} w-8 justify-center px-0`}>
          ↺
        </button>
        <button type="button" onClick={() => turn(TURN_STEP)} disabled={!ready} aria-label={s.turnRight} title={s.turnRight} className={`${DCHIP} w-8 justify-center px-0`}>
          ↻
        </button>
        <button type="button" onClick={frameFigure} disabled={!ready} className={DCHIP}>
          {s.frameFigure}
        </button>
        {stageUndoCount > 0 && (
          <button
            type="button"
            onClick={() => stageStepRef.current?.undo()}
            disabled={!ready || shooting || previz}
            title={s.stageUndoHint}
            className={DCHIP}
          >
            {s.stageUndo}
          </button>
        )}
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
    </div>
    );
  }

  const chatHeader = (
            <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.07)] px-4 py-3">
              <span className="text-[11px] font-medium uppercase tracking-widest text-[#c6c9d1]">{s.astraLabel}</span>
              <span className="flex items-center gap-2">
                <span className="text-[11px] text-[#9aa0ad]">{formatMsg(s.panelMeta, { engine: stillEngineName })}</span>
                {/* The phone's fold (Helios Cut 3, step 2): the conversation folds away and the
                    words box with its priced send stays; before, this button was hidden below md,
                    the only width that draws this header, so a phone's chat could not be closed.
                    A 36 px target; the negative margins keep the header's height as designed. */}
                <button
                  type="button"
                  onClick={() => setChatOpen((v) => !v)}
                  aria-expanded={chatOpen}
                  title={chatOpen ? s.chatHide : s.palette.chatShow}
                  aria-label={chatOpen ? s.chatHide : s.palette.chatShow}
                  className="-my-2.5 -mr-2 flex h-9 w-9 cursor-pointer items-center justify-center rounded text-[#d6d9e0] hover:text-[#ecedf1]"
                >
                  <span aria-hidden className={`inline-block transition-transform motion-reduce:transition-none ${chatOpen ? "rotate-90" : "-rotate-90"}`}>
                    ›
                  </span>
                </button>
              </span>
            </div>
  );
  const chatThread = (
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
                          <p className="text-sm leading-relaxed text-[#d6d9e0]">
                            {shot.status === "succeeded" ? stillLine(shot) : shot.status === "failed" ? s.takeFailedLine : s.takeRendering}
                          </p>
                          <div className="rounded-[14px] bg-[rgba(255,255,255,0.05)] p-3 ring-1 ring-[rgba(255,255,255,0.07)] space-y-3">
                            <div className="flex items-center gap-3">
                              <button
                                type="button"
                                onClick={() => setViewing(shot.generationId)}
                                title={formatMsg(s.takeTile, { n: stillNumber(shot) })}
                                className="relative h-24 w-24 flex-shrink-0 cursor-pointer overflow-hidden rounded-[10px] bg-black/60 ring-1 ring-[rgba(255,255,255,0.15)]"
                              >
                                {shot.posterUrl ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img src={shot.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                                ) : shot.status === "failed" ? (
                                  <span className="flex h-full items-center justify-center text-lg font-semibold text-red-400">!</span>
                                ) : (
                                  <span className="flex h-full items-center justify-center text-lg text-onmedia/70">▶</span>
                                )}
                              </button>
                              <div className="min-w-0 flex flex-col gap-1">
                                <span className="text-[13px] font-medium text-[#ecedf1]">{formatMsg(s.takeTile, { n: stillNumber(shot) })}</span>
                                <span className="text-xs text-[#c6c9d1] tabular-nums">
                                  {formatMsg(s.takeSeconds, { s: shot.seconds ?? SET_TAKE_ENGINES[SET_TAKE_DEFAULT_ENGINE].seconds })} · <LocalDate date={shot.createdAt} />
                                </span>
                              </div>
                            </div>
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Link href={`/app/history/${shot.generationId}`} className={chip(false)}>
                                {s.openTake}
                              </Link>
                              {shot.takeFrom && retryable.has(shot.generationId) && (
                                <button
                                  type="button"
                                  onClick={() => shot.takeFrom && void retryClip(framesOf(shot.takeFrom, shot))}
                                  disabled={shooting || matching || !ready}
                                  title={s.takeRetryHint}
                                  className={chip(false)}
                                >
                                  {retryLabel(shot.takeFrom)}
                                </button>
                              )}
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
                        <p className="text-sm leading-relaxed text-[#d6d9e0]">
                          {facts ? `${formatMsg(s.shotInSeconds, { s: facts.seconds })} ` : ""}
                          {stillLine(shot)}
                          {isLook ? ` ${s.lookOnLine}` : ""}
                          {shot.rigCheck ? ` ${rigCheckedLine(shot.rigCheck)}` : ""}
                        </p>
                        <div className="rounded-[14px] bg-[rgba(255,255,255,0.05)] p-3 ring-1 ring-[rgba(255,255,255,0.07)] space-y-3">
                          <div className="flex items-center gap-3">
                            <button
                              type="button"
                              onClick={() => setViewing(shot.generationId)}
                              title={formatMsg(s.stillTile, { n: stillNumber(shot) })}
                              className={`relative h-24 w-24 flex-shrink-0 cursor-pointer overflow-hidden rounded-[10px] bg-black/60 ${
                                isLook ? "ring-2 ring-[#e0a468]" : "ring-1 ring-[rgba(255,255,255,0.15)]"
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
                              <span className="text-xs text-[#c6c9d1] tabular-nums">
                                {shot.score !== null ? `${formatMsg(s.identityScore, { score: shot.score })} · ` : ""}
                                <LocalDate date={shot.createdAt} />
                              </span>
                              {facts && <span className="text-xs text-[#c6c9d1]">{facts.frame}</span>}
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

              {/* v1's waiting messages; reader v2's are its turns, below. */}
              {!v2On &&
                pendingAsks.map((ask, i) => (
                  <div key={`ask-${i}`} className="max-w-[86%] self-end whitespace-pre-wrap rounded-[16px] rounded-br-[4px] bg-[#ecedf1] px-3.5 py-2.5 text-sm leading-relaxed text-[#1b1c20]">
                    {ask}
                  </div>
                ))}

              {/* The chat's turns (Helios Cut 2, reader v2, steps 11a and
                  11b): the person's words, then Astra's reply said from what
                  the page did (astra-reply.tsx, the layout the owner picks),
                  its buttons live on the newest turn only; an earlier turn
                  keeps what it did. A still that lands carries the words of
                  the turns before it, and they fold into it, as v1's
                  messages do. */}
              {v2On &&
                turns.map((tn) => {
                  if (tn.shotsAt !== shots.length) return null;
                  const newest = tn.id === turns[turns.length - 1]?.id;
                  const held = reading || shooting || editingSet || matching || following !== null || shootDue !== null || !ready;
                  const card = newest && !tn.settled ? tn.reply.astra : null;
                  const said = shownLines(tn.reply, { compact: !newest, open: newest && !tn.settled }).length > 0;
                  return (
                    <Fragment key={`turn-${tn.id}`}>
                      {tn.asked !== null && (
                        <div className="max-w-[86%] self-end whitespace-pre-wrap rounded-[16px] rounded-br-[4px] bg-[#ecedf1] px-3.5 py-2.5 text-sm leading-relaxed text-[#1b1c20]">
                          {tn.asked}
                        </div>
                      )}
                      {said && (
                        <div className="flex items-start gap-2.5" data-turn={tn.id}>
                          <AstraMark />
                          <AstraReply
                            model={tn.reply}
                            copy={s.reply}
                            live={newest}
                            settled={tn.settled}
                            busy={held}
                            compact={!newest}
                            following={following ? followingLine : null}
                            onAction={(action) => replyAction(tn, action)}
                            astraCard={
                              /* A change to the set itself waits on its card: the words Astra reads, the month's changes, its own press. */
                              card && (
                                <AstraChangeCard
                                  words={card.said}
                                  cut={card.cut}
                                  editsLeft={editsLeft}
                                  editsCap={astraEditsCap}
                                  tooBig={astraTooBig(spec)}
                                  busy={held}
                                  shootCredits={card.shootCredits}
                                  onGo={() => replyAction(tn, { kind: "astraGo" })}
                                  onGoShoot={() => replyAction(tn, { kind: "astraGoShoot", credits: card.shootCredits ?? pageCredits.still })}
                                  onNotNow={() => replyAction(tn, { kind: "notNow" })}
                                  copy={s.reply}
                                  buildLabel={s.editorOpen}
                                />
                              )
                            }
                          />
                        </div>
                      )}
                    </Fragment>
                  );
                })}

              {/* An Astra edit of the set, landed: how much of it changed. */}
              {setChanged !== null && (
                <div className="flex items-start gap-2.5">
                  <AstraMark />
                  <p className="text-sm leading-relaxed text-[#d6d9e0]">
                    {setChanged === 0 ? s.editorAskNothing : setChanged === 1 ? s.editorAskDoneOne : formatMsg(s.editorAskDone, { n: setChanged })}{" "}
                    {/* What is left of the month after it, as the last answer said (Helios Cut 2, step 1): the Build editor's own words. */}
                    {editsLeft !== null && (
                      <span className="text-[#9aa0ad]" data-edits-left>
                        {editsLeft === 0 ? s.editorAskLeftNone : editsLeft === 1 ? s.editorAskLeftOne : formatMsg(s.editorAskLeft, { n: editsLeft })}.{" "}
                      </span>
                    )}
                    {setChanged > 0 && (
                      <button type="button" onClick={() => void undoSetEdit()} className="cursor-pointer font-medium text-[#e0a468]">
                        {s.editorUndo}
                      </button>
                    )}
                  </p>
                </div>
              )}

              {/* What the changed line's Undo did (Helios Cut 2, step 2). */}
              {undoNote !== null && (
                <div className="flex items-start gap-2.5" data-undo-note={undoNote}>
                  <AstraMark />
                  <p className="text-sm leading-relaxed text-[#d6d9e0]">{undoNote === "textKept" ? s.reply.noteUndoAstraText : s.reply.noteUndoAstra}</p>
                </div>
              )}

              {/* A change to the set itself, waiting for its press (Helios Cut 2, step 1). */}
              {astraAsk && (
                <div className="flex items-start gap-2.5">
                  <AstraMark />
                  <div className="min-w-0 flex-1">
                    <AstraChangeCard
                      words={astraAsk.words}
                      editsLeft={editsLeft}
                      editsCap={astraEditsCap}
                      tooBig={astraTooBig(spec)}
                      busy={reading || shooting || editingSet || matching || following !== null || !ready}
                      shootCredits={null}
                      onGo={() => {
                        // editSet's own busy rule, read before the card goes: a press it would refuse keeps the card (review of Cut 2, N3, R5).
                        const b = busyRef.current;
                        if (b.editing || b.shooting || b.taking || b.matching) return;
                        // Exactly the words the card quoted: what Astra reads.
                        const { quoted } = astraCardWords(astraAsk.words);
                        setAstraAsk(null);
                        void editSet({ said: quoted }, null);
                      }}
                      onNotNow={() => setAstraAsk(null)}
                      copy={s.reply}
                      buildLabel={s.editorOpen}
                    />
                  </div>
                </div>
              )}

              {/* Astra's turn: the frame in a sentence, then as a card, and Shoot to approve it */}
              <div className="flex items-start gap-2.5">
                <AstraMark />
                <div className="min-w-0 flex-1 space-y-2.5">
                  {note?.down !== undefined && (
                    <p className="text-sm leading-relaxed text-[#d6d9e0]" data-reader-down>
                      {s.reply.replyReaderDown}{" "}
                      <button type="button" onClick={() => wordsAsHappens(note.down ?? "")} disabled={!ready} className="cursor-pointer font-medium text-[#e0a468] disabled:text-[#9aa0ad]">
                        {s.reply.useMyWords}
                      </button>
                    </p>
                  )}
                  {characters.length === 0 ? (
                    <p className="text-sm leading-relaxed text-[#d6d9e0]">
                      {s.noCharacters}{" "}
                      <Link href={newCharacterHref} className="font-medium text-[#e0a468] underline underline-offset-2">
                        {s.createCharacter}
                      </Link>
                    </p>
                  ) : (
                    <>
                      <p className="text-sm leading-relaxed text-[#d6d9e0]">
                        {frameLead ? `${frameLead} ` : ""}
                        {placedLine} {s.frameProse}
                      </p>
                      <div className="rounded-[14px] bg-[rgba(255,255,255,0.05)] p-4 ring-1 ring-[rgba(255,255,255,0.07)] space-y-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-medium uppercase tracking-widest text-[#c6c9d1]">{s.frameCard}</span>
                          <span className="text-xs text-[#9aa0ad] tabular-nums">{formatMsg(s.revisionN, { n: frameNumber })}</span>
                        </div>
                        <dl className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-[13px] leading-[18px]">
                          {rowLabel(s.rowWho, "who")}
                          <dd className="flex items-center gap-1.5 text-[#ecedf1]">
                            {character?.thumbUrl ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={character.thumbUrl} alt="" className="h-[18px] w-[18px] rounded-full object-cover" />
                            ) : (
                              <span className="h-[18px] w-[18px] rounded-full bg-[rgba(255,255,255,0.15)]" />
                            )}
                            {characterName}
                          </dd>
                          {rowLabel(s.rowWhere, "where")}
                          <dd className="text-[#ecedf1]">
                            {markLabel} · {facingLabel}
                          </dd>
                          {rowLabel(s.rowCamera, "camera")}
                          <dd className="text-[#ecedf1] tabular-nums">
                            {cameraLabel} · {lensLabel}
                            {rig.format !== "square" ? ` · ${s.rig.formats[rig.format]}` : ""}
                          </dd>
                          {rigLooksLine && (
                            <>
                              {rowLabel(s.rig.rowRig, "rig")}
                              <dd className="text-[#f0cda6] tabular-nums">{rigLooksLine}</dd>
                            </>
                          )}
                          {rig.light && (
                            <>
                              {rowLabel(s.rig.rowLight, "light")}
                              <dd className="text-[#f0cda6] tabular-nums">
                                {s.rig.lights[rig.light.scheme]} · {formatMsg(s.rig.lightHeight, { deg: Math.round(rig.light.elevationDeg) })}
                              </dd>
                            </>
                          )}
                          {/* The hour the rig sets, on reader v2's page (spec §5.1): the chat sets it, and the card says it. */}
                          {v2On && rig.time !== null && (
                            <>
                              {rowLabel(s.rig.rowTime, "time")}
                              <dd className="text-[#f0cda6] tabular-nums" data-row-time>
                                {timeLabel(rig.time)}
                              </dd>
                            </>
                          )}
                          {rig.palette && (
                            <>
                              {rowLabel(s.rig.rowPalette, "palette")}
                              <dd className="text-[#f0cda6]">{s.rig.palettes[rig.palette]}</dd>
                            </>
                          )}
                          {rowLabel(s.rowHappens, "happens")}
                          <dd className={direction ? "text-[#ecedf1]" : "text-[#9aa0ad]"}>{direction || "—"}</dd>
                          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#9aa0ad]">{s.rowCost}</dt>
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
                            disabled={!canShootNow}
                            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[8px] bg-[#e0a468] px-[18px] text-sm font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:bg-[#2a2b33] disabled:text-[#c6c9d1] disabled:opacity-100"
                          >
                            {takeStart && !shooting ? formatMsg(s.takeButton, { n: takeCredits }) : shootLabel}
                          </button>
                          <button
                            type="button"
                            onClick={anotherAngle}
                            disabled={!ready || shooting || reading || editingSet}
                            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[8px] bg-[rgba(255,255,255,0.06)] px-4 text-sm font-medium text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.1)] transition-colors hover:bg-[rgba(255,255,255,0.1)] disabled:text-[#9aa0ad] disabled:opacity-100"
                          >
                            {s.anotherAngle}
                          </button>
                        </div>
                        {error && <p className="text-sm text-red-400">{localizeServerText(error, t)}</p>}
                        {takeRetry && (
                          <button
                            type="button"
                            onClick={() => void retryClip(takeRetry)}
                            disabled={shooting || matching || reading || editingSet || !ready}
                            title={s.takeRetryHint}
                            className={chip(false)}
                          >
                            {retryLabel(takeRetry)}
                          </button>
                        )}
                        {rigError && <p className="text-xs text-red-400">{localizeServerText(rigError, t)}</p>}
                        {lastMiss && (
                          <p className="text-sm text-[#c6c9d1]">
                            {s.shotDidNotFinish}{" "}
                            <Link href={`/app/history/${lastMiss}`} className="font-medium text-[#e0a468] underline underline-offset-2">
                              {s.openTake}
                            </Link>
                          </p>
                        )}
                        {lookDropped && (
                          <p className="text-xs text-[#c6c9d1]" aria-live="polite">
                            {s.lookDropped}
                          </p>
                        )}
                        {lookAside && (
                          <p className="text-xs text-[#c6c9d1]" aria-live="polite" data-look-aside>
                            {s.lookAside}
                          </p>
                        )}
                        {/* A thing's photos that didn't ride the last still, and why (R1). */}
                        {shotElements?.map((e) => {
                          const why = afterShotWhy(e.status);
                          if (!why) return null;
                          const words = formatMsg(cast[why], { max: ELEMENT_SHEETS_PER_STILL, n: e.like ?? 1 });
                          return (
                            <p key={e.key} className="text-xs text-[#c6c9d1]" data-el-after>
                              {formatMsg(cast.afterNotSent, { name: elementName(e.key), why: words })}
                            </p>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>

              {(reading || shooting || editingSet) && (
                <div className="flex items-center gap-2.5">
                  <AstraMark />
                  <p className="flex items-center gap-2 text-sm text-[#c6c9d1]">
                    <Spinner className="h-4 w-4 flex-shrink-0" />
                    {editingSet ? s.editorAsking : following ? followingLine : shooting ? `${s.shooting} ${formatMsg(s.shootingLine, { engine: pressEngineName })}` : s.threadReading}
                  </p>
                </div>
              )}
              <div ref={threadEndRef} aria-hidden />
            </div>
  );
  // An empty send is a paid Shoot (pressShoot): on every account's page,
  // reader v1 or v2, it shows its label and price, not only an arrow (money
  // rule 7). With words in the box it is the arrow again: those words are
  // read first, and only a message that asks to shoot spends.
  const sendSaysPrice = !draft.trim() && !justTalk;
  const chatComposer = (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (mentionOpen && mentionList[0]) pickMention(mentionList[0]);
                // The send arrow runs a free "/" row, never the paid Shoot row:
                // the arrow shows no price, and on a phone it is the usual tap
                // (review of Cut 2, M1). Shoot runs from its own row, which
                // says what it charges, or from Enter on it.
                else if (slashQuery !== null) {
                  if (!slashPaid) runSlash(slashPick);
                } else if (draft.trim()) void send(draft);
                // Just talking is the mode that spends nothing: with nothing
                // written there is nothing to answer, and an empty send used
                // to shoot anyway (found in the rundown, 2026-09-16).
                else if (!justTalk) void pressShoot();
              }}
              className="relative border-t border-[rgba(255,255,255,0.07)] px-3.5 pb-3.5 pt-3"
            >
              {/* The "/" menu: ⌘K's own commands, free, the Shoot row at its price (Cut 2, step 11b). */}
              {slashQuery !== null && (
                <div
                  role="listbox"
                  aria-label={s.palette.title}
                  className="absolute bottom-full left-3.5 right-3.5 z-30 mb-2 max-w-[22rem] rounded-[12px] border border-[rgba(255,255,255,0.11)] bg-[#1d1e24] p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]"
                  data-slash-menu
                >
                  {slashList.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-xs text-[#c6c9d1]">{s.palette.empty}</p>
                  ) : (
                    slashList.map((c, i) => (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={i === slashPick}
                        onMouseEnter={() => setSlashAt(i)}
                        onClick={() => runSlash(i)}
                        data-slash-command={c.id}
                        className={`flex h-9 w-full cursor-pointer items-center gap-3 rounded-[7px] px-2.5 text-left text-[13px] ${
                          i === slashPick ? "bg-[rgba(224,164,104,0.13)] text-[#f0cda6]" : "text-[#d6d9e0] hover:text-[#ecedf1]"
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate">{c.label}</span>
                        <span className="whitespace-nowrap text-[10.5px] uppercase tracking-[0.06em] text-[#9aa0ad]">{s.palette.groups[c.group]}</span>
                      </button>
                    ))
                  )}
                </div>
              )}
              {mentionOpen && (
                <div
                  role="listbox"
                  aria-label={s.mentionTitle}
                  className="absolute bottom-full left-3.5 z-30 mb-2 w-max min-w-[13rem] rounded-[12px] border border-[rgba(255,255,255,0.11)] bg-[#1d1e24] p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]"
                >
                  <p className="px-2.5 pb-1 pt-1 text-[11px] font-medium uppercase tracking-widest text-[#c6c9d1]">{s.mentionTitle}</p>
                  {mentionList.length === 0 ? (
                    <p className="px-2.5 py-1.5 text-xs text-[#c6c9d1]">{s.mentionHint}</p>
                  ) : (
                    mentionList.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        role="option"
                        aria-selected={characterId === c.id}
                        onClick={() => pickMention(c)}
                        className={`flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] transition-colors ${
                          characterId === c.id ? "bg-[rgba(255,255,255,0.08)] font-medium text-[#ecedf1]" : "text-[#c6c9d1] hover:bg-[rgba(255,255,255,0.05)] hover:text-[#ecedf1]"
                        }`}
                      >
                        {c.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={c.thumbUrl} alt="" className="h-[22px] w-[22px] rounded-full object-cover" />
                        ) : (
                          <span className="h-[22px] w-[22px] rounded-full bg-[rgba(255,255,255,0.15)]" />
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
                onChange={(e) => {
                  setDraft(e.target.value);
                  // A fresh "/" opens the menu again, at its first row.
                  setSlashAt(0);
                  if (!e.target.value.startsWith("/")) setSlashOff(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Escape" && mentionOpen) {
                    e.preventDefault();
                    setMentionForced(false);
                    return;
                  }
                  if (slashQuery !== null) {
                    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                      e.preventDefault();
                      setSlashAt(stepIndex(slashPick, e.key === "ArrowDown" ? 1 : -1, slashList.length));
                      return;
                    }
                    if (e.key === "Escape") {
                      // Words that start with "/", sent as words.
                      e.preventDefault();
                      setSlashOff(true);
                      return;
                    }
                  }
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    if (mentionOpen && mentionList[0]) pickMention(mentionList[0]);
                    else if (slashQuery !== null) runSlash(slashPick);
                    else if (draft.trim()) void send(draft);
                  }
                }}
                rows={2}
                aria-label={v2On ? s.reply.composerPlaceholder : s.threadPlaceholder}
                placeholder={reading ? s.threadReading : v2On ? s.reply.composerPlaceholder : s.threadPlaceholder}
                disabled={reading || shooting || editingSet}
                className="block min-h-[44px] w-full resize-none border-none bg-transparent px-2 py-1.5 text-sm text-[#ecedf1] outline-none placeholder:text-[#9aa0ad] disabled:text-[#9aa0ad]"
              />
              {/* Past 500 characters, how many of the 600 the reader reads (spec §3.7; Cut 2, step 11b). */}
              {v2On && draft.length > COMPOSER_COUNT_FROM && (
                <p
                  className={`px-2 text-right text-[11px] tabular-nums ${draft.length > SHOT_WORDS_MAX_CHARS ? "text-[#e0a468]" : "text-[#9aa0ad]"}`}
                  aria-live="polite"
                  data-composer-count
                >
                  {formatMsg(s.reply.composerCount, { n: draft.length, max: SHOT_WORDS_MAX_CHARS })}
                </p>
              )}
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
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => toggleMenu("engine")}
                      aria-haspopup="listbox"
                      aria-expanded={menu === "engine"}
                      title={s.engineHint}
                      data-still-engine={stillEngine}
                      className="flex h-8 cursor-pointer items-center gap-1 whitespace-nowrap rounded-full bg-[rgba(255,255,255,0.06)] px-3 text-xs text-[#c6c9d1] tabular-nums hover:bg-[rgba(255,255,255,0.1)]"
                    >
                      {stillEngineName} · {credits}
                      <Chevron />
                    </button>
                    {menu === "engine" && (
                      <div role="listbox" aria-label={s.engineHint} className={DMENU_UP} data-still-engines>
                        {SELECTABLE_IMAGE_MODEL_IDS.map((id) => (
                          <Option key={id} active={stillEngine === id} onPick={() => pickStillEngine(id)}>
                            {getImageModel(id).name}
                          </Option>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <span className="flex-1" />
                <button
                  type="submit"
                  disabled={reading || shooting || editingSet || !ready || slashPaid || (!draft.trim() && (!characterId || justTalk))}
                  title={draft.trim() || justTalk ? s.threadPlaceholder : pressLabel}
                  aria-label={draft.trim() || justTalk ? s.threadPlaceholder : pressLabel}
                  data-send-shoots={sendSaysPrice || undefined}
                  className={`flex h-9 flex-shrink-0 cursor-pointer items-center justify-center rounded-full bg-[#e0a468] text-[#1b1c20] transition-opacity hover:opacity-90 disabled:bg-[rgba(255,255,255,0.06)] disabled:text-[#c6c9d1] ${
                    sendSaysPrice ? "gap-1.5 whitespace-nowrap px-3.5 text-[12px] font-semibold" : "w-9"
                  }`}
                >
                  {reading || shooting || editingSet ? (
                    <Spinner className="h-4 w-4" />
                  ) : sendSaysPrice ? (
                    // An empty send shoots: it says what, and what it charges, where it can be read (Cut 2, step 11b).
                    pressLabel
                  ) : (
                    <SendIcon className="h-4 w-4" />
                  )}
                </button>
              </div>
            </form>
  );

  return (
    <div data-set-workspace className="fixed inset-0 z-40 flex flex-col overflow-hidden bg-[#101116] text-[#d6d9e0]">
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

      {/* The studio's frame (canvas page J, board J1; cut A): the bar across the top, the same in every mode. */}
      <StudioBar
        back={{ href: "/app/sets", label: s.back }}
        title={title || s.untitled}
        meta={shotCount}
        mode={studioMode}
        modes={studioModes}
        steps={simpleSteps}
        stepsLabel={sw.stepsLabel}
        view={{ mode: viewMode, onChange: setViewMode, label: s.studio.viewLabel, names: { lit: s.editorViewLit, clay: s.editorViewClay, wire: s.editorViewWire, depth: s.editorViewDepth } }}
        find={{ label: s.studio.find, kbd: s.palette.open, onOpen: () => setPaletteOpen(true) }}
        rendering={renderingCount > 0 ? { label: renderingCount === 1 ? s.studio.renderingOne : formatMsg(s.studio.rendering, { n: renderingCount }) } : null}
        primary={
          simpleOn && filmOpen && !cutOpen ? (
            // The new layout's Film: its one action is the render, the same
            // button the sequencer carries.
            <button
              type="button"
              onClick={() => void renderFilm()}
              disabled={Boolean(filmBusy)}
              title={filmRenderWhy ?? undefined}
              data-bar-render
              className="flex h-7 flex-none cursor-pointer items-center whitespace-nowrap rounded-[6px] bg-[#e0a468] px-3.5 text-[12px] font-semibold text-[#1b1c20] disabled:cursor-default disabled:bg-[#2a2b33] disabled:text-[#c6c9d1]"
            >
              {filmRenderLabel}
            </button>
          ) : simpleOn && simpleShooting && simpleStep === "set" && !takeStart ? (
            <button
              type="button"
              onClick={() => setSimpleStep("shoot")}
              className="flex h-7 flex-none cursor-pointer items-center whitespace-nowrap rounded-[6px] bg-[#e0a468] px-3.5 text-[12px] font-semibold text-[#1b1c20]"
              data-next-shoot
            >
              {sw.nextShoot}
            </button>
          ) : (
          <button
            type="button"
            onClick={() => void (takeStart ? take() : shoot())}
            disabled={!canShootNow}
            className="flex h-7 flex-none cursor-pointer items-center whitespace-nowrap rounded-[6px] bg-[#e0a468] px-3.5 text-[12px] font-semibold text-[#1b1c20] disabled:cursor-default disabled:bg-[#2a2b33] disabled:text-[#c6c9d1]"
          >
            {takeStart && !shooting ? formatMsg(s.takeButton, { n: takeCredits }) : shootLabel}
          </button>
          )
        }
      >
        {/* Only where the switch does something: from 1180 px, where the three columns fit; below it, down to a phone, Classic. */}
        {simpleLayout && wide3 && (
          <button
            type="button"
            onClick={toggleLayout}
            aria-pressed={simple}
            data-layout-toggle
            title={simple ? sw.toggleClassic : sw.toggleNew}
            className="flex h-8 flex-none cursor-pointer items-center whitespace-nowrap rounded-[6px] border border-[rgba(240,196,142,0.45)] px-2 text-xs font-semibold text-[#f0cda6] hover:bg-[rgba(224,164,104,0.1)] md:px-2.5"
          >
            {simple ? sw.toggleClassic : sw.toggleNew}
          </button>
        )}
        <div className="relative">
          <button
            type="button"
            onClick={() => toggleMenu("history")}
            aria-haspopup="listbox"
            aria-expanded={menu === "history"}
            disabled={revisions.length < 2}
            aria-label={`${s.historyLabel} · ${formatMsg(s.revisionN, { n: frameNumber })}`}
            className="flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 text-xs font-medium text-[#d6d9e0] hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#9aa0ad] disabled:opacity-100 md:px-2.5"
          >
            <span className="hidden xl:inline">{s.historyLabel} · </span>
            {formatMsg(s.revisionN, { n: frameNumber })}
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
          onClick={viewingFile && viewingShot ? () => void downloadShot(viewingShot) : downloadFrame}
          disabled={!viewingFile && !ready}
          title={barDownloadLabel}
          aria-label={barDownloadLabel}
          data-bar-download
          className="flex h-8 w-8 flex-none cursor-pointer items-center justify-center rounded-[6px] text-[#d6d9e0] hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#9aa0ad] disabled:opacity-100"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M12 3v12" />
            <path d="m7 10 5 5 5-5" />
            <path d="M4 19h16" />
          </svg>
        </button>
      </StudioBar>

      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        commands={paletteCommands}
        words={{ title: s.palette.title, placeholder: s.palette.placeholder, empty: s.palette.empty, hint: s.palette.hint, groups: s.palette.groups }}
      />

      {/* The frame's row: the rail, the viewport with everything floating on it, the dock. */}
      <div className="flex min-h-0 flex-1 items-stretch">
        {wide &&
          (simpleOn ? (
            <ThingsPanel
              people={panelPeople}
              things={panelThings}
              selected={elementCard?.key ?? null}
              onOpen={(key) => openElementCard(key)}
              onPlace={() => {
                closeElementCard();
                studioModes.shoot.onClick();
                setSimpleStep("set");
              }}
              placeLine={sw.placeText}
              models={modelsOn}
              loose={panelLoose}
              w={sw}
              c={cast}
            />
          ) : (
            <StudioRail mode={studioMode} tool={stageTool} onTool={(id) => studioKeysRef.current.tool(id)} names={s.studio.tools} notes={s.studio.toolNotes} />
          ))}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="relative min-h-0 flex-1">
          <div ref={hostRef} className="absolute inset-0" style={gradeFilter ? { filter: gradeFilter } : undefined} />
          {/* the palette's grade, previewed over the stage (never the sketch) */}
          {gradeTint && <div aria-hidden className="pointer-events-none absolute inset-0 mix-blend-soft-light" style={{ background: gradeTint }} />}
          {/* The dark round the frame lines is a 9,999 px shadow, and this layer —
              the stage's own box — is what keeps it on the stage. Unclipped it
              spread over the whole page and, being positioned, painted OVER the
              bar, the rail and the dock, which are not: everything outside the
              lines at 45% of itself, in Shoot, Film and Cut and never in Build,
              which draws no frame lines ("In Build mode the text is not dimmed,
              when switching to shoot film and cut it gets dimmed", 2026-09-18). */}
          <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
            <div
              ref={guideRef}
              aria-hidden
              className={`pointer-events-none absolute rounded-[2px] shadow-[0_0_0_9999px_rgba(0,0,0,0.55)] outline outline-1 outline-[rgba(255,255,255,0.45)] ${viewingShot ? "hidden" : ""}`}
            >
              {/* The camera department's readout, and the viewfinder's aids (cut 2): on the stage only, never in the picture. */}
              {/* Over the render, not over the chrome: on a daylight exterior #c6c9d1
                  came out at 1.8:1 — the token that exists for text painted on
                  media reads on any set (2026-09-18). */}
              <div className="absolute -top-[18px] left-0 right-0 flex justify-between gap-3 whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.06em] text-onmedia">
                <span className="min-w-0 truncate">{hudLeft}</span>
                <span className="tabular-nums">{hudRight}</span>
              </div>
              {(rig.overlays.thirds || rig.overlays.golden || rig.overlays.safe || rig.overlays.centre) && (
                <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none">
                  {rig.overlays.thirds &&
                    [33.333, 66.667].flatMap((t) => [
                      <line key={`tx${t}`} x1={t} y1="0" x2={t} y2="100" stroke="rgba(255,255,255,0.28)" vectorEffect="non-scaling-stroke" />,
                      <line key={`ty${t}`} x1="0" y1={t} x2="100" y2={t} stroke="rgba(255,255,255,0.28)" vectorEffect="non-scaling-stroke" />,
                    ])}
                  {rig.overlays.golden &&
                    [38.197, 61.803].flatMap((t) => [
                      <line key={`gx${t}`} x1={t} y1="0" x2={t} y2="100" stroke="rgba(224,164,104,0.35)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />,
                      <line key={`gy${t}`} x1="0" y1={t} x2="100" y2={t} stroke="rgba(224,164,104,0.35)" strokeDasharray="4 3" vectorEffect="non-scaling-stroke" />,
                    ])}
                  {rig.overlays.safe && (
                    <>
                      <rect x="5" y="5" width="90" height="90" fill="none" stroke="rgba(255,255,255,0.3)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                      <rect x="10" y="10" width="80" height="80" fill="none" stroke="rgba(255,255,255,0.18)" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                  {rig.overlays.centre && (
                    <>
                      <line x1="48" y1="50" x2="52" y2="50" stroke="rgba(255,255,255,0.55)" vectorEffect="non-scaling-stroke" />
                      <line x1="50" y1="47" x2="50" y2="53" stroke="rgba(255,255,255,0.55)" vectorEffect="non-scaling-stroke" />
                    </>
                  )}
                </svg>
              )}
              {rig.overlays.histogram && <canvas ref={histogramRef} width={128} height={40} className="absolute right-2 top-2 rounded-[4px] bg-black/50" />}
            </div>
          </div>
          <div
            ref={focusHudRef}
            hidden
            aria-hidden
            className={`pointer-events-none absolute left-0 top-0 z-20 -translate-x-1/2 whitespace-nowrap rounded-full border border-[rgba(255,255,255,0.1)] bg-black/60 px-2 py-0.5 text-[10.5px] font-medium tabular-nums text-white ${viewingShot ? "hidden" : ""}`}
          />
          {/* The viewport's furniture (cut C, furniture.ts): the sun where it stands, the focus bracket, the measure line, the gizmo and the scale. */}
          <button
            ref={sunRef}
            type="button"
            hidden
            data-sun
            title={s.studio.sunDrag}
            aria-label={s.studio.sunDrag}
            onPointerDown={(e) => {
              sunDragRef.current = true;
              e.currentTarget.setPointerCapture(e.pointerId);
              e.preventDefault();
            }}
            onPointerMove={(e) => {
              if (!sunDragRef.current) return;
              const h = apiRef.current?.sunHourAt(e.clientX, e.clientY);
              if (h !== null && h !== undefined) setRig((r) => (r.time === h ? r : { ...r, time: h }));
            }}
            onPointerUp={(e) => {
              sunDragRef.current = false;
              if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            }}
            className={`absolute left-0 top-0 z-20 flex -translate-x-1/2 -translate-y-1/2 cursor-grab touch-none items-center gap-1.5 active:cursor-grabbing ${viewingShot ? "hidden" : ""}`}
          >
            <svg viewBox="-20 -20 40 40" className="h-9 w-9" aria-hidden>
              <circle r="9" fill="none" stroke="#f0cda6" strokeWidth="1.5" />
              <circle r="3" fill="#f0cda6" />
              <g stroke="#f0cda6" strokeWidth="1.2">
                <line x1="0" y1="-14" x2="0" y2="-18" />
                <line x1="0" y1="14" x2="0" y2="18" />
                <line x1="-14" y1="0" x2="-18" y2="0" />
                <line x1="14" y1="0" x2="18" y2="0" />
              </g>
            </svg>
            <span className="whitespace-nowrap rounded-[4px] bg-black/50 px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#f0cda6]" />
          </button>
          <div ref={bracketRef} hidden aria-hidden data-bracket className={`pointer-events-none absolute left-0 top-0 z-10 ${viewingShot ? "hidden" : ""}`}>
            <span className="absolute left-0 top-0 h-3 w-3 border-l-[1.5px] border-t-[1.5px] border-[rgba(255,255,255,0.9)]" />
            <span className="absolute right-0 top-0 h-3 w-3 border-r-[1.5px] border-t-[1.5px] border-[rgba(255,255,255,0.9)]" />
            <span className="absolute bottom-0 left-0 h-3 w-3 border-b-[1.5px] border-l-[1.5px] border-[rgba(255,255,255,0.9)]" />
            <span className="absolute bottom-0 right-0 h-3 w-3 border-b-[1.5px] border-r-[1.5px] border-[rgba(255,255,255,0.9)]" />
          </div>
          <svg ref={measureRef} style={{ display: "none" }} aria-hidden data-measure className={`pointer-events-none absolute inset-0 z-10 h-full w-full ${viewingShot ? "hidden" : ""}`}>
            <line stroke="#f0cda6" strokeWidth="1.5" strokeDasharray="4 3" />
            <circle data-end="a" r="4" fill="#f0cda6" />
            <circle data-end="b" r="4" fill="#f0cda6" />
            <text fill="#ffffff" fontSize="11" fontWeight="600" textAnchor="middle" paintOrder="stroke" stroke="rgba(0,0,0,0.7)" strokeWidth="3" />
          </svg>
          <svg ref={eyelineRef} style={{ display: "none" }} aria-hidden data-eyeline className={`pointer-events-none absolute inset-0 z-10 h-full w-full ${viewingShot ? "hidden" : ""}`}>
            <line stroke="#ffffff" strokeWidth="1.2" strokeDasharray="2 3" opacity="0.9" />
            <circle r="3" fill="#ffffff" />
            <text fill="#ffffff" fontSize="10.5" fontWeight="600" textAnchor="middle" paintOrder="stroke" stroke="rgba(0,0,0,0.7)" strokeWidth="3" />
          </svg>
          <svg ref={pathRef} style={{ display: "none" }} aria-hidden data-path className={`pointer-events-none absolute inset-0 z-10 h-full w-full ${viewingShot ? "hidden" : ""}`}>
            <polyline fill="none" stroke="#d8b37c" strokeWidth="1.5" strokeDasharray="5 4" />
            <circle r="3.5" fill="#d8b37c" />
            <circle r="3.5" fill="#d8b37c" />
            <circle r="3.5" fill="#d8b37c" />
            <circle r="3.5" fill="#d8b37c" />
            <circle r="3.5" fill="#d8b37c" />
            <circle r="3.5" fill="#d8b37c" />
          </svg>
          {laying && (
            <span className="pointer-events-none absolute left-3.5 top-[116px] z-20 rounded-full border border-onmedia/10 bg-black/70 px-3 py-1 text-[11px] text-[#f0cda6]" data-laying>
              {laying === "path"
                ? s.studio.pathLaying
                : laying === "mover"
                  ? cast.driveLaying
                  : laying === "mover-way"
                    ? cast.driveWayLaying
                    : s.studio.gazePick}
            </span>
          )}
          <div className={`pointer-events-none absolute right-3.5 z-10 hidden items-end gap-2.5 md:flex ${viewingShot ? "md:hidden" : ""} ${filmOpen || cutOpen ? "bottom-3.5" : "bottom-[104px]"}`}>
            <div ref={scaleRef} data-scale className="flex items-center gap-1.5 rounded-[6px] border border-[rgba(255,255,255,0.1)] bg-black/50 px-2 py-1 text-[10.5px] text-[#d6d9e0]">
              <i className="block h-px bg-[#d6d9e0]" style={{ width: 60 }} />
              <span>1 m</span>
            </div>
            <div className="flex h-[58px] w-[58px] items-center justify-center rounded-[8px] border border-[rgba(255,255,255,0.1)] bg-black/50">
              <svg ref={gizmoRef} data-gizmo viewBox="-23 -23 46 46" className="h-[46px] w-[46px]" aria-hidden>
                <line data-axis="x" x1="0" y1="0" x2="17" y2="0" stroke="#e05a5a" strokeWidth="1.8" />
                <line data-axis="y" x1="0" y1="0" x2="0" y2="-17" stroke="#7fc36a" strokeWidth="1.8" />
                <line data-axis="z" x1="0" y1="0" x2="0" y2="0" stroke="#6a9bcc" strokeWidth="1.8" />
                <circle data-axis-dot="x" cx="17" cy="0" r="4.5" fill="#e05a5a" />
                <circle data-axis-dot="y" cx="0" cy="-17" r="4.5" fill="#7fc36a" />
                <circle data-axis-dot="z" cx="0" cy="0" r="4.5" fill="#6a9bcc" />
                <text data-axis-text="x" x="17" y="2.2" textAnchor="middle" fontSize="6" fontWeight="700" fill="#1b1c20">X</text>
                <text data-axis-text="y" x="0" y="-14.8" textAnchor="middle" fontSize="6" fontWeight="700" fill="#1b1c20">Y</text>
                <text data-axis-text="z" x="0" y="2.2" textAnchor="middle" fontSize="6" fontWeight="700" fill="#1b1c20">Z</text>
              </svg>
            </div>
          </div>
          {/* Film's keyframes, named on the path (the path itself is in the canvas) */}
          <div ref={overlayHostRef} aria-hidden className={`pointer-events-none absolute inset-0 overflow-hidden ${viewingShot ? "hidden" : ""}`} />
          {loadFailed && !viewingShot && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#101116]/90 p-6 text-center text-sm text-onmedia/80">{s.loadFailed}</div>
          )}

          {/* The setup, as chips on the picture itself (or, in the new layout, in the Shoot panel). */}
          {!viewingShot && !simpleOn && !simplePhoneSet && setupChipsView(false)}
          {/* The new layout's tools: the rail's, floating at the stage's corner. */}
          {simpleOn && !viewingShot && (
            <div className="absolute left-3.5 top-3.5 z-20 overflow-hidden rounded-[12px] border border-[rgba(255,255,255,0.08)] shadow-[0_12px_32px_-12px_rgba(0,0,0,0.6)]" data-floating-tools>
              <StudioRail compact mode={studioMode} tool={stageTool} onTool={(id) => studioKeysRef.current.tool(id)} names={s.studio.tools} notes={s.studio.toolNotes} />
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
                disabled={editingSet || reading || shooting}
                onClick={() => {
                  setScaleDismissed(true);
                  // One of the month's changes: the card says so and waits for its press.
                  askAstraCard(s.scaleFixAsk);
                }}
                className="cursor-pointer rounded-full bg-[#e0a468] px-3 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:bg-[#2a2b33] disabled:text-[#c6c9d1] disabled:opacity-100"
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
              {takeStartOldKey && (
                <span className="rounded-full bg-black/70 px-3 py-1.5 text-xs text-[#f0cda6]" data-take-start-old>
                  {formatMsg(cast.takeStartOld, { name: elementName(takeStartOldKey) })}
                </span>
              )}
              <button type="button" onClick={() => setTakeStart(null)} className={glassBtn}>
                {t.common.cancel}
              </button>
            </div>
          )}

          {/* the drag hint, above the filmstrip (Film has its dock instead), and
              over it the cast strip (R1): who and what the next still carries.
              One column, so a hint that wraps never meets the strip, clear of
              the gizmo on the right. */}
          {!viewingShot && !loadFailed && !filmOpen && !simpleOn && (
            <div className="pointer-events-none absolute bottom-[104px] left-3.5 right-3.5 z-20 flex flex-col items-start gap-2 md:right-[190px]" data-stage-foot>
              {/* The first-visit card: here on a computer's Classic, and on a phone while its conversation is folded. */}
              {tipsShown && (wide || !chatOpen) && firstVisitView("pointer-events-auto w-full max-w-[340px]")}
              {simplePhoneSet ? (
                <div className="pointer-events-auto relative max-w-full">
                  <ThingsStrip rows={[...panelPeople, ...panelThings]} selected={elementCard?.key ?? null} onOpen={(key) => openElementCard(key)} loose={panelLoose} w={sw} c={cast} />
                </div>
              ) : (
                // The new layout's Shoot on a phone: the chips already name who is in the still, so the strip stays in Set.
                castShown && !simplePhone && castStrip("pointer-events-auto relative max-w-full")
              )}
              {/* A phone's bar has no room for the switch: it sits here, where the layout is offered. */}
              {simpleLayout && !wide && (
                <button
                  type="button"
                  onClick={toggleLayout}
                  aria-pressed={simple}
                  data-layout-toggle-phone
                  className="pointer-events-auto flex h-8 flex-none cursor-pointer items-center whitespace-nowrap rounded-full border border-[rgba(240,196,142,0.45)] bg-[rgba(0,0,0,0.62)] px-3 text-[11.5px] font-semibold text-[#f0cda6] backdrop-blur"
                >
                  {simple ? sw.toggleClassic : sw.toggleNew}
                </button>
              )}
              {/* The hint is a mouse's (shift-drag, scroll, double-click): on a phone it steps aside for the strip. */}
              <span
                aria-live="polite"
                className={`max-w-[80%] rounded-full border border-onmedia/10 bg-black/60 px-3 py-1 text-[11px] text-onmedia/80 md:max-w-full ${castShown && !figureMoved ? "max-md:hidden" : ""}`}
              >
                {figureMoved ? s.figureMovedOut : s.dragHint}
              </span>
            </div>
          )}
          {/* The new layout on a computer draws no stage foot: the first-visit card has its own corner. */}
          {simpleOn && tipsShown && <div className="absolute bottom-[104px] left-3.5 z-20 w-[340px] max-w-[calc(100%-28px)]">{firstVisitView("w-full")}</div>}

          {/* Match this shot: the read in progress, what it matched, or what went wrong */}
          {matchOn && (matching || matched || matchError) && (
            <div className={`absolute left-3.5 top-16 z-20 max-w-md space-y-1.5 rounded-[12px] p-3 ${PANEL_BG}`}>
              {matching ? (
                <p className="text-xs text-[#c6c9d1]" aria-live="polite">
                  {s.matchReading}
                </p>
              ) : matched && matchedLine ? (
                <div className="flex items-start gap-2.5" aria-live="polite">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={matched.photo} alt={s.matchReferenceAlt} className="h-12 w-auto max-w-[5.5rem] shrink-0 rounded-[4px] border border-[rgba(255,255,255,0.1)] object-cover" />
                  <div className="min-w-0 flex-1 space-y-0.5 text-xs leading-relaxed">
                    <p className="text-[#ecedf1]/90">{matchedLine.line}</p>
                    {matchedLine.notes && <p className="text-[#c6c9d1]">{matchedLine.notes}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMatched(null)}
                    aria-label={t.common.dismiss}
                    title={t.common.dismiss}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-sm text-[#c6c9d1] transition-colors hover:text-[#ecedf1]"
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
                      {/* The film plays silent until it is dubbed, and older clips still speak (2026-09-25). */}
                      <video
                        ref={(el) => {
                          reelVideosRef.current[i] = el;
                        }}
                        src={shot.resultUrl ?? undefined}
                        preload="auto"
                        muted
                        playsInline
                        onPlaying={() => setReelWaiting(false)}
                        onTimeUpdate={(e) => {
                          const v = e.currentTarget;
                          if (v.duration > 0) setPlayhead(timeOf(beatSpans(film), i, v.currentTime / v.duration));
                        }}
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
              <div className="absolute right-3.5 top-3.5 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void downloadFilm()}
                  disabled={filmFileBusy}
                  className="flex h-8 cursor-pointer items-center rounded-full bg-black/60 px-3 text-xs font-medium text-onmedia hover:bg-black/80 disabled:cursor-default disabled:text-onmedia/60"
                >
                  {filmFileBusy ? s.filmDownloading : `↓ ${s.filmDownload}`}
                </button>
                <button
                  type="button"
                  onClick={() => setReel(null)}
                  aria-label={t.common.dismiss}
                  title={t.common.dismiss}
                  className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-full bg-black/60 text-onmedia hover:bg-black/80"
                >
                  ×
                </button>
              </div>
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
                ) : viewingShot.status === "failed" ? (
                  <div className="flex h-full flex-col items-center justify-center gap-3 px-10 text-center">
                    <span className="text-sm text-onmedia/80">{s.takeFailedLine}</span>
                    {viewingShot.takeFrom && retryable.has(viewingShot.generationId) && (
                      <button
                        type="button"
                        onClick={() => viewingShot.takeFrom && void retryClip(framesOf(viewingShot.takeFrom, viewingShot))}
                        disabled={shooting || matching || !ready}
                        title={s.takeRetryHint}
                        className={chip(false)}
                      >
                        {retryLabel(viewingShot.takeFrom)}
                      </button>
                    )}
                  </div>
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
              <button type="button" onClick={() => setViewing(null)} className={`absolute top-3.5 ${glassBtn} right-3.5`}>
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
                    className={`absolute top-1/2 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-onmedia/10 bg-black/60 text-lg text-onmedia/80 transition-colors hover:text-onmedia right-3.5`}
                  >
                    ›
                  </button>
                </>
              )}
              <div className="absolute bottom-3.5 left-3.5 right-3.5 flex flex-wrap items-center justify-between gap-2">
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
                        if (!takesOn) {
                          setError(SET_TAKE_NEEDS_PLAN);
                          return;
                        }
                        setTakeStart({ id: viewingShot.generationId, n: stillNumber(viewingShot), armedBy: "person" });
                        setTakeEngine(SET_TAKE_DEFAULT_ENGINE);
                        setViewing(null);
                      }}
                      title={takesOn ? undefined : localizeServerText(SET_TAKE_NEEDS_PLAN, t)}
                      className={glassBtn}
                    >
                      {s.takeItSomewhere}
                    </button>
                  )}
                  {liveOn && viewingShot.kind === "still" && viewingShot.status === "succeeded" && (
                    <Link
                      href={`/app/live?from=${encodeURIComponent(viewingShot.generationId)}&set=${encodeURIComponent(setId)}`}
                      className={glassBtn}
                    >
                      {s.directLive}
                    </Link>
                  )}
                  {viewingFile && (
                    <button type="button" onClick={() => void downloadShot(viewingShot)} className={glassBtn} data-shot-download>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden>
                        <path d="M12 3v12" />
                        <path d="m7 10 5 5 5-5" />
                        <path d="M4 19h16" />
                      </svg>
                      {viewingShot.kind === "take" ? s.downloadTake : s.downloadStill}
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
            ref={stripRef}
            data-filmstrip
            className={`absolute bottom-3.5 left-3.5 right-3.5 z-10 flex items-center gap-2 overflow-x-auto rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-black/40 p-1.5 backdrop-blur ${viewingShot ? "hidden md:flex" : ""}`}
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
                  ) : shot.status === "failed" ? (
                    <span className="flex h-full items-center justify-center text-lg font-semibold text-red-400">!</span>
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
              <span className="mx-1.5 whitespace-nowrap text-[11px] text-[#c6c9d1] tabular-nums">
                {shotCount} · {s.newestFirst}
              </span>
            )}
          </div>
          )}

          {/* The film dock (canvas page H): the move where the filmstrip was —
              transport and price above, then the start still and a cell per
              beat. The stage stays the stage: orbit, then K keeps the view. */}
          {/* The cast strip in Film (R1): at the stage's foot on a computer, clear of the
              gizmo. A phone's Film is full already (its dock under the setup chips): a
              tap on a thing opens its card there, with what rides. */}
          {wide && filmOpen && !viewingShot && !loadFailed && castShown && !simpleOn && castStrip("absolute bottom-3.5 left-3.5 right-[190px] z-20")}
          {/* Never taller than the stage below the chips' one row (14 px + 32 + 8,
              and its own 14 at the foot): when it must give, the beats' row
              shrinks and scrolls, and the rows above it stay whole. Over the
              page's click-away layer (z-20) while its own menu is open, or a
              tap on a still only shut the menu. */}
          {!wide && filmOpen && (
            <div
              data-film-dock
              className={`absolute bottom-3.5 left-3.5 right-3.5 ${menu === "filmStart" ? "z-30" : "z-10"} flex max-h-[calc(100%-68px)] flex-col gap-2 rounded-[14px] border border-[rgba(255,255,255,0.08)] bg-black/40 p-2 backdrop-blur ${viewingShot ? "hidden md:flex" : ""}`}
            >
              {/* the stage's keys, above the dock (canvas pages H and I); a touch has neither hover nor keys */}
              <span className="pointer-events-none absolute bottom-full left-0 mb-2 hidden max-w-full rounded-[12px] border border-onmedia/10 bg-black/60 px-3 py-1 text-[11px] leading-4 text-onmedia/80 md:pointer-fine:block">
                {rigOpen ? s.filmHintMoves : s.filmHint}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void playMove()}
                  disabled={!ready || previz || film.beats.length === 0}
                  className={chip(false)}
                >
                  ▶ {s.filmPlayMove}
                </button>
                {rehearsalControls("contents", false)}
                <span className="whitespace-nowrap text-[11px] text-[#c6c9d1] tabular-nums">
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
                {reelReady && (
                  <button type="button" onClick={() => void downloadFilm()} disabled={filmFileBusy} className={chip(false)}>
                    {filmFileBusy ? s.filmDownloading : `↓ ${s.filmDownload}`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void renderFilm()}
                  disabled={Boolean(filmBusy)}
                  title={filmRenderWhy ?? undefined}
                  className="inline-flex h-8 cursor-pointer items-center justify-center rounded-[8px] bg-[#e0a468] px-3.5 text-xs font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:bg-[#2a2b33] disabled:text-[#c6c9d1] disabled:opacity-100"
                >
                  {filmRenderLabel}
                </button>
              </div>
              <div className="flex items-stretch gap-2 overflow-x-auto">
                {/* Not a box of its own: the menu hangs from the dock, since this
                    row scrolls and cut it off above the tile, unseen (2026-09-22). */}
                <div className="flex-shrink-0">
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
                      className={`${DMENU_BASE} left-2 top-2`}
                      style={{ maxHeight: "calc(100% - 16px)" }}
                    >
                      {filmStartMenuItems}
                    </div>
                  )}
                </div>
                {film.beats.map((b, i) => (
                  <div
                    key={i}
                    className={`flex min-h-fit min-w-[210px] max-w-[280px] flex-1 flex-col gap-1.5 rounded-[10px] bg-[rgba(255,255,255,0.04)] p-2 ring-1 ${
                      filmSel === i ? "ring-[#e0a468]" : "ring-[rgba(255,255,255,0.08)]"
                    }`}
                  >
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.07em] text-[#9aa0ad]">
                      <button type="button" onClick={() => filmGoTo(i)} className="cursor-pointer whitespace-nowrap hover:text-[#e0a468]">
                        {formatMsg(s.filmBeatLabel, { n: i + 1 })}
                      </button>
                      <span className="whitespace-nowrap normal-case tabular-nums">
                        {formatMsg(s.takeSeconds, { s: SET_TAKE_ENGINES[film.engine].seconds })}
                      </span>
                      {b.move && (
                        <span
                          title={s.rig.moves[b.move]}
                          className="min-w-0 truncate whitespace-nowrap rounded-[4px] bg-[rgba(224,164,104,0.14)] px-1.5 text-[10px] font-semibold normal-case tracking-[0.02em] text-[#f0cda6]"
                        >
                          {s.rig.moves[b.move]}
                        </span>
                      )}
                      {filmBusy?.beat === i ? (
                        <span className="whitespace-nowrap normal-case text-[#e0a468]">{filmBusy.following === "checking" ? s.filmBeatCheckingShort : filmBusy.following ? s.filmBeatFollowingShort : filmBusy.clipOnly ? s.filmBeatClip : s.filmBeatStill}</span>
                      ) : filmClipShots[i] ? (
                        <span
                          className={`whitespace-nowrap normal-case ${
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
                        onClick={() => filmSetBeatEnd(i)}
                        disabled={Boolean(filmBusy) || previz || !ready}
                        aria-label={formatMsg(s.filmSetEnd, { n: i + 1 })}
                        title={formatMsg(s.filmSetEnd, { n: i + 1 })}
                        className="flex-shrink-0 cursor-pointer hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#9aa0ad] disabled:opacity-100"
                      >
                        {/* a viewfinder: this view, as the beat's end */}
                        <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" className="h-3.5 w-3.5" aria-hidden>
                          <path d="M2 5V2h3M11 2h3v3M14 11v3h-3M5 14H2v-3" />
                          <circle cx="8" cy="8" r="1.4" />
                        </svg>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          editFilm((f) => ({ ...f, beats: f.beats.filter((_, j) => j !== i) }));
                          setFilmSel(null);
                        }}
                        disabled={Boolean(filmBusy)}
                        aria-label={formatMsg(s.filmRemoveBeat, { n: i + 1 })}
                        title={formatMsg(s.filmRemoveBeat, { n: i + 1 })}
                        className="flex-shrink-0 cursor-pointer hover:text-[#ecedf1] disabled:cursor-default disabled:text-[#9aa0ad] disabled:opacity-100"
                      >
                        ×
                      </button>
                    </div>
                    {filmJumps[i] && (
                      <p data-film-jump className="text-[10.5px] leading-snug text-[#e0a468]">
                        {formatMsg(s.filmBeatJumps, { n: i + 1 })}
                      </p>
                    )}
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
                      className="h-7 rounded-[6px] bg-black/40 px-2 text-xs text-[#ecedf1] ring-1 ring-[rgba(255,255,255,0.08)] placeholder:text-[#565a64] focus:outline-none focus:ring-[#e0a468]/60"
                    />
                    {/* The people and sun tracks (cut 5): where the figure stands, and the hour, at this beat's end. */}
                    <div className="flex flex-wrap items-center gap-1 pt-1">
                      <button
                        type="button"
                        disabled={Boolean(filmBusy)}
                        onClick={() =>
                          editFilm((f) => ({
                            ...f,
                            beats: f.beats.map((bb, j) => (j === i ? { ...bb, figure: bb.figure ? null : { x: mark.x, z: mark.z, facingDeg: mark.facingDeg, pose } } : bb)),
                          }))
                        }
                        title={b.figure ? s.filmFigureClear : s.filmFigureHere}
                        className={chip(Boolean(b.figure))}
                      >
                        {b.figure ? formatMsg(s.filmFigureSet, { pose: s.poses[b.figure.pose], x: b.figure.x.toFixed(1), z: b.figure.z.toFixed(1) }) : s.filmFigureHere}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(filmBusy)}
                        onClick={() =>
                          editFilm((f) => ({
                            ...f,
                            beats: f.beats.map((bb, j) => (j === i ? { ...bb, time: bb.time !== null ? null : (rig.time ?? 12) } : bb)),
                          }))
                        }
                        title={b.time !== null ? s.filmHourClear : s.filmHourHere}
                        className={chip(b.time !== null)}
                      >
                        {formatMsg(s.filmHourSet, { h: b.time !== null ? timeLabel(b.time) : rig.time !== null ? timeLabel(rig.time) : s.filmHourAsBuilt })}
                      </button>
                    </div>
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
              {!takesOn && <p className="px-1 text-xs text-[#c6c9d1]">{localizeServerText(SET_TAKE_NEEDS_PLAN, t)}</p>}
              {filmError && <p className="px-1 text-xs text-red-400">{localizeServerText(filmError, t)}</p>}
            </div>
          )}

          {/* A photo set: the photo beside camera 1, where the photographer stood */}
          {sourcePhotoUrl && compareOpen && (
            <div className={`absolute bottom-[104px] left-3.5 z-20 w-[min(640px,80%)] space-y-2.5 rounded-[14px] p-3.5 ${PANEL_BG}`}>
              <div className="flex items-center justify-between">
                <h2 className="text-[11px] font-medium uppercase tracking-widest text-[#c6c9d1]">{s.compareTitle}</h2>
                <button
                  type="button"
                  onClick={() => setCompareOpen(false)}
                  aria-label={t.common.dismiss}
                  title={t.common.dismiss}
                  className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full text-sm text-[#d6d9e0] hover:text-[#ecedf1]"
                >
                  ×
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <figure className="space-y-1.5">
                  <div className="overflow-hidden rounded-media border border-[rgba(255,255,255,0.1)] bg-black/60" style={{ aspectRatio: photoAspect ?? 4 / 3 }}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img ref={readPhotoShape} src={sourcePhotoUrl} alt={s.comparePhoto} onLoad={(e) => readPhotoShape(e.currentTarget)} className="h-full w-full object-cover" />
                  </div>
                  <figcaption className="text-xs text-[#c6c9d1]">{s.comparePhoto}</figcaption>
                </figure>
                <figure className="space-y-1.5">
                  <div className="overflow-hidden rounded-media border border-[rgba(255,255,255,0.1)] bg-black/60" style={{ aspectRatio: photoAspect ?? 4 / 3 }}>
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
                  <figcaption className="text-xs text-[#c6c9d1]">{formatMsg(s.cameraN, { n: 1 })}</figcaption>
                </figure>
              </div>
              <p className="text-[11px] text-[#9aa0ad]">{s.compareNote}</p>
            </div>
          )}
        </div>

        {/* The sequencer (canvas page J, board J1; cut B): the timeline under the viewport while the film is open. */}
        {wide && filmOpen && (
          <Sequencer
            s={s}
            film={film}
            jumps={filmJumps}
            jumpNote={
              filmPersonOther
                ? formatMsg(s.filmPersonOther, { name: filmPersonOther })
                : filmLookNoneShown
                  ? s.filmLookNone
                  : filmJumps.indexOf(true) >= 0
                    ? formatMsg(s.filmBeatJumps, { n: filmJumps.indexOf(true) + 1 })
                    : null
            }
            selected={filmSel}
            playhead={playhead}
            playing={previz || reel !== null}
            ready={ready}
            busy={filmBusy}
            clipStatus={filmClipShots.map((sh) => sh?.status ?? null)}
            rigTime={rig.time}
            sensorHeightMm={sensorHeightMm(rig.sensor, rig.format)}
            light={rig.light ? s.rig.lights[rig.light.scheme] : null}
            startLabel={filmStartShot ? formatMsg(s.stillTile, { n: stillNumber(filmStartShot) }) : null}
            startImage={filmStartShot?.resultUrl ?? null}
            startMenu={
              <div role="listbox" aria-label={s.filmStarts} className={DMENU}>
                {filmStartMenuItems}
              </div>
            }
            startOpen={menu === "filmStart"}
            startDisabled={Boolean(filmBusy)}
            onStartMenu={() => toggleMenu("filmStart")}
            poseName={(pz) => s.poses[pz]}
            figureNote={(i) => {
              // The walk and the eye-line of a beat (cut D), after its pose and place.
              const b = film.beats[i];
              if (!b?.figure) return "";
              const parts: string[] = [];
              if (b.path.length) {
                const from = i > 0 && film.beats[i - 1].figure ? film.beats[i - 1].figure! : mark;
                parts.push(formatMsg(s.studio.pathWalks, { d: pathLength(from, b.path, b.figure), n: b.path.length }));
              }
              if (b.gaze) {
                parts.push(
                  b.gaze.at === "camera"
                    ? s.studio.lookAtCamera
                    : b.gaze.at === "object"
                      ? formatMsg(s.studio.lookAtThing, { thing: spec.objects[b.gaze.index] ? names.objectName(spec.objects[b.gaze.index]) : "" })
                      : s.studio.lookAtPoint,
                );
              }
              return parts.length ? ` · ${parts.join(" · ")}` : "";
            }}
            onSelect={filmGoTo}
            onSeek={filmSeek}
            onPlay={() => void playMove()}
            onStop={stopPlayback}
            onToStart={filmToStart}
            onToEnd={filmToEnd}
            onPlayTake={(i) => {
              reelFailedRef.current = new Set();
              setReelWaiting(false);
              setReel(i);
            }}
            onAddKeyframe={filmAddKeyframe}
            onShotList={() => setDockTab("film")}
            engine={film.engine}
            onEngine={(e) => editFilm((f) => ({ ...f, engine: e }))}
            engineDisabled={Boolean(filmBusy)}
            reelReady={reelReady}
            onPlayFilm={() => {
              reelFailedRef.current = new Set();
              setReelWaiting(false);
              setReel(0);
            }}
            onDownload={() => void downloadFilm()}
            downloading={filmFileBusy}
            renderLabel={filmRenderLabel}
            onRender={() => void renderFilm()}
            renderDisabled={Boolean(filmBusy)}
            renderWhy={filmRenderWhy}
            hint={s.filmHint}
            note={filmRenderWhy}
            error={filmError ? localizeServerText(filmError, t) : null}
          />
        )}

        {/* The cut (cut C): the film's clips in order, under the viewport, where the reel plays. */}
        {cutOpen && (
          <div data-cut className="flex flex-none flex-col gap-2 border-t border-[rgba(255,255,255,0.07)] bg-[#191a20] px-3 py-2.5 text-[#d6d9e0]">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[#c6c9d1]">{s.studio.cutTitle}</span>
              <span className="text-[11.5px] tabular-nums text-[#9aa0ad]">{formatMsg(s.studio.cutLine, { n: film.beats.length, s: filmSeconds(film) })}</span>
              <span className="flex-1" />
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
              {reelReady && (
                <button type="button" onClick={() => void downloadFilm()} disabled={filmFileBusy} className={chip(false)}>
                  {filmFileBusy ? s.filmDownloading : `↓ ${s.filmDownload}`}
                </button>
              )}
              {!reelReady && film.beats.length > 0 && (
                <button
                  type="button"
                  onClick={() => void renderFilm()}
                  disabled={Boolean(filmBusy)}
                  title={filmRenderWhy ?? undefined}
                  className="inline-flex h-7 cursor-pointer items-center justify-center rounded-[6px] bg-[#e0a468] px-3 text-[11.5px] font-semibold text-[#1b1c20] hover:opacity-90 disabled:cursor-default disabled:bg-[#2a2b33] disabled:text-[#c6c9d1] disabled:opacity-100"
                >
                  {filmRenderLabel}
                </button>
              )}
            </div>
            {film.beats.length === 0 ? (
              <p className="text-[11.5px] text-[#9aa0ad]">{s.studio.cutEmpty}</p>
            ) : (
              <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
                <div className="flex w-[104px] flex-none flex-col gap-1">
                  <div className="relative h-[58px] overflow-hidden rounded-[8px] bg-black/50 ring-1 ring-[rgba(255,255,255,0.08)]">
                    {filmStartShot?.resultUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={filmStartShot.resultUrl} alt="" className="h-full w-full object-cover" />
                    )}
                  </div>
                  <span className="truncate text-[10px] font-semibold uppercase tracking-[0.06em] text-[#c6c9d1]">{s.studio.cutStart}</span>
                </div>
                {film.beats.map((b, i) => {
                  const clip = filmClipShots[i];
                  const endId = film.ends[i];
                  const end = endId ? (shots.find((sh) => sh.generationId === endId) ?? null) : null;
                  const done = clip?.status === "succeeded" && Boolean(clip.resultUrl);
                  return (
                    <Fragment key={i}>
                      <button
                        type="button"
                        data-cut-clip={done ? "done" : clip ? clip.status : "missing"}
                        onClick={() => {
                          if (done) {
                            reelFailedRef.current = new Set();
                            setReelWaiting(false);
                            setReel(i);
                          } else filmGoTo(i);
                        }}
                        className={`flex w-[168px] flex-none cursor-pointer flex-col gap-1 rounded-[8px] text-left ring-1 ${filmSel === i ? "ring-[#e0a468]" : "ring-transparent"}`}
                      >
                        <div className="relative h-[58px] overflow-hidden rounded-[8px] bg-black/50 ring-1 ring-[rgba(255,255,255,0.08)]">
                          {clip?.posterUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={clip.posterUrl} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <span className="absolute inset-0 flex items-center justify-center text-[11px] text-[#9aa0ad]">{clip ? "…" : "—"}</span>
                          )}
                          {done && <span className="absolute bottom-1 left-1 rounded-[3px] bg-black/60 px-1 text-[10px] text-[#fff]">▶</span>}
                        </div>
                        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-[#c6c9d1]">
                          <span className="truncate">{formatMsg(s.studio.cutClip, { n: i + 1, s: SET_TAKE_ENGINES[film.engine].seconds })}</span>
                          <span className={`normal-case tracking-normal ${done ? "text-[#5f9e6e]" : clip?.status === "failed" ? "text-red-400" : "text-[#9aa0ad]"}`}>
                            {done ? s.filmBeatDone : clip?.status === "failed" ? s.filmBeatClipFailed : clip ? s.filmBeatClip : s.studio.cutMissing}
                          </span>
                        </span>
                        {b.move && <span className="truncate text-[10px] text-[#9aa0ad]">{s.rig.moves[b.move]}</span>}
                      </button>
                      {end?.resultUrl && (
                        <div className="flex w-[64px] flex-none flex-col gap-1" title={formatMsg(s.studio.cutEnd, { n: i + 1 })}>
                          <div className="h-[58px] overflow-hidden rounded-[8px] bg-black/50 ring-1 ring-[rgba(255,255,255,0.08)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={end.resultUrl} alt="" className="h-full w-full object-cover" />
                          </div>
                          <span className="truncate text-[10px] text-[#9aa0ad]">{formatMsg(s.studio.cutEnd, { n: i + 1 })}</span>
                        </div>
                      )}
                    </Fragment>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* On a phone the rig is its own panel over the stage (canvas page I); on the frame it is the dock's departments. */}
        {!wide && rigOpen && rigPanel(null)}
        {/* A thing's card on a phone: a sheet over the stage (R1). */}
        {!wide && elementCardView("sheet")}

        {/* On a phone the conversation sits under the stage; on the frame it is the dock's Astra tab, with the composer at the dock's foot. */}
        {/* Folded (Helios Cut 3, step 2), the thread goes and the header and the words box
            stay, so the priced send is always on screen; the folded panel does not clip, so
            the composer's "/" and @ menus still open upward over the stage. */}
        {!wide && (
          <aside
            className={`z-30 flex min-h-0 flex-none flex-col ${chatOpen ? "h-[42%] overflow-hidden" : "overflow-visible"} border-t border-[rgba(255,255,255,0.11)] bg-[#16171c] ${PANEL_BG} border-x-0 border-b-0 shadow-none`}
          >
            {chatHeader}
            {chatOpen && tipsShown && <div className="flex-none px-3.5 pt-3">{firstVisitView("w-full")}</div>}
            {chatOpen && chatThread}
            {chatComposer}
          </aside>
        )}
      </div>

        {wide && simpleOn && !cutOpen && stepPanelView()}
        {wide && !(simpleOn && !cutOpen) && (
          <StudioDock
            label={s.studio.dockLabel}
            tabs={dockTabs}
            names={s.studio.dock}
            tab={dockTab}
            onTab={setDockTab}
            foot={
              <>
                {/* A press being followed says so here too, whichever tab is open (review, 2026-09-25). */}
                {following && dockTab !== "astra" && (
                  <p className="border-t border-[rgba(255,255,255,0.07)] px-3.5 py-2 text-[12px] text-[#c6c9d1]" aria-live="polite" data-press-following>
                    {followingLine}
                  </p>
                )}
                {dockTab !== "astra" && (error || rigError) && (
                  <p className="border-t border-[rgba(255,255,255,0.07)] px-3.5 py-2 text-[12px] text-red-400">{localizeServerText(error || rigError, t)}</p>
                )}
                {chatComposer}
              </>
            }
          >
            {dockTab === "scene" && (
              <div className="flex flex-col">
                {elementCardView("dock")}
                <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.07)] px-3 py-2">
                  <input
                    value={sceneQuery}
                    onChange={(e) => setSceneQuery(e.target.value)}
                    placeholder={s.editorFind}
                    aria-label={s.editorFind}
                    className="h-6 min-w-0 flex-1 rounded-[5px] bg-[#111217] px-2 text-[11px] text-[#ecedf1] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)] outline-none placeholder:text-[#9aa0ad] focus:shadow-[inset_0_0_0_1px_rgba(224,164,104,0.6)]"
                  />
                  <span className="text-[11px] tabular-nums text-[#9aa0ad]">{spec.objects.length}</span>
                </div>
                <p className="px-3 pt-2 text-[11px] leading-snug text-[#9aa0ad]">{s.studio.sceneHint}</p>
                <SceneTree spec={spec} s={s} selected={null} query={sceneQuery} onPick={pickSceneTarget} />
              </div>
            )}
            {dockTab === "film" && filmBeatView()}
            {(dockTab === "camera" || dockTab === "light" || dockTab === "look" || dockTab === "film") && rigPanel(dockTab)}
            {dockTab === "history" && (
              <div className="p-2">
                <div className="flex h-6 items-center px-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[#9aa0ad]">{s.studio.historyFrames}</div>
                {revisions.length < 2 ? (
                  <p className="px-1 py-1 text-[11px] leading-snug text-[#9aa0ad]">{s.studio.historyEmpty}</p>
                ) : (
                  <div role="listbox" aria-label={s.historyLabel} className="flex flex-col gap-0.5">
                    {historyOptions}
                  </div>
                )}
              </div>
            )}
            {dockTab === "astra" && chatThread}
          </StudioDock>
        )}
      </div>

      {wide && (
        <StudioStatus>
          <span className="tabular-nums">
            {spec.objects.length === 1 ? s.studio.status.thingsOne : formatMsg(s.studio.status.things, { n: spec.objects.length })} ·{" "}
            {formatMsg(s.studio.status.shapes, { n: specInstanceCount(spec), max: SET_LIMITS.maxInstances })}
            {fps > 0 ? ` · ${formatMsg(s.studio.status.fps, { n: fps })}` : ""}
          </span>
          <span className="hidden xl:inline">{s.rig.saved}</span>
          <span className="flex-1" />
          <StatusList label={s.studio.status.held} items={heldItems} none={s.studio.status.none} className="hidden lg:inline" />
          <StatusList label={s.studio.status.checked} items={checkedItems} none={s.studio.status.none} className="hidden lg:inline" />
          <StatusList label={s.studio.status.lab} items={labItems} none={s.studio.status.none} className="hidden xl:inline" />
        </StudioStatus>
      )}
    </div>
  );
}
