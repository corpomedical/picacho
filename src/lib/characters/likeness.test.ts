import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LIKENESS_ANSWERS, LIKENESS_NOTICE_VERSION, needsLikenessAnswer, parseLikeness, photosHash } from "./likeness";

// Who is in a character's photos (Helios R1, 2026-09-21): three answers,
// kept with the exact photos they were given for, asked again when the
// photos change; asked before a character is saved with photos and before
// Helios shoots it; recorded by the server alone, under its own notice.

describe("the rules", () => {
  it("takes the three answers and nothing else", () => {
    expect(LIKENESS_ANSWERS).toEqual(["me", "permission", "not_a_person"]);
    for (const a of LIKENESS_ANSWERS) expect(parseLikeness(a)).toBe(a);
    for (const bad of ["", "yes", "ME", null, undefined, 1]) expect(parseLikeness(bad)).toBeNull();
    expect(LIKENESS_NOTICE_VERSION).toBe("2026-09-21");
  });

  it("keys the photos by what they are, not their order", () => {
    expect(photosHash(["u/a.jpg", "u/b.jpg"])).toBe(photosHash(["u/b.jpg", "u/a.jpg"]));
    expect(photosHash(["u/a.jpg", "u/b.jpg"])).not.toBe(photosHash(["u/a.jpg", "u/b.jpg", "u/c.jpg"]));
    expect(photosHash(["u/a.jpg"])).not.toBe(photosHash(["u/b.jpg"]));
  });

  it("asks when there are photos and no answer for exactly these photos", () => {
    const paths = ["u/a.jpg", "u/b.jpg"];
    const record = { answer: "me" as const, photosHash: photosHash(paths), consentedAt: "2026-09-21T10:00:00Z" };
    expect(needsLikenessAnswer({ paths, record: null })).toBe(true);
    expect(needsLikenessAnswer({ paths, record })).toBe(false);
    expect(needsLikenessAnswer({ paths: [...paths, "u/c.jpg"], record })).toBe(true);
    expect(needsLikenessAnswer({ paths: [], record: null })).toBe(false);
  });
});

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");

describe("saving a character", () => {
  const actions = read("actions.ts");
  const save = actions.slice(actions.indexOf("export async function saveCharacterProfile("), actions.indexOf("type GenerateReferenceResult"));
  it("refuses without an answer before anything is paid for or written", () => {
    const refuse = save.indexOf("return { error: LIKENESS_NEEDS_ANSWER };");
    expect(refuse).toBeGreaterThan(-1);
    for (const later of ["describeOutfitImage(", "classifyRenderStyle(", ".insert({ ...row, id: characterId })", ".update(row)"]) expect(refuse, later).toBeLessThan(save.indexOf(later));
  });
  it("keeps the answer with the service client, before an edit is written and right after a new character is", () => {
    expect(save.match(/await recordLikeness\(createAdminClient\(\), \{/g)).toHaveLength(2);
    expect(save.indexOf("await recordLikeness(createAdminClient()")).toBeLessThan(save.indexOf(".update(row)"));
    // Matched loosely across lines: the insert carries the id the voice was
    // assigned for (voice-lock.ts), so this call no longer fits on one.
    expect(save).toMatch(/\.insert\(\{ \.\.\.row, id: characterId \}\)\s*\.select\("id"\)\s*\.single\(\)/);
    // A new character whose answer couldn't be kept goes too.
    expect(save).toMatch(/if \(kept === "failed"\) \{\s*await supabase\.from\("character_profiles"\)\.delete\(\)\.eq\("id", savedId\)\.eq\("user_id", uid\);\s*return \{ error: LIKENESS_COULDNT_RECORD \};/);
    // The page never sends the notice version: only the answer.
    expect(save).not.toContain("likeness_version");
  });
});

describe("the form", () => {
  const form = read("../../components/character-form.tsx");
  it("starts with nothing picked, waits for a pick, and links the Content Policy", () => {
    expect(form).toContain("useState<LikenessAnswer | null>(null)");
    expect(form).toContain("disabled={likenessShown && !likenessAnswer}");
    expect(form).toContain('href="/content-policy"');
    expect(form).toContain('if (likenessShown && likenessAnswer) formData.set("likeness_answer", likenessAnswer);');
  });
});

describe("Helios", () => {
  const sets = read("../sets/actions.ts");
  it("won't shoot a character with no answer for its photos, before the shot is counted", () => {
    const shoot = sets.slice(sets.indexOf("export async function shootInSet("), sets.indexOf("export type TakeResult"));
    const ask = shoot.indexOf("return { error: SET_LIKENESS_NEEDED };");
    expect(ask).toBeGreaterThan(-1);
    expect(ask).toBeLessThan(shoot.indexOf('rateLimited(userId, "set-shot"'));
    const take = sets.slice(sets.indexOf("export async function takeInSet("));
    expect(take.indexOf("return { error: SET_LIKENESS_NEEDED };")).toBeLessThan(take.indexOf('rateLimited(userId, "set-take"'));
  });
  it("answers from the figure's card through a server action that checks the character is the person's own", () => {
    const act = read("likeness-actions.ts");
    expect(act).toContain('.eq("user_id", data.user.id)');
    expect(act).toContain('place: "helios_cast",');
    expect(act).not.toMatch(/notice_version|LIKENESS_NOTICE_VERSION/);
  });
});

describe("the table", () => {
  const sql = read("../../../supabase/applied/2026-09-22/character-likeness-consent.sql");
  it("takes the three answers, keeps the photos' key, and is written by the server only", () => {
    expect(sql).toContain("check (answer in ('me', 'permission', 'not_a_person'))");
    expect(sql).toContain("photos_hash     text not null");
    expect(sql).toContain("revoke all on public.character_likeness_consents from public, anon, authenticated;");
    expect(sql).toContain("grant select on public.character_likeness_consents to authenticated;");
    expect(sql).toContain("enable row level security");
  });
});
