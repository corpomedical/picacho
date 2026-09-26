import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Settings › Security › Connected apps: when the section shows (integration,
// 2026-09-26). The real loadConnectedApps, with its three providers faked:
// the grants read, the press_tour_mcp switch and the person's access.

const state = {
  grants: [] as unknown[] | "unavailable",
  enabled: false as boolean | "throws",
  mayConnect: false,
};

vi.mock("@/lib/supabase/server", () => ({ createAdminClient: () => ({}) }));
vi.mock("./store", () => ({ listGrants: async () => state.grants }));
vi.mock("./runtime", () => ({
  oauthEnabled: async () => {
    if (state.enabled === "throws") throw new Error("feature_flags unreachable");
    return state.enabled;
  },
  mayConnectApps: async () => state.mayConnect,
}));

import { loadConnectedApps } from "./connected-apps";

const user = { id: "11111111-1111-4111-8111-111111111111", email_confirmed_at: "2026-09-01T00:00:00Z" };
const load = () => loadConnectedApps({} as SupabaseClient, user);
const APP = { id: "g1", appName: "Claude", host: "claude.ai", verified: true, onThisComputer: false, scopes: ["read"], connectedAt: "2026-09-26T00:00:00Z", lastUsedAt: null };

beforeEach(() => {
  state.grants = [];
  state.enabled = false;
  state.mayConnect = false;
});

describe("the Connected apps section", () => {
  it("shows a connected app whatever the switch says, so it can always be disconnected", async () => {
    state.grants = [APP];
    expect(await load()).toEqual({ show: true, apps: [APP], unavailable: false });
  });

  it("with nothing connected, shows only while connecting apps is open to the person", async () => {
    expect((await load()).show).toBe(false);
    state.enabled = true;
    expect((await load()).show).toBe(false);
    state.mayConnect = true;
    expect(await load()).toEqual({ show: true, apps: [], unavailable: false });
  });

  it("a list that couldn't be read never puts the section in front of someone it isn't open to", async () => {
    state.grants = "unavailable";
    expect(await load()).toEqual({ show: false, apps: [], unavailable: true });
    state.enabled = "throws";
    state.mayConnect = true;
    expect((await load()).show).toBe(false);
  });

  it("and says it couldn't load to someone it is open to", async () => {
    state.grants = "unavailable";
    state.enabled = true;
    state.mayConnect = true;
    expect(await load()).toEqual({ show: true, apps: [], unavailable: true });
  });
});
