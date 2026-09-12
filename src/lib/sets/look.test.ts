import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canBeLook, lookStoragePath, newestLook } from "./look";

// A shot's look reference must be a finished picture in the person's own
// folder — the only check on what a still's row points at — and one whose
// camera was recorded, or nobody can say where its objects are.

describe("lookStoragePath", () => {
  const user = "a3102bc1-2355-444a-8ade-caafd7980218";

  it("reads the path of the person's own finished picture", () => {
    expect(lookStoragePath(`/api/media/generated-images/${user}/abc-123.png?v=sig`, user)).toBe(`${user}/abc-123.png`);
    expect(lookStoragePath(`/api/media/generated-images/${user}/a%20b.png`, user)).toBe(`${user}/a b.png`);
  });

  it("refuses anyone else's folder, other buckets and anything that walks out of the folder", () => {
    expect(lookStoragePath(`/api/media/generated-images/someone-else/abc.png?v=x`, user)).toBeNull();
    expect(lookStoragePath(`/api/media/chat-attachments/${user}/frame.jpg?v=x`, user)).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}/../other/abc.png`, user)).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}/%2E%2E/other/abc.png`, user)).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}//abc.png`, user)).toBeNull();
    expect(lookStoragePath(`https://example.com/api/media/generated-images/${user}/abc.png`, user)).toBeNull();
  });

  it("refuses what is not a picture URL at all", () => {
    expect(lookStoragePath(null, user)).toBeNull();
    expect(lookStoragePath(42, user)).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}/abc.png`, "")).toBeNull();
    expect(lookStoragePath(`/api/media/generated-images/${user}/%E0%A4%A.png`, user)).toBeNull();
  });
});

describe("which stills the page offers as the look", () => {
  const shot = (id: string, over: Partial<{ status: string; resultUrl: string | null; hasCamera: boolean }> = {}) => ({
    generationId: id,
    status: "succeeded",
    resultUrl: `/img/${id}.png`,
    hasCamera: true,
    ...over,
  });

  it("only a finished still with its picture and its camera recorded", () => {
    expect(canBeLook(shot("a"))).toBe(true);
    expect(canBeLook(shot("a", { hasCamera: false }))).toBe(false);
    expect(canBeLook(shot("a", { status: "failed" }))).toBe(false);
    expect(canBeLook(shot("a", { status: "processing" }))).toBe(false);
    expect(canBeLook(shot("a", { resultUrl: null }))).toBe(false);
  });

  it("defaults to the newest still WITH a camera, passing over newer ones without", () => {
    // A set's shots come newest first (data.ts orders them so, and the page
    // puts each new one in front).
    const shots = [
      shot("newest-no-camera", { hasCamera: false }),
      shot("newest-failed", { status: "failed" }),
      shot("with-camera"),
      shot("older-with-camera"),
    ];
    expect(newestLook(shots)).toBe("with-camera");
    // Every still from before cameras were recorded: no look to default to.
    expect(newestLook([shot("old-1", { hasCamera: false }), shot("old-2", { hasCamera: false })])).toBeNull();
    expect(newestLook([])).toBeNull();
  });

  it("is the rule the set page follows: its default, its choice, its contact sheet, and a new still", () => {
    // set-view.tsx, read as source: a client component does not load here.
    const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
    expect(view).toContain("useState<string | null>(() => newestLook(initialShots))");
    expect(view).toContain("const lookShot = shots.find((shot) => shot.generationId === lookId && canBeLook(shot)) ?? null;");
    expect(view).toContain("const latestStill = newestLook(shots);");
    expect(view).toContain("const lookable = canBeLook(shot);");
    // A new still takes over as the look only when it can be one, and only
    // while the person has not picked or turned the look off (a ref, read
    // when the shot lands, not when it started).
    expect(view).toContain("else if (canBeLook(shot) && !lookPinnedRef.current) setLookId(result.generationId);");
    const pick = view.slice(view.indexOf("function pickLook("), view.indexOf("function pickLook(") + 200);
    expect(pick).toContain("lookPinnedRef.current = true;");
    // What the server said about the camera and the look, as it said it.
    expect(view).toContain("hasCamera: result.hasCamera,");
    expect(view).toContain("setLookDropped(result.lookDropped);");
    expect(view).toContain("{s.lookDropped}");
    // The frame's canvas shape rides with the shot, read when the frame is taken.
    expect(view).toContain("const canvasAspect = apiRef.current?.canvasAspect();");
    expect(view).toMatch(/lookGenerationId: lookShot\?\.generationId \?\? null,\s*canvasAspect,/);
  });
});
