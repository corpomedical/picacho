import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FACE_ASSETS_PER_CHARACTER,
  FACE_CONSENT_NOTICE_VERSION,
  faceAssetPlan,
  faceAssetUri,
  faceCheckLink,
  faceCheckPassed,
  faceSessionExpired,
  facePhotosToSend,
  isFaceState,
} from "./model";

// "Verify it's you" (2026-09-19). The rules here are BytePlus's Real Person
// Verification Usage Rules turned into code: consent before any face is
// processed, a record of it, withdrawal that stops and deletes, and a
// verification that only ever lifts the real-face check for the person who
// passed it. The flow is pinned as source where it lives in actions and
// routes, the model as behaviour.

const src = (p: string) => readFileSync(join(__dirname, p), "utf8");
const actions = src("actions.ts");
const run = src("run.ts");
const callback = src("../../app/api/face-verification/callback/route.ts");
const sql = readFileSync(join(__dirname, "..", "..", "..", "supabase", "applied", "2026-09-22", "face-verification.sql"), "utf8");

describe("the face check's own rules", () => {
  it("opens BytePlus's page in English — the one of its three languages we speak", () => {
    const link = faceCheckLink("https://www.byteplus.com/en/liveness-face-manage/authorization?pl=abc&uid=1");
    expect(new URL(link).searchParams.get("lng")).toBe("en");
    expect(new URL(link).searchParams.get("pl")).toBe("abc");
    expect(faceCheckLink("https://x.test/a?lng=zh")).toBe("https://x.test/a?lng=en");
  });

  it("passes only on 10000", () => {
    expect(faceCheckPassed("10000")).toBe(true);
    expect(faceCheckPassed("10001")).toBe(false);
    expect(faceCheckPassed(null)).toBe(false);
  });

  it("takes only our own state token, and only for BytePlus's 30 minutes", () => {
    expect(isFaceState("a".repeat(64))).toBe(true);
    expect(isFaceState("A".repeat(64))).toBe(false);
    expect(isFaceState("a".repeat(63))).toBe(false);
    expect(isFaceState(undefined)).toBe(false);
    const now = new Date("2026-09-19T12:00:00Z");
    expect(faceSessionExpired("2026-09-19T11:31:00Z", now)).toBe(false);
    expect(faceSessionExpired("2026-09-19T11:29:00Z", now)).toBe(true);
    expect(faceSessionExpired("not a date", now)).toBe(true);
  });

  it("sends a character's first photos, within the pilot's budget", () => {
    expect(facePhotosToSend(["u/1.jpg", "u/2.jpg", "u/3.jpg", "u/4.jpg", "u/5.jpg"])).toEqual(["u/1.jpg", "u/2.jpg", "u/3.jpg"]);
    expect(FACE_ASSETS_PER_CHARACTER).toBeLessThanOrEqual(4);
  });

  it("keeps a character's assets in step with its photos", () => {
    const plan = faceAssetPlan(["u/1.jpg", "u/3.jpg"], [
      { photoPath: "u/1.jpg", status: "active" },
      { photoPath: "u/2.jpg", status: "processing" },
      { photoPath: "u/9.jpg", status: "removed" },
    ]);
    expect(plan.add).toEqual(["u/3.jpg"]);
    expect(plan.remove).toEqual(["u/2.jpg"]);
  });

  it("names an asset where a photo's url would go", () => {
    expect(faceAssetUri("asset-20260318-abc")).toBe("asset://asset-20260318-abc");
  });
});

