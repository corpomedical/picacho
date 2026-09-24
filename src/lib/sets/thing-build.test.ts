import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  THING_BUILD_ENDPOINT,
  THING_BUILD_MULTI_ENDPOINT,
  THING_BUILD_RESOLUTION,
  THING_BUILD_USD,
  THING_BUILD_VERTICES,
  buildHandleAllowed,
  builtModelUrl,
  readBuildHandle,
  thingBuildInput,
  thingBuildRequest,
} from "./thing-build";

// A thing's 3D model built inside Helios from its front photo (2026-09-24,
// "Can we add trellis feature on helios? Everything should be done under
// one roof."): TRELLIS.2, the open model, on fal's GPUs.

const Q = "https://queue.fal.run/fal-ai/trellis-2/requests/764cabcf-b745-4b3e-ae38-1200304cf45b";

describe("what TRELLIS.2 is sent", () => {
  it("is the photo's bytes at 1024, brought down to a stage-sized mesh, at fal's stated $0.30", () => {
    expect(THING_BUILD_ENDPOINT).toBe("fal-ai/trellis-2");
    expect(thingBuildInput("data:image/jpeg;base64,/9j/")).toEqual({
      image_url: "data:image/jpeg;base64,/9j/",
      resolution: THING_BUILD_RESOLUTION,
      decimation_target: THING_BUILD_VERTICES,
      texture_size: 2048,
      remesh: true,
    });
    expect(THING_BUILD_RESOLUTION).toBe(1024);
    expect(THING_BUILD_USD).toBe(0.3);
  });
});

describe("several views of one thing", () => {
  it("one image → the photo endpoint; several → the multi-view endpoint, same settings", () => {
    expect(thingBuildRequest(["data:a"])).toEqual({ endpoint: "fal-ai/trellis-2", body: thingBuildInput("data:a") });
    const multi = thingBuildRequest(["data:a", "data:b", "data:c"]);
    expect(multi.endpoint).toBe(THING_BUILD_MULTI_ENDPOINT);
    expect(multi.endpoint).toBe("fal-ai/trellis-2/multi");
    expect(multi.body).toEqual({
      image_urls: ["data:a", "data:b", "data:c"],
      resolution: 1024,
      decimation_target: THING_BUILD_VERTICES,
      texture_size: 2048,
      remesh: true,
    });
  });

  it("a multi-view job's queue handle is accepted whether fal names it by the app or the sub-endpoint", () => {
    const id = "764cabcf-b745-4b3e-ae38-1200304cf45b";
    for (const base of ["https://queue.fal.run/fal-ai/trellis-2", "https://queue.fal.run/fal-ai/trellis-2/multi"]) {
      const h = readBuildHandle({ request_id: id, status_url: `${base}/requests/${id}/status`, response_url: `${base}/requests/${id}` });
      expect(buildHandleAllowed(h)).toBe(true);
    }
  });
});

describe("the job the page holds", () => {
  it("is fal's own queue, this endpoint, one request — nothing a page could point elsewhere", () => {
    const h = readBuildHandle({ request_id: "764cabcf-b745-4b3e-ae38-1200304cf45b", status_url: `${Q}/status`, response_url: Q });
    expect(h).not.toBeNull();
    expect(buildHandleAllowed(h)).toBe(true);
    expect(buildHandleAllowed({ ...h, statusUrl: "https://example.com/requests/x/status" })).toBe(false);
    expect(buildHandleAllowed({ ...h, responseUrl: Q.replace("trellis-2", "hunyuan3d/v2") })).toBe(false);
    // Another request's URLs under this one's id.
    expect(buildHandleAllowed({ ...h, requestId: "00000000-0000-0000-0000-000000000000" })).toBe(false);
    expect(readBuildHandle({ request_id: "x", status_url: `${Q}/status`, response_url: Q })).toBeNull();
  });
});

describe("the model it answers with", () => {
  it("is taken only from fal's own file host, over https", () => {
    expect(builtModelUrl({ model_glb: { url: "https://v3b.fal.media/files/b/x/car.glb", file_size: 1200 } })).toEqual({ url: "https://v3b.fal.media/files/b/x/car.glb", size: 1200 });
    expect(builtModelUrl({ model_glb: { url: "https://fal.media/files/car.glb" } })).toEqual({ url: "https://fal.media/files/car.glb", size: null });
    expect(builtModelUrl({ model_glb: { url: "http://v3b.fal.media/car.glb" } })).toBeNull();
    expect(builtModelUrl({ model_glb: { url: "https://evil.example/fal.media/car.glb" } })).toBeNull();
    expect(builtModelUrl({ model_glb: { url: "https://fal.media.evil.example/car.glb" } })).toBeNull();
    expect(builtModelUrl({})).toBeNull();
  });
});

describe("the actions and the card", () => {
  const actions = readFileSync(join(__dirname, "model-actions.ts"), "utf8");
  const view = readFileSync(join(__dirname, "../../components/sets/set-view.tsx"), "utf8");
  const card = readFileSync(join(__dirname, "../../components/sets/element-card.tsx"), "utf8");

  it("are an admin's, paced, and keep what they build as a loaded model is kept", () => {
    for (const fn of ["export async function startThingBuild", "export async function pollThingBuild"]) {
      const body = actions.slice(actions.indexOf(fn), actions.indexOf(fn) + 400);
      expect(body, fn).toContain("const own = await ownSet(await setsAccess(), setId);");
    }
    expect(actions).toContain('if (await rateLimited(own.userId, "thing-build", 60 * 60, THING_BUILDS_PER_HOUR)) return { error: THING_MODEL_TOO_FAST };');
    expect(actions).toContain("if (!glbHeaderOk(bytes.subarray(0, 12), bytes.byteLength)) return { error: THING_BUILD_FAILED };");
    expect(actions).toContain("await removeOthers(admin, own.userId, own.setId, key, path);");
  });

  it("offers the build on a thing with a photo, and waits for it without holding the page", () => {
    expect(card).toContain("data-el-model-build");
    expect(view).toContain("can: (h?.photos.length ?? 0) > 0,");
    expect(view).toContain("const res = await pollThingBuild(setId, { key: started.key, handle: started.handle });");
    expect(view).toContain("while (aliveRef.current && new Date().getTime() < deadline) {");
  });
});
