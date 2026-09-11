"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "@/lib/i18n/provider";
import { localizeServerText } from "@/lib/i18n/server-text";
import { formatMsg } from "@/lib/i18n/format";
import { quoteSend } from "@/lib/generations/quote";
import { isStaleDeployError } from "@/lib/stale-deploy";
import { saveSetLayout, saveSetThumbnail, shootInSet } from "@/lib/sets/actions";
import { matchSetShot } from "@/lib/sets/match-actions";
import { LENSES_MM, fovForLens, nearestLens } from "@/lib/sets/build-scene";
import { compareCrop, compareOutputSize, widenFovDeg, type CompareCrop } from "@/lib/sets/compare";
import { matchSummary, placeMatchedCamera, solveMatchPose, type CameraMove, type MatchClamp } from "@/lib/sets/match-shot";
import { SET_PHOTO_UNREADABLE } from "@/lib/sets/messages";
import { preparePhoto } from "@/lib/sets/photo-client";
import {
  SET_COMPARE_PX,
  SET_DIRECTION_MAX_CHARS,
  SET_FRAME_PX,
  SET_MAX_TILT_DOWN_DEG,
  SET_MAX_TILT_UP_DEG,
  SET_THUMB_PX,
} from "@/lib/sets/set-config";
import type { SetLayout, SetSpec, Vec3 } from "@/lib/sets/set-spec";
import type { SetCharacter, SetShot } from "@/lib/sets/types";

// A Set, open (Astra Sets, 2026-09-10). The page does three things: show
// the place Astra built, let the person arrange it — where their
// character's stand-in stands and faces, where the camera is, which lens —
// and shoot a still of exactly the square they framed.
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
};

const ACCENT = "#c8923a";
const TURN_STEP = 30;
/** One press of a pan or tilt arrow. */
const AIM_STEP = 5;
// Framing the figure: a full-length shot, a little headroom and floor.
const FRAME_HEIGHT_M = 2.3;
const FRAME_TARGET_Y = 0.95;
const FRAME_EYE_Y = 1.45;
// How far a tilt may go (SET_MAX_TILT_UP_DEG, SET_MAX_TILT_DOWN_DEG) is in
// set-config.ts: a matched shot is held to the same limits. The up limit
// keeps a tilt inside the orbit's maxPolarAngle below.

/** The newest finished still, the look's default. */
function newestStill(shots: SetShot[]): string | null {
  return shots.find((shot) => shot.status === "succeeded" && shot.resultUrl)?.generationId ?? null;
}

