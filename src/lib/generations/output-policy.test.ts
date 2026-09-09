// The output gate's pure halves: parseVision, where every fail-closed path
// lives, and decideOutput, which holds every rule about two readers that are
// good at different things. Nothing here makes a network call; the readers'
// calibration is measured by scripts/output-policy-eval.mjs against the
// reviewer's real renders and sixty ordinary ones.

import { describe, expect, it } from "vitest";
import { decideOutput, parseModeration, parseVision, moderationBand, type OutputReadings, type VisionReading } from "./output-policy";

const vis = (over: Partial<VisionReading> = {}): VisionReading => ({
  sexual_nudity: "NEGLIGIBLE",
  sexual_act: "NEGLIGIBLE",
  suggestive_framing: "NEGLIGIBLE",
  minor_sexualized: "NEGLIGIBLE",
  depicted_subject: "none",
  ...over,
});
const both = (flagged: boolean, v: Partial<VisionReading> = {}): OutputReadings => ({
  moderation: { flagged, sexual: flagged ? 0.9 : 0.001 },
  vision: vis(v),
});

describe("two readers, good at different things", () => {
  it("refuses when both see it", () => {
    expect(decideOutput(both(true, { sexual_nudity: "HIGH", depicted_subject: "person" }))).toBe("sexual");
    expect(decideOutput(both(true, { sexual_nudity: "MEDIUM", depicted_subject: "person" }))).toBe("sexual");
  });

  it("lets the model win the one disagreement it is competent for — a depicted artwork", () => {
    // The endpoint flags a marble nude; the model says it is a statue and
    // there is nothing on a person. Context wins.
    expect(decideOutput(both(true, { sexual_nudity: "LOW", depicted_subject: "artwork" }))).toBeNull();
    expect(decideOutput(both(true, { sexual_nudity: "NEGLIGIBLE", depicted_subject: "artwork" }))).toBeNull();
  });

  it("refuses when the endpoint flags and the model merely hedges — the picture exists", () => {
    // Not an artwork, and the model is at LOW: on the output side a wrong
    // allow ships the picture. Ties go to refusal here, unlike the prompt gate.
    expect(decideOutput(both(true, { sexual_nudity: "LOW", depicted_subject: "person" }))).toBe("sexual");
    expect(decideOutput(both(true, { sexual_nudity: "NEGLIGIBLE", depicted_subject: "none" }))).toBe("sexual");
  });

  it("lets the model catch what a nudity score misses, but only when sure", () => {
    expect(decideOutput(both(false, { sexual_act: "MEDIUM", depicted_subject: "person" }))).toBe("sexual");
    expect(decideOutput(both(false, { suggestive_framing: "HIGH", depicted_subject: "person" }))).toBe("sexual");
    // Unflagged and the model at MEDIUM on framing: allowed. This is where
    // precision on swimwear and dancewear is bought.
    expect(decideOutput(both(false, { suggestive_framing: "MEDIUM", depicted_subject: "person" }))).toBeNull();
    expect(decideOutput(both(false, { sexual_nudity: "MEDIUM", depicted_subject: "person" }))).toBeNull();
  });

  it("allows an ordinary picture", () => {
    expect(decideOutput(both(false))).toBeNull();
  });
});

describe("minors on the image", () => {
  it("is the vision model's call alone, at LOW, ahead of everything", () => {
    // The moderation endpoint's image reading for minors is always 0 by
    // design; only the model can see it.
    expect(decideOutput(both(false, { minor_sexualized: "LOW" }))).toBe("minors");
    expect(decideOutput(both(true, { minor_sexualized: "LOW", sexual_nudity: "HIGH" }))).toBe("minors");
  });

  it("does not refuse a child merely present", () => {
    expect(decideOutput(both(false, { minor_sexualized: "NEGLIGIBLE" }))).toBeNull();
  });
});

