import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// No spending without paying, the small ones (2026-09-30, operator: "fix the
// remaining small ones"). Every paid call a person can trigger without a
// render now either waits until they can pay, or has a total for the day on
// top of its burst brake. The actions are "use server" modules that cannot
// load here, so the order of each check is read from the source.

const read = (p: string) => readFileSync(join(__dirname, p), "utf8");
// Code only: what the comments say is not what the code does.
const code = (s: string) => s.replace(/^\s*\/\/.*$/gm, "");
const fnOf = (source: string, sig: string) => {
  const start = source.indexOf(sig);
  expect(start, sig).toBeGreaterThan(-1);
  const end = source.indexOf("\nexport async function", start + sig.length);
  return code(source.slice(start, end < 0 ? undefined : end));
};
const before = (body: string, first: string, then: string) => {
  const a = body.indexOf(first);
  const b = body.indexOf(then);
  expect(a, first).toBeGreaterThan(-1);
  expect(b, then).toBeGreaterThan(-1);
  expect(a, `${first} comes before ${then}`).toBeLessThan(b);
};

describe("the paid prompt gate waits until the account can pay", () => {
  const actions = read("generations/actions.ts");

  it("Generate: one check at the smallest price, then the gate; a resent POST follows its first delivery", () => {
    const run = fnOf(actions, "export async function runGeneration(");
    before(run, "const canPay = await checkGenerationAllowance(supabase, userData.user.id, 1, cooldown);", "await gatePrompt(");
    expect(run).toContain("if (canPay.error) return (await followRepeat()) ?? { error: canPay.error };");
  });

  it("several angles: the same, with the batch's follower", () => {
    const multi = fnOf(actions, "export async function runMultiAngleGeneration(");
    before(multi, "const canPay = await checkGenerationAllowance(supabase, userData.user.id, 1);", "await gatePrompt(");
    expect(multi).toContain("if (canPay.error) return (await followRepeatBatch()) ?? { error: canPay.error };");
  });

  it("a layer edit: its own price and the check before the gate", () => {
    const edit = code(actions.slice(actions.indexOf("const creditWeight = layerEditCreditCost(")));
    before(edit, "const allowance = await checkGenerationAllowance(supabase, userId, creditWeight);", "await gatePrompt({ prompt, userId, hasRealPersonReference: true });");
  });

  it("the API: the check first, in the same words and status as the one that decides", () => {
    const api = code(read("api/generate.ts"));
    before(api, "const canPay = await checkGenerationAllowance(supabase, userId, 1, { skipCooldown: true });", "await gatePrompt({ prompt, userId });");
    expect(api).toContain("if (canPay.error) return (await followRepeat()) ?? { error: withoutSalesPitch(canPay.error), status: 402 };");
  });

  it("prompt assists: the switches and the allowance before the gate, and a burst brake on every plan", () => {
    const prompts = read("prompts/actions.ts");
    for (const sig of ["export async function compilePrompt(", "export async function planScene("]) {
      before(fnOf(prompts, sig), "const allowance = await assistAllowance(", "await gatePrompt(");
    }
    const allowance = code(prompts.slice(prompts.indexOf("async function assistAllowance("), prompts.indexOf("export async function")));
    before(allowance, 'if (profile?.role === "admin") return', 'rateLimited(userId, "prompt-assist", 60 * 10, PROMPT_ASSISTS_PER_10_MIN)');
  });
});