export function SetView({
  setId,
  spec,
  initialLayout,
  hasThumb,
  sourcePhotoUrl,
  description,
  characters,
  initialShots,
  identityBar,
  matchOn,
}: {
  setId: string;
  spec: SetSpec;
  initialLayout: SetLayout | null;
  hasThumb: boolean;
  /** A photo set's photo (signed for its owner); null for a set built from words. */
  sourcePhotoUrl: string | null;
  description: string;
  characters: SetCharacter[];
  initialShots: SetShot[];
  identityBar: number;
  /** Whether "Match a shot" is offered (admins, the photo switch on); the action checks again. */
  matchOn: boolean;
}) {
  const { t, locale } = useLocale();
  const s = t.sets;

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
  const [characterId, setCharacterId] = useState(characters[0]?.id ?? "");
  const [direction, setDirection] = useState("");
  const [shooting, setShooting] = useState(false);
  const [error, setError] = useState("");
  const [loadFailed, setLoadFailed] = useState(false);
  // The stage is a dynamic import plus a WebGL context: until it exists,
  // nothing that drives it (camera, lens, mark, shoot) can do what it says.
  const [ready, setReady] = useState(false);
  const [shots, setShots] = useState<SetShot[]>(initialShots);
  const [lastMiss, setLastMiss] = useState<string | null>(null);
  // The look (2026-09-11): the earlier still whose objects and finishes the
  // next shot keeps, so the car is the same car. It follows the newest still
  // until the person picks one or turns it off.
  const [lookId, setLookId] = useState<string | null>(() => newestStill(initialShots));
  // A ref, not state: a shot resolving tens of seconds after it started must
  // read the person's latest choice, not the one from the render it began in
  // (review, 2026-09-11 — turning the look off mid-render was undone).
  const lookPinnedRef = useRef(false);
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
  const layoutRef = useRef({ markId: startMarkId, mark: startMark });
  // The stage calls this when an orbit settles; it points at scheduleSave,
  // which is declared below the stage's effect.
  const settledRef = useRef<(() => void) | null>(null);
  // The arrangement last saved (or loaded). Compared, not counted: effects
  // can run twice for one change (React's development double-invoke), and
  // opening a set is not arranging it.
  const savedMarkRef = useRef(JSON.stringify({ markId: startMarkId, mark: startMark }));

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
          setMark((m) => ({ x: Math.round(p.x * 100) / 100, z: Math.round(p.z * 100) / 100, facingDeg: m.facingDeg }));
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
          built.dispose();
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

  function aimBy(leftDeg: number, upDeg: number) {
    apiRef.current?.aim(leftDeg, upDeg);
    setCameraId(null);
    scheduleSave();
  }

  // Match this shot: the reference is prepared here (upright, at most 2048 px,
  // a JPEG with no metadata — photo-client.ts), its camera is read on the
  // server, and only numbers come back. The camera is placed from them
  // against the figure's mark, the camera and the canvas as they are when
  // the answer lands, and saved like any camera move.
  async function pickReference(file: File | undefined) {
    if (!file || matching || !ready) return;
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

  async function shoot() {
    if (shooting || !characterId || !ready) return;
    setError("");
    setLastMiss(null);
    const frame = apiRef.current?.snapshot(SET_FRAME_PX);
    if (!frame) {
      setError(s.loadFailed);
      return;
    }
    setShooting(true);
    const pose = apiRef.current?.pose() ?? null;
    const shotCharacterId = characterId;
    let result: Awaited<ReturnType<typeof shootInSet>>;
    try {
      result = await shootInSet(setId, {
        frameDataUri: frame,
        characterId: shotCharacterId,
        direction,
        layout: { ...layoutRef.current, camera: pose },
        lifted: apiRef.current?.lifted === true,
        lookGenerationId: lookShot?.generationId ?? null,
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
    setShots((prev) => [
      {
        generationId: result.generationId,
        status: result.succeeded ? "succeeded" : "failed",
        resultUrl: result.resultUrl,
        score: result.score,
        createdAt: new Date().toISOString(),
        characterId: shotCharacterId,
      },
      ...prev,
    ]);
    if (!result.succeeded) setLastMiss(result.generationId);
    else if (result.resultUrl && !lookPinnedRef.current) setLookId(result.generationId);
  }

  const lookShot = shots.find((shot) => shot.generationId === lookId && shot.status === "succeeded" && shot.resultUrl) ?? null;
  const latestStill = newestStill(shots);

  function pickLook(generationId: string | null) {
    setLookId(generationId);
    lookPinnedRef.current = true;
  }
  // The outfit only carries over from a still of the same character, and
  // never over their saved outfit photo, which rides every render.
  const lookCarriesOutfit =
    lookShot?.characterId === characterId && !characters.find((c) => c.id === characterId)?.hasOutfit;

  const chip = (active: boolean) =>
    `cursor-pointer rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:cursor-default disabled:opacity-50 ${
      active
        ? "border-atelier-accent bg-atelier-accent/10 text-atelier-ink"
        : "border-atelier-rule text-atelier-muted hover:text-atelier-ink"
    }`;
  const activeLens = nearestLens(fovDeg);

  return (
    <div className="space-y-6">
      {/* The stage */}
      <div className="space-y-2.5">
        <div className="relative overflow-hidden rounded-media border border-atelier-rule bg-atelier-stage">
          <div ref={hostRef} className="h-[58vh] min-h-[320px] w-full" />
          <div
            ref={guideRef}
            aria-hidden
            className="pointer-events-none absolute rounded-[2px] shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] outline outline-1 outline-white/40"
          />
          <span className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] rounded-full border border-onmedia/10 bg-black/60 px-3 py-1 text-[11px] text-onmedia/80">
            {s.dragHint}
          </span>
          {/* Pan and tilt: turn the camera where it stands. */}
          <div role="group" aria-label={s.aimLabel} className="absolute bottom-3 right-3 grid grid-cols-3 gap-1">
            {(
              [
                [null, [0, AIM_STEP, s.aimUp, "↑"], null],
                [[AIM_STEP, 0, s.aimLeft, "←"], null, [-AIM_STEP, 0, s.aimRight, "→"]],
                [null, [0, -AIM_STEP, s.aimDown, "↓"], null],
              ] as const
            ).flatMap((row, r) =>
              row.map((cell, c) =>
                cell ? (
                  <button
                    key={`${r}${c}`}
                    type="button"
                    onClick={() => aimBy(cell[0], cell[1])}
                    disabled={!ready}
                    aria-label={cell[2]}
                    title={cell[2]}
                    className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-onmedia/10 bg-black/60 text-xs text-onmedia/80 transition-colors hover:text-onmedia disabled:cursor-default disabled:opacity-50"
                  >
                    {cell[3]}
                  </button>
                ) : (
                  <span key={`${r}${c}`} aria-hidden />
                ),
              ),
            )}
          </div>
          {loadFailed && (
            <div className="absolute inset-0 flex items-center justify-center bg-atelier-stage/90 p-6 text-center text-sm text-onmedia/80">
              {s.loadFailed}
            </div>
          )}
        </div>
        <p className="text-xs text-atelier-muted">{s.frameHint}</p>
      </div>

      {/* A photo set: the photo beside camera 1, where the photographer stood */}
      {sourcePhotoUrl && (
        <div className="space-y-2.5">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.compareTitle}</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <figure className="space-y-1.5">
              <div
                className="overflow-hidden rounded-media border border-atelier-rule bg-atelier-stage"
                style={{ aspectRatio: photoAspect ?? 4 / 3 }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={readPhotoShape}
                  src={sourcePhotoUrl}
                  alt={s.comparePhoto}
                  onLoad={(e) => readPhotoShape(e.currentTarget)}
                  className="h-full w-full object-cover"
                />
              </div>
              <figcaption className="text-xs text-atelier-muted">{s.comparePhoto}</figcaption>
            </figure>
            <figure className="space-y-1.5">
              <div
                className="overflow-hidden rounded-media border border-atelier-rule bg-atelier-stage"
                style={{ aspectRatio: photoAspect ?? 4 / 3 }}
              >
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
              <figcaption className="text-xs text-atelier-muted">{formatMsg(s.cameraN, { n: 1 })}</figcaption>
            </figure>
          </div>
          <p className="text-xs text-atelier-muted">{s.compareNote}</p>
        </div>
      )}

      {/* Camera, lens, and the stand-in */}
      <div className="grid gap-4 md:grid-cols-[1fr_auto]">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.cameraLabel}</span>
            {spec.cameras.map((c, i) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={cameraId === c.id}
                onClick={() => pickCamera(c.id)}
                disabled={!ready}
                className={chip(cameraId === c.id)}
              >
                {c.label || formatMsg(s.cameraN, { n: i + 1 })}
              </button>
            ))}
            <span className={`${chip(cameraId === null)} cursor-default`}>{s.freeCamera}</span>
            <button type="button" onClick={frameFigure} disabled={!ready} className={chip(false)}>
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
                <button
                  type="button"
                  onClick={() => matchFileRef.current?.click()}
                  disabled={!ready || matching}
                  className={chip(false)}
                >
                  {s.matchShot}
                </button>
              </>
            )}
          </div>
          {/* Match this shot: the hint, the read in progress, or what it matched. */}
          {matchOn && (
            <div className="space-y-1.5 sm:pl-[4.5rem]">
              {matching ? (
                <p className="text-xs text-atelier-muted" aria-live="polite">
                  {s.matchReading}
                </p>
              ) : matched && matchedLine ? (
                <div className="flex items-start gap-2.5" aria-live="polite">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={matched.photo}
                    alt={s.matchReferenceAlt}
                    className="h-12 w-auto max-w-[5.5rem] shrink-0 rounded-[4px] border border-atelier-rule object-cover"
                  />
                  <div className="min-w-0 flex-1 space-y-0.5 text-xs leading-relaxed">
                    <p className="text-atelier-ink/85">{matchedLine.line}</p>
                    {matchedLine.notes && <p className="text-atelier-muted">{matchedLine.notes}</p>}
                  </div>
                  <button
                    type="button"
                    onClick={() => setMatched(null)}
                    aria-label={t.common.dismiss}
                    title={t.common.dismiss}
                    className="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-full text-sm text-atelier-muted transition-colors hover:text-atelier-ink"
                  >
                    ×
                  </button>
                </div>
              ) : (
                <p className="max-w-2xl text-xs text-atelier-muted">{s.matchHint}</p>
              )}
              {matchError && <p className="text-xs text-red-600">{localizeServerText(matchError, t)}</p>}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.lensLabel}</span>
            {LENSES_MM.map((mm) => (
              <button
                key={mm}
                type="button"
                aria-pressed={activeLens === mm}
                onClick={() => pickLens(mm)}
                disabled={!ready}
                className={`${chip(activeLens === mm)} tabular-nums`}
              >
                {mm} mm
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-16 text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.markLabel}</span>
            {spec.marks.length > 1 &&
              spec.marks.map((m, i) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={markId === m.id}
                  onClick={() => pickMark(m.id)}
                  disabled={!ready}
                  className={chip(markId === m.id)}
                >
                  {m.label || formatMsg(s.markN, { n: i + 1 })}
                </button>
              ))}
            <button type="button" onClick={() => turn(-TURN_STEP)} disabled={!ready} className={chip(false)} aria-label={s.turnLeft} title={s.turnLeft}>
              ↺
            </button>
            <button type="button" onClick={() => turn(TURN_STEP)} disabled={!ready} className={chip(false)} aria-label={s.turnRight} title={s.turnRight}>
              ↻
            </button>
          </div>
        </div>
        <p className="max-w-xs text-xs leading-relaxed text-atelier-muted md:text-right">{s.standInNote}</p>
      </div>

      {description && (
        <div className="border-t border-atelier-rule pt-4">
          <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.descriptionLabel}</h2>
          <p className="mt-1 max-w-3xl text-sm text-atelier-ink/85">{description}</p>
        </div>
      )}

      {/* Shoot */}
      <div className="space-y-3 border-t border-atelier-rule pt-4">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.shootTitle}</h2>
        {characters.length === 0 ? (
          <div className="flex flex-wrap items-center gap-3 text-sm text-atelier-muted">
            <span>{s.noCharacters}</span>
            <Link href="/app/character/new" className="font-medium text-atelier-accent underline underline-offset-2">
              {s.createCharacter}
            </Link>
          </div>
        ) : (
          <>
            <div role="radiogroup" aria-label={s.characterLabel} className="flex flex-wrap gap-2">
              {characters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="radio"
                  aria-checked={characterId === c.id}
                  onClick={() => setCharacterId(c.id)}
                  className={`flex cursor-pointer items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition-colors ${
                    characterId === c.id
                      ? "border-atelier-accent bg-atelier-accent/10 text-atelier-ink"
                      : "border-atelier-rule text-atelier-muted hover:text-atelier-ink"
                  }`}
                >
                  {c.thumbUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={c.thumbUrl} alt="" className="h-6 w-6 rounded-full object-cover" />
                  ) : (
                    <span className="h-6 w-6 rounded-full bg-atelier-rule" />
                  )}
                  {c.name}
                </button>
              ))}
            </div>
            <label className="block">
              <span className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.directionLabel}</span>
              <textarea
                value={direction}
                onChange={(e) => setDirection(e.target.value.slice(0, SET_DIRECTION_MAX_CHARS))}
                rows={2}
                placeholder={s.directionPlaceholder}
                className="mt-1.5 w-full rounded-control border border-atelier-rule bg-transparent px-3 py-2 text-sm text-atelier-ink outline-none transition-colors placeholder:text-atelier-muted/70 focus:border-atelier-accent"
              />
            </label>
            {/* The look: which earlier still this one keeps the objects of. */}
            <div className="flex flex-wrap items-center gap-2 text-xs text-atelier-muted">
              <span className="text-[11px] font-medium uppercase tracking-widest">{s.lookLabel}</span>
              {lookShot?.resultUrl ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={lookShot.resultUrl} alt="" className="h-8 w-8 rounded-[4px] object-cover" />
                  <span className="max-w-md">{lookCarriesOutfit ? s.lookOnSame : s.lookOn}</span>
                  <button type="button" onClick={() => pickLook(null)} className={chip(false)}>
                    {s.lookOff}
                  </button>
                </>
              ) : latestStill ? (
                <>
                  <span>{s.lookOffNote}</span>
                  <button type="button" onClick={() => pickLook(latestStill)} className={chip(false)}>
                    {s.lookUseLatest}
                  </button>
                </>
              ) : (
                <span>{s.lookFirst}</span>
              )}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-3">
              {error && <p className="mr-auto text-sm text-red-600">{localizeServerText(error, t)}</p>}
              <button
                type="button"
                onClick={() => void shoot()}
                disabled={shooting || !characterId || loadFailed || !ready}
                className="cursor-pointer rounded-control bg-atelier-ink px-5 py-2.5 text-sm font-medium text-atelier-paper transition-opacity hover:opacity-90 disabled:opacity-40"
              >
                {shooting
                  ? s.shooting
                  : quote.totalCredits === 1
                    ? s.shootButtonOne
                    : formatMsg(s.shootButton, { n: quote.totalCredits })}
              </button>
            </div>
            {lastMiss && (
              <p className="text-sm text-atelier-muted">
                {s.shotDidNotFinish}{" "}
                <Link href={`/app/history/${lastMiss}`} className="font-medium text-atelier-accent underline underline-offset-2">
                  {s.openTake}
                </Link>
              </p>
            )}
          </>
        )}
      </div>

      {/* Contact sheet */}
      <div className="space-y-3 border-t border-atelier-rule pt-4">
        <h2 className="text-[11px] font-medium uppercase tracking-widest text-atelier-muted">{s.contactSheet}</h2>
        {shots.length === 0 ? (
          <p className="text-xs text-atelier-muted">{s.contactSheetEmpty}</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {shots.map((shot) => {
              const low = shot.score !== null && shot.score < identityBar;
              const canBeLook = shot.status === "succeeded" && Boolean(shot.resultUrl);
              const isLook = canBeLook && shot.generationId === lookShot?.generationId;
              return (
                <div key={shot.generationId} className="relative">
                <Link
                  href={`/app/history/${shot.generationId}`}
                  className="group relative block aspect-square overflow-hidden rounded-media border border-atelier-rule bg-atelier-stage"
                >
                  {shot.resultUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={shot.resultUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="flex h-full items-center justify-center p-3 text-center text-xs text-onmedia/60">
                      {s.openTake}
                    </span>
                  )}
                  <span
                    className={`absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums ${
                      shot.score === null
                        ? "bg-black/60 text-onmedia/80"
                        : low
                          ? "bg-amber-500 text-black"
                          : "bg-black/60 text-onmedia"
                    }`}
                    title={low ? formatMsg(s.identityLow, { bar: identityBar }) : undefined}
                  >
                    {shot.score === null ? s.unscored : formatMsg(s.identityScore, { score: shot.score })}
                  </span>
                </Link>
                {/* Beside the link, not in it: a button inside a link is not a button. */}
                {isLook ? (
                  <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-atelier-accent px-2 py-0.5 text-[10px] font-semibold text-black">
                    {s.lookBadge}
                  </span>
                ) : canBeLook ? (
                  <button
                    type="button"
                    onClick={() => pickLook(shot.generationId)}
                    className="absolute bottom-2 right-2 cursor-pointer rounded-full border border-onmedia/10 bg-black/60 px-2 py-0.5 text-[10px] font-medium text-onmedia/90 transition-colors hover:text-onmedia"
                  >
                    {s.lookUse}
                  </button>
                ) : null}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
