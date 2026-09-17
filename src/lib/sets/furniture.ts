// The viewport's furniture (canvas page J, board J1; cut C of closing the
// gap, 2026-09-17): the sun drawn where it stands and dragged through the
// day, the focus bracket on the figure's eyes, the metre scale, the
// orientation gizmo, the measure tool, the iris's blades and a beat's rack
// of focus. Pure: the page draws what these return; the tests hold them.

import { SUNRISE, SUNSET, sunAt } from "./time-of-day";
import { RIG_TIME_STEP } from "./rig";
import type { SetObject, SetSpec } from "./set-spec";

/** The sun's direction at an hour, unit length, in the set's own axes (time-of-day.ts sunLight places it the same way). */
export function sunDirection(hour: number): [number, number, number] {
  const sun = sunAt(hour);
  const az = (sun.azimuthDeg * Math.PI) / 180;
  const el = (sun.elevationDeg * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

/** A direction's azimuth, degrees 0–360, the way sunAt says it: east 90, south 180, west 270. */
export function azimuthOf(x: number, z: number): number {
  const deg = (Math.atan2(x, z) * 180) / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/**
 * The hour the sun stands at an azimuth — the inverse of sunAt's day: east
 * at sunrise, south at noon, west at sunset, to the rig's quarter hours.
 * North of east it is sunrise, north of west it is sunset.
 */
export function hourFromAzimuth(azimuthDeg: number): number {
  let az = ((azimuthDeg % 360) + 360) % 360;
  // North of east the sun is rising; north of west it is setting.
  if (az < 90) az = 90;
  else if (az > 270) az = 270;
  const day = (az - 90) / 180;
  const hour = SUNRISE + day * (SUNSET - SUNRISE);
  return Math.min(SUNSET, Math.max(SUNRISE, Math.round(hour / RIG_TIME_STEP) * RIG_TIME_STEP));
}

/** The scale bar: a round number of metres whose bar fits between 40 and 140 px at this scale. */
export function scaleBar(pxPerMetre: number): { metres: number; px: number } {
  const steps = [100, 50, 20, 10, 5, 2, 1, 0.5, 0.25, 0.1];
  if (!(pxPerMetre > 0) || !Number.isFinite(pxPerMetre)) return { metres: 1, px: 0 };
  // The longest round length that fits: a metre before half a metre.
  for (const m of steps) {
    const px = m * pxPerMetre;
    if (px >= 40 && px <= 140) return { metres: m, px: Math.round(px) };
  }
  const m = steps[0];
  return { metres: m, px: Math.round(Math.min(140, m * pxPerMetre)) };
}

/** The measure tool: two points on the ground, and the metres between them. */
export type MeasurePoint = { x: number; z: number };
export function measureMetres(a: MeasurePoint, b: MeasurePoint): number {
  return Math.round(Math.hypot(b.x - a.x, b.z - a.z) * 100) / 100;
}

/** The iris's blades (the camera department's Focus section): how the blur's highlights are shaped. */
export const RIG_BLADES = [5, 7, 9, 11] as const;
export type RigBlades = (typeof RIG_BLADES)[number];

/** What the blades add to the focus words: only with a stop set, where there is blur to shape. */
export function bladesWords(blades: RigBlades | null): string {
  if (blades === null) return "";
  const shape = blades >= 11 ? "perfectly round" : blades === 9 ? "round" : blades === 7 ? "softly seven-sided" : "distinctly five-sided";
  return `The iris has ${blades} blades: the bright points in the blur are ${shape}.`;
}

/** A beat's rack of focus (the film's Focus row): to the figure, or to one of the set's things by index. */
export type FilmRack = { to: "figure" } | { to: "object"; index: number };

export function normaliseRack(v: unknown, objects: number): FilmRack | null {
  if (!v || typeof v !== "object") return null;
  const r = v as Record<string, unknown>;
  if (r.to === "figure") return { to: "figure" };
  if (r.to === "object" && typeof r.index === "number" && Number.isInteger(r.index) && r.index >= 0 && r.index < objects) return { to: "object", index: r.index };
  return null;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** How a thing is named to the video model: its shape and its size, the way the scene tree names it. */
export function thingWords(o: SetObject): string {
  return `the ${o.shape} ${r1(o.size[0])} × ${r1(o.size[1])} × ${r1(o.size[2])} m`;
}

/** The rack's words for the take: the focus travels during the move, from the person to the thing, or back to the person. */
export function rackWords(rack: FilmRack | null, spec: Pick<SetSpec, "objects">): string {
  if (!rack) return "";
  if (rack.to === "figure") return "During the move the focus racks back onto the person: they end sharp, whatever was sharp before falls soft.";
  const o = spec.objects[rack.index];
  if (!o) return "";
  return `During the move the focus racks from the person to ${thingWords(o)}: the person falls soft as it comes sharp.`;
}
