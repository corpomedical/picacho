// The Angle Stage's shape, in one client-safe module (2026-09-05,
// operator-approved after the proven prototype: still → 3D proxy → picked
// angles → re-rendered frames → the EXISTING start & end frames lane).
//
// The stage itself follows the reference-photo precedent (see
// PLAN_REFERENCE_IMAGE_LIMITS in lib/plans.ts for why a CAP, not a credit
// charge): the video render it produces is priced, charged, scored and
// refunded by the existing lane untouched, and the stage's own provider
// spend — one Hunyuan3D proxy per take plus a handful of guided re-renders
// — is bounded per billing month instead of nickel-and-diming a credit
// price onto every orbit.
//
// The cost being bounded (all read from fal 2026-09-05): a textured
// Hunyuan3D v2 proxy is $0.16 × 3 = $0.48 (their published 3× multiplier on
// the white-mesh price); a Seedream v4 edit frame billed cents in the
// prototype run (fal doesn't publish that page's price). Worst case per
// take: one proxy + MAX_STAGE_FRAMES_PER_TAKE edits ≈ $0.70. The monthly
// caps keep the worst-case account spend a sane fraction of the plan price:
// Studio 15 × ~$0.70 ≈ $10.50 against $49; Elite 40 ≈ $28 against $99 —
// and a staged take that actually renders earns the frames-lane price on
// top.
import type { PlanId } from "../plans";

// Who can open the stage at all: exactly the plans the start & end frames
// lane accepts (actions.ts gates frames on studio/elite/admin — a stage
// whose render button is refused by the server would be a lie).
export function angleStageEligible(plan: string | null | undefined, isAdmin: boolean): boolean {
  return isAdmin || plan === "studio" || plan === "elite";
}

// Proxies (= staged takes) per billing month. Zero for plans whose renders
// the frames lane would refuse anyway.
export const ANGLE_STAGE_MONTHLY_LIMITS = {
  none: 0,
  basic: 0,
  starter: 0,
  growth: 0,
  studio: 15,
  elite: 40,
} as const satisfies Record<PlanId, number>;

// Full-quality angle frames per take. Six is generous for picking a start
// and an end (the UI keeps every one for reuse) while capping the per-take
// provider exposure.
export const MAX_STAGE_FRAMES_PER_TAKE = 6;

// Where the pieces live, derived — never stored — so the stage needs no new
// tables or columns: the proxy file's existence IS the record of a staged
// take, and its storage created_at is what the monthly cap counts.
// generated-videos and generated-images are both served by the media route
// and swept by account deletion (truth-contracts.test.ts pins the roster).
export function stageProxyPath(userId: string, generationId: string): string {
  return `${userId}/proxies/${generationId}.glb`;
}
export function stageFramesPrefix(userId: string, generationId: string): string {
  return `${userId}/stage/${generationId}`;
}
