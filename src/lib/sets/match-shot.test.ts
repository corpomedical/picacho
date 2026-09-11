import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { buildAstraRequestBody, type AstraInput } from "../generations/providers/astra";
import { buildSetScene, fovForLens } from "./build-scene";
import {
  MATCH_SHOT_INPUT_TEXT,
  MATCH_SHOT_INSTRUCTIONS,
  MATCH_SHOT_JSON_SCHEMA,
  MATCH_SHOT_SCHEMA_NAME,
  aimFrom,
  matchShotInput,
  matchShotRequest,
  matchSummary,
  parseMatchShotText,
  placeMatchedCamera,
  pollUntilDeadline,
  solveMatchPose,
  type CameraPose,
  type MatchClamp,
  type MatchNotes,
  type ShotMatch,
} from "./match-shot";
import { SET_MATCH_INPUT_TOKENS, SET_MATCH_MAX_OUTPUT_TOKENS } from "./set-config";
import { normaliseSetSpec, SET_LIMITS } from "./set-spec";

// Match this shot (2026-09-11): what the model is asked, what its answer may
// hold, and where the stage camera stands to match it — checked by
// projecting through a real three.js camera, not by re-deriving the solver.

const answer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    subject_found: true,
    camera_height_m: 1.6,
    pitch_deg: -8,
    vertical_fov_deg: 40,
    subject_distance_m: 4,
    subject_x: 0.6,
    framing: "medium_full",
    confidence: "medium",
    ...over,
  });

