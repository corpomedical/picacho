import { beforeEach, describe, expect, it, vi } from "vitest";
import { AdminErrorBanner } from "../../components/admin-error-banner";

// Restore now / Suspend on Admin → AI providers (2026-09-19). The
// model_health write's result went unchecked, so a failed write went back to
// the page as if it had worked: a model just suspended kept taking renders,
// and a model just restored stayed out, with nothing on the page and nothing
// in the log. Now the failure is logged and the banner says something went
// wrong. Nothing changed, so its generic "try again" line is true.
//
// actions.ts imports through "@/", which this suite does not resolve: the
// session, the database, the model catalogues and Next's redirect are stood
// in for, and the modules neither action calls are stubbed.

const events: string[] = [];

class Redirected extends Error {
  constructor(readonly to: string) {
    super(to);
  }
}

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    events.push("redirect");
    throw new Redirected(to);
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

// model_health as these two actions see it: its rows, and whether writing fails.
type HealthRow = { model_id: string; tripped_at: string | null } & Record<string, unknown>;
const health = {
  rows: new Map<string, HealthRow>(),
  writeError: null as { message: string } | null,
};
vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table !== "model_health") throw new Error(`unexpected table: ${table}`);
      return {
        update: (values: Partial<HealthRow>) => ({
          eq: async (_column: string, modelId: string) => {
            if (health.writeError) return { error: health.writeError };
            const row = health.rows.get(modelId);
            if (row) Object.assign(row, values);
            return { error: null };
          },
        }),
        upsert: async (values: HealthRow) => {
          if (health.writeError) return { error: health.writeError };
          health.rows.set(values.model_id, { ...health.rows.get(values.model_id), ...values });
          return { error: null };
        },
      };
    },
  }),
}));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: async () => ({}) }));
vi.mock("@/lib/generations/providers/video-models", () => ({ VIDEO_MODELS: [{ id: "video-model" }] }));
vi.mock("@/lib/generations/providers/image-models", () => ({ IMAGE_MODELS: [{ id: "image-model" }] }));
// Imported by actions.ts, called by neither action.
vi.mock("@/lib/profile/storage-buckets", () => ({ removeAllUserStorage: async () => {} }));
vi.mock("@/lib/profile/promo-redemptions", () => ({ erasePromoRedemptionEmail: async () => {} }));
vi.mock("@/lib/rate-hits", () => ({ removeUserRateHits: async () => {} }));
vi.mock("@/lib/faces/run", () => ({ deleteUserFaces: async () => {} }));
vi.mock("@/lib/stripe/cancel-customer", () => ({ cancelStripeCustomerBilling: async () => {} }));
vi.mock("@/lib/plans", () => ({ PLAN_LIMITS: {} }));
vi.mock("@/lib/admin/badges", () => ({ computeAdminBadgeCounts: async () => ({}) }));
vi.mock("@/lib/generations/identity-gate", () => ({ MIN_IDENTITY_THRESHOLD: 0, MAX_IDENTITY_THRESHOLD: 95 }));
vi.mock("@/lib/generations/providers/lane-setting", () => ({ SEEDANCE_LANE_KEY: "seedance_provider" }));

import { restoreModel, suspendModel } from "./actions";

/** Presses a model's button; where the action sends the admin next. */
async function press(action: (form: FormData) => Promise<void>, fields: Record<string, string>): Promise<string> {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  try {
    await action(form);
  } catch (err) {
    if (err instanceof Redirected) return err.to;
    throw err;
  }
  throw new Error("the action finished without redirecting");
}

/** The line the banner shows on the page a redirect lands on. */
function bannerAfter(to: string): string | undefined {
  expect(to).toMatch(/^\/admin\/providers\?error=/);
  const error = new URL(to, "https://picacho.test").searchParams.get("error") ?? undefined;
  return AdminErrorBanner({ error })?.props.children;
}
const GENERIC = AdminErrorBanner({ error: "anything the banner doesn't know" })?.props.children;

const TRIPPED = "2026-09-19T08:00:00.000Z";

beforeEach(() => {
  vi.restoreAllMocks();
  events.length = 0;
  health.rows.clear();
  health.writeError = null;
  vi.spyOn(console, "error").mockImplementation(() => {
    events.push("log");
  });
});

describe("Restore now / Suspend when model_health can't be written", () => {
  it("Restore now says it didn't work, after logging why, and the model stays out", async () => {
    health.rows.set("video-model", { model_id: "video-model", tripped_at: TRIPPED });
    health.writeError = { message: "canceling statement due to statement timeout" };

    expect(bannerAfter(await press(restoreModel, { model_id: "video-model", kind: "video" }))).toBe(GENERIC);
    expect(health.rows.get("video-model")?.tripped_at).toBe(TRIPPED);
    // The cause is in the server log before the banner points there.
    expect(events).toEqual(["log", "redirect"]);
  });

  it("Suspend says it didn't work, after logging why, and the model stays in service", async () => {
    health.writeError = { message: "canceling statement due to statement timeout" };

    expect(bannerAfter(await press(suspendModel, { model_id: "image-model", kind: "image" }))).toBe(GENERIC);
    expect(health.rows.has("image-model")).toBe(false);
    expect(events).toEqual(["log", "redirect"]);
  });

  it("both go straight back to the page when the write works", async () => {
    health.rows.set("video-model", { model_id: "video-model", tripped_at: TRIPPED });

    expect(await press(restoreModel, { model_id: "video-model", kind: "video" })).toBe("/admin/providers");
    expect(health.rows.get("video-model")?.tripped_at).toBeNull();
    expect(await press(suspendModel, { model_id: "image-model", kind: "image" })).toBe("/admin/providers");
    expect(health.rows.get("image-model")?.tripped_at).toEqual(expect.any(String));
    expect(events).toEqual(["redirect", "redirect"]);
  });
});
