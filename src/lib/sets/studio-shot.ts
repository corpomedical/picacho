import { formatFrame, type FormatFrame, type RigFormat } from "./rig";
import { MOVERS_PER_BEAT, type Placement } from "./movers";

// Helios Studio stage 3 (2026-09-29): "Photo with your character". The
// Studio's shot camera, stand-in and moved things, said the way the set
// page's Shoot says them to shootInSet (actions.ts) — the one paid path for
// a still. Pure: the engine measures the scene and draws the frame; this
// works out what is sent.
//
// The frame is drawn at the rig format's render size (rig.ts formatFrame),
// with the strips outside the band painted dark, exactly as the set page's
// sketch is (set-view.tsx drawSketch). The lens is widened so the BAND shows
// what the Studio's camera frame shows: the Studio frames the format's shape
// with its lens's vertical view, while the render is taller than a wide
// band — so the render's view is the band's, stretched to the render height.
// That widened view is the fov the layout records, as the set page's is
// the view its render was drawn with.

/** The Studio's formats (studio-engine.ts FORMATS) as the rig's: 4:5 has no photo format, so it goes square. */
export const STUDIO_FORMAT_RIG: Readonly<Record<string, RigFormat>> = {
  "16:9 · HD": "wide",
  "2.39:1 · Scope": "scope",
  "9:16 · Vertical": "vertical",
  "1:1 · Square": "square",
  "4:5 · Portrait": "square",
};

/** The rig format a Studio format is shot as; square for anything unknown. */
export function studioRigFormat(label: string): RigFormat {
  return Object.prototype.hasOwnProperty.call(STUDIO_FORMAT_RIG, label) ? STUDIO_FORMAT_RIG[label] : "square";
}

/** The vertical view the render is drawn with so its band shows `fovDeg` top to bottom. */
export function studioRenderFovDeg(fovDeg: number, fr: Pick<FormatFrame, "renderH" | "bandH">): number {
  const half = (fovDeg * Math.PI) / 360;
  return (Math.atan(Math.tan(half) * (fr.renderH / fr.bandH)) * 360) / Math.PI;
}

export type StudioShotScene = {
  /** The Studio's format label (FORMATS). */
  format: string;
  /** The shot camera: where it stands, the way its lens looks (unit), its vertical view, and its focus distance. */
  camera: { position: [number, number, number]; forward: [number, number, number]; fovDeg: number; focusM: number };
  /** The stand-in where the Studio has it now: facingDeg 0 faces +Z, 90 faces +X (build-scene.ts placeStandIn). */
  figure: { x: number; z: number; facingDeg: number };
  /** The set's first mark's id, the one the Studio's stand-in starts on. */
  markId: string | null;
  /** The set's things the Studio moved or turned, where they stand now. */
  moved: Placement[];
};

const r3 = (n: number) => {
  const v = Math.round(n * 1000) / 1000;
  return v === 0 ? 0 : v;
};

/** What shootInSet is sent for a Studio frame (with the frame, the character and the words beside it), and the frame to draw. */
export function studioShotInput(scene: StudioShotScene): {
  frame: FormatFrame;
  renderFovDeg: number;
  layout: {
    markId: string | undefined;
    mark: { x: number; z: number; facingDeg: number };
    camera: { position: [number, number, number]; target: [number, number, number]; fovDeg: number };
    pose: "stand";
    gaze: null;
  };
  rig: { format: RigFormat };
  canvasAspect: number;
  movers: Placement[];
} {
  const format = studioRigFormat(scene.format);
  const frame = formatFrame(format, 1);
  const renderFovDeg = studioRenderFovDeg(scene.camera.fovDeg, frame);
  const [px, py, pz] = scene.camera.position;
  const [fx, fy, fz] = scene.camera.forward;
  const len = Math.hypot(fx, fy, fz) || 1;
  // Where the lens looks, at its focus distance (at least a metre, so the
  // layout's camera is never a point looking at itself).
  const reach = Math.max(1, Number.isFinite(scene.camera.focusM) ? scene.camera.focusM : 7);
  const facing = ((scene.figure.facingDeg % 360) + 360) % 360;
  return {
    frame,
    renderFovDeg,
    layout: {
      markId: scene.markId ?? undefined,
      mark: { x: r3(scene.figure.x), z: r3(scene.figure.z), facingDeg: Math.round(facing * 10) / 10 },
      camera: {
        position: [r3(px), r3(py), r3(pz)],
        target: [r3(px + (fx / len) * reach), r3(py + (fy / len) * reach), r3(pz + (fz / len) * reach)],
        fovDeg: Math.round(renderFovDeg * 100) / 100,
      },
      pose: "stand",
      gaze: null,
    },
    rig: { format },
    canvasAspect: frame.renderW / frame.renderH,
    movers: scene.moved.slice(0, MOVERS_PER_BEAT).map((m) => ({ key: m.key, x: r3(m.x), z: r3(m.z), turnDeg: Math.round(m.turnDeg * 10) / 10 })),
  };
}
