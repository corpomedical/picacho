import { describe, expect, it } from "vitest";
import { NOTIFICATION_PREFS, PREF_FOR_KEY } from "./prefs";

describe("every push key answers to exactly one toggle", () => {
  it("maps completions, failures and the credit warning to their own switches", () => {
    expect(PREF_FOR_KEY.videoReady).toBe("notify_render_ready");
    expect(PREF_FOR_KEY.layersReady).toBe("notify_render_ready");
    expect(PREF_FOR_KEY.videoFailed).toBe("notify_render_failed");
    expect(PREF_FOR_KEY.videoFailedRefunded).toBe("notify_render_failed");
    expect(PREF_FOR_KEY.lowCredits).toBe("notify_low_credits");
  });
  it("stays total when a key is added — a silent unmapped key would be un-toggleable", () => {
    for (const [key, pref] of Object.entries(PREF_FOR_KEY)) {
      expect(NOTIFICATION_PREFS as readonly string[], key).toContain(pref);
    }
  });
});
