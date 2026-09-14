"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { LocalDate } from "@/components/local-date";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { quoteSend } from "@/lib/generations/quote";
import { isStaleDeployError } from "@/lib/stale-deploy";
import { saveSetLayout, saveSetThumbnail, shootInSet } from "@/lib/sets/actions";
import { editSetWithAstra } from "@/lib/sets/editor-actions";
import { matchSetShot } from "@/lib/sets/match-actions";
import { readShotWords } from "@/lib/sets/words-actions";
import { LENSES_MM, fovForLens, nearestLens } from "@/lib/sets/build-scene";
import { clearMarks } from "@/lib/sets/marks";
import { compareCrop, compareOutputSize, widenFovDeg, type CompareCrop } from "@/lib/sets/compare";
import { canBeLook, newestLook } from "@/lib/sets/look";
import { matchSummary, placeMatchedCamera, solveMatchPose, type CameraMove, type MatchClamp } from "@/lib/sets/match-shot";
import { SET_PHOTO_UNREADABLE } from "@/lib/sets/messages";
import { preparePhoto } from "@/lib/sets/photo-client";
import { facingFor, hasCameraWords, wordsToMatch, type ShotWords } from "@/lib/sets/shot-words";
import {
  SET_COMPARE_PX,
  SET_FRAME_PX,
  SET_MAX_TILT_DOWN_DEG,
  SET_MAX_TILT_UP_DEG,
  SET_THUMB_PX,
} from "@/lib/sets/set-config";
import type { SetLayout, SetSpec, Vec3 } from "@/lib/sets/set-spec";
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
  /** Width ÷ height of the canvas the still's centre square is cut from. */
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

