// The snapshot page (snap-page.html) mirrors how the product's viewer,
// src/components/sets/set-view.tsx, draws a set and takes its snapshots. It
// cannot import that component (React, a WebGL canvas, server actions), so
// at run start this checks that every line the mirror depends on is still
// in set-view.tsx. A missing line means the product changed how it draws:
// the run refuses unless --accept-drift, which the manifest records.
//
// A runtime check, not a suite test, on purpose: a product commit must
// never be blocked by the eval.

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Lines of set-view.tsx the mirror depends on, compared trimmed. */
export const MIRRORED_LINES = [
  // the renderer
  "const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });",
  "renderer.outputColorSpace = THREE.SRGBColorSpace;",
  "renderer.toneMapping = THREE.ACESFilmicToneMapping;",
  "renderer.toneMappingExposure = BASE_EXPOSURE;",
  "renderer.shadowMap.enabled = !coarse;",
  "renderer.shadowMap.type = THREE.PCFShadowMap;",
  // the scene and the stand-in
  "const stageOpts = { shadows: !coarse, quality, textures, sky: pmrem ? { Sky, pmrem } : null };",
  "const built = buildSetScene(THREE, spec, stageOpts);",
  "if (built.background) scene.background = built.background;",
  "if (built.fog) scene.fog = built.fog;",
  'const ACCENT = "#c8923a";',
  "const standIn = buildStandIn(THREE, ACCENT, undefined, layoutRef.current.pose);",
  "const eyeY = () => STAND_IN_EYE_M[standPose];",
  "placeStandIn(standIn, layoutRef.current.mark);",
  "const camera = new THREE.PerspectiveCamera(startPose.fovDeg, 1, 0.05, built.farPlane);",
  // The SKETCH and its own lift (2026-09-17): what the picture model is sent
  // is not the stage the person turns but the flat grey sketch, drawn at the
  // sketch's own lift — measured on the sketch, without the figure, and
  // measured again whenever the stage is rebuilt (2026-09-18).
  "standIn.group.visible = false;",
  "sketchStage(scene, built.root, true);",
  "sketchLift = liftSet(THREE, renderer, scene, forSpec, farPlane);",
  "sketchStage(scene, built.root, false);",
  "lift = liftSet(THREE, renderer, scene, forSpec, farPlane);",
  "standIn.group.visible = true;",
  "lifted: sketchLift.fill > 1 || sketchLift.exposure > BASE_EXPOSURE,",
  // a snapshot
  "standIn.helpers.visible = false;",
  "if (opts?.hideFigure) standIn.figure.visible = false;",
  "cam.lookAt(new THREE.Vector3(...opts.from.target));",
  "const side = Math.min(src.width, src.height);",
  "ctx.drawImage(src, (src.width - side) / 2, (src.height - side) / 2, side, side, 0, 0, px, px);",
  'return out.toDataURL("image/jpeg", 0.9);',
  // which snapshots: the card (first camera, no figure) and a shot's frame
  "const first = spec.cameras[0];",
  "const thumb = apiRef.current?.snapshot(SET_THUMB_PX, {",
  "hideFigure: true,",
  "from: { position: first.position, target: first.target, fovDeg: first.fovDeg },",
  // A shot's frame (2026-09-15, Helios Cinema): rendered by frame() at the
  // rig format's own size with the pose's field of view across its height.
  // For the square — the only format the eval shoots — that is a 1024² view
  // at the pose's vertical field of view: exactly the old centre square of a
  // landscape canvas, which is what the snapshot page still draws.
  "const frame = apiRef.current?.frame();",
  "const cam = new THREE.PerspectiveCamera(from.fovDeg, fr.renderW / fr.renderH, camera.near, camera.far);",
  "cam.lookAt(new THREE.Vector3(...from.target));",
] as const;

/** What B's photo arm also mirrors: camera 1 drawn at the photo's shape, beside the photo. */
export const MIRRORED_PHOTO_LINES = [
  "opts?.from && opts.aspect ? compareCrop(renderer.domElement.width, renderer.domElement.height, opts.aspect) : null;",
  "cam.fov = crop ? widenFovDeg(opts.from.fovDeg, crop.fovScale) : opts.from.fovDeg;",
  "url = crop ? cropRect(crop, px) : cropSquare(px);",
  "const size = compareOutputSize(crop.sw, crop.sh, px);",
  "ctx.drawImage(src, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, size.width, size.height);",
  "const shot = apiRef.current?.snapshot(SET_COMPARE_PX, {",
  "aspect: photoAspect,",
  "setPhotoAspect(img.naturalWidth / img.naturalHeight);",
] as const;

/**
 * What E mirrors (lib/match-pose.mts): a fresh set's stage — the first
 * camera in hand, the figure on the first mark — solving a read into a pose
 * and placing it against the set as built, the orbit's reach it places it
 * with, and the pose the page's line is said from. The figure's eye height
 * is one of the base lines above (2026-09-18: it is the POSE's eye, not the
 * constant this once mirrored).
 */
export const MIRRORED_MATCH_LINES = [
  "position: spec.cameras[0].position,",
  "target: spec.cameras[0].target,",
  "fovDeg: spec.cameras[0].fovDeg,",
  "const startMarkId = initialLayout?.markId ?? spec.marks[0].id;",
  "controls.maxDistance = Math.max(spec.bounds.x, spec.bounds.z) * 1.2 + 10;",
  "const solved = solveMatchPose(res.match, {",
  "mark: layoutRef.current.mark,",
  "current: api.pose(),",
  "referenceAspect: prepared.width / prepared.height,",
  "canvasAspect: api.canvasAspect(),",
  "const moved = api.matchTo(solved.pose);",
  "const placed = placeMatchedCamera(THREE, built.root, pose, {",
  "mark: { x: p.x, z: p.z, facingDeg: layoutRef.current.mark.facingDeg },",
  "eyeY: eyeY(),",
  "maxDistance: controls.maxDistance,",
  "camera.position.set(...placed.position);",
  "controls.target.set(...placed.target);",
  // The lens the pose carries (2026-09-15): the stage keeps it apart from the
  // canvas camera's own, widened field of view (set-view.tsx fit).
  "poseFov = pose.fovDeg;",
  "const r = (n: number) => Math.round(n * 1000) / 1000;",
  "position: [r(camera.position.x), r(camera.position.y), r(camera.position.z)],",
  "fovDeg: Math.round(poseFov * 100) / 100,",
  "setMatched({ photo: prepared.dataUri, summary: matchSummary(res.match, solved, api.pose()), moved });",
] as const;

export type ViewerParity = { ok: boolean; missing: string[]; file: string };

export function checkViewerParity(repoRoot: string, o: { photo?: boolean; match?: boolean } = {}): ViewerParity {
  const file = "src/components/sets/set-view.tsx";
  const lines = new Set(
    readFileSync(join(repoRoot, file), "utf8")
      .split("\n")
      .map((l) => l.trim()),
  );
  const missing = [...MIRRORED_LINES, ...(o.photo ? MIRRORED_PHOTO_LINES : []), ...(o.match ? MIRRORED_MATCH_LINES : [])].filter((l) => !lines.has(l));
  return { ok: missing.length === 0, missing, file };
}