describe("dictation and voice previews", () => {
  const voice = read("voice/actions.ts");

  it("need a plan in good standing", () => {
    expect(voice).toContain('.select("plan, plan_status, role")');
    expect(voice).toContain('const onPaidPlan = (profile?.plan ?? "none") !== "none" && planInGoodStanding(profile?.plan_status);');
    const previews = read("voices/actions.ts");
    expect(previews).toContain('.select("plan, plan_status, role, status")');
    expect(previews).toContain("if (!planInGoodStanding(profile?.plan_status) && profile?.role !== \"admin\")");
  });

  it("dictation: 2 MB a clip, a day's clips, and long clips counted after Whisper and read before it", () => {
    expect(voice).toContain("const MAX_AUDIO_BYTES = 2 * 1024 * 1024;");
    const t = fnOf(voice, "export async function transcribeVoice(");
    before(t, 'rateHitCount(available.userId, "voice-long", DAY_SECONDS)) >= LONG_CLIPS_PER_DAY', 'fetchWithTimeout(');
    before(t, 'dailyCapReached(available.userId, "voice-transcribe", TRANSCRIBES_PER_DAY)', 'fetchWithTimeout(');
    expect(t).toContain('form.set("response_format", "verbose_json");');
    before(t, 'fetchWithTimeout(', 'await rateLimited(available.userId, "voice-long", DAY_SECONDS, 1_000);');
    expect(t).toContain("seconds > LONGEST_REAL_CLIP_SECONDS");
  });

  it("voice previews: a day's total, admins aside", () => {
    expect(read("voices/actions.ts")).toContain('dailyCapReached(userData.user.id, "voice-preview", PREVIEWS_PER_DAY)');
  });
});

describe("the character reads", () => {
  it("an uploaded close-up is scored only within its limits, and kept unchecked past them", () => {
    const upload = fnOf(read("characters/expression-actions.ts"), "export async function setExpressionSlotUpload(");
    before(upload, 'rateLimited(userId, "expression-score", 60 * 10, EXPRESSION_SCORES_PER_10_MIN)', "likenessAgainstPhotoOne(");
    before(upload, 'dailyCapReached(userId, "expression-score", EXPRESSION_SCORES_PER_DAY)', "likenessAgainstPhotoOne(");
    expect(upload).toContain("const likeness = scoreAllowed ? await likenessAgainstPhotoOne(supabase, character, path) : null;");
  });

  it("a save's outfit and style reads each ask the limits first", () => {
    const characters = read("characters/actions.ts");
    expect(characters).toContain("if (signed?.signedUrl && (await characterReadAllowed(data.user.id))) {");
    expect(characters).toContain("if (signedRef?.signedUrl && (await characterReadAllowed(data.user.id))) {");
    expect(characters).toContain('dailyCapReached(userId, "character-read", CHARACTER_READS_PER_DAY)');
  });
});

describe("Helios's free reads have a day as well as a burst", () => {
  it("the chat reader, on all three of its doors", () => {
    const words = read("sets/words-actions.ts");
    expect(words.match(/dailyCapReached\(userId, "set-words", SHOT_WORDS_PER_DAY\)/g)).toHaveLength(3);
    expect(words.match(/rateLimited\(userId, "set-words", 60 \* 10, SHOT_WORDS_PER_10_MIN\)/g)).toHaveLength(3);
  });

  it("the rig check, the reference photo check and the things' sheets", () => {
    expect(read("sets/rig-actions.ts")).toContain('dailyCapReached(userId, "set-rig-check", 100)');
    expect(read("sets/reference-upload.ts")).toContain('dailyCapReached(userId, "set-ref", SET_REFS_PER_DAY)');
    expect(read("sets/element-actions.ts")).toContain('dailyCapReached(userId, "set-sheet", ELEMENT_SHEETS_PER_DAY)');
  });
});

describe("the day's bucket", () => {
  it("is the same limiter in its own scope, over a rolling 24 hours; the peek adds nothing and fails closed", () => {
    const limiter = read("rate-limit.ts");
    expect(limiter).toContain("return rateLimited(userId, `${scope}-day`, DAY_SECONDS, perDay);");
    expect(limiter).toContain("const DAY_SECONDS = 24 * 60 * 60;");
    const peek = limiter.slice(limiter.indexOf("export async function rateHitCount("));
    expect(peek).toContain('.select("id", { count: "exact", head: true })');
    expect(peek).not.toContain(".insert(");
    expect(peek).toContain("if (error) return Number.POSITIVE_INFINITY;");
  });
});
