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
  type ShotMatch,
} from "./match-shot";
import { SET_MATCH_INPUT_TOKENS, SET_MATCH_MAX_OUTPUT_TOKENS } from "./set-config";
import { normaliseSetSpec } from "./set-spec";

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

function cameraAt(pose: CameraPose) {
  const cam = new THREE.PerspectiveCamera(pose.fovDeg, 1, 0.05, 1000);
  cam.position.set(...pose.position);
  cam.lookAt(new THREE.Vector3(...pose.target));
  cam.updateMatrixWorld();
  return cam;
}

/**
 * Where the mark's vertical line crosses the still's horizontal centre line —
 * the line's point at the height of the optical axis — in the square still,
 * 0 left to 1 right; and the camera's tilt in degrees.
 */
function measure(pose: CameraPose, mark: { x: number; z: number }) {
  const cam = cameraAt(pose);
  const up = new THREE.Vector3(0, 1, 0).applyQuaternion(cam.quaternion);
  const c = cam.position;
  const y = c.y - ((mark.x - c.x) * up.x + (mark.z - c.z) * up.z) / up.y;
  const point = new THREE.Vector3(mark.x, y, mark.z);
  const ahead = point.clone().sub(c).dot(cam.getWorldDirection(new THREE.Vector3()));
  const ndc = point.clone().project(cam);
  const dir = cam.getWorldDirection(new THREE.Vector3());
  return { x: (ndc.x + 1) / 2, ndcY: ndc.y, ahead, pitchDeg: Math.asin(dir.y) / DEG };
}

/** Where the rule puts the subject in the square still. */
const expectedX = (x: number, aspect: number) => Math.min(0.85, Math.max(0.15, aspect >= 1 ? 0.5 + (x - 0.5) * aspect : x));

const finiteDeep = (v: unknown): boolean =>
  Array.isArray(v) ? v.every(finiteDeep) : typeof v === "object" && v !== null ? Object.values(v).every(finiteDeep) : typeof v !== "number" || Number.isFinite(v);

