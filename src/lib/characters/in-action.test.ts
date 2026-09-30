import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { IN_ACTION_CHECK_COLUMNS, IN_ACTION_COLUMNS, inActionRows, isInActionImage } from "./in-action";

// 2026-09-30, live check: Helios Studio's Look strip said "No pictures of Eva in your gallery yet" beside her
// character page's eight finished images. Its own query asked for `prompt`, which public.generations doesn't have
// (the column is `prompt_input`): every read failed, and a failed read showed as none. The strip, the check of a
// picked look and the page's "In action" now share one source and one rule.

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");
const generationsColumns = (() => {
  const schema = src("../../../supabase/schema.sql");
  const block = schema.slice(schema.indexOf("create table public.generations ("), schema.indexOf(");", schema.indexOf("create table public.generations (")));
  return new Set([...block.matchAll(/^\s+"([a-z_]+)"\s/gm)].map((m) => m[1]));
})();

describe("a character's finished work: one source for In action, the Look strip and its check", () => {
  it("reads only columns public.generations has (the strip asked for `prompt`, which it doesn't)", () => {
    expect(generationsColumns.has("prompt_input")).toBe(true);
    expect(generationsColumns.has("prompt")).toBe(false);
    for (const c of [...IN_ACTION_COLUMNS, ...IN_ACTION_CHECK_COLUMNS]) expect(generationsColumns.has(c), c).toBe(true);
  });

  it("asks for this person's finished, undeleted work of this character with a file — and the strip, images only", async () => {
    const calls: string[] = [];
    const q = {
      eq: (k: string, v: unknown) => (calls.push(`eq ${k}=${v}`), q),
      is: (k: string, v: unknown) => (calls.push(`is ${k}=${v}`), q),
      not: (k: string, op: string, v: unknown) => (calls.push(`not ${k} ${op} ${v}`), q),
      order: (k: string, o: { ascending: boolean }) => (calls.push(`order ${k} ${o.ascending}`), q),
      limit: async (n: number) => (calls.push(`limit ${n}`), { data: [], error: null }),
    };
    const db = { from: (t: string) => (calls.push(`from ${t}`), { select: (c: string) => (calls.push(`select ${c}`), q) }) };
    await inActionRows(db, { userId: "u", characterId: "c", limit: 15 });
    const page = [...calls];
    calls.length = 0;
    await inActionRows(db, { userId: "u", characterId: "c", limit: 30, imagesOnly: true });
    const rule = ["from generations", `select ${IN_ACTION_COLUMNS.join(", ")}`, "eq user_id=u", "eq character_profile_id=c", "eq status=succeeded", "is deleted_at=null", "not result_url is null"];
    expect(page).toEqual([...rule, "order created_at false", "limit 15"]);
    expect(calls).toEqual([...rule, "eq content_type=image", "order created_at false", "limit 30"]);
  });

  it("the check of a picked look accepts exactly the rows the strip lists, and nothing looser", () => {
    const me = { userId: "u", characterId: "c" };
    const ok = { id: "g", user_id: "u", character_profile_id: "c", status: "succeeded", deleted_at: null, result_url: "https://x/y.png", content_type: "image" };
    expect(isInActionImage(ok, me)).toBe(true);
    for (const bad of [
      { ...ok, user_id: "someone else" },
      { ...ok, character_profile_id: "another character" },
      { ...ok, status: "generating" },
      { ...ok, deleted_at: "2026-09-30" },
      { ...ok, result_url: null },
      { ...ok, content_type: "video" },
      null,
    ]) expect(isInActionImage(bad, me)).toBe(false);
  });

  it("the character page, the Look strip and the look's check all go through it", () => {
    expect(src("../../app/app/character/[id]/page.tsx")).toContain("inActionRows(supabase, { userId: userData.user.id, characterId: id, limit: 15 })");
    const strip = src("../sets/studio-recast-actions.ts");
    expect(strip).toContain("inActionRows(access.supabase, { userId: access.userId, characterId, limit: STUDIO_LOOKS_MAX, imagesOnly: true })");
    expect(strip).not.toMatch(/\.from\("generations"\)\s*\.select\("id, result_url, prompt/);
    const check = src("../sets/studio-looks.ts");
    expect(check).toContain(".select(IN_ACTION_CHECK_COLUMNS.join(\", \"))");
    expect(check).toContain("isInActionImage(");
  });
});