describe("the prompt informs the picture", () => {
  it("scrutinises one band harder on a category the prompt gate scored MEDIUM", () => {
    const borderline = { sexual_nudity: "MEDIUM", sexual_act: "NEGLIGIBLE", suggestive_framing: "NEGLIGIBLE", clothing_removal: "NEGLIGIBLE", minor_sexualized: "NEGLIGIBLE" } as const;
    // Unflagged, model MEDIUM on nudity: allowed on its own…
    expect(decideOutput(both(false, { sexual_nudity: "MEDIUM", depicted_subject: "person" }))).toBeNull();
    // …but with a borderline prompt on that category, MEDIUM is read as HIGH.
    expect(decideOutput(both(false, { sexual_nudity: "MEDIUM", depicted_subject: "person" }), { promptScores: borderline })).toBe("sexual");
  });
});

describe("the strict lane — a real person's photograph was edited", () => {
  const person = { depicted_subject: "person" } as const;
  it("refuses at MEDIUM on nudity or framing where the ordinary lane refuses at HIGH", () => {
    expect(decideOutput(both(false, { sexual_nudity: "MEDIUM", ...person }))).toBeNull();
    expect(decideOutput(both(false, { sexual_nudity: "MEDIUM", ...person }), { strictLane: true })).toBe("sexual");
    expect(decideOutput(both(false, { suggestive_framing: "MEDIUM", ...person }))).toBeNull();
    expect(decideOutput(both(false, { suggestive_framing: "MEDIUM", ...person }), { strictLane: true })).toBe("sexual");
  });

  it("still allows a LOW reading — the slip-dress picture, measured 2026-09-10, reads LOW/LOW", () => {
    expect(
      decideOutput(both(false, { sexual_nudity: "LOW", suggestive_framing: "LOW", ...person }), { strictLane: true }),
    ).toBeNull();
  });

  it("does not move the act axis or minors, which have no lane", () => {
    expect(decideOutput(both(false, { sexual_act: "LOW", ...person }), { strictLane: true })).toBeNull();
    expect(decideOutput(both(false, { minor_sexualized: "LOW" }), { strictLane: true })).toBe("minors");
  });

  it("gives the artwork override no room: a real person as a nude statue is refused", () => {
    expect(decideOutput(both(true, { sexual_nudity: "LOW", depicted_subject: "artwork" }))).toBeNull();
    expect(decideOutput(both(true, { sexual_nudity: "LOW", depicted_subject: "artwork" }), { strictLane: true })).toBe("sexual");
  });

  it("stacks with a borderline prompt, bounded: LOW + prompt MEDIUM + strict lane reads HIGH", () => {
    const borderline = { sexual_nudity: "MEDIUM", sexual_act: "NEGLIGIBLE", suggestive_framing: "NEGLIGIBLE", clothing_removal: "NEGLIGIBLE", minor_sexualized: "NEGLIGIBLE" } as const;
    expect(decideOutput(both(false, { sexual_nudity: "LOW", ...person }), { strictLane: true, promptScores: borderline })).toBe("sexual");
  });

  it("does not stack with a recent refusal: the lane and the count are one band between them", () => {
    // LOW + lane + session would read HIGH and refuse — the strict-at-LOW
    // rule measured and rejected on 2026-09-10. It stays MEDIUM: allowed.
    expect(decideOutput(both(false, { sexual_nudity: "LOW", ...person }), { strictLane: true, sessionPriorHits: 1 })).toBeNull();
    expect(decideOutput(both(false, { suggestive_framing: "LOW", ...person }), { strictLane: true, sessionPriorHits: 3 })).toBeNull();
  });

  it("does not stack with a moderation outage either", () => {
    const visionOnly = (v: Partial<VisionReading>): OutputReadings => ({ moderation: null, vision: vis(v) });
    // Vision alone is one band stricter on nudity: MEDIUM refuses, LOW does not…
    expect(decideOutput(visionOnly({ sexual_nudity: "MEDIUM", ...person }))).toBe("sexual");
    expect(decideOutput(visionOnly({ sexual_nudity: "LOW", ...person }))).toBeNull();
    // …and the strict lane adds nothing on top of that band.
    expect(decideOutput(visionOnly({ sexual_nudity: "LOW", ...person }), { strictLane: true })).toBeNull();
    expect(decideOutput(visionOnly({ sexual_nudity: "MEDIUM", ...person }), { strictLane: true })).toBe("sexual");
    // Framing has no outage band; the lane's one band applies.
    expect(decideOutput(visionOnly({ suggestive_framing: "MEDIUM", ...person }))).toBeNull();
    expect(decideOutput(visionOnly({ suggestive_framing: "MEDIUM", ...person }), { strictLane: true })).toBe("sexual");
  });
});

