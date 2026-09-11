import { describe, expect, it } from "vitest";
import {
  closeRetryFeedback,
  closeRetryInput,
  decideAfterValidAnswer,
  RETRY_SMALLER,
  RETRY_SMALLER_PHOTO,
} from "./build-retry";
import { photoBuildInput, setBuildInput } from "./set-builder-prompt";
import { SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS } from "./set-config";
import { normaliseSetSpec, type SetSpec } from "./set-spec";
import showroomOpen from "./fixtures-showroom-open.json";

const spec = (raw: unknown): SetSpec => {
  const r = normaliseSetSpec(raw);
  if (!r.ok) throw new Error("fixture");
  return r.spec;
};

describe("closeRetryInput", () => {
  const s = spec(showroomOpen);
  const input = closeRetryInput("A modern sports car on a dealership", ["the +Z side (around z = 10)"], s);

  it("keeps the brief first and names the open sides", () => {
    expect(input.startsWith("Brief: A modern sports car on a dealership")).toBe(true);
    expect(input).toContain("toward the +Z side (around z = 10)");
    expect(input).toContain("There is no fourth wall");
  });

  it("sends the set back to be mended, without our ids or version", () => {
    expect(input).toContain("Return the same set with those sides closed");
    const sent = JSON.parse(input.slice(input.indexOf("Previous set: ") + "Previous set: ".length));
    expect(sent.objects.length).toBe(s.objects.length);
    expect(sent).not.toHaveProperty("version");
    expect(sent.marks[0]).not.toHaveProperty("id");
    expect(sent.cameras[0]).not.toHaveProperty("id");
  });

  it("falls back to a fresh, told build when the set is too close to the shape limit for walls to survive", () => {
    const crowded: SetSpec = {
      ...s,
      objects: [
        { ...s.objects[0], repeat: { count: 50, offset: [1, 0, 0] as [number, number, number] } },
        ...Array.from({ length: 7 }, () => ({ ...s.objects[0], repeat: { count: 48, offset: [0, 0, 1] as [number, number, number] } })),
      ],
    };
    expect(crowded.objects.reduce((n, o) => n + (o.repeat?.count ?? 1), 0)).toBeGreaterThan(360);
    const told = closeRetryInput("b", ["the +Z side (around z = 10)"], crowded);
    expect(told).not.toContain("Previous set:");
  });

  it("falls back to a fresh, told build when the set is too large to send", () => {
    const huge: SetSpec = { ...s, objects: Array.from({ length: 300 }, () => s.objects[0]) };
    expect(JSON.stringify(huge).length).toBeGreaterThan(SET_CLOSE_RETRY_MAX_PREVIOUS_CHARS);
    const told = closeRetryInput("b", ["the -X side (around x = -5)"], huge);
    expect(told).not.toContain("Previous set:");
    expect(told).toContain("Build the set again with every side closed.");
  });
});

describe("the closing retry's feedback, shared by both kinds of build (2026-09-11)", () => {
  const s = spec(showroomOpen);
  const sides = ["the +Z side (around z = 10)"];

  it("leaves a text build's closing retry byte for byte as it was: the brief, a blank line, the feedback", () => {
    expect(closeRetryInput("b", sides, s)).toBe(`${setBuildInput("b")}\n\n${closeRetryFeedback(sides, s)}`);
    // The text as it was written before the feedback was split out.
    const where = sides.join("; ");
    const head =
      `\n\nYour previous set was open: from its marks a camera could see past the last wall toward ${where}. ` +
      "There is no fourth wall, walls meet at the corners, and a glass front is still a wall.";
    expect(closeRetryInput("b", sides, s).startsWith(`Brief: b${head} Return the same set with those sides closed`)).toBe(true);
    const huge: SetSpec = { ...s, objects: Array.from({ length: 300 }, () => s.objects[0]) };
    expect(closeRetryInput("b", sides, huge)).toBe(`Brief: b${head} Build the set again with every side closed.`);
  });

  it("never carries a brief of its own", () => {
    expect(closeRetryFeedback(sides, s)).not.toContain("Brief:");
    expect(closeRetryFeedback(sides, s).startsWith("Your previous set was open")).toBe(true);
  });

  it("goes back with the photo on a photo build: the image, then the set to mend", () => {
    const photo = "data:image/jpeg;base64,/9j/AAAA";
    const input = photoBuildInput(photo, "", closeRetryFeedback(sides, s)) as {
      content: { type: string; text?: string; image_url?: string }[];
    }[];
    const parts = input[0].content;
    expect(parts[1]).toMatchObject({ type: "input_image", image_url: photo });
    expect(parts[parts.length - 1].text).toContain("Previous set: ");
    expect(JSON.stringify(input)).not.toContain("Brief:");
  });

  it("asks a photo build for a smaller answer about the photo, not a brief", () => {
    expect(RETRY_SMALLER_PHOTO).toContain("for this photo");
    expect(RETRY_SMALLER_PHOTO).not.toContain("brief");
    expect(RETRY_SMALLER_PHOTO.startsWith("\n")).toBe(false);
    // The text build's is unchanged.
    expect(RETRY_SMALLER).toBe("\n\nYour previous answer for this brief was too long. Use at most 80 objects and lean on repeat.");
  });
});

describe("decideAfterValidAnswer", () => {
  const base = { attempts: 1, maxAttempts: 2, stale: false, draftOpen: null };

  it("spends the retry on closing an open set", () => {
    expect(decideAfterValidAnswer({ ...base, open: 3 })).toEqual({ kind: "retry-close" });
  });

  it("finishes a closed set at once", () => {
    expect(decideAfterValidAnswer({ ...base, open: 0 })).toEqual({ kind: "ready", use: "answer" });
  });

  it("finishes an open set when the retry is spent or the build is stale", () => {
    expect(decideAfterValidAnswer({ ...base, open: 3, attempts: 2 })).toEqual({ kind: "ready", use: "answer" });
    expect(decideAfterValidAnswer({ ...base, open: 3, stale: true })).toEqual({ kind: "ready", use: "answer" });
  });

  it("after a closing retry keeps whichever set is more closed, ties to the mended one", () => {
    expect(decideAfterValidAnswer({ ...base, attempts: 2, open: 0, draftOpen: 4 })).toEqual({ kind: "ready", use: "answer" });
    expect(decideAfterValidAnswer({ ...base, attempts: 2, open: 5, draftOpen: 2 })).toEqual({ kind: "ready", use: "draft" });
    expect(decideAfterValidAnswer({ ...base, attempts: 2, open: 2, draftOpen: 2 })).toEqual({ kind: "ready", use: "answer" });
  });
});
