// Render many sets through one page server and one Chrome: B's first-camera
// snapshots (figure hidden, the card picture at 1024 px) and C/D's frames
// (a camera's view with the figure on the first mark). A set that fails to
// render is left out and counted, never retried silently.

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { SET_COMPARE_PX } from "../../../src/lib/sets/set-config.ts";
import type { SetSpec } from "../../../src/lib/sets/set-spec.ts";
import type { NetGuard } from "../lib/net-guard.mts";
import { DEFAULT_CHROME, startChrome, type Pose, type RenderResult } from "./chrome.mts";
import { startStage } from "./stage.mts";

export type RenderJob = { key: string; spec: SetSpec; mark: { x: number; z: number; facingDeg: number } | null; poses: Pose[] };
export type Rendered = { key: string; ok: true; result: RenderResult; files: Record<string, string> } | { key: string; ok: false; error: string };

/** The first camera, figure hidden: the product's card picture (set-view.tsx), at 1024 px. */
export function cardPose(spec: SetSpec): Pose {
  const c = spec.cameras[0];
  return { poseId: c.id, position: c.position, target: c.target, fovDeg: c.fovDeg, figure: false };
}

/**
 * A photo set's camera 1 beside its photo (set-view.tsx): the first camera,
 * figure hidden, at the photo's shape — the page crops it with compare.ts
 * and widens the lens where the crop is shorter than the canvas — with its
 * long side at SET_COMPARE_PX.
 */
export function comparePose(spec: SetSpec, photoAspect: number): Pose {
  return { ...cardPose(spec), aspect: photoAspect, px: SET_COMPARE_PX };
}

/** A shot's frame from one of the set's cameras, the figure on the first mark. */
export function framePose(spec: SetSpec, cameraIndex: number): Pose {
  const c = spec.cameras[cameraIndex];
  return { poseId: c.id, position: c.position, target: c.target, fovDeg: c.fovDeg, figure: true };
}

export async function renderSets(o: {
  net: NetGuard;
  repoRoot: string;
  chromePath: string | null;
  jobs: readonly RenderJob[];
  outDir: string;
  progress: (m: string) => void;
}): Promise<Rendered[]> {
  if (o.jobs.length === 0) return [];
  const stage = await startStage(o.net, o.repoRoot);
  let chrome: Awaited<ReturnType<typeof startChrome>> | null = null;
  const out: Rendered[] = [];
  try {
    chrome = await startChrome({ chromePath: o.chromePath ?? DEFAULT_CHROME, net: o.net });
    for (const job of o.jobs) {
      stage.putSpec(job.key, job.spec);
      try {
        const result = await chrome.renderSet(stage.pageUrl, job.key, job.mark, job.poses);
        const files: Record<string, string> = {};
        for (const f of result.frames) {
          if (!f.jpeg) continue;
          const name = `${job.key}-${f.poseId}.jpg`;
          writeFileSync(join(o.outDir, name), Buffer.from(f.jpeg.slice(f.jpeg.indexOf(",") + 1), "base64"));
          files[f.poseId] = name;
          f.jpeg = null;
        }
        out.push({ key: job.key, ok: true, result, files });
        o.progress(`rendered ${job.key} (${result.ms} ms, fill ${result.lift.fill}, exposure ${result.lift.exposure})`);
      } catch (e) {
        out.push({ key: job.key, ok: false, error: e instanceof Error ? e.message.slice(0, 300) : String(e) });
        o.progress(`render failed ${job.key}`);
      }
    }
  } finally {
    await chrome?.close();
    await stage.close();
  }
  return out;
}