type MenuId = "camera" | "lens" | "figure" | "history" | "mode" | "who";

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
/** A menu opened downward from a chip, dark. */
const DMENU =
  "absolute left-0 top-full z-40 mt-2 flex max-h-80 min-w-[11rem] flex-col gap-0.5 overflow-y-auto rounded-[12px] border border-white/[0.11] bg-[#1d1e24] p-1.5 shadow-[0_24px_48px_-12px_rgba(0,0,0,0.6)]";
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
}) {
  const { t, locale } = useLocale();
  const s = t.sets;

  // The set as drawn NOW: the working copy the page opened with, replaced
  // whole when an Astra edit lands from the conversation (send → editSet).
  // Everything below reads this, so the frame card, the marks and the
  // camera menus follow the edit; the engine swaps its scene via
  // api.rebuild and keeps its own initial bounds for the drag clamps.
  const [spec, setSpec] = useState<SetSpec>(initialSpec);

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
        const { buildSetScene, buildStandIn, placeStandIn } = await import("@/lib/sets/build-scene");
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
        const fit = () => {
          const w = host.clientWidth;
          const h = host.clientHeight;
          if (w === lastW && h === lastH) return;
          lastW = w;
          lastH = h;
          renderer.setSize(w, h, false);
          camera.aspect = w / Math.max(1, h);
          camera.updateProjectionMatrix();
          // The frame guide: the square the still will be, centred.
          const side = Math.min(w, h);
          const g = guideRef.current;
          if (g) {
            g.style.width = `${side}px`;
            g.style.height = `${side}px`;
            g.style.left = `${(w - side) / 2}px`;
            g.style.top = `${(h - side) / 2}px`;
          }
        };
        const loop = () => {
          raf = requestAnimationFrame(loop);
          fit();
          controls.update();
          if (camera.position.y < 0.1) camera.position.y = 0.1;
          renderer.render(scene, camera);
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
            camera.fov = pose.fovDeg;
            camera.updateProjectionMatrix();
            controls.update();
          },
          setFov(f) {
            camera.fov = f;
            camera.updateProjectionMatrix();
          },
          placeMark(m) {
            placeStandIn(standIn, m);
          },
          pose() {
            const r = (n: number) => Math.round(n * 1000) / 1000;
            return {
              position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],
              target: [r(controls.target.x), r(controls.target.y), r(controls.target.z)],
              fovDeg: Math.round(camera.fov * 100) / 100,
            };
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
            const want = FRAME_HEIGHT_M / 2 / Math.tan((camera.fov * Math.PI) / 360);
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
            camera.fov = pose.fovDeg;
            camera.updateProjectionMatrix();
            controls.update();
            return placed.moved;
          },
          canvasAspect() {
            // What cropSquare cuts the still from.
            const c = renderer.domElement;
            return c.width / Math.max(1, c.height);
          },
          rebuild(next) {
            // The new set's things move into the SAME root group, so the
            // matcher (placeMatchedCamera against built.root) never notices;
            // the old build's geometries and materials are freed, and the
            // fresh group's own dispose is kept for the edit after this one.
            const fresh = buildSetScene(THREE, next, { shadows: !coarse });
            disposeLive();
            for (const child of [...fresh.root.children]) built.root.add(child);
            disposeLive = () => fresh.dispose();
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
  async function shoot(directionNow?: string) {
    // Not during a match (pickReference says why): the frame would be taken
    // now, from a camera the match is about to move.
    if (shooting || matching || !characterId || !ready) return;
    setError("");
    setLastMiss(null);
    setLookDropped(false);
    setViewing(null);
    setMenu(null);
    const frame = apiRef.current?.snapshot(SET_FRAME_PX);
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
      score: result.score,
      createdAt: new Date().toISOString(),
      hasLookObjects: result.hasLookObjects,
      words: asked ?? null,
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

  /**
   * Words about the place itself — "make the barriers brick red", "now
   * golden hour" — handed to Astra, which edits the set's data server-side
   * (editor-actions.ts, gated like a build) and hands the revised set back.
   * The stage rebuilds under the camera; the line under the frame says how
   * many pieces changed. The Build editor's tools and Astra's original are
   * one press away for anything by hand.
   */
  async function editSet(message: string) {
    setEditingSet(true);
    const res = await editSetWithAstra(setId, message);
    setEditingSet(false);
    if (res.error !== null) {
      setError(res.error);
      return;
    }
    setSpec(res.spec);
    apiRef.current?.rebuild(res.spec);
    setSetChanged(res.changed);
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
      if (!askFirst) await shoot(message);
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
    if (words.intent === "shoot" || !askFirst) await shoot(words.direction || message);
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

  /** The frame as a picture on disk — 3D Jutsu's static-frame export, for the frame the still would be shot from. */
  function downloadFrame() {
    const shot = apiRef.current?.snapshot(SET_FRAME_PX);
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
  const stillNumber = (shot: SetShot) => shots.length - shots.findIndex((x) => x.generationId === shot.generationId);
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
  const lensOptions = LENSES_MM.map((mm) => (
    <Option
      key={mm}
      active={activeLens === mm}
      hint={mm === 18 ? s.lensWide : mm === 85 ? s.lensPortrait : mm === 135 ? s.lensLong : undefined}
      onPick={() => {
        pickLens(mm);
        setMenu(null);
      }}
    >
      {formatMsg(s.lensMm, { mm })}
    </Option>
  ));
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
      {menu && <div className="fixed inset-0 z-20" onClick={() => setMenu(null)} aria-hidden />}

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
          <span className="flex h-6 items-center rounded-[4px] bg-[#2a2b33] px-3.5 text-[12px] font-medium text-[#e0a468] shadow-[0_1px_2px_rgba(0,0,0,0.3)]">
            {s.editorShootTab}
          </span>
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
            <div role="listbox" aria-label={s.historyLabel} className={`${DMENU} left-auto right-0`}>
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
          <div ref={hostRef} className="absolute inset-0" />
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
            <div className={`absolute left-3.5 top-3.5 z-20 flex flex-wrap items-center gap-2 right-3.5 ${chatOpen ? "md:right-[404px]" : "md:right-24"}`}>
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
              <div className="relative">
                <button type="button" onClick={() => toggleMenu("lens")} aria-haspopup="listbox" aria-expanded={menu === "lens"} disabled={!ready} className={DCHIP}>
                  {lensLabel}
                  <Chevron />
                </button>
                {menu === "lens" && (
                  <div role="listbox" aria-label={s.toolbarLens} className={DMENU}>
                    {lensOptions}
                  </div>
                )}
              </div>
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

          {/* the drag hint, above the filmstrip */}
          {!viewingShot && !loadFailed && (
            <span
              aria-live="polite"
              className="pointer-events-none absolute bottom-[104px] left-3.5 z-10 max-w-[60%] rounded-full border border-onmedia/10 bg-black/60 px-3 py-1 text-[11px] text-onmedia/80"
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

          {/* A still in the stage's place: the stage stays underneath, running. */}
          {viewingShot && (
            <div className="absolute inset-0 z-10 bg-[#101116]">
              {viewingShot.viewUrl || viewingShot.resultUrl ? (
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
                  {formatMsg(s.stillTile, { n: stillNumber(viewingShot) })} · <LocalDate date={viewingShot.createdAt} />
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
                  <Link href={`/app/history/${viewingShot.generationId}`} className={glassBtn}>
                    {s.openTake}
                  </Link>
                </span>
              </div>
            </div>
          )}

          {/* The filmstrip — the workspace's timeline: the frame, then every still, newest first */}
          <div
            className={`absolute bottom-3.5 left-3.5 z-10 flex items-center gap-2 overflow-x-auto rounded-[14px] border border-white/[0.08] bg-black/40 p-1.5 backdrop-blur right-3.5 ${
              chatOpen ? "md:right-[404px]" : "md:right-24"
            } ${viewingShot ? "hidden md:flex" : ""}`}
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
            {shots.map((shot, i) => (
              <button
                key={shot.generationId}
                type="button"
                onClick={() => setViewing(shot.generationId)}
                aria-pressed={viewing === shot.generationId}
                title={formatMsg(s.stillTile, { n: shots.length - i })}
                className={tile(viewing === shot.generationId)}
              >
                {shot.resultUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={shot.resultUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full items-center justify-center text-[10px] text-onmedia/60">{formatMsg(s.stillTile, { n: shots.length - i })}</span>
                )}
                {shot.score !== null && (
                  <span className="absolute left-1 top-1 rounded-full bg-black/60 px-1.5 py-px text-[9px] font-semibold text-onmedia tabular-nums">{shot.score}</span>
                )}
                {shot.generationId === lookShot?.generationId && (
                  <span className="absolute bottom-1 left-1 rounded-full bg-[#e0a468] px-1.5 py-px text-[9px] font-bold uppercase text-black">{s.lookBadge}</span>
                )}
              </button>
            ))}
            {shots.length > 0 && (
              <span className="mx-1.5 whitespace-nowrap text-[11px] text-[#9aa0ad] tabular-nums">
                {shots.length === 1 ? s.shotsOne : formatMsg(s.shotsMany, { n: shots.length })} · {s.newestFirst}
              </span>
            )}
          </div>

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
                    {setChanged === 0 ? s.editorAskNothing : setChanged === 1 ? s.editorAskDoneOne : formatMsg(s.editorAskDone, { n: setChanged })}
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
                          </dd>
                          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rowHappens}</dt>
                          <dd className={direction ? "text-[#ecedf1]" : "text-[#6b6f7a]"}>{direction || "—"}</dd>
                          <dt className="text-[11px] font-medium uppercase tracking-[0.08em] text-[#6b6f7a]">{s.rowCost}</dt>
                          <dd className="text-[#ecedf1] tabular-nums">{formatMsg(s.costLine, { credits })}</dd>
                        </dl>
                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() => void shoot()}
                            disabled={shooting || matching || !characterId || loadFailed || !ready}
                            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-[8px] bg-[#e0a468] px-[18px] text-sm font-semibold text-[#1b1c20] transition-opacity hover:opacity-90 disabled:opacity-40"
                          >
                            {shootLabel}
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
                else void shoot();
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
                <button type="button" onClick={() => setMentionForced(true)} disabled={characters.length === 0} className={chip(false)} title={s.mentionHint}>
                  @ {character?.name || s.characterLabel}
                </button>
                <div className="relative">
                  <button type="button" onClick={() => toggleMenu("mode")} aria-haspopup="listbox" aria-expanded={menu === "mode"} title={s.modeHint} className={chip(justTalk)}>
                    {justTalk ? s.justTalking : askFirst ? s.askBeforeShooting : s.shootWithoutAsking}
                    <Chevron />
                  </button>
                  {menu === "mode" && (
                    <div role="listbox" aria-label={s.modeHint} className={`${DMENU} bottom-full top-auto mb-2 mt-0`}>
                      {modeOptions}
                    </div>
                  )}
                </div>
                <span className="flex h-8 items-center whitespace-nowrap rounded-full bg-white/[0.06] px-3 text-xs text-[#9aa0ad] tabular-nums">
                  {s.engineChip} · {credits}
                </span>
                <span className="flex-1" />
                <button
                  type="submit"
                  disabled={reading || shooting || editingSet || !ready || (!draft.trim() && !characterId)}
                  title={draft.trim() ? s.threadPlaceholder : shootLabel}
                  aria-label={draft.trim() ? s.threadPlaceholder : shootLabel}
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