describe("consent comes first, and is kept (Usage Rules 2)", () => {
  it("refuses without the tick, or against an older notice", () => {
    expect(actions).toContain("if (input?.consent !== true || input?.noticeVersion !== FACE_CONSENT_NOTICE_VERSION) return { error: FACE_NEEDS_CONSENT };");
    // The tick is checked before anything touches BytePlus.
    expect(actions.indexOf("FACE_NEEDS_CONSENT };")).toBeLessThan(actions.indexOf("createVerificationSession(callback)"));
  });

  it("records when, which notice and how — before the person is sent anywhere", () => {
    const insert = actions.slice(actions.indexOf('from("face_verifications").insert({'));
    expect(insert).toContain("consented_at: new Date().toISOString()");
    expect(insert).toContain("consent_notice_version: FACE_CONSENT_NOTICE_VERSION");
    expect(insert).toContain("consent_method: FACE_CONSENT_METHOD");
    expect(actions.indexOf('from("face_verifications").insert({')).toBeLessThan(actions.indexOf("return { error: null, link: faceCheckLink(session.h5Link) };"));
    expect(sql).toContain("consented_at            timestamptz not null");
    expect(sql).toContain("consent_notice_version  text not null");
  });

  it("offers the notice and an UNTICKED box, with a way to say no", () => {
    const panel = readFileSync(join(__dirname, "..", "..", "components", "face-verification-panel.tsx"), "utf8");
    expect(panel).toContain("const [agreed, setAgreed] = useState(false);");
    expect(panel).toContain("disabled={!agreed || busy}");
    expect(panel).toContain("{c.notNow}");
    expect(panel).toContain('href="/privacy#facial-information"');
    expect(FACE_CONSENT_NOTICE_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("is admins-only behind its own switch while it is proved", () => {
    expect(actions).toContain('if (profile?.role !== "admin") return { error: FACE_NOT_OPEN };');
    expect(run).toContain('.eq("key", "face_verification")');
    expect(sql).toContain("'face_verification',\n  false,");
  });
});

describe("the callback trusts nothing it is handed", () => {
  it("reads the person's group with the token WE stored, never the address's", () => {
    expect(callback).toContain('getVerificationGroup(row.byted_token ?? "")');
    expect(callback).toContain("if (returned && returned !== row.byted_token)");
  });

  it("refuses a return signed in as another account, a late one and a failed one", () => {
    expect(callback).toContain("if (auth.user && auth.user.id !== row.user_id)");
    expect(callback).toContain("if (faceSessionExpired(row.created_at, new Date())) return close(\"expired\");");
    expect(callback).toContain("if (!faceCheckPassed(resultCode))");
  });

  it("keeps one verified face per account, and never leaves a second person's group behind", () => {
    expect(sql).toContain("on public.face_verifications (user_id) where status = 'verified'");
    expect(callback).toContain("await deleteFaceGroup(groupId);");
  });
});

describe("a verification lifts the check only for its own person (Usage Rules 5.2)", () => {
  it("reads the verified face of the account sending, and nobody else's", () => {
    expect(run).toContain("const face = await verifiedFaceOf(admin, userId);");
    const send = readFileSync(join(__dirname, "..", "generations", "actions.ts"), "utf8");
    expect(send).toContain("await faceAssetUrisFor(createAdminClient(), userData.user.id, characterId)");
    expect(send).toContain("!wantsMultiCharacter && !attachmentReferenceUrl && isByteplusCapable(videoModelId)");
  });

  it("carries only photos BytePlus accepted, to the one lane that can use them", () => {
    expect(run).toContain('.filter((a) => a.status === "active" && a.asset_id)');
    const queue = readFileSync(join(__dirname, "..", "generations", "providers", "video-queue.ts"), "utf8");
    expect(queue).toContain('const provider = withFace ? "byteplus" : videoProviderFor(modelId, chosen);');
    expect(queue).toContain("? options.faceAssetUris!");
  });
});

describe("withdrawal and deletion (Usage Rules 4.2, 5.3)", () => {
  it("stops using the face BEFORE deleting it, and queues what BytePlus refuses", () => {
    const withdraw = run.slice(run.indexOf("export async function withdrawFace"));
    expect(withdraw.indexOf('update({ status: "withdrawn"')).toBeLessThan(withdraw.indexOf("await deleteGroupOrGone("));
    expect(withdraw).toContain('.from("face_group_deletions")');
  });

  it("deletes a person's face at BytePlus before their account's rows cascade away, on both deletion paths", () => {
    // The admin path once had no withdrawal at all (2026-09-19): its face
    // stayed at BytePlus with nothing left here to find it by.
    for (const file of ["profile/actions.ts", "admin/actions.ts"]) {
      const source = readFileSync(join(__dirname, "..", file), "utf8");
      const stripe = source.indexOf("await cancelStripeCustomerBilling(");
      const faces = source.indexOf("await deleteUserFaces(admin, userId);");
      const authDelete = source.indexOf("const { error } = await admin.auth.admin.deleteUser(userId);");
      expect(stripe, file).toBeGreaterThan(-1);
      expect(faces, file).toBeGreaterThan(stripe);
      // Past the Stripe stop: a deletion that stops there keeps the face.
      expect(source.slice(stripe, faces), file).toMatch(/if \(stripeCancelError\) \{[\s\S]*?redirect\(/);
      expect(authDelete, file).toBeGreaterThan(faces);
    }
    // The ledger outlives the account on purpose: no foreign key.
    const ledger = sql.slice(sql.indexOf("create table if not exists public.face_group_deletions"), sql.indexOf("alter table public.face_verifications enable"));
    expect(ledger).not.toContain("references");
  });

  it("forgets a character's photos at BytePlus before the character goes", () => {
    const characters = readFileSync(join(__dirname, "..", "characters", "actions.ts"), "utf8");
    const count = characters.split("if (existing) await forgetCharacterFaceAssets(createAdminClient(), data.user.id, id);").length - 1;
    expect(count).toBe(2);
  });

  it("retries every owed deletion daily", () => {
    const prune = readFileSync(join(__dirname, "..", "..", "app", "api", "cron", "prune", "route.ts"), "utf8");
    expect(prune).toContain("await retryFaceGroupDeletions(admin)");
  });
});

describe("the privacy policy says what BytePlus's rules require (Usage Rules 3)", () => {
  const privacy = readFileSync(join(__dirname, "..", "i18n", "legal", "privacy.ts"), "utf8");
  it("carries the facial-information section in all four languages", () => {
    expect(privacy.split('id: "facial-information"').length - 1).toBe(4);
  });

  it("names the processor, the check, the reference image, the storage and deletion, consent and rights", () => {
    const en = privacy.slice(privacy.indexOf('heading: "Facial information (face verification)"'));
    const section = en.slice(0, en.indexOf("heading: \"Cookies & analytics\""));
    for (const must of ["BytePlus Pte. Ltd.", "live face check", "reference image", "compared", "Southeast Asia", "outside the European Economic Area", "deletes it at BytePlus", "withdraw your consent", "requests come to us, not to BytePlus", "which version of this notice"]) {
      expect(section, must).toContain(must);
    }
  });
});
