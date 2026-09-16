import { beforeEach, describe, expect, it, vi } from "vitest";
import { FILM_MAX_BEATS } from "./film";
import { SET_NOT_FOUND } from "./messages";
import { takesCredits } from "./take";

// A film render is asked for in full before its first beat (2026-09-16):
// the page renders a film one take at a time, each take priced on its own,
// so a film the person could not pay for in full stopped part way, paid for
// in part. checkFilmCredits asks the person's balance for the Render
// button's price — a question only, so counts a caller makes up change
// nothing but the answer.
//
// film-actions.ts imports through "@/", which this suite does not resolve:
// the session, the balance and the database are stood in for, and the Sets
// modules are the real ones.

const SET = "22222222-2222-4222-8222-222222222222";
const asked: { credits: number; options: unknown }[] = [];
let access: { error: string } | { error: null; supabase: unknown; userId: string } = { error: null, supabase: {}, userId: "u1" };
let balance: string | null = null;

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => {
    throw new Error("a question writes nothing");
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimited: async () => false }));
vi.mock("@/lib/media/url", () => ({ thumbUrl: () => null }));
vi.mock("@/lib/generations/core", () => ({
  checkGenerationAllowance: async (_db: unknown, _user: string, credits: number, options: unknown) => {
    asked.push({ credits, options });
    return { error: balance, plan: "growth", isAdmin: false };
  },
}));
vi.mock("@/lib/sets/access", () => ({
  setsAccess: async () => access,
  UUID_RE: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
}));
vi.mock("@/lib/sets/film", async () => await import("./film"));
vi.mock("@/lib/sets/take", async () => await import("./take"));
vi.mock("@/lib/sets/messages", async () => await import("./messages"));

import { checkFilmCredits } from "./film-actions";

beforeEach(() => {
  asked.length = 0;
  access = { error: null, supabase: {}, userId: "u1" };
  balance = null;
});

describe("checkFilmCredits", () => {
  it("asks the balance for the render's whole price, as the Render button shows it", async () => {
    expect(await checkFilmCredits(SET, "veo", { clips: 3, stills: 2 })).toEqual({ error: null });
    expect(await checkFilmCredits(SET, "omni", { clips: 2, stills: 0 })).toEqual({ error: null });
    expect(asked).toEqual([
      { credits: takesCredits("veo", { clips: 3, stills: 2 }), options: { skipCooldown: true } },
      { credits: takesCredits("omni", { clips: 2, stills: 0 }), options: { skipCooldown: true } },
    ]);
  });

  it("says the balance's own refusal", async () => {
    balance = "That would use 39 credits (some models cost more than 1 per video), but you only have 20 left on your Growth plan this month.";
    expect(await checkFilmCredits(SET, "veo", { clips: 3, stills: 3 })).toEqual({ error: balance });
  });

  it("prices an engine it does not know as the default take", async () => {
    await checkFilmCredits(SET, "kling", { clips: 1, stills: 1 });
    expect(asked[0].credits).toBe(takesCredits("omni", { clips: 1, stills: 1 }));
  });

  it("asks nothing for counts no film can have — each take is still checked on its own", async () => {
    for (const count of [
      { clips: 0, stills: 0 },
      { clips: FILM_MAX_BEATS + 1, stills: 0 },
      { clips: 2, stills: 3 },
      { clips: -1, stills: 0 },
      { clips: 1.5, stills: 1 },
      { clips: "3", stills: 1 },
      { clips: 2, stills: null },
    ]) {
      expect(await checkFilmCredits(SET, "omni", count)).toEqual({ error: null });
    }
    expect(await checkFilmCredits(SET, "omni", null as unknown as { clips: number; stills: number })).toEqual({ error: null });
    expect(asked).toEqual([]);
  });

  it("answers only the person signed in, for a set id", async () => {
    expect(await checkFilmCredits("not-a-set", "omni", { clips: 1, stills: 1 })).toEqual({ error: SET_NOT_FOUND });
    access = { error: "Your session expired — please log in again." };
    expect(await checkFilmCredits(SET, "omni", { clips: 1, stills: 1 })).toEqual({ error: "Your session expired — please log in again." });
    expect(asked).toEqual([]);
  });
});