describe("a recent refusal on the account", () => {
  it("raises every reading by one band, and only one, however many there were", () => {
    // Unflagged, model MEDIUM on nudity: allowed alone; with a prior hit it
    // reads HIGH and refuses.
    expect(decideOutput(both(false, { sexual_nudity: "MEDIUM", depicted_subject: "person" }), { sessionPriorHits: 1 })).toBe("sexual");
    // LOW framing after five refusals is MEDIUM, not HIGH: still allowed.
    expect(decideOutput(both(false, { suggestive_framing: "LOW", depicted_subject: "person" }), { sessionPriorHits: 5 })).toBeNull();
    // NEGLIGIBLE is immune — a count must not manufacture a reading.
    expect(decideOutput(both(false), { sessionPriorHits: 5 })).toBeNull();
  });
});

describe("one reader down", () => {
  it("with only the endpoint, its own verdict stands", () => {
    expect(decideOutput({ moderation: { flagged: true, sexual: 0.9 }, vision: null })).toBe("sexual");
    expect(decideOutput({ moderation: { flagged: false, sexual: 0.001 }, vision: null })).toBeNull();
  });

  it("with only the model, it is one band stricter than when it has a second opinion", () => {
    expect(decideOutput({ moderation: null, vision: vis({ sexual_nudity: "MEDIUM", depicted_subject: "person" }) })).toBe("sexual");
    expect(decideOutput({ moderation: null, vision: vis({ sexual_nudity: "LOW", depicted_subject: "person" }) })).toBeNull();
  });

  it("with neither, the answer is unavailable — and the caller refuses", () => {
    expect(decideOutput({ moderation: null, vision: null })).toBe("unavailable");
  });
});

describe("parseVision fails closed", () => {
  const ok = '{"sexual_nudity":"LOW","sexual_act":"NEGLIGIBLE","suggestive_framing":"NEGLIGIBLE","minor_sexualized":"NEGLIGIBLE","depicted_subject":"person"}';
  it("reads a complete reading, and the last object in a chatty reply", () => {
    expect(parseVision(ok)?.sexual_nudity).toBe("LOW");
    expect(parseVision(`Looking {closely}.\n${ok}`)?.depicted_subject).toBe("person");
  });
  it("returns null for anything incomplete or unrecognised", () => {
    for (const raw of ["", "{}", "[]", '{"sexual_nudity":"LOW"}', ok.replace('"person"', '"statue"'), ok.replace('"LOW"', '"SAFE"')]) {
      expect(parseVision(raw), raw).toBeNull();
    }
  });
});

describe("parseModeration reads only the sexual categories", () => {
  const reply = (categories: Record<string, boolean>, sexual: number, flagged = true) => ({
    results: [{ flagged, categories, category_scores: { sexual, violence: 0.9 } }],
  });
  it("ignores the overall flag when it fired on another category", () => {
    // The warrior video: overall flagged on violence, sexual 0.0000.
    expect(parseModeration(reply({ sexual: false, violence: true }, 0.0))).toEqual({ flagged: false, sexual: 0 });
  });
  it("flags on the sexual category, and on sexual/minors", () => {
    expect(parseModeration(reply({ sexual: true }, 0.93))?.flagged).toBe(true);
    expect(parseModeration(reply({ "sexual/minors": true }, 0.4))?.flagged).toBe(true);
  });
  it("fails closed on an unreadable reply", () => {
    expect(parseModeration(null)).toBeNull();
    expect(parseModeration({ results: [{ flagged: true, categories: {}, category_scores: {} }] })).toBeNull();
  });
});

describe("moderation bands", () => {
  it("map the raw score onto the four bands at the pinned cut-offs", () => {
    expect(moderationBand(0.0000136)).toBe("NEGLIGIBLE");
    expect(moderationBand(0.1)).toBe("LOW");
    expect(moderationBand(0.4)).toBe("MEDIUM");
    expect(moderationBand(0.95)).toBe("HIGH");
  });
});