describe("parseMatchShotText", () => {
  it("reads a valid answer", () => {
    expect(parseMatchShotText(answer())).toEqual({
      ok: true,
      match: {
        subjectFound: true,
        cameraHeightM: 1.6,
        pitchDeg: -8,
        verticalFovDeg: 40,
        subjectDistanceM: 4,
        subjectX: 0.6,
        framing: "medium_full",
        confidence: "medium",
      },
    });
  });

  it("holds every number to its bounds", () => {
    const low = parseMatchShotText(
      answer({ camera_height_m: 0.001, pitch_deg: -120, vertical_fov_deg: 0.5, subject_distance_m: 0.01, subject_x: -0.4 }),
    );
    const high = parseMatchShotText(
      answer({ camera_height_m: 500, pitch_deg: 120, vertical_fov_deg: 179, subject_distance_m: 9_000, subject_x: 1.7 }),
    );
    expect(low.ok && low.match).toMatchObject({
      cameraHeightM: 0.05,
      pitchDeg: -89,
      verticalFovDeg: 3,
      subjectDistanceM: 0.2,
      subjectX: 0,
    });
    expect(high.ok && high.match).toMatchObject({
      cameraHeightM: 30,
      pitchDeg: 89,
      verticalFovDeg: 150,
      subjectDistanceM: 200,
      subjectX: 1,
    });
  });

  it("nulls every subject field when no subject was found, whatever came with it", () => {
    const r = parseMatchShotText(answer({ subject_found: false, subject_distance_m: 3, subject_x: 0.2, framing: "close_up" }));
    expect(r.ok && r.match).toMatchObject({ subjectFound: false, subjectDistanceM: null, subjectX: null, framing: null });
  });

  it("keeps a found subject's fields null where the answer left them out", () => {
    const r = parseMatchShotText(answer({ subject_distance_m: null, subject_x: null, framing: null }));
    expect(r.ok && r.match).toMatchObject({ subjectFound: true, subjectDistanceM: null, subjectX: null, framing: null });
  });

  it("reads an unknown framing as none and an unknown confidence as low", () => {
    const r = parseMatchShotText(answer({ framing: "cowboy", confidence: "certain" }));
    expect(r.ok && r.match).toMatchObject({ framing: null, confidence: "low" });
  });

  it("refuses garbage", () => {
    for (const text of [
      "",
      "not json",
      "[]",
      "null",
      "42",
      '"camera"',
      answer({ subject_found: "yes" }),
      answer({ camera_height_m: "1.6" }),
      answer({ pitch_deg: null }),
      answer({ vertical_fov_deg: undefined }),
      answer({ subject_x: "left" }),
    ]) {
      expect(parseMatchShotText(text), text).toEqual({ ok: false });
    }
    expect(parseMatchShotText(undefined as unknown as string)).toEqual({ ok: false });
  });

  it("refuses a number that is not finite (1e999 parses to Infinity)", () => {
    for (const field of ["camera_height_m", "pitch_deg", "vertical_fov_deg", "subject_distance_m", "subject_x"]) {
      const text = answer().replace(new RegExp(`"${field}":[^,}]+`), `"${field}":1e999`);
      expect(text).toContain("1e999");
      expect(parseMatchShotText(text), field).toEqual({ ok: false });
      expect(parseMatchShotText(text.replace("1e999", "-1e999")), field).toEqual({ ok: false });
    }
  });

  it("tolerates a stray code fence", () => {
    expect(parseMatchShotText("```json\n" + answer() + "\n```").ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------

type Schema = {
  type?: string | readonly string[];
  enum?: readonly unknown[];
  properties?: Record<string, Schema>;
  required?: readonly string[];
  additionalProperties?: boolean;
  items?: Schema;
  anyOf?: readonly Schema[];
};

function nodes(s: Schema, path: string, out: { path: string; s: Schema }[] = []) {
  out.push({ path, s });
  for (const [k, v] of Object.entries(s.properties ?? {})) nodes(v, `${path}.${k}`, out);
  if (s.items) nodes(s.items, `${path}[]`, out);
  for (const [i, v] of (s.anyOf ?? []).entries()) nodes(v, `${path}|${i}`, out);
  return out;
}

describe("the match schema", () => {
  const all = nodes(MATCH_SHOT_JSON_SCHEMA as unknown as Schema, "$");

  it("is strict everywhere: closed objects, every property required", () => {
    const objects = all.filter(({ s }) => s.type === "object");
    expect(objects.length).toBeGreaterThan(0);
    for (const { path, s } of objects) {
      expect(s.additionalProperties, path).toBe(false);
      expect([...(s.required ?? [])].sort(), path).toEqual(Object.keys(s.properties ?? {}).sort());
    }
  });

  it("has no free-text field: a string is always one of a fixed list", () => {
    for (const { path, s } of all) {
      const types = typeof s.type === "string" ? [s.type] : [...(s.type ?? [])];
      if (types.includes("string")) {
        expect(Array.isArray(s.enum) && s.enum.length > 0, `${path} is a plain string`).toBe(true);
        expect(s.enum?.every((v) => typeof v === "string" && /^[a-z_]+$/.test(v)), path).toBe(true);
      }
    }
    // Everything the answer carries is a number, a boolean or an enum.
    const leafTypes = new Set(all.flatMap(({ s }) => (typeof s.type === "string" ? [s.type] : [...(s.type ?? [])])));
    expect([...leafTypes].sort()).toEqual(["boolean", "null", "number", "object", "string"]);
  });

  it("asks for the camera and nothing else — no roll (the stage camera has none)", () => {
    expect(Object.keys(MATCH_SHOT_JSON_SCHEMA.properties)).toEqual([
      "subject_found",
      "camera_height_m",
      "pitch_deg",
      "vertical_fov_deg",
      "subject_distance_m",
      "subject_x",
      "framing",
      "confidence",
    ]);
    expect(MATCH_SHOT_JSON_SCHEMA.properties.subject_distance_m.type).toEqual(["number", "null"]);
    expect(MATCH_SHOT_JSON_SCHEMA.properties.subject_x.type).toEqual(["number", "null"]);
    // The nullable enum in SET_SPEC_JSON_SCHEMA's form.
    expect(MATCH_SHOT_JSON_SCHEMA.properties.framing.anyOf[1]).toEqual({ type: "null" });
  });
});

describe("the match request", () => {
  const PIC = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";
  const OTHER = "data:image/png;base64,iVBORw0KGgo=";
  const req = matchShotRequest(PIC, "sid");

  it("runs at effort low with a 2,500-token cap, carrying the safety identifier", () => {
    expect(req.effort).toBe("low");
    expect(req.maxOutputTokens).toBe(2_500);
    expect(req.maxOutputTokens).toBe(SET_MATCH_MAX_OUTPUT_TOKENS);
    expect(req.safetyIdentifier).toBe("sid");
    expect(matchShotRequest(PIC, undefined).safetyIdentifier).toBeUndefined();
  });

  it("is one user message: the fixed line, then the picture inline at detail high", () => {
    expect(req.input).toEqual([
      {
        role: "user",
        content: [
          { type: "input_text", text: MATCH_SHOT_INPUT_TEXT },
          { type: "input_image", image_url: PIC, detail: "high" },
        ],
      },
    ]);
    const body = buildAstraRequestBody(req);
    expect(body.tools).toEqual([]);
    expect(body.store).toBe(false);
    expect(body.text).toEqual({
      format: { type: "json_schema", name: MATCH_SHOT_SCHEMA_NAME, schema: MATCH_SHOT_JSON_SCHEMA, strict: true },
    });
  });

  it("changes nothing but the picture between matches, so every match shares the cached prefix", () => {
    const other = matchShotRequest(OTHER, "someone-else");
    expect(other.instructions).toBe(req.instructions);
    expect(other.instructions).toBe(MATCH_SHOT_INSTRUCTIONS);
    expect(other.schema).toBe(req.schema);
    expect(other.schemaName).toBe(req.schemaName);
    const withoutPicture = (input: AstraInput) =>
      JSON.stringify(input).replace(PIC, "<picture>").replace(OTHER, "<picture>");
    expect(withoutPicture(other.input)).toBe(withoutPicture(req.input));
    expect(withoutPicture(matchShotInput(PIC))).toBe(withoutPicture(req.input));
  });

  it("stays inside the input budget set-config.ts prices", () => {
    // 4.4 characters a token, as the set prefix measured (8,132 → 1,822–1,843),
    // plus the photo build's image budget of 2,150.
    const prefix = MATCH_SHOT_INSTRUCTIONS + JSON.stringify(MATCH_SHOT_JSON_SCHEMA) + MATCH_SHOT_INPUT_TEXT;
    expect(prefix.length / 4.4 + 2_150).toBeLessThanOrEqual(SET_MATCH_INPUT_TOKENS);
  });

  it("reads only the camera, never a person, and names no provider", () => {
    expect(MATCH_SHOT_INSTRUCTIONS).toContain("Read only the camera");
    expect(MATCH_SHOT_INSTRUCTIONS).toContain("Never identify, name or describe any person");
    expect(MATCH_SHOT_INSTRUCTIONS).toContain("numbers and fixed choices only");
    expect(MATCH_SHOT_INSTRUCTIONS).not.toMatch(/astra|gpt|openai|claude|anthropic|picacho/i);
    // Every field is defined, with its units and conventions.
    for (const field of Object.keys(MATCH_SHOT_JSON_SCHEMA.properties)) expect(MATCH_SHOT_INSTRUCTIONS).toContain(field);
    expect(MATCH_SHOT_INSTRUCTIONS).toContain("metres and degrees");
    expect(MATCH_SHOT_INSTRUCTIONS).toContain("Positive is tilted up, negative tilted down, 0 is level");
    expect(MATCH_SHOT_INSTRUCTIONS).toContain("across the picture's HEIGHT");
    expect(MATCH_SHOT_INSTRUCTIONS).toContain("0 at the left edge, 1 at the right edge");
  });
});

// ---------------------------------------------------------------------------
// The solve, by projection
// ---------------------------------------------------------------------------

const DEG = Math.PI / 180;
const BOUNDS = { x: 30, z: 30, height: 12 };
const MARK = { x: 1, z: -2, facingDeg: 0 };
/** The camera the person has now: 5 m off the mark toward +Z. */
const CURRENT: CameraPose = { position: [1, 1.6, 3], target: [1, 1.2, -2], fovDeg: 40 };
/** A desktop's stage canvas: landscape, so the still spans the lens's vertical field of view. */
const WIDE = 16 / 9;
/** Phone stage canvases, portrait (w-full × 58vh): a Pixel 7 (380×531) and an iPhone SE (343×387). */
const PHONES = [380 / 531, 343 / 387];

const match = (over: Partial<ShotMatch> = {}): ShotMatch => ({
  subjectFound: true,
  cameraHeightM: 1.6,
  pitchDeg: 0,
  verticalFovDeg: 40,
  subjectDistanceM: 4,
  subjectX: 0.5,
  framing: "medium",
  confidence: "medium",
  ...over,
});

function cameraAt(pose: CameraPose, canvasAspect = 1) {
  const cam = new THREE.PerspectiveCamera(pose.fovDeg, canvasAspect, 0.05, 1000);
  cam.position.set(...pose.position);
  cam.lookAt(new THREE.Vector3(...pose.target));
  cam.updateMatrixWorld();
  return cam;
}

/**
 * Where the mark's vertical line crosses the still's horizontal centre line —
 * the line's point at the height of the optical axis — in the square still,
 * 0 left to 1 right; and the camera's tilt in degrees. The still is the
 * canvas's centre square (set-view.tsx cropSquare), seen through the stage
 * camera at the canvas's own shape: on a landscape canvas it spans the
 * canvas's height, on a portrait one its width.
 */
function measure(pose: CameraPose, mark: { x: number; z: number }, canvasAspect = 1) {
  const cam = cameraAt(pose, canvasAspect);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const c = cam.position;
  const y = c.y - ((mark.x - c.x) * up.x + (mark.z - c.z) * up.z) / up.y;
  const point = new THREE.Vector3(mark.x, y, mark.z);
  const ahead = point.clone().sub(c).dot(cam.getWorldDirection(new THREE.Vector3()));
  const ndc = point.clone().project(cam);
  const dir = cam.getWorldDirection(new THREE.Vector3());
  // The square's half-width in the canvas's own -1…1: the whole width on a
  // portrait canvas, height ÷ width of it on a landscape one.
  const squareHalf = Math.min(1, 1 / canvasAspect);
  return { x: 0.5 + ndc.x / (2 * squareHalf), ndcY: ndc.y, ahead, pitchDeg: Math.asin(dir.y) / DEG };
}

/** Where the rule puts the subject in the square still. */
const expectedX = (x: number, aspect: number) => Math.min(0.85, Math.max(0.15, aspect >= 1 ? 0.5 + (x - 0.5) * aspect : x));

const finiteDeep = (v: unknown): boolean =>
  Array.isArray(v) ? v.every(finiteDeep) : typeof v === "object" && v !== null ? Object.values(v).every(finiteDeep) : typeof v !== "number" || Number.isFinite(v);

describe("solveMatchPose — the mark lands where the subject sat, at the tilt read", () => {
  const cases: { pitch: number; x: number; aspect: number; fov: number; canvas: number }[] = [];
  for (const pitch of [-80, -45, -12, 0, 8, 20])
    for (const x of [0.15, 0.3, 0.5, 0.62, 0.85])
      for (const aspect of [0.75, 4 / 3, 16 / 9, 2.39])
        for (const fov of [25, 50, 88])
          for (const canvas of [WIDE, 1, PHONES[0]]) cases.push({ pitch, x, aspect, fov, canvas });

  it(`holds on ${cases.length} combinations of tilt, subject position, picture shape, lens and stage canvas`, () => {
    for (const { pitch, x, aspect, fov, canvas } of cases) {
      const label = `pitch ${pitch}, x ${x}, aspect ${aspect.toFixed(2)}, fov ${fov}, canvas ${canvas.toFixed(3)}`;
      const { pose } = solveMatchPose(match({ pitchDeg: pitch, subjectX: x, verticalFovDeg: fov }), {
        mark: MARK,
        current: CURRENT,
        referenceAspect: aspect,
        bounds: BOUNDS,
        canvasAspect: canvas,
      });
      const m = measure(pose, MARK, canvas);
      expect(m.ahead, label).toBeGreaterThan(0);
      expect(Math.abs(m.ndcY), label).toBeLessThan(1e-6);
      expect(Math.abs(m.x - expectedX(x, aspect)), label).toBeLessThanOrEqual(0.01);
      expect(Math.abs(m.pitchDeg - pitch), label).toBeLessThanOrEqual(0.1);
    }
  });

  it("places the figure for the still a phone's portrait canvas takes, and keeps it inside that still", () => {
    // A portrait canvas's still spans only its width, so the same turn would
    // land the mark farther out: 0.99 of a Pixel 7's still for a subject at
    // the edge of a 16:9 picture, which the page calls "kept inside".
    for (const canvas of PHONES) {
      for (const [x, aspect, atEdge] of [
        [0.95, 16 / 9, true],
        [0.62, 16 / 9, false],
        [0.8, 0.75, false],
        [0.02, 2.39, true],
      ] as const) {
        const label = `canvas ${canvas.toFixed(3)}, x ${x}, aspect ${aspect.toFixed(2)}`;
        const { pose, notes } = solveMatchPose(match({ subjectX: x, pitchDeg: -8 }), {
          mark: MARK,
          current: CURRENT,
          referenceAspect: aspect,
          bounds: BOUNDS,
          canvasAspect: canvas,
        });
        const m = measure(pose, MARK, canvas);
        expect(Math.abs(m.x - expectedX(x, aspect)), label).toBeLessThanOrEqual(0.01);
        expect(m.x, label).toBeGreaterThanOrEqual(0.15 - 0.01);
        expect(m.x, label).toBeLessThanOrEqual(0.85 + 0.01);
        // The same pose on a desktop sits nearer the centre, still inside.
        const wide = measure(pose, MARK, WIDE);
        expect(Math.abs(wide.x - 0.5), label).toBeLessThanOrEqual(Math.abs(m.x - 0.5) + 1e-9);
        expect(notes.subjectPulledIn ?? false, label).toBe(atEdge);
      }
    }
  });

  it("holds for 2,000 random sets, marks, cameras and answers, inside every limit a saved layout keeps", () => {
    let seed = 20260911;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (let i = 0; i < 2000; i++) {
      const bounds = { x: 2 + rand() * 198, z: 2 + rand() * 198, height: 2 + rand() * 98 };
      const mark = { x: (rand() - 0.5) * bounds.x, z: (rand() - 0.5) * bounds.z, facingDeg: rand() * 360 };
      const current: CameraPose = {
        position: [mark.x + (rand() - 0.5) * 20, 0.2 + rand() * 5, mark.z + (rand() - 0.5) * 20],
        target: [mark.x, 1, mark.z],
        fovDeg: 40,
      };
      const aspect = 0.42 + rand() * 2;
      const m = match({
        cameraHeightM: 0.05 + rand() * 30,
        pitchDeg: -89 + rand() * 178,
        verticalFovDeg: 3 + rand() * 147,
        subjectDistanceM: 0.2 + rand() * 200,
        subjectX: rand(),
      });
      const canvas = 0.45 + rand() * 2;
      const label = `case ${i}`;
      const { pose, notes } = solveMatchPose(m, { mark, current, referenceAspect: aspect, bounds, canvasAspect: canvas });
      expect(finiteDeep(pose), label).toBe(true);
      const [px, py, pz] = pose.position;
      expect(Math.abs(px), label).toBeLessThanOrEqual(bounds.x / 2 + 10 + 1e-9);
      expect(Math.abs(pz), label).toBeLessThanOrEqual(bounds.z / 2 + 10 + 1e-9);
      expect(py, label).toBeGreaterThanOrEqual(0.2);
      expect(py, label).toBeLessThanOrEqual(bounds.height * 2);
      expect(Math.hypot(px - mark.x, pz - mark.z), label).toBeGreaterThanOrEqual(0.6 - 1e-9);
      for (const v of pose.target) expect(Math.abs(v), label).toBeLessThanOrEqual(200 + 1e-9);
      expect(Math.hypot(pose.target[0] - px, pose.target[1] - py, pose.target[2] - pz), label).toBeGreaterThanOrEqual(0.5 - 1e-9);
      const got = measure(pose, mark, canvas);
      expect(Math.abs(got.x - expectedX(m.subjectX ?? 0.5, aspect)), label).toBeLessThanOrEqual(0.01);
      expect(Math.abs(got.pitchDeg - Math.min(20, Math.max(-80, m.pitchDeg))), label).toBeLessThanOrEqual(0.1);
      // Every limit that moved the camera off the read is noted: unless one
      // is, it stands at the read height and distance (the long lens's move
      // in included).
      const distance = Math.hypot(px - mark.x, pz - mark.z);
      const wanted = m.subjectDistanceM! * (notes.distanceScaled ?? 1);
      if (!notes.distanceClampedNear && !notes.distanceClampedFar) expect(distance, label).toBeCloseTo(wanted, 9);
      if (notes.distanceClampedNear) expect(distance, label).toBeGreaterThan(wanted);
      if (notes.distanceClampedFar) expect(distance, label).toBeLessThan(wanted);
      if (!notes.heightClampedLow && !notes.heightClampedHigh) expect(py, label).toBeCloseTo(m.cameraHeightM, 9);
    }
  });

  it("holds the tilt to what the stage camera can do: 20° up, 80° down", () => {
    const up = solveMatchPose(match({ pitchDeg: 45 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    const down = solveMatchPose(match({ pitchDeg: -85 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    expect(measure(up.pose, MARK).pitchDeg).toBeCloseTo(20, 1);
    expect(measure(down.pose, MARK).pitchDeg).toBeCloseTo(-80, 1);
    expect(up.notes.pitchClamped).toBe(true);
    expect(down.notes.pitchClamped).toBe(true);
    const within = solveMatchPose(match({ pitchDeg: -30 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    expect(within.notes.pitchClamped).toBeUndefined();
  });

  it("keeps the figure inside the still when the subject sat at the picture's edge", () => {
    for (const [x, want] of [
      [0.05, 0.15],
      [0.95, 0.85],
      [0, 0.15],
      [1, 0.85],
    ] as const) {
      const { pose, notes } = solveMatchPose(match({ subjectX: x }), { mark: MARK, current: CURRENT, referenceAspect: 16 / 9, bounds: BOUNDS, canvasAspect: WIDE });
      expect(measure(pose, MARK).x).toBeCloseTo(want, 2);
      expect(notes.subjectPulledIn).toBe(true);
    }
    // A portrait picture is no wider than the square: its x carries straight over.
    const portrait = solveMatchPose(match({ subjectX: 0.2 }), { mark: MARK, current: CURRENT, referenceAspect: 0.75, bounds: BOUNDS, canvasAspect: WIDE });
    expect(measure(portrait.pose, MARK).x).toBeCloseTo(0.2, 2);
    expect(portrait.notes.subjectPulledIn).toBeUndefined();
  });

  it("aims at the mark when there is no subject", () => {
    const { pose } = solveMatchPose(match({ subjectFound: false, subjectX: null, subjectDistanceM: null, pitchDeg: -15 }), {
      mark: MARK,
      current: CURRENT,
      referenceAspect: 2.39,
      bounds: BOUNDS,
      canvasAspect: WIDE,
    });
    expect(measure(pose, MARK).x).toBeCloseTo(0.5, 3);
  });
});

describe("solveMatchPose — the lens", () => {
  const solve = (fov: number, aspect: number, over: Partial<ShotMatch> = {}) =>
    solveMatchPose(match({ verticalFovDeg: fov, pitchDeg: 0, subjectX: 0.5, ...over }), {
      mark: MARK,
      current: CURRENT,
      referenceAspect: aspect,
      bounds: BOUNDS,
      canvasAspect: WIDE,
    });

  // The square still spans the reference's SHORTER side: projected through
  // the solved camera, the direction at the edge of that side lands on the
  // square's edge.
  const edgeOf = (pose: CameraPose, along: "up" | "right", tanHalf: number) => {
    const cam = cameraAt(pose);
    const f = cam.getWorldDirection(new THREE.Vector3());
    const axis = new THREE.Vector3(along === "up" ? 0 : 1, along === "up" ? 1 : 0, 0).applyQuaternion(cam.quaternion);
    return cam.position.clone().add(f).addScaledVector(axis, tanHalf).project(cam);
  };

  it("a landscape picture: its height spans the square", () => {
    const { pose, notes } = solve(40, 4 / 3);
    expect(pose.fovDeg).toBeCloseTo(40, 9);
    expect(edgeOf(pose, "up", Math.tan(20 * DEG)).y).toBeCloseTo(1, 6);
    expect(notes).toEqual({});
  });

  it("a 2.39:1 film frame: its height spans the square", () => {
    const { pose } = solve(30, 2.39);
    expect(pose.fovDeg).toBeCloseTo(30, 9);
    expect(edgeOf(pose, "up", Math.tan(15 * DEG)).y).toBeCloseTo(1, 6);
  });

  it("a portrait picture: its width spans the square", () => {
    const { pose } = solve(60, 0.75);
    const tanHalfWidth = 0.75 * Math.tan(30 * DEG);
    expect(pose.fovDeg).toBeCloseTo((2 * Math.atan(tanHalfWidth)) / DEG, 9);
    expect(edgeOf(pose, "right", tanHalfWidth).x).toBeCloseTo(1, 6);
  });

  it("wider than the stage's widest lens: the widest, and nothing else moves", () => {
    const { pose, notes } = solve(120, 1.5);
    expect(pose.fovDeg).toBe(90);
    expect(notes).toEqual({ fovClampedWide: true });
    expect(Math.hypot(pose.position[0] - MARK.x, pose.position[2] - MARK.z)).toBeCloseTo(4, 9);
  });

  it("longer than the stage's longest lens: the longest, moved in so the subject keeps its size in frame", () => {
    // A 1.7 m figure 20 m away through a 6° lens (about 230 mm), the camera
    // at its middle; the stage keeps down to 10°, the 135 mm chip's.
    const { pose, notes } = solve(6, 1.5, { subjectDistanceM: 20, cameraHeightM: 0.85 });
    const factor = Math.tan(3 * DEG) / Math.tan(5 * DEG);
    expect(pose.fovDeg).toBe(SET_LIMITS.minLayoutFovDeg);
    expect(notes.fovClampedNarrow).toBe(true);
    expect(notes.distanceScaled).toBeCloseTo(factor, 9);
    expect(Math.hypot(pose.position[0] - MARK.x, pose.position[2] - MARK.z)).toBeCloseTo(20 * factor, 9);
    const cam = cameraAt(pose);
    const top = new THREE.Vector3(MARK.x, 1.7, MARK.z).project(cam).y;
    const foot = new THREE.Vector3(MARK.x, 0, MARK.z).project(cam).y;
    const inReference = 1.7 / (2 * 20 * Math.tan(3 * DEG));
    expect((top - foot) / 2).toBeCloseTo(inReference, 3);
  });

  it("keeps a long lens the stage has a chip for: a 135 mm reference is not clamped", () => {
    const { pose, notes } = solve(fovForLens(135), 1.5);
    expect(pose.fovDeg).toBeCloseTo(fovForLens(135), 9);
    expect(notes.fovClampedNarrow).toBeUndefined();
  });
});

describe("solveMatchPose — where the camera stands", () => {
  const horizontal = (pose: CameraPose) => [pose.position[0] - MARK.x, pose.position[2] - MARK.z] as const;

  it("keeps the side the person is shooting from", () => {
    const current: CameraPose = { position: [MARK.x + 3, 2, MARK.z + 4], target: [MARK.x, 1, MARK.z], fovDeg: 40 };
    const { pose } = solveMatchPose(match({ subjectDistanceM: 7 }), { mark: MARK, current, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    const [dx, dz] = horizontal(pose);
    expect(Math.hypot(dx, dz)).toBeCloseTo(7, 9);
    expect(dx / 7).toBeCloseTo(0.6, 9);
    expect(dz / 7).toBeCloseTo(0.8, 9);
    expect(pose.position[1]).toBeCloseTo(1.6, 9);
  });

  it("stands where the figure faces when the camera is on the mark", () => {
    for (const [facingDeg, ux, uz] of [
      [0, 0, 1],
      [90, 1, 0],
      [180, 0, -1],
      [270, -1, 0],
    ] as const) {
      const current: CameraPose = { position: [MARK.x + 0.1, 1.6, MARK.z - 0.1], target: [MARK.x, 1, MARK.z - 3], fovDeg: 40 };
      const { pose } = solveMatchPose(match({ subjectDistanceM: 3 }), {
        mark: { ...MARK, facingDeg },
        current,
        referenceAspect: 1.5,
        bounds: BOUNDS,
        canvasAspect: WIDE,
      });
      const [dx, dz] = horizontal(pose);
      expect(dx).toBeCloseTo(3 * ux, 9);
      expect(dz).toBeCloseTo(3 * uz, 9);
    }
  });

  it("keeps the current distance when the picture has no subject", () => {
    const { pose } = solveMatchPose(match({ subjectFound: false, subjectDistanceM: null, subjectX: null }), {
      mark: MARK,
      current: CURRENT,
      referenceAspect: 1.5,
      bounds: BOUNDS,
      canvasAspect: WIDE,
    });
    expect(Math.hypot(...horizontal(pose))).toBeCloseTo(5, 9);
  });

  it("stands at least 0.6 m off the mark, and says so", () => {
    const { pose, notes } = solveMatchPose(match({ subjectDistanceM: 0.2 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    expect(Math.hypot(...horizontal(pose))).toBeCloseTo(0.6, 9);
    expect(notes).toEqual({ distanceClampedNear: true });
  });

  it("never stands past where a saved layout keeps a camera: the set's footprint + 10 m, and says so", () => {
    const current: CameraPose = { position: [MARK.x + 3, 1.6, MARK.z + 4], target: [MARK.x, 1, MARK.z], fovDeg: 40 };
    const { pose, notes } = solveMatchPose(match({ subjectDistanceM: 200 }), { mark: MARK, current, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    expect(Math.abs(pose.position[0])).toBeLessThanOrEqual(25 + 1e-9);
    expect(Math.abs(pose.position[2])).toBeLessThanOrEqual(25 + 1e-9);
    // On the bearing, at the edge of the reach.
    const [dx, dz] = horizontal(pose);
    expect(dx / Math.hypot(dx, dz)).toBeCloseTo(0.6, 9);
    expect(Math.max(Math.abs(pose.position[0]), Math.abs(pose.position[2]))).toBeCloseTo(25, 9);
    expect(notes).toEqual({ distanceClampedFar: true });
    // The review's case: a 20 × 20 m set, the mark at its centre, a subject read 60 m out.
    const small = solveMatchPose(match({ subjectDistanceM: 60 }), {
      mark: { x: 0, z: 0, facingDeg: 0 },
      current: { position: [0, 1.6, 5], target: [0, 1.2, 0], fovDeg: 40 },
      referenceAspect: 1.5,
      bounds: { x: 20, z: 20, height: 6 },
      canvasAspect: WIDE,
    });
    expect(small.pose.position[2]).toBeCloseTo(20, 9);
    expect(small.notes.distanceClampedFar).toBe(true);
  });

  it("says nothing about a distance the picture did not give", () => {
    // No subject, the camera on the mark: it stands 0.6 m out, as any camera must.
    const { pose, notes } = solveMatchPose(match({ subjectFound: false, subjectDistanceM: null, subjectX: null }), {
      mark: MARK,
      current: { position: [MARK.x, 1.6, MARK.z], target: [MARK.x, 1, MARK.z - 3], fovDeg: 40 },
      referenceAspect: 1.5,
      bounds: BOUNDS,
      canvasAspect: WIDE,
    });
    expect(Math.hypot(...horizontal(pose))).toBeCloseTo(0.6, 9);
    expect(notes).toEqual({});
  });

  it("holds the height between 0.2 m and twice the set's height, and says so", () => {
    const low = solveMatchPose(match({ cameraHeightM: 0.05 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    const high = solveMatchPose(match({ cameraHeightM: 30 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    expect(low.pose.position[1]).toBe(0.2);
    expect(high.pose.position[1]).toBe(24);
    expect(low.notes).toEqual({ heightClampedLow: true });
    expect(high.notes).toEqual({ heightClampedHigh: true });
    const within = solveMatchPose(match({ cameraHeightM: 24 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    expect(within.notes).toEqual({});
  });

  it("puts the target where the axis passes the mark, or on the ground if it gets there first", () => {
    const level = solveMatchPose(match({ pitchDeg: 0 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    expect(level.pose.target[0]).toBeCloseTo(MARK.x, 9);
    expect(level.pose.target[2]).toBeCloseTo(MARK.z, 9);
    expect(level.pose.target[1]).toBeCloseTo(1.6, 9);
    // 1.6 m up, 60° down: the ground is 1.85 m along the axis, the mark 8 m.
    const steep = solveMatchPose(match({ pitchDeg: -60 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    expect(steep.pose.target[1]).toBeCloseTo(0, 9);
    const t = steep.pose.target;
    const p = steep.pose.position;
    expect(Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2])).toBeCloseTo(1.6 / Math.sin(60 * DEG), 9);
  });

  it("keeps the target at least 0.5 m out, and inside the coordinates a saved layout keeps", () => {
    const floor = solveMatchPose(match({ cameraHeightM: 0.2, pitchDeg: -80 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE });
    const t = floor.pose.target;
    const p = floor.pose.position;
    expect(Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2])).toBeCloseTo(0.5, 9);
    const huge = { x: 200, z: 200, height: 100 };
    const far = solveMatchPose(match({ pitchDeg: 20, subjectDistanceM: 200 }), {
      mark: { x: -100, z: -100, facingDeg: 0 },
      current: { position: [-99, 1.6, -99], target: [-100, 1, -100], fovDeg: 40 },
      referenceAspect: 1.5,
      bounds: huge,
      canvasAspect: WIDE,
    });
    for (const v of far.pose.target) expect(Math.abs(v)).toBeLessThanOrEqual(200 + 1e-9);
    expect(Math.abs(measure(far.pose, { x: -100, z: -100 }).pitchDeg - 20)).toBeLessThanOrEqual(0.1);
  });

  it("never returns NaN, whatever it is handed", () => {
    const degenerate: [string, ShotMatch, Parameters<typeof solveMatchPose>[1]][] = [
      ["the camera on the mark", match(), { mark: MARK, current: { position: [MARK.x, 1.6, MARK.z], target: [0, 0, 0], fovDeg: 40 }, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE }],
      ["pitch −89", match({ pitchDeg: -89 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE }],
      ["subject_x 0 in a 2.39:1 frame", match({ subjectX: 0 }), { mark: MARK, current: CURRENT, referenceAspect: 2.39, bounds: BOUNDS, canvasAspect: WIDE }],
      ["all three at once", match({ pitchDeg: -89, subjectX: 0 }), { mark: MARK, current: { position: [MARK.x, 1.6, MARK.z], target: [0, 0, 0], fovDeg: 40 }, referenceAspect: 2.39, bounds: BOUNDS, canvasAspect: WIDE }],
      ["no picture shape", match(), { mark: MARK, current: CURRENT, referenceAspect: Number.NaN, bounds: BOUNDS, canvasAspect: WIDE }],
      ["a zero-width picture", match(), { mark: MARK, current: CURRENT, referenceAspect: 0, bounds: BOUNDS, canvasAspect: WIDE }],
      ["an endless picture", match(), { mark: MARK, current: CURRENT, referenceAspect: Infinity, bounds: BOUNDS, canvasAspect: WIDE }],
      ["a broken camera", match(), { mark: MARK, current: { position: [Number.NaN, Number.NaN, Number.NaN], target: [0, 0, 0], fovDeg: 40 }, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE }],
      ["a broken mark", match(), { mark: { x: Number.NaN, z: Infinity, facingDeg: Number.NaN }, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS, canvasAspect: WIDE }],
      ["the narrowest lens, straight down, at the edge", match({ verticalFovDeg: 3, pitchDeg: -89, subjectX: 1, cameraHeightM: 0.05, subjectDistanceM: 0.2 }), { mark: MARK, current: CURRENT, referenceAspect: 0.2, bounds: BOUNDS, canvasAspect: WIDE }],
    ];
    for (const [label, m, input] of degenerate) {
      const solved = solveMatchPose(m, input);
      expect(finiteDeep(solved), label).toBe(true);
      const { position: p, target: t } = solved.pose;
      expect(Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2]), label).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(solved.pose.fovDeg, label).toBeGreaterThanOrEqual(SET_LIMITS.minLayoutFovDeg);
      expect(solved.pose.fovDeg, label).toBeLessThanOrEqual(90);
    }
  });
});

describe("aimFrom — where the camera looks once the page has placed it", () => {
  const solve = (over: Partial<ShotMatch>) =>
    solveMatchPose(match(over), { mark: MARK, current: CURRENT, referenceAspect: 16 / 9, bounds: BOUNDS, canvasAspect: WIDE }).pose;
  /** A point on the line from the figure's eye to the solved camera, `share` of the way out. */
  const pulledTo = (pose: CameraPose, share: number): [number, number, number] => [
    MARK.x + (pose.position[0] - MARK.x) * share,
    1.45 + (pose.position[1] - 1.45) * share,
    MARK.z + (pose.position[2] - MARK.z) * share,
  ];

  it("looks at the solved target from the solved place", () => {
    const solved = solve({ pitchDeg: -10, subjectX: 0.7 });
    const t = aimFrom(solved.position, solved, MARK, 100);
    for (let i = 0; i < 3; i++) expect(t[i]).toBeCloseTo(solved.target[i], 9);
  });

  it("keeps the framing after a pull toward the figure: the mark where the subject sat, at the tilt read", () => {
    // The case a local check caught: a long lens, tilted up, the subject at
    // the edge, 30 m out — pulled to a fifth of the way.
    for (const over of [
      { pitchDeg: 35, verticalFovDeg: 8, subjectDistanceM: 30, subjectX: 0.98, cameraHeightM: 0.4 },
      { pitchDeg: -10, subjectX: 0.7 },
      { pitchDeg: -60, subjectDistanceM: 6, subjectX: 0.3 },
    ]) {
      const solved = solve(over);
      const before = measure(solved, MARK);
      for (const share of [0.9, 0.5, 0.2]) {
        const position = pulledTo(solved, share);
        const placed: CameraPose = { position, target: aimFrom(position, solved, MARK, 100), fovDeg: solved.fovDeg };
        const after = measure(placed, MARK);
        expect(after.x, `${JSON.stringify(over)} at ${share}`).toBeCloseTo(before.x, 6);
        expect(after.pitchDeg).toBeCloseTo(before.pitchDeg, 6);
        const t = placed.target;
        expect(Math.hypot(t[0] - position[0], t[1] - position[1], t[2] - position[2])).toBeGreaterThanOrEqual(0.5 - 1e-9);
      }
    }
  });

  it("keeps the target within the orbit's reach, along the same direction", () => {
    const solved = solve({ pitchDeg: 5, subjectDistanceM: 60 });
    const t = aimFrom(solved.position, solved, MARK, 20);
    const p = solved.position;
    expect(Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2])).toBeLessThan(20);
    const was = new THREE.Vector3(...solved.target).sub(new THREE.Vector3(...p)).normalize();
    const now = new THREE.Vector3(...t).sub(new THREE.Vector3(...p)).normalize();
    expect(now.dot(was)).toBeCloseTo(1, 9);
  });
});

describe("placeMatchedCamera — the set as built", () => {
  const SET_BOUNDS = { x: 20, z: 20, height: 6 };
  const built = (objects: unknown[]) => {
    const r = normaliseSetSpec({ bounds: SET_BOUNDS, objects, marks: [{ x: 0, z: 0, facingDeg: 0 }] });
    if (!r.ok) throw new Error("fixture");
    return buildSetScene(THREE, r.spec);
  };
  // A 6 m wall, 3 m high and 0.2 m thick, centred 3 m in front of a mark
  // at the origin: its near face is at z = 2.9.
  const walled = built([{ shape: "box", position: [0, 1.5, 3], size: [6, 3, 0.2] }]);
  const ORIGIN = { x: 0, z: 0, facingDeg: 0 };
  const stage = (over: Partial<Parameters<typeof placeMatchedCamera>[3]> = {}) => ({
    mark: ORIGIN,
    eyeY: 1.45,
    bounds: SET_BOUNDS,
    maxDistance: 100,
    ...over,
  });
  const EYE: [number, number, number] = [0, 1.45, 0];
  const pose = (position: [number, number, number]): CameraPose => ({ position, target: [0, 1.2, 0], fovDeg: 40 });
  /** Whatever built stands on the line from the camera to a point on the figure (the floor and sky aside). */
  const between = (root: THREE.Object3D, from: readonly number[], to: readonly number[]) => {
    const a = new THREE.Vector3(...from);
    const d = new THREE.Vector3(...to).sub(a);
    const length = d.length();
    return new THREE.Raycaster(a, d.normalize(), 0, length)
      .intersectObject(root, true)
      .filter((h) => h.object.name !== "sky" && h.object.name !== "ground");
  };
  const FIGURE_POINTS = [0.4, 1.2, 1.45, 1.6].map((y) => [0, y, 0]);
  const solveAt = (current: CameraPose, over: Partial<ShotMatch> = {}) =>
    solveMatchPose(match({ subjectDistanceM: 4, subjectX: 0.7, pitchDeg: -8, ...over }), {
      mark: ORIGIN,
      current,
      referenceAspect: 16 / 9,
      bounds: SET_BOUNDS,
      canvasAspect: WIDE,
    }).pose;

  it("leaves the camera where it was solved when nothing built stands between", () => {
    const solved = pose([0, 1.6, -6]);
    const placed = placeMatchedCamera(THREE, walled.root, solved, stage());
    expect(placed.moved).toBe("none");
    expect(placed.position).toEqual(solved.position);
    expect(placed.target).toEqual(aimFrom(solved.position, solved, { x: 0, z: 0 }, 100));
  });

  it("pulls the camera toward the figure, 0.3 m short of a wall in the way, on the same line", () => {
    const placed = placeMatchedCamera(THREE, walled.root, pose([0, 1.6, 6]), stage());
    expect(placed.moved).toBe("in");
    const [x, y, z] = placed.position;
    expect(x).toBeCloseTo(0, 9);
    // On the line from the eye (1.45 m) to the solved camera (1.6 m, 6 m out).
    expect((y - 1.45) / z).toBeCloseTo(0.15 / 6, 9);
    const wallAt = 2.9 * Math.hypot(6, 0.15) / 6;
    expect(Math.hypot(x - EYE[0], y - EYE[1], z - EYE[2])).toBeCloseTo(wallAt - 0.3, 6);
    expect(placed.target).toEqual(aimFrom(placed.position, pose([0, 1.6, 6]), { x: 0, z: 0 }, 100));
  });

  it("keeps the figure where the subject sat when a wall pulls a solved camera in", () => {
    const current: CameraPose = { position: [0, 1.6, 5], target: [0, 1.2, 0], fovDeg: 40 };
    const solved = solveAt(current, { subjectDistanceM: 8, subjectX: 0.75, pitchDeg: 6, cameraHeightM: 0.9 });
    const placed = placeMatchedCamera(THREE, walled.root, solved, stage());
    expect(placed.moved).toBe("in");
    const got = measure({ position: placed.position, target: placed.target, fovDeg: solved.fovDeg }, ORIGIN);
    expect(got.x).toBeCloseTo(expectedX(0.75, 16 / 9), 2);
    expect(got.pitchDeg).toBeCloseTo(6, 6);
  });

  // The review's case (2026-09-11): a thin partition nearer the figure than
  // a camera may stand. Stopping 0.6 m out put the camera 0.1 m beyond it,
  // hiding the figure, under a note that said it had moved closer.
  describe("a thin partition nearer the figure than a camera may stand", () => {
    for (const [label, partition] of [
      ["0.1 m thick, 0.4 m out", { shape: "box", position: [0, 1.5, 0.45], size: [6, 3, 0.1] }],
      ["0.12 m thick, 0.35 m out", { shape: "box", position: [0, 1.5, 0.41], size: [6, 3, 0.12] }],
      ["0.2 m thick, 0.4 m out", { shape: "box", position: [0, 1.5, 0.5], size: [6, 3, 0.2] }],
      // A plane lies flat until turned: 90° about X stands it up, facing ±Z.
      ["a plane 0.4 m out", { shape: "plane", position: [0, 1.5, 0.4], size: [6, 1, 3], rotation: [90, 0, 0] }],
    ] as const) {
      it(`${label}: the camera goes round to another side, where it sees the figure, and the framing holds`, () => {
        const set = built([partition]);
        // The person's camera is beyond the partition, 5 m out.
        const solved = solveAt({ position: [0, 1.6, 5], target: [0, 1.2, 0], fovDeg: 40 });
        const placed = placeMatchedCamera(THREE, set.root, solved, stage());
        expect(placed.moved).toBe("around");
        for (const point of FIGURE_POINTS) expect(between(set.root, placed.position, point), `${label} to y ${point[1]}`).toEqual([]);
        // The figure faces the partition (+Z), so the first open side is a compass point off it.
        expect(Math.abs(placed.position[2])).toBeLessThan(Math.hypot(placed.position[0], placed.position[2]));
        const got = measure({ position: placed.position, target: placed.target, fovDeg: solved.fovDeg }, ORIGIN);
        expect(got.x).toBeCloseTo(expectedX(0.7, 16 / 9), 2);
        expect(got.pitchDeg).toBeCloseTo(-8, 6);
        // As far out as it was matched: the other side is open.
        expect(Math.hypot(placed.position[0], placed.position[2])).toBeCloseTo(4, 6);
        set.dispose();
      });
    }

    it("the same when the camera stood on the mark and the figure faces the partition", () => {
      const set = built([{ shape: "box", position: [0, 1.5, 0.45], size: [6, 3, 0.1] }]);
      const solved = solveAt({ position: [0.05, 1.6, 0.05], target: [0, 1.2, 3], fovDeg: 40 });
      const placed = placeMatchedCamera(THREE, set.root, solved, stage());
      expect(placed.moved).toBe("around");
      for (const point of FIGURE_POINTS) expect(between(set.root, placed.position, point)).toEqual([]);
      set.dispose();
    });
  });

  it("goes round to a side with room rather than standing close under a wall on the person's side", () => {
    // The wall's near face 1 m out: on this side the camera could stand only
    // 0.7 m off, a close-up the match never asked for; the figure's other
    // sides are open (frameFigure's rule: 1.2 m, or as far as it was matched).
    const set = built([{ shape: "box", position: [0, 1.5, 1.1], size: [6, 3, 0.2] }]);
    const solved = solveAt({ position: [0, 1.6, 5], target: [0, 1.2, 0], fovDeg: 40 });
    const placed = placeMatchedCamera(THREE, set.root, solved, stage());
    expect(placed.moved).toBe("around");
    expect(Math.hypot(placed.position[0], placed.position[2])).toBeCloseTo(4, 6);
    set.dispose();
  });

  it("stays on the person's side, pulled in, when that still leaves 1.2 m — even with more room elsewhere", () => {
    // A 1.4 m-wide corridor along X, closed 1.9 m out on +X, open on −X.
    const set = built([
      { shape: "box", position: [0, 1.5, 0.8], size: [20, 3, 0.2] },
      { shape: "box", position: [0, 1.5, -0.8], size: [20, 3, 0.2] },
      { shape: "box", position: [2, 1.5, 0], size: [0.2, 3, 1.4] },
    ]);
    // Down the open end: nothing in the way.
    const open = placeMatchedCamera(THREE, set.root, solveAt({ position: [-5, 1.6, 0], target: [0, 1.2, 0], fovDeg: 40 }, { subjectX: 0.5 }), stage());
    expect(open.moved).toBe("none");
    expect(open.position[0]).toBeCloseTo(-4, 6);
    // From the closed end: 1.6 m of room there, so in to 1.6 m rather than round to the open end's 4 m.
    const closed = placeMatchedCamera(THREE, set.root, solveAt({ position: [5, 1.6, 0], target: [0, 1.2, 0], fovDeg: 40 }, { subjectX: 0.5 }), stage());
    expect(closed.moved).toBe("in");
    expect(closed.position[0]).toBeGreaterThan(0);
    expect(Math.hypot(closed.position[0], closed.position[1] - 1.45, closed.position[2])).toBeCloseTo(1.6, 2);
    set.dispose();
  });

  it("takes whichever usable side has the most room when none has 1.2 m", () => {
    // A closet 1 m deep on three sides of the figure (walls 0.5 m out) and
    // 1.7 m on the fourth (−X, its wall 1.2 m out): only −X leaves 0.6 m.
    const set = built([
      { shape: "box", position: [-0.35, 1.5, 0.55], size: [1.9, 3, 0.1] },
      { shape: "box", position: [-0.35, 1.5, -0.55], size: [1.9, 3, 0.1] },
      { shape: "box", position: [0.55, 1.5, 0], size: [0.1, 3, 1.2] },
      { shape: "box", position: [-1.25, 1.5, 0], size: [0.1, 3, 1.2] },
    ]);
    const solved = solveAt({ position: [0, 1.6, 5], target: [0, 1.2, 0], fovDeg: 40 });
    const placed = placeMatchedCamera(THREE, set.root, solved, stage());
    expect(placed.moved).toBe("around");
    expect(placed.position[0]).toBeCloseTo(-0.9, 2);
    expect(placed.position[2]).toBeCloseTo(0, 9);
    for (const point of FIGURE_POINTS) expect(between(set.root, placed.position, point)).toEqual([]);
    const got = measure({ position: placed.position, target: placed.target, fovDeg: solved.fovDeg }, ORIGIN);
    expect(got.x).toBeCloseTo(expectedX(0.7, 16 / 9), 2);
    set.dispose();
  });

  it("stays as solved, and says the figure may be hidden, when something built stands close on every side", () => {
    // A closet: four walls 0.5 m from the mark.
    const set = built([
      { shape: "box", position: [0, 1.5, 0.55], size: [1.2, 3, 0.1] },
      { shape: "box", position: [0, 1.5, -0.55], size: [1.2, 3, 0.1] },
      { shape: "box", position: [0.55, 1.5, 0], size: [0.1, 3, 1.2] },
      { shape: "box", position: [-0.55, 1.5, 0], size: [0.1, 3, 1.2] },
    ]);
    const solved = solveAt({ position: [0, 1.6, 5], target: [0, 1.2, 0], fovDeg: 40 });
    const placed = placeMatchedCamera(THREE, set.root, solved, stage());
    expect(placed.moved).toBe("blocked");
    expect(placed.position).toEqual(solved.position);
    set.dispose();
  });

  it("never stands past where a saved layout keeps a camera, on whichever side it goes to", () => {
    // The mark at the set's +X edge, facing +X; a partition on the person's
    // side. Facing +X, the layout reaches only 10 m, not the 16 m matched.
    const set = built([{ shape: "box", position: [9.5, 1.5, 0.45], size: [3, 3, 0.1] }]);
    const mark = { x: 9.5, z: 0, facingDeg: 90 };
    const solved = solveMatchPose(match({ subjectDistanceM: 16, subjectX: 0.5, pitchDeg: 0 }), {
      mark,
      current: { position: [9.5, 1.6, 5], target: [9.5, 1.2, 0], fovDeg: 40 },
      referenceAspect: 16 / 9,
      bounds: SET_BOUNDS,
      canvasAspect: WIDE,
    }).pose;
    const placed = placeMatchedCamera(THREE, set.root, solved, stage({ mark }));
    expect(placed.moved).toBe("around");
    expect(Math.abs(placed.position[0])).toBeLessThanOrEqual(20 + 1e-9);
    expect(Math.abs(placed.position[2])).toBeLessThanOrEqual(20 + 1e-9);
    expect(placed.position[0]).toBeCloseTo(20, 6);
    set.dispose();
  });

  it("never counts the interpreter's own floor or sky as something built", () => {
    // Low and far: past the sky dome's 150 m radius, above the floor all the way.
    const placed = placeMatchedCamera(THREE, walled.root, pose([0, 0.2, -190]), stage({ maxDistance: 250 }));
    expect(placed.moved).toBe("none");
    expect(placed.position).toEqual([0, 0.2, -190]);
  });

  // The final review's case (2026-09-11): a camera read at the floor, pulled
  // in by a wall along the line from the figure's eye, came out 0.8 m high
  // under a note that it stood as low as the stage allows.
  it("with matchSummary: a camera moved for something built is never said to stand at a limit it has left", () => {
    const person: CameraPose = { position: [0, 1.6, 5], target: [0, 1.2, 0], fovDeg: 40 };
    const openSide: CameraPose = { position: [0, 1.6, -5], target: [0, 1.2, 0], fovDeg: 40 };
    const say = (set: THREE.Object3D, over: Partial<ShotMatch>, current = person) => {
      const m = match({ subjectDistanceM: 5, subjectX: 0.6, pitchDeg: -8, ...over });
      const solved = solveMatchPose(m, { mark: ORIGIN, current, referenceAspect: 16 / 9, bounds: SET_BOUNDS, canvasAspect: WIDE });
      const placed = placeMatchedCamera(THREE, set, solved.pose, stage());
      const taken: CameraPose = { position: placed.position, target: placed.target, fovDeg: solved.pose.fovDeg };
      return { notes: solved.notes, moved: placed.moved, ...matchSummary(m, solved, taken) };
    };

    // Read 0.05 m up: held to 0.2 m, then pulled in by the wall 2.9 m out.
    const low = say(walled.root, { cameraHeightM: 0.05 });
    expect(low.notes).toEqual({ heightClampedLow: true });
    expect(low.moved).toBe("in");
    expect(low).toMatchObject({ heightM: 0.8, tiltDeg: -8, clamps: [] });
    // The same read from the wall's open side: it stands at 0.2 m, and says so.
    expect(say(walled.root, { cameraHeightM: 0.05 }, openSide)).toMatchObject({ moved: "none", heightM: 0.2, clamps: ["low"] });

    // A subject read 200 m out: held to the set's reach, 20 m, then pulled in to 2.6 m.
    const far = say(walled.root, { subjectDistanceM: 200 });
    expect(far.notes).toEqual({ distanceClampedFar: true });
    expect(far).toMatchObject({ moved: "in", clamps: [] });
    expect(say(walled.root, { subjectDistanceM: 200 }, openSide)).toMatchObject({ moved: "none", clamps: ["far"] });

    // Read 30 m up: held to twice the set's height, 12 m, then pulled in under a ceiling.
    const roofed = built([{ shape: "box", position: [0, 3.1, 0], size: [20, 0.2, 20] }]);
    const high = say(roofed.root, { cameraHeightM: 30 });
    expect(high.notes).toEqual({ heightClampedHigh: true });
    expect(high.moved).toBe("in");
    expect(high.heightM).toBeLessThan(3);
    expect(high.clamps).toEqual([]);
    roofed.dispose();

    // Gone round a partition with no pull-in: another side at the same 0.2 m,
    // so the height limit is still where it stands.
    const partitioned = built([{ shape: "box", position: [0, 1.5, 0.45], size: [6, 3, 0.1] }]);
    expect(say(partitioned.root, { cameraHeightM: 0.05 })).toMatchObject({ moved: "around", heightM: 0.2, clamps: ["low"] });
    partitioned.dispose();
  });
});

describe("matchSummary", () => {
  const pose = (fovDeg: number, height: number, tiltDeg: number): CameraPose => ({
    position: [0, height, 5],
    target: [0, height + 5 * Math.tan(tiltDeg * DEG), 0],
    fovDeg,
  });
  /** The summary of a camera that stands where it was solved: nothing built moved it. */
  const summary = (m: ShotMatch, p: CameraPose, notes: MatchNotes) => matchSummary(m, { pose: p, notes }, p);

  it("names the lens to the millimetre, the height to 0.1 m and the tilt in whole degrees", () => {
    expect(summary(match(), pose(fovForLens(35), 1.23, -8.4), {})).toEqual({ lensMm: 35, heightM: 1.2, tiltDeg: -8, clamps: [] });
    // Lenses no chip sits on: 20° ≈ 68 mm, and the stage's two ends, 10° ≈ 137 mm and 90° = 12 mm.
    expect(summary(match(), pose(20, 0.46, 12.6), {})).toMatchObject({ lensMm: 68, heightM: 0.5, tiltDeg: 13 });
    expect(summary(match(), pose(10, 1.6, 0), {}).lensMm).toBe(137);
    expect(summary(match(), pose(90, 2, -30), {}).lensMm).toBe(12);
    expect(summary(match(), pose(90, 3, 0.3), {}).tiltDeg).toBe(0);
    expect(Object.is(summary(match(), pose(90, 3, -0.3), {}).tiltDeg, -0)).toBe(false);
  });

  it("says the camera as it was taken, not as it was solved", () => {
    const solved = pose(40, 0.2, -8);
    const taken: CameraPose = { position: [0, 0.83, 2.6], target: [0, 0.83 + 2.6 * Math.tan(-8 * DEG), 0], fovDeg: 40 };
    expect(matchSummary(match(), { pose: solved, notes: {} }, taken)).toMatchObject({ heightM: 0.8, tiltDeg: -8 });
  });

  it("lists which of the stage's limits applied, the tilt's by the way it was read", () => {
    const all = { fovClampedWide: true, pitchClamped: true, subjectPulledIn: true };
    expect(summary(match({ pitchDeg: 40 }), pose(90, 1, 20), all).clamps).toEqual(["wide", "tiltUp", "subject"]);
    expect(summary(match({ pitchDeg: -85 }), pose(20, 1, -80), { fovClampedNarrow: true, distanceScaled: 0.5, pitchClamped: true }).clamps).toEqual([
      "narrow",
      "tiltDown",
    ]);
    expect(summary(match(), pose(40, 1, 0), { distanceClampedFar: true, heightClampedHigh: true }).clamps).toEqual(["far", "high"]);
    expect(summary(match(), pose(40, 1, 0), { distanceClampedNear: true, heightClampedLow: true }).clamps).toEqual(["near", "low"]);
  });

  it("says a limit on where the camera stands only while it still stands there", () => {
    // Solved 5 m out at the stage's lowest, every limit noted; then moved by
    // the page (placeMatchedCamera), which keeps the lens, tilt and turn.
    const solved = pose(20, 0.2, 20);
    const notes: MatchNotes = {
      fovClampedNarrow: true,
      distanceScaled: 0.5,
      distanceClampedNear: true,
      distanceClampedFar: true,
      heightClampedLow: true,
      heightClampedHigh: true,
      pitchClamped: true,
      subjectPulledIn: true,
    };
    const along = (position: [number, number, number]): CameraPose => ({ position, target: [0, position[1] + 5 * Math.tan(20 * DEG), 0], fovDeg: 20 });
    const always: MatchClamp[] = ["narrow", "tiltUp", "subject"];
    const said = (taken: CameraPose) => matchSummary(match({ pitchDeg: 40 }), { pose: solved, notes }, taken).clamps;
    // Where it was solved, give or take the millimetres pose() rounds to.
    expect(said(along([0.001, 0.2, 5.001]))).toEqual(["narrow", "near", "far", "low", "high", "tiltUp", "subject"]);
    // Pulled in along the figure's line of sight: nearer, and higher.
    expect(said(along([0, 0.8, 2.6]))).toEqual(always);
    // Gone round, no pull-in: another place, the same height.
    expect(said(along([5, 0.2, 0]))).toEqual(["narrow", "low", "high", "tiltUp", "subject"]);
    // Pulled in by less than the line shows: still at the limits.
    expect(said(along([0, 0.24, 4.97]))).toEqual(["narrow", "near", "far", "low", "high", "tiltUp", "subject"]);
    // Past the 0.1 m the line gives, it is not.
    expect(said(along([0, 0.27, 4.9]))).toEqual(always);
  });

  it("names every limit solveMatchPose can apply: each note has its clamp", () => {
    // Held to the page's promise: every limit that moved the camera off the
    // read is said while the camera stands at it. A note matchSummary drops
    // for a camera nothing moved would be a limit said nowhere.
    const everyNote: Required<MatchNotes> = {
      fovClampedWide: true,
      fovClampedNarrow: true,
      distanceScaled: 0.5,
      distanceClampedNear: true,
      distanceClampedFar: true,
      heightClampedLow: true,
      heightClampedHigh: true,
      pitchClamped: true,
      subjectPulledIn: true,
    };
    const said = new Set<MatchClamp>(summary(match({ pitchDeg: 40 }), pose(40, 1, 0), everyNote).clamps);
    for (const c of summary(match({ pitchDeg: -40 }), pose(40, 1, 0), everyNote).clamps) said.add(c);
    const ALL: Record<MatchClamp, true> = { wide: true, narrow: true, near: true, far: true, low: true, high: true, tiltUp: true, tiltDown: true, subject: true };
    expect([...said].sort()).toEqual(Object.keys(ALL).sort());
    // distanceScaled is the narrow lens's factor, said with "narrow".
    expect(Object.keys(everyNote).length).toBe(9);
  });
});

describe("pollUntilDeadline", () => {
  const fakeClock = (deadlineAt: number) => {
    let now = 0;
    const polledAt: number[] = [];
    return {
      polledAt,
      clock: { now: () => now, pause: async (ms: number) => void (now += ms), deadlineAt, intervalMs: 2_500 },
      poll: (answers: string[]) => async () => {
        polledAt.push(now);
        return answers.shift() ?? "working";
      },
    };
  };

  it("returns the answer as soon as it is in", async () => {
    const f = fakeClock(270_000);
    const got = await pollUntilDeadline(f.poll(["working", "working", "done"]), (a) => a === "working", f.clock);
    expect(got).toBe("done");
    expect(f.polledAt).toEqual([2_500, 5_000, 7_500]);
  });

  it("stops before the deadline, with no poll starting past it", async () => {
    const f = fakeClock(270_000);
    const got = await pollUntilDeadline(f.poll([]), (a) => a === "working", f.clock);
    expect(got).toBeNull();
    expect(f.polledAt.at(-1)).toBeLessThan(270_000);
    expect(f.polledAt.at(-1)! + 2_500).toBeGreaterThanOrEqual(270_000);
    expect(f.polledAt).toHaveLength(107);
  });

  it("does not poll at all when no time is left", async () => {
    const f = fakeClock(2_000);
    expect(await pollUntilDeadline(f.poll(["done"]), (a) => a === "working", f.clock)).toBeNull();
    expect(f.polledAt).toEqual([]);
  });
});