describe("solveMatchPose — the mark lands where the subject sat, at the tilt read", () => {
  const cases: { pitch: number; x: number; aspect: number; fov: number }[] = [];
  for (const pitch of [-80, -45, -12, 0, 8, 20])
    for (const x of [0.15, 0.3, 0.5, 0.62, 0.85])
      for (const aspect of [0.75, 4 / 3, 16 / 9, 2.39])
        for (const fov of [25, 50, 88]) cases.push({ pitch, x, aspect, fov });

  it(`holds on ${cases.length} combinations of tilt, subject position, picture shape and lens`, () => {
    for (const { pitch, x, aspect, fov } of cases) {
      const label = `pitch ${pitch}, x ${x}, aspect ${aspect.toFixed(2)}, fov ${fov}`;
      const { pose } = solveMatchPose(match({ pitchDeg: pitch, subjectX: x, verticalFovDeg: fov }), {
        mark: MARK,
        current: CURRENT,
        referenceAspect: aspect,
        bounds: BOUNDS,
      });
      const m = measure(pose, MARK);
      expect(m.ahead, label).toBeGreaterThan(0);
      expect(Math.abs(m.ndcY), label).toBeLessThan(1e-6);
      expect(Math.abs(m.x - expectedX(x, aspect)), label).toBeLessThanOrEqual(0.01);
      expect(Math.abs(m.pitchDeg - pitch), label).toBeLessThanOrEqual(0.1);
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
      const label = `case ${i}`;
      const { pose } = solveMatchPose(m, { mark, current, referenceAspect: aspect, bounds });
      expect(finiteDeep(pose), label).toBe(true);
      const [px, py, pz] = pose.position;
      expect(Math.abs(px), label).toBeLessThanOrEqual(bounds.x / 2 + 10 + 1e-9);
      expect(Math.abs(pz), label).toBeLessThanOrEqual(bounds.z / 2 + 10 + 1e-9);
      expect(py, label).toBeGreaterThanOrEqual(0.2);
      expect(py, label).toBeLessThanOrEqual(bounds.height * 2);
      expect(Math.hypot(px - mark.x, pz - mark.z), label).toBeGreaterThanOrEqual(0.6 - 1e-9);
      for (const v of pose.target) expect(Math.abs(v), label).toBeLessThanOrEqual(200 + 1e-9);
      expect(Math.hypot(pose.target[0] - px, pose.target[1] - py, pose.target[2] - pz), label).toBeGreaterThanOrEqual(0.5 - 1e-9);
      const got = measure(pose, mark);
      expect(Math.abs(got.x - expectedX(m.subjectX ?? 0.5, aspect)), label).toBeLessThanOrEqual(0.01);
      expect(Math.abs(got.pitchDeg - Math.min(20, Math.max(-80, m.pitchDeg))), label).toBeLessThanOrEqual(0.1);
    }
  });

  it("holds the tilt to what the stage camera can do: 20° up, 80° down", () => {
    const up = solveMatchPose(match({ pitchDeg: 45 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    const down = solveMatchPose(match({ pitchDeg: -85 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    expect(measure(up.pose, MARK).pitchDeg).toBeCloseTo(20, 1);
    expect(measure(down.pose, MARK).pitchDeg).toBeCloseTo(-80, 1);
    expect(up.notes.pitchClamped).toBe(true);
    expect(down.notes.pitchClamped).toBe(true);
    const within = solveMatchPose(match({ pitchDeg: -30 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    expect(within.notes.pitchClamped).toBeUndefined();
  });

  it("keeps the figure inside the still when the subject sat at the picture's edge", () => {
    for (const [x, want] of [
      [0.05, 0.15],
      [0.95, 0.85],
      [0, 0.15],
      [1, 0.85],
    ] as const) {
      const { pose, notes } = solveMatchPose(match({ subjectX: x }), { mark: MARK, current: CURRENT, referenceAspect: 16 / 9, bounds: BOUNDS });
      expect(measure(pose, MARK).x).toBeCloseTo(want, 2);
      expect(notes.subjectPulledIn).toBe(true);
    }
    // A portrait picture is no wider than the square: its x carries straight over.
    const portrait = solveMatchPose(match({ subjectX: 0.2 }), { mark: MARK, current: CURRENT, referenceAspect: 0.75, bounds: BOUNDS });
    expect(measure(portrait.pose, MARK).x).toBeCloseTo(0.2, 2);
    expect(portrait.notes.subjectPulledIn).toBeUndefined();
  });

  it("aims at the mark when there is no subject", () => {
    const { pose } = solveMatchPose(match({ subjectFound: false, subjectX: null, subjectDistanceM: null, pitchDeg: -15 }), {
      mark: MARK,
      current: CURRENT,
      referenceAspect: 2.39,
      bounds: BOUNDS,
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
    // A 1.7 m figure 20 m away through a 10° lens, the camera at its middle.
    const { pose, notes } = solve(10, 1.5, { subjectDistanceM: 20, cameraHeightM: 0.85 });
    const factor = Math.tan(5 * DEG) / Math.tan(10 * DEG);
    expect(pose.fovDeg).toBe(20);
    expect(notes.fovClampedNarrow).toBe(true);
    expect(notes.distanceScaled).toBeCloseTo(factor, 9);
    expect(Math.hypot(pose.position[0] - MARK.x, pose.position[2] - MARK.z)).toBeCloseTo(20 * factor, 9);
    const cam = cameraAt(pose);
    const top = new THREE.Vector3(MARK.x, 1.7, MARK.z).project(cam).y;
    const foot = new THREE.Vector3(MARK.x, 0, MARK.z).project(cam).y;
    const inReference = 1.7 / (2 * 20 * Math.tan(5 * DEG));
    expect((top - foot) / 2).toBeCloseTo(inReference, 3);
  });
});

describe("solveMatchPose — where the camera stands", () => {
  const horizontal = (pose: CameraPose) => [pose.position[0] - MARK.x, pose.position[2] - MARK.z] as const;

  it("keeps the side the person is shooting from", () => {
    const current: CameraPose = { position: [MARK.x + 3, 2, MARK.z + 4], target: [MARK.x, 1, MARK.z], fovDeg: 40 };
    const { pose } = solveMatchPose(match({ subjectDistanceM: 7 }), { mark: MARK, current, referenceAspect: 1.5, bounds: BOUNDS });
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
    });
    expect(Math.hypot(...horizontal(pose))).toBeCloseTo(5, 9);
  });

  it("stands at least 0.6 m off the mark", () => {
    const { pose } = solveMatchPose(match({ subjectDistanceM: 0.2 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    expect(Math.hypot(...horizontal(pose))).toBeCloseTo(0.6, 9);
  });

  it("never stands past where a saved layout keeps a camera: the set's footprint + 10 m", () => {
    const current: CameraPose = { position: [MARK.x + 3, 1.6, MARK.z + 4], target: [MARK.x, 1, MARK.z], fovDeg: 40 };
    const { pose } = solveMatchPose(match({ subjectDistanceM: 200 }), { mark: MARK, current, referenceAspect: 1.5, bounds: BOUNDS });
    expect(Math.abs(pose.position[0])).toBeLessThanOrEqual(25 + 1e-9);
    expect(Math.abs(pose.position[2])).toBeLessThanOrEqual(25 + 1e-9);
    // On the bearing, at the edge of the reach.
    const [dx, dz] = horizontal(pose);
    expect(dx / Math.hypot(dx, dz)).toBeCloseTo(0.6, 9);
    expect(Math.max(Math.abs(pose.position[0]), Math.abs(pose.position[2]))).toBeCloseTo(25, 9);
  });

  it("holds the height between 0.2 m and twice the set's height", () => {
    const low = solveMatchPose(match({ cameraHeightM: 0.05 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    const high = solveMatchPose(match({ cameraHeightM: 30 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    expect(low.pose.position[1]).toBe(0.2);
    expect(high.pose.position[1]).toBe(24);
  });

  it("puts the target where the axis passes the mark, or on the ground if it gets there first", () => {
    const level = solveMatchPose(match({ pitchDeg: 0 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    expect(level.pose.target[0]).toBeCloseTo(MARK.x, 9);
    expect(level.pose.target[2]).toBeCloseTo(MARK.z, 9);
    expect(level.pose.target[1]).toBeCloseTo(1.6, 9);
    // 1.6 m up, 60° down: the ground is 1.85 m along the axis, the mark 8 m.
    const steep = solveMatchPose(match({ pitchDeg: -60 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    expect(steep.pose.target[1]).toBeCloseTo(0, 9);
    const t = steep.pose.target;
    const p = steep.pose.position;
    expect(Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2])).toBeCloseTo(1.6 / Math.sin(60 * DEG), 9);
  });

  it("keeps the target at least 0.5 m out, and inside the coordinates a saved layout keeps", () => {
    const floor = solveMatchPose(match({ cameraHeightM: 0.2, pitchDeg: -80 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS });
    const t = floor.pose.target;
    const p = floor.pose.position;
    expect(Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2])).toBeCloseTo(0.5, 9);
    const huge = { x: 200, z: 200, height: 100 };
    const far = solveMatchPose(match({ pitchDeg: 20, subjectDistanceM: 200 }), {
      mark: { x: -100, z: -100, facingDeg: 0 },
      current: { position: [-99, 1.6, -99], target: [-100, 1, -100], fovDeg: 40 },
      referenceAspect: 1.5,
      bounds: huge,
    });
    for (const v of far.pose.target) expect(Math.abs(v)).toBeLessThanOrEqual(200 + 1e-9);
    expect(Math.abs(measure(far.pose, { x: -100, z: -100 }).pitchDeg - 20)).toBeLessThanOrEqual(0.1);
  });

  it("never returns NaN, whatever it is handed", () => {
    const degenerate: [string, ShotMatch, Parameters<typeof solveMatchPose>[1]][] = [
      ["the camera on the mark", match(), { mark: MARK, current: { position: [MARK.x, 1.6, MARK.z], target: [0, 0, 0], fovDeg: 40 }, referenceAspect: 1.5, bounds: BOUNDS }],
      ["pitch −89", match({ pitchDeg: -89 }), { mark: MARK, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS }],
      ["subject_x 0 in a 2.39:1 frame", match({ subjectX: 0 }), { mark: MARK, current: CURRENT, referenceAspect: 2.39, bounds: BOUNDS }],
      ["all three at once", match({ pitchDeg: -89, subjectX: 0 }), { mark: MARK, current: { position: [MARK.x, 1.6, MARK.z], target: [0, 0, 0], fovDeg: 40 }, referenceAspect: 2.39, bounds: BOUNDS }],
      ["no picture shape", match(), { mark: MARK, current: CURRENT, referenceAspect: Number.NaN, bounds: BOUNDS }],
      ["a zero-width picture", match(), { mark: MARK, current: CURRENT, referenceAspect: 0, bounds: BOUNDS }],
      ["an endless picture", match(), { mark: MARK, current: CURRENT, referenceAspect: Infinity, bounds: BOUNDS }],
      ["a broken camera", match(), { mark: MARK, current: { position: [Number.NaN, Number.NaN, Number.NaN], target: [0, 0, 0], fovDeg: 40 }, referenceAspect: 1.5, bounds: BOUNDS }],
      ["a broken mark", match(), { mark: { x: Number.NaN, z: Infinity, facingDeg: Number.NaN }, current: CURRENT, referenceAspect: 1.5, bounds: BOUNDS }],
      ["the narrowest lens, straight down, at the edge", match({ verticalFovDeg: 3, pitchDeg: -89, subjectX: 1, cameraHeightM: 0.05, subjectDistanceM: 0.2 }), { mark: MARK, current: CURRENT, referenceAspect: 0.2, bounds: BOUNDS }],
    ];
    for (const [label, m, input] of degenerate) {
      const solved = solveMatchPose(m, input);
      expect(finiteDeep(solved), label).toBe(true);
      const { position: p, target: t } = solved.pose;
      expect(Math.hypot(t[0] - p[0], t[1] - p[1], t[2] - p[2]), label).toBeGreaterThanOrEqual(0.5 - 1e-9);
      expect(solved.pose.fovDeg, label).toBeGreaterThanOrEqual(20);
      expect(solved.pose.fovDeg, label).toBeLessThanOrEqual(90);
    }
  });
});

describe("aimFrom — where the camera looks once the page has placed it", () => {
  const solve = (over: Partial<ShotMatch>) =>
    solveMatchPose(match(over), { mark: MARK, current: CURRENT, referenceAspect: 16 / 9, bounds: BOUNDS }).pose;
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
  // A 6 m wall, 3 m high and 0.2 m thick, centred 3 m in front of a mark
  // at the origin: its near face is at z = 2.9.
  const walled = (() => {
    const r = normaliseSetSpec({
      bounds: { x: 20, z: 20, height: 6 },
      objects: [{ shape: "box", position: [0, 1.5, 3], size: [6, 3, 0.2] }],
      marks: [{ x: 0, z: 0, facingDeg: 0 }],
      cameras: [{ position: [0, 1.6, -6], target: [0, 1.2, 0], fovDeg: 40 }],
    });
    if (!r.ok) throw new Error("fixture");
    return buildSetScene(THREE, r.spec);
  })();
  const EYE: [number, number, number] = [0, 1.45, 0];
  const pose = (position: [number, number, number]): CameraPose => ({ position, target: [0, 1.2, 0], fovDeg: 40 });

  it("leaves the camera where it was solved when nothing built stands between", () => {
    const solved = pose([0, 1.6, -6]);
    const placed = placeMatchedCamera(THREE, walled.root, EYE, solved, 100);
    expect(placed.pulledIn).toBe(false);
    expect(placed.position).toEqual(solved.position);
    expect(placed.target).toEqual(aimFrom(solved.position, solved, { x: 0, z: 0 }, 100));
  });

  it("pulls the camera toward the figure, 0.3 m short of a wall in the way, on the same line", () => {
    const placed = placeMatchedCamera(THREE, walled.root, EYE, pose([0, 1.6, 6]), 100);
    expect(placed.pulledIn).toBe(true);
    const [x, y, z] = placed.position;
    expect(x).toBeCloseTo(0, 9);
    // On the line from the eye (1.45 m) to the solved camera (1.6 m, 6 m out).
    expect((y - 1.45) / z).toBeCloseTo(0.15 / 6, 9);
    const wallAt = 2.9 * Math.hypot(6, 0.15) / 6;
    expect(Math.hypot(x - EYE[0], y - EYE[1], z - EYE[2])).toBeCloseTo(wallAt - 0.3, 6);
    expect(placed.target).toEqual(aimFrom(placed.position, pose([0, 1.6, 6]), { x: 0, z: 0 }, 100));
  });

  it("keeps the figure where the subject sat when a wall pulls a solved camera in", () => {
    const mark = { x: 0, z: 0, facingDeg: 0 };
    const current: CameraPose = { position: [0, 1.6, 5], target: [0, 1.2, 0], fovDeg: 40 };
    const { pose: solved } = solveMatchPose(match({ subjectDistanceM: 8, subjectX: 0.75, pitchDeg: 6, cameraHeightM: 0.9 }), {
      mark,
      current,
      referenceAspect: 16 / 9,
      bounds: { x: 20, z: 20, height: 6 },
    });
    const placed = placeMatchedCamera(THREE, walled.root, EYE, solved, 100);
    expect(placed.pulledIn).toBe(true);
    const got = measure({ position: placed.position, target: placed.target, fovDeg: solved.fovDeg }, mark);
    expect(got.x).toBeCloseTo(expectedX(0.75, 16 / 9), 2);
    expect(got.pitchDeg).toBeCloseTo(6, 6);
  });

  it("stops at least 0.6 m from the figure, however close the wall", () => {
    const tight = (() => {
      const r = normaliseSetSpec({
        bounds: { x: 20, z: 20, height: 6 },
        objects: [{ shape: "box", position: [0, 1.5, 0.5], size: [6, 3, 0.2] }],
        marks: [{ x: 0, z: 0, facingDeg: 0 }],
      });
      if (!r.ok) throw new Error("fixture");
      return buildSetScene(THREE, r.spec);
    })();
    const placed = placeMatchedCamera(THREE, tight.root, EYE, pose([0, 1.45, 5]), 100);
    expect(placed.pulledIn).toBe(true);
    expect(placed.position[2]).toBeCloseTo(0.6, 9);
    tight.dispose();
  });

  it("never counts the interpreter's own floor or sky as something built", () => {
    // Low and far: past the sky dome's 150 m radius, above the floor all the way.
    const placed = placeMatchedCamera(THREE, walled.root, EYE, pose([0, 0.2, -190]), 250);
    expect(placed.pulledIn).toBe(false);
    expect(placed.position).toEqual([0, 0.2, -190]);
  });
});

describe("matchSummary", () => {
  const pose = (fovDeg: number, height: number, tiltDeg: number): CameraPose => ({
    position: [0, height, 5],
    target: [0, height + 5 * Math.tan(tiltDeg * DEG), 0],
    fovDeg,
  });

  it("names the lens to the millimetre, the height to 0.1 m and the tilt in whole degrees", () => {
    expect(matchSummary(match(), pose(fovForLens(35), 1.23, -8.4), {})).toEqual({ lensMm: 35, heightM: 1.2, tiltDeg: -8, clamps: [] });
    // The stage's two ends, which no lens chip sits on: 20° ≈ 68 mm, 90° = 12 mm.
    expect(matchSummary(match(), pose(20, 0.46, 12.6), {})).toMatchObject({ lensMm: 68, heightM: 0.5, tiltDeg: 13 });
    expect(matchSummary(match(), pose(90, 2, -30), {}).lensMm).toBe(12);
    expect(matchSummary(match(), pose(90, 3, 0.3), {}).tiltDeg).toBe(0);
    expect(Object.is(matchSummary(match(), pose(90, 3, -0.3), {}).tiltDeg, -0)).toBe(false);
  });

  it("lists which of the stage's limits applied, the tilt's by the way it was read", () => {
    const all = { fovClampedWide: true, pitchClamped: true, subjectPulledIn: true };
    expect(matchSummary(match({ pitchDeg: 40 }), pose(90, 1, 20), all).clamps).toEqual(["wide", "tiltUp", "subject"]);
    expect(matchSummary(match({ pitchDeg: -85 }), pose(20, 1, -80), { fovClampedNarrow: true, distanceScaled: 0.5, pitchClamped: true }).clamps).toEqual([
      "narrow",
      "tiltDown",
    ]);
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
