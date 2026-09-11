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
  "const built = buildSetScene(THREE, spec, { shadows: !coarse });",
  "if (built.background) scene.background = built.background;",
  "if (built.fog) scene.fog = built.fog;",
  'const ACCENT = "#c8923a";',
  "const standIn = buildStandIn(THREE, ACCENT);",
  "placeStandIn(standIn, layoutRef.current.mark);",
  "const camera = new THREE.PerspectiveCamera(startPose.fovDeg, 1, 0.05, built.farPlane);",
  // the lift, measured without the figure
  "standIn.group.visible = false;",
  "lift = liftSet(THREE, renderer, scene, spec, built.farPlane);",
  "standIn.group.visible = true;",
  "lifted: lift.fill > 1 || lift.exposure > BASE_EXPOSURE,",
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
  "const frame = apiRef.current?.snapshot(SET_FRAME_PX);",
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

export type ViewerParity = { ok: boolean; missing: string[]; file: string };

export function checkViewerParity(repoRoot: string, o: { photo?: boolean } = {}): ViewerParity {
  const file = "src/components/sets/set-view.tsx";
  const lines = new Set(
    readFileSync(join(repoRoot, file), "utf8")
      .split("\n")
      .map((l) => l.trim()),
  );
  const missing = [...MIRRORED_LINES, ...(o.photo ? MIRRORED_PHOTO_LINES : [])].filter((l) => !lines.has(l));
  return { ok: missing.length === 0, missing, file };
}
